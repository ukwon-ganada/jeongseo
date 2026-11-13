// ============================================================================
//  사건방에 올라온 파일 받기 (works-bot-callback 이 부름)
//
//  1) 웍스 봇 토큰 만들기: 서비스 계정 JWT(RS256) → auth.worksmobile.com (사무실 PC 스크립트와 같은 방식)
//  2) GET /bots/{botId}/attachments/{fileId} → 302 Location → 그 주소에서 파일 받기
//  3) Supabase 비공개 저장소 case-files 에 올리고 case_file 표에 기록
//
//  필요한 시크릿 (Supabase > Edge Functions > Secrets, 값은 사무실 PC credentials.json 과 열쇠 파일):
//    WORKS_CLIENT_ID, WORKS_CLIENT_SECRET, WORKS_SERVICE_ACCOUNT, WORKS_PRIVATE_KEY(열쇠 파일 내용 전체)
//  파일 내용·이름은 로그에 남기지 않는다.
// ============================================================================

export type FileEnv = {
  sbUrl: string; sbKey: string;
  clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string;
};

const MAX_BYTES = 50 * 1024 * 1024;
const BUCKET = "case-files";

// ── 열쇠 (PEM) 읽기: "BEGIN PRIVATE KEY"(PKCS#8)·"BEGIN RSA PRIVATE KEY"(PKCS#1) 둘 다 ──
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
function der(tag: number, body: Uint8Array): Uint8Array {
  const l = derLen(body.length);
  const out = new Uint8Array(1 + l.length + body.length);
  out[0] = tag; out.set(l, 1); out.set(body, 1 + l.length);
  return out;
}
function concat(...xs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(xs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of xs) { out.set(x, o); o += x.length; }
  return out;
}
export function pemToPkcs8(pem: string): Uint8Array {
  const text = pem.replace(/\\n/g, "\n"); // 시크릿 칸에 한 줄로 붙여 넣은 경우
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(text);
  const body = b64ToBytes(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  if (!isPkcs1) return body;
  // PKCS#1 → PKCS#8: SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption OID, NULL }, OCTET STRING { pkcs1 } }
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algo = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, concat(version, algo, der(0x04, body)));
}

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? unescape(encodeURIComponent(b)) : String.fromCharCode(...b))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cached: { token: string; until: number } | null = null;

export async function botToken(env: FileEnv, fetcher: typeof fetch = fetch): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const { clientId, clientSecret, serviceAccount, privateKey } = env;
  if (!clientId || !clientSecret || !serviceAccount || !privateKey) throw new Error("웍스 열쇠 시크릿 없음");
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(privateKey) as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim)));
  const assertion = head + "." + claim + "." + b64url(sig);
  const r = await fetcher("https://auth.worksmobile.com/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      assertion, grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      client_id: clientId, client_secret: clientSecret, scope: "bot",
    }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("토큰 실패 " + r.status + " " + t.slice(0, 120));
  const j = JSON.parse(t);
  cached = { token: j.access_token, until: Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 300) * 1000 };
  return cached.token;
}

// Content-Disposition 에서 원래 파일 이름 꺼내기 (filename*=UTF-8''… 우선)
export function fileNameFrom(cd: string | null, url: string): string {
  if (cd) {
    const star = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/);
    if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* 아래로 */ } }
    const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/);
    if (plain) {
      const v = plain[1].trim();
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  try {
    const last = new URL(url).pathname.split("/").pop() || "";
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
  } catch { /* 무시 */ }
  return "";
}

// 저장소 안 위치: 한글·공백 없는 이름 (원래 이름은 표에 따로)
export function storagePath(channelId: string, lNum: string | null, fileName: string, when = new Date()): string {
  const k = new Date(when.getTime() + 9 * 3600e3).toISOString(); // KST
  const stamp = k.slice(0, 10).replace(/-/g, "") + "_" + k.slice(11, 19).replace(/:/g, "");
  const ext = (fileName.match(/\.([a-z0-9]{1,6})$/i)?.[1] || "bin").toLowerCase();
  const rand = crypto.randomUUID().slice(0, 8);
  const room = channelId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "room";
  return (lNum ? "case/" + String(lNum).replace(/[^a-zA-Z0-9_-]/g, "") : "room/" + room) + "/" + stamp + "_" + rand + "." + ext;
}

async function rest(env: FileEnv, path: string, init: RequestInit, fetcher: typeof fetch) {
  return fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

type Incoming = { botId: string; fileId: string; channelId: string; userId?: string; fileName?: string };

export async function saveRoomFile(env: FileEnv, f: Incoming, fetcher: typeof fetch = fetch): Promise<string> {
  // 같은 파일 신호가 두 번 와도 한 번만 (file_id unique)
  const m = await rest(env, "works_room_case?select=l_num,case_no,status&order=is_primary.desc,updated_at.desc&limit=1&channel_id=eq." +
    encodeURIComponent(f.channelId), {}, fetcher);
  const rows = m.ok ? await m.json() : (await m.body?.cancel(), []);
  const st = rows[0]?.status ?? null;
  const lNum = st && st !== "보류" ? (rows[0]?.l_num ?? null) : null;
  const caseNo = st && st !== "보류" ? (rows[0]?.case_no ?? null) : null;

  const ins = await rest(env, "case_file?on_conflict=file_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ file_id: f.fileId, bot_id: f.botId, channel_id: f.channelId, l_num: lNum, case_no: caseNo, works_user_id: f.userId ?? null, file_name: f.fileName || null }),
  }, fetcher);
  if (!ins.ok) throw new Error("기록 실패 " + ins.status + " " + (await ins.text()).slice(0, 120));
  const made = await ins.json();
  if (!Array.isArray(made) || !made.length) return "dup"; // 이미 받은 파일
  const id = made[0].id;

  const mark = (patch: Record<string, unknown>) =>
    rest(env, "case_file?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }, fetcher)
      .then((r) => r.body?.cancel());

  try {
    const tok = await botToken(env, fetcher);
    const a = await fetcher(`https://www.worksapis.com/v1.0/bots/${encodeURIComponent(f.botId)}/attachments/${encodeURIComponent(f.fileId)}`, {
      headers: { Authorization: "Bearer " + tok }, redirect: "manual",
    });
    let res: Response;
    if (a.status >= 300 && a.status < 400) {
      const loc = a.headers.get("location");
      await a.body?.cancel();
      if (!loc) throw new Error("내려받을 주소 없음");
      // 내려받는 주소도 같은 토큰을 요구함
      res = await fetcher(loc, { headers: { Authorization: "Bearer " + tok } });
    } else res = a;
    if (!res.ok) throw new Error("내려받기 실패 " + res.status + " " + (await res.text()).slice(0, 120));
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) { await res.body?.cancel(); throw new Error("50MB 넘는 파일"); }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error("50MB 넘는 파일");

    const name = f.fileName || fileNameFrom(res.headers.get("content-disposition"), res.url) || "파일";
    let ctype = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!ctype || ctype === "application/octet-stream") ctype = /\.pdf$/i.test(name) ? "application/pdf" : (ctype || "application/octet-stream");
    const path = storagePath(f.channelId, lNum, name);
    const up = await fetcher(env.sbUrl + "/storage/v1/object/" + BUCKET + "/" + path, {
      method: "POST",
      headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": ctype, "x-upsert": "false" },
      body: bytes,
    });
    if (!up.ok) throw new Error("보관 실패 " + up.status + " " + (await up.text()).slice(0, 120));
    await up.body?.cancel();
    await mark({ status: "보관", file_name: name, content_type: ctype, size_bytes: bytes.length, storage_path: path, saved_at: new Date().toISOString(), error: null });
    return "saved";
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 300);
    await mark({ status: "실패", error: msg });
    throw e;
  }
}

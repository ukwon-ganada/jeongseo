// 웍스 서비스 계정 토큰 (works-bot-callback/room_file.ts 의 botToken 과 같은 방식, scope 만 다름)
export type AuthEnv = { clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string };

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

const cache = new Map<string, { token: string; until: number }>();

export async function worksToken(env: AuthEnv, scope: string, fetcher: typeof fetch = fetch): Promise<string> {
  const hit = cache.get(scope);
  if (hit && hit.until > Date.now()) return hit.token;
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
      client_id: clientId, client_secret: clientSecret, scope,
    }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("토큰 실패 " + r.status + " " + t.slice(0, 120));
  const j = JSON.parse(t);
  cache.set(scope, { token: j.access_token, until: Date.now() + Math.max(60, (Number(j.expires_in) || 3600) - 300) * 1000 });
  return j.access_token;
}


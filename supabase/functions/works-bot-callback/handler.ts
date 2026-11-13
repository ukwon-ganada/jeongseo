// ============================================================================
//  works-bot-callback — 네이버웍스 봇 콜백 받기 (Supabase Edge Function, Deno)
//
//  지금 하는 일:
//    · 사건방 리치 메뉴 "이 방 사건 보기"(postback, data="room-case")를 받으면
//      누가(userId)·어느 방(channelId)에서 눌렀는지 pc_open_request 에 기록한다.
//      → 그 사람 PC의 "정서 사건 도우미"가 받아서 사건 화면을 연다.
//    · 사건방에 파일(file 메시지)이 올라오면 웍스에서 내려받아 비공개 저장소 case-files 에
//      보관하고 case_file 표에 기록한다 (room_file.ts). 글(text)은 받지도 저장하지도 않는다.
//      → 사건 화면 진행내용 탭에서 [열기]
//
//  보안: 웍스가 보낸 것인지 X-WORKS-Signature(봇 시크릿 HMAC-SHA256, Base64)로 확인.
//
//  필요한 시크릿:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Supabase 기본 주입)
//    WORKS_BOT_SECRET                          (개발자 콘솔 > 정서 시험봇 > Bot Secret)
//    WORKS_BOT_SECRET_PROD                     (개발자 콘솔 > 운영 봇 > Bot Secret) — 둘 중 하나와 맞으면 통과
//    WORKS_CLIENT_ID, WORKS_CLIENT_SECRET, WORKS_SERVICE_ACCOUNT, WORKS_PRIVATE_KEY  (파일 내려받기용, room_file.ts)
//  배포:  supabase functions deploy works-bot-callback --no-verify-jwt
//  콘솔:  Bot > Callback URL = https://<프로젝트>.supabase.co/functions/v1/works-bot-callback
//         (Callback 이벤트: postback + 파일. 텍스트는 켜지 않음)
// ============================================================================

import { saveRoomFile } from "./room_file.ts";

export const POSTBACK_ROOM_CASE = "room-case";

export async function hmacBase64(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Env = {
  sbUrl: string; sbKey: string; botSecret: string; botSecrets?: string[];
  clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string;
};

// 응답(200)을 먼저 보내고 뒤에서 계속 일하기 (Supabase Edge Runtime)
function background(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
}

async function rest(env: Env, path: string, init: RequestInit = {}) {
  return fetch(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: env.sbKey,
      Authorization: "Bearer " + env.sbKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const sig = req.headers.get("x-works-signature") || "";
  // 시험봇·운영 봇 시크릿 중 하나라도 맞으면 웍스가 보낸 것
  const secrets = [env.botSecret, ...(env.botSecrets || [])].filter(Boolean);
  let okSig = false;
  for (const sec of secrets) if (safeEqual(sig, await hmacBase64(raw, sec))) okSig = true;
  if (!okSig) return new Response("bad signature", { status: 401 });
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const data = ev?.data ?? ev?.content?.postback;
  const userId = ev?.source?.userId;
  const channelId = ev?.source?.channelId;
  // 시험 단계: 웍스가 보내는 모양 확인용 (내용·이름은 남기지 않음)
  console.log("event", ev?.type, Object.keys(ev || {}).join(","), "content:", ev?.content?.type || "", Object.keys(ev?.content || {}).join(","), typeof data === "string" ? data.slice(0, 30) : "", channelId ? "has-channel" : "no-channel");

  if (ev?.type === "postback" && data === POSTBACK_ROOM_CASE && userId && channelId) {
    // 한 방에 사건이 여럿이면 주 사건(상급심)을 연다
    const m = await rest(env, "works_room_case?select=l_num,case_no,status&order=is_primary.desc,updated_at.desc&limit=1&channel_id=eq." +
      encodeURIComponent(channelId));
    const rows = m.ok ? await m.json() : (await m.body?.cancel(), []);
    // 보류(어느 사건인지 확정 못 함)면 사건을 붙이지 않는다: 잘못 붙이느니 안 붙인다
    const st = rows[0]?.status ?? null;
    const hold = st === "보류";
    const caseNo = hold ? null : rows[0]?.case_no ?? null;
    const lNum = hold ? null : rows[0]?.l_num ?? null;
    const ins = await rest(env, "pc_open_request", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ works_user_id: userId, channel_id: channelId, l_num: lNum, case_no: caseNo, room_status: st }),
    });
    if (!ins.ok) console.error("insert failed", ins.status, await ins.text());
    else await ins.body?.cancel();
  }
  // 사건방에 올라온 파일 → 내려받아 보관 (오래 걸릴 수 있어 응답 뒤에)
  const content = ev?.content;
  if (ev?.type === "message" && content?.type === "file" && content?.fileId && channelId) {
    const botId = req.headers.get("x-works-botid") || String(ev?.botId || "");
    if (!botId) console.error("file: no bot id");
    else {
      background(saveRoomFile(env, { botId, fileId: String(content.fileId), channelId, userId, fileName: content.fileName || undefined }, fetcher)
        .then((r) => console.log("file", r))
        .catch((e) => console.error("file fail", String(e?.message || e).slice(0, 200))));
    }
  }

  // 웍스는 빨리 200을 받아야 다시 보내지 않음
  return new Response("ok");
}

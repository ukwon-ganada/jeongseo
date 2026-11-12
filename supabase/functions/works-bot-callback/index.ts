// ============================================================================
//  works-bot-callback — 네이버웍스 봇 콜백 받기 (Supabase Edge Function, Deno)
//
//  지금 하는 일:
//    · 사건방 리치 메뉴 "이 방 사건 보기"(postback, data="room-case")를 받으면
//      누가(userId)·어느 방(channelId)에서 눌렀는지 pc_open_request 에 기록한다.
//      → 그 사람 PC의 "정서 사건 도우미"가 받아서 사건 화면을 연다.
//  나중에 더할 일: 사건방에 올라온 서면 PDF 받기(file 메시지).
//
//  보안: 웍스가 보낸 것인지 X-WORKS-Signature(봇 시크릿 HMAC-SHA256, Base64)로 확인.
//
//  필요한 시크릿:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Supabase 기본 주입)
//    WORKS_BOT_SECRET                          (개발자 콘솔 > Bot > Bot Secret)
//  배포:  supabase functions deploy works-bot-callback --no-verify-jwt
//  콘솔:  Bot > Callback URL = https://<프로젝트>.supabase.co/functions/v1/works-bot-callback
//         (Callback 이벤트에 postback 포함)
// ============================================================================

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

type Env = { sbUrl: string; sbKey: string; botSecret: string };

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

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const sig = req.headers.get("x-works-signature") || "";
  if (!env.botSecret || !safeEqual(sig, await hmacBase64(raw, env.botSecret))) {
    return new Response("bad signature", { status: 401 });
  }
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const data = ev?.data ?? ev?.content?.postback;
  const userId = ev?.source?.userId;
  const channelId = ev?.source?.channelId;

  if (ev?.type === "postback" && data === POSTBACK_ROOM_CASE && userId && channelId) {
    // 한 방에 사건이 여럿이면 주 사건(상급심)을 연다
    const m = await rest(env, "works_room_case?select=l_num,case_no&order=is_primary.desc,updated_at.desc&limit=1&channel_id=eq." +
      encodeURIComponent(channelId));
    const rows = m.ok ? await m.json() : (await m.body?.cancel(), []);
    const caseNo = rows[0]?.case_no ?? null;
    const lNum = rows[0]?.l_num ?? null;
    const ins = await rest(env, "pc_open_request", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ works_user_id: userId, channel_id: channelId, l_num: lNum, case_no: caseNo }),
    });
    if (!ins.ok) console.error("insert failed", ins.status, await ins.text());
    else await ins.body?.cancel();
  }
  // 웍스는 빨리 200을 받아야 다시 보내지 않음
  return new Response("ok");
}

if (import.meta.main) {
  Deno.serve((req) =>
    handle(req, {
      sbUrl: Deno.env.get("SUPABASE_URL")!,
      sbKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      botSecret: Deno.env.get("WORKS_BOT_SECRET") || "",
    })
  );
}

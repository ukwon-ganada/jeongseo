// ============================================================================
//  case-view — 웍스 사건 화면(woff/case.html)에 실제 사건 자료를 주는 곳 (Supabase Edge Function)
//
//  1단계(지금): 직원 확인만 시험한다.
//    화면이 보낸 웍스 로그인 토큰을 웍스 API(users/me)에 직접 물어봐 "누구인지" 확인한다.
//    화면이 스스로 말하는 이름(getProfile)은 믿지 않는다.
//  2단계(다음): 확인된 직원에게만 방↔사건 표로 찾은 사건 자료를 주고 열람 기록을 남긴다.
//
//  호출: POST { "action": "whoami" }  + 헤더 X-Works-Token: <woff.getAccessToken()>
//  배포: verify_jwt=false (웍스 토큰으로 직접 확인)
// ============================================================================

const ALLOW_ORIGIN = "https://ukwon-ganada.github.io";
const CORS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-works-token, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export type WhoAmI = { ok: boolean; status: number; userId?: string; domainId?: number | string; name?: string; error?: string };

export async function worksWhoAmI(token: string, fetcher: typeof fetch = fetch): Promise<WhoAmI> {
  if (!token || token.length < 20) return { ok: false, status: 0, error: "토큰 없음" };
  const r = await fetcher("https://www.worksapis.com/v1.0/users/me", { headers: { Authorization: "Bearer " + token } });
  const t = await r.text();
  if (!r.ok) return { ok: false, status: r.status, error: t.slice(0, 200) };
  let u: any = {};
  try { u = JSON.parse(t); } catch { /* 무시 */ }
  const name = u?.userName ? [u.userName.lastName, u.userName.firstName].filter(Boolean).join("") : undefined;
  return { ok: true, status: r.status, userId: u?.userId, domainId: u?.domainId, name };
}

export async function handle(req: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* 빈 몸 허용 */ }
  const token = req.headers.get("x-works-token") || "";
  const who = await worksWhoAmI(token, fetcher);
  console.log("whoami", who.ok, who.status, who.domainId ?? "", who.error ? who.error.slice(0, 80) : "");
  if (body?.action === "whoami") return json(who, who.ok ? 200 : 401);
  return json({ error: "아직 준비 중" }, 400);
}

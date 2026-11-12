// ============================================================================
//  pc-helper-wait — PC "정서 사건 도우미"가 기다리는 곳 (Supabase Edge Function, Deno)
//
//  도우미가 GET으로 부르면 최대 25초 기다리다가,
//  그 사람이 사건방에서 "이 방 사건 보기"를 누른 기록이 생기면 열 주소를 돌려준다.
//    200 {"url": "..."}  → 도우미가 브라우저로 연다
//    204                 → 새 기록 없음, 도우미가 바로 다시 부른다
//    401                 → 토큰이 틀리거나 막힘
//
//  인증: Authorization: Bearer <도우미 토큰>  (pc_helper_issue 로 발급, 해시만 저장)
//  시크릿: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (기본 주입)
//  배포:  supabase functions deploy pc-helper-wait --no-verify-jwt
// ============================================================================

export const WOFF = "https://woff.worksmobile.com/woff/Nxkob0LER_dfaSzH8s6flw";
const WAIT_MS = 25_000;
const STEP_MS = 1_000;
const FRESH_SEC = 60; // 1분 넘게 지난 클릭은 열지 않음 (PC가 꺼져 있다 켜졌을 때 엉뚱하게 열리지 않게)

type Env = { sbUrl: string; sbKey: string; waitMs?: number; stepMs?: number };

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

async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function openUrl(caseNo: string | null, channelId: string, status?: string | null): string {
  const p: Record<string, string> = caseNo ? { case: caseNo } : { room: channelId };
  if (status === "보류") p.hold = "1";        // 사건 화면 대신 "아직 정해지지 않음" 안내만
  else if (status === "종결" && caseNo) p.closed = "1"; // 화면은 열고 '종결' 표시
  p.view = "timeline";
  return WOFF + "?" + new URLSearchParams(p).toString();
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{48}$/.test(tok)) return new Response("unauthorized", { status: 401 });
  const h = await sha256Hex(tok);
  const d = await rest(env, "pc_helper_device?select=id,works_user_id&revoked_at=is.null&token_hash=eq." + h);
  const dev = d.ok ? (await d.json())[0] : null;
  if (!dev) return new Response("unauthorized", { status: 401 });
  await rest(env, "pc_helper_device?id=eq." + dev.id, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
  }).then((x) => x.body?.cancel());

  const until = Date.now() + (env.waitMs ?? WAIT_MS);
  while (Date.now() < until) {
    const since = new Date(Date.now() - FRESH_SEC * 1000).toISOString();
    const r = await rest(env,
      "pc_open_request?select=id,channel_id,case_no,room_status&delivered_at=is.null" +
        "&works_user_id=eq." + encodeURIComponent(dev.works_user_id) +
        "&created_at=gte." + encodeURIComponent(since) + "&order=created_at.desc&limit=1");
    const row = r.ok ? (await r.json())[0] : null;
    if (row) {
      // 같은 사람 PC가 두 대여도 한 대만 열리게: 아직 안 가져간 것만 표시
      const u = await rest(env, "pc_open_request?id=eq." + row.id + "&delivered_at=is.null", {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ delivered_at: new Date().toISOString() }),
      });
      const got = u.ok ? await u.json() : [];
      if (got.length) {
        return new Response(JSON.stringify({ url: openUrl(row.case_no, row.channel_id, row.room_status) }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    await new Promise((s) => setTimeout(s, env.stepMs ?? STEP_MS));
  }
  return new Response(null, { status: 204 });
}

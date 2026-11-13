// ============================================================================
//  pc-helper-wait — PC "정서 사건 도우미"가 기다리는 곳 (Supabase Edge Function, Deno)
//
//  도우미가 GET으로 부르면 최대 25초 기다리다가,
//  그 사람이 사건방에서 "이 방 사건 보기"를 누른 기록이 생기면 열 주소를 돌려준다.
//    200 {"url": "..."}  → 도우미가 브라우저로 연다
//    204                 → 새 기록 없음, 도우미가 바로 다시 부른다
//    200 {"task":"ocr","id":N} → 사건 화면(PC)이 "지금 어느 방?"을 물음. 도우미가 웍스 창 방 제목을 읽어
//                          POST {"id":N,"lines":[{x,y,t}...]} 로 보내면 서버가 방을 찾아 pc_locate 에 적는다
//    401                 → 토큰이 틀리거나 막힘
//
//  인증: Authorization: Bearer <도우미 토큰>  (pc_helper_issue 로 발급, 해시만 저장)
//  시크릿: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (기본 주입)
//  배포:  supabase functions deploy pc-helper-wait --no-verify-jwt
// ============================================================================

export const WOFF = "https://woff.worksmobile.com/woff/Nxkob0LER_dfaSzH8s6flw";
const WAIT_MS = 25_000;
const STEP_MS = 600;
const LOCATE_FRESH_SEC = 20; // 방 찾기 요청은 20초 안에 받아 간 것만 (화면이 기다리는 시간)
const FRESH_SEC = 60; // 1분 넘게 지난 클릭은 열지 않음 (PC가 꺼져 있다 켜졌을 때 엉뚱하게 열리지 않게)

import { matchRoom, type OcrLine } from "./match.ts";

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

const jsonRes = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// 도우미가 읽은 방 제목을 받아 방을 찾고 pc_locate 에 적는다
async function report(req: Request, env: Env, userId: string): Promise<Response> {
  let b: any = {};
  try { b = await req.json(); } catch { /* */ }
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return jsonRes({ error: "id" }, 400);
  const own = await rest(env, `pc_locate?select=id&id=eq.${id}&works_user_id=eq.${encodeURIComponent(userId)}&done_at=is.null`);
  if (!own.ok || !(await own.json()).length) return jsonRes({ error: "not found" }, 404);
  const lines: OcrLine[] = (Array.isArray(b.lines) ? b.lines : []).slice(0, 80).map((l: any) => ({
    x: Number(l?.x) || 0, y: Number(l?.y) || 0, t: String(l?.t ?? "").slice(0, 200),
  }));
  let m = { channelId: null as string | null, how: "error", score: 0, header: String(b?.error ?? "").slice(0, 200) };
  if (!b?.error) {
    const rr = await rest(env, "works_room_case?select=channel_id,room_title&room_title=not.is.null&limit=5000");
    m = matchRoom(lines, rr.ok ? await rr.json() : []);
  }
  await rest(env, `pc_locate?id=eq.${id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ done_at: new Date().toISOString(), channel_id: m.channelId, how: m.how, score: m.score, header_text: m.header.slice(0, 300) }),
  }).then((x) => x.body?.cancel());
  return jsonRes({ ok: true, found: !!m.channelId, how: m.how });
}

// 이 직원의 방 찾기 요청 하나를 집어 온다 (PC 두 대여도 한 대만)
async function takeLocate(env: Env, userId: string): Promise<number | null> {
  const since = new Date(Date.now() - LOCATE_FRESH_SEC * 1000).toISOString();
  const r = await rest(env, "pc_locate?select=id&taken_at=is.null&works_user_id=eq." + encodeURIComponent(userId) +
    "&created_at=gte." + encodeURIComponent(since) + "&order=created_at.desc&limit=1");
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return null;
  const u = await rest(env, `pc_locate?id=eq.${row.id}&taken_at=is.null`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ taken_at: new Date().toISOString() }),
  });
  const got = u.ok ? await u.json() : [];
  return got.length ? row.id : null;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^[0-9a-f]{48}$/.test(tok)) return new Response("unauthorized", { status: 401 });
  const h = await sha256Hex(tok);
  const d = await rest(env, "pc_helper_device?select=id,works_user_id&revoked_at=is.null&token_hash=eq." + h);
  const dev = d.ok ? (await d.json())[0] : null;
  if (!dev) return new Response("unauthorized", { status: 401 });
  if (req.method === "POST") return report(req, env, dev.works_user_id);
  // 도우미 버전(?v=2 이상)만 방 찾기 일을 받는다. 옛 도우미는 받아도 처리 못 하므로 주지 않음
  const canOcr = Number(new URL(req.url).searchParams.get("v") || "1") >= 2;
  await rest(env, "pc_helper_device?id=eq." + dev.id, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
  }).then((x) => x.body?.cancel());

  const until = Date.now() + (env.waitMs ?? WAIT_MS);
  while (Date.now() < until) {
    if (canOcr) {
      const lid = await takeLocate(env, dev.works_user_id);
      if (lid) return jsonRes({ task: "ocr", id: lid });
    }
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

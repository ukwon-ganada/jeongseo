// ============================================================================
//  휴대폰 [일정 입력] → [저장]: 직원이 사건 화면에서 확인·고친 일정을 변호사 웍스 캘린더에 넣는다
//  (석원 2026-11-25 "휴대폰에서도 입력할 수 있도록". 웍스 캘린더 웹 입력 창은 휴대폰에서 열리지 않음)
//  서비스 계정 토큰(scope calendar user.read)으로 POST /users/{변호사}/calendar/events (기본 캘린더)
// ============================================================================
import { calToken, works } from "./hearing_notify.ts";
import type { SchedEnv } from "./schedule_cmd.ts";

export type SaveIn = { summary: string; date: string; start: string; end: string; location?: string; description?: string; lawyer: string };

const pad = (n: number) => String(n).padStart(2, "0");
const T = /^([01]\d|2[0-3]):[0-5]\d$/;

export function checkSave(b: any): SaveIn | string {
  const o: SaveIn = {
    summary: String(b?.summary ?? "").trim().slice(0, 200), date: String(b?.date ?? "").trim(),
    start: String(b?.start ?? "").trim(), end: String(b?.end ?? "").trim(),
    location: String(b?.location ?? "").trim().slice(0, 200), description: String(b?.description ?? "").slice(0, 2000),
    lawyer: String(b?.lawyer ?? "").trim(),
  };
  if (!o.summary) return "제목이 비었습니다";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date) || isNaN(Date.parse(o.date))) return "날짜가 잘못됐습니다";
  if (!T.test(o.start)) return "시작 시각이 잘못됐습니다";
  if (!o.end) { const [h, m] = o.start.split(":").map(Number); o.end = `${pad(Math.min(h + 1, 23))}:${pad(m)}`; }
  if (!T.test(o.end) || o.end <= o.start) return "끝 시각이 잘못됐습니다";
  if (!o.lawyer) return "캘린더(변호사)를 골라 주세요";
  return o;
}

export function eventBody(o: SaveIn) {
  const c: Record<string, unknown> = {
    summary: o.summary,
    start: { dateTime: `${o.date}T${o.start}:00`, timeZone: "Asia/Seoul" },
    end: { dateTime: `${o.date}T${o.end}:00`, timeZone: "Asia/Seoul" },
  };
  if (o.location) c.location = o.location;
  if (o.description) c.description = o.description;
  return { eventComponents: [c] };
}

let users: Map<string, string> | null = null;
async function userIdOf(env: SchedEnv, name: string, fetcher: typeof fetch): Promise<string | null> {
  if (!users) {
    const tok = await calToken(env, fetcher);
    const m = new Map<string, string>();
    let cur = "";
    for (let i = 0; i < 20; i++) {
      const j = await works(tok, `/users?count=100${cur ? "&cursor=" + encodeURIComponent(cur) : ""}`, fetcher);
      for (const u of j.users || []) m.set([u?.userName?.lastName, u?.userName?.firstName].filter(Boolean).join(""), u.userId);
      cur = j?.responseMetaData?.nextCursor || "";
      if (!cur) break;
    }
    users = m;
  }
  return users.get(name) || null;
}

export async function saveEvent(env: SchedEnv, b: unknown, fetcher: typeof fetch = fetch): Promise<{ ok?: true; eventId?: string; why?: string }> {
  const o = checkSave(b);
  if (typeof o === "string") return { why: o };
  const uid = await userIdOf(env, o.lawyer, fetcher);
  if (!uid) return { why: o.lawyer + " 캘린더를 찾지 못했습니다" };
  const tok = await calToken(env, fetcher, "calendar user.read");
  const r = await fetcher(`https://www.worksapis.com/v1.0/users/${encodeURIComponent(uid)}/calendar/events`, {
    method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(eventBody(o)),
  });
  const t = await r.text();
  if (!r.ok) {
    console.log("schedSave fail", r.status, t.slice(0, 200));
    return { why: r.status === 403 || /scope/i.test(t) ? "캘린더 쓰기 권한이 아직 없습니다" : "캘린더에 넣지 못했습니다 (" + r.status + ")" };
  }
  let j: any = {};
  try { j = t ? JSON.parse(t) : {}; } catch { /* */ }
  return { ok: true, eventId: String(j?.eventComponents?.[0]?.eventId || j?.eventId || "") };
}

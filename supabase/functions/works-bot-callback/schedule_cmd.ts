// ============================================================================
//  "/일정" — 사건방에서 치면 웍스 캘린더 새 일정 입력 창을 미리 채워서 연다 (석원 2026-11-25)
//
//  · 캘린더에 바로 넣지 않는다. 채워진 입력 창 링크만 주고, 직원이 확인 뒤 [저장]을 누른다.
//    (입력 창 주소 칸: summary 제목, startDateTime·endDateTime, location 장소, description 메모 — 석원 실측)
//  · 기일은 로웨어(나의사건) 기일 중 오늘 이후 가장 가까운 것. 없으면 case_all 의 다음 기일.
//  · 제목 규칙(2026-11-25 실제 캘린더 2,115건에서 찾음):
//      [(영상)]머리글)종류_이름        예) (증인)강)공판_임윤선 · 강)변론_이윤정/신용보증기금 · 예)공판_국선 김철우
//      머리글: 방 제목 앞머리 서)·이)·박)·강) → 서고은(머리글 안 붙임)·이예나 "예)"·박종덕 "박)"·강현구 "강)"
//      종류: 공판·선고(형사) / 변론·판결선고(민사) / 조정·심문·심리 등은 "기일"만 뺀다
//      민사·가사는 "의뢰인/상대방", 국선은 "국선 이름". (증인) 같은 표시는 직원이 창에서 붙인다.
//  · 시간은 기일 시각부터 1시간, 장소는 "법원 법정" (예: 인천지방법원 316호법정)
// ============================================================================
import { botToken } from "./room_file.ts";

export type SchedEnv = {
  sbUrl: string; sbKey: string;
  clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string;
};

export const CAL_EDIT = "https://calendar.worksmobile.com/web/calendar/scheduleEdit";

export function isScheduleCmd(text: unknown): boolean {
  return typeof text === "string" && /^\s*\/\s*일정\s*$/.test(text);
}

// 방 제목 앞머리 → 담당 변호사. "강)신)!(형/피고인)…" 처럼 여러 개면 변호사 표시만 본다
const LAWYERS: Record<string, { name: string; head: string }> = {
  "서": { name: "서고은", head: "" },
  "이": { name: "이예나", head: "예)" },
  "박": { name: "박종덕", head: "박)" },
  "강": { name: "강현구", head: "강)" },
};
export function lawyerFromTitle(title: string): { name: string; head: string } | null {
  const lead = String(title || "").split("(")[0]; // 사건 구분 "(형/…)" 앞까지만
  for (const m of lead.matchAll(/([가-힣])\)/g)) if (LAWYERS[m[1]]) return LAWYERS[m[1]];
  return null;
}

// 형사 사건부호 (그 밖은 민사·가사·행정으로 보고 "의뢰인/상대방")
const CRIMINAL = new Set(["고단", "고합", "고정", "고약", "고약전", "노", "도", "초기", "초보", "초적", "초재", "감고", "감노", "감도", "로", "모", "오", "코", "재고단", "재고합", "재노", "재도"]);
export function isCriminal(caseNo: string): boolean {
  const m = String(caseNo || "").replace(/\s/g, "").match(/^\d{2,4}([가-힣]+)\d/);
  return !!m && CRIMINAL.has(m[1]);
}

// "공판기일(316호법정 14:00)" / "변론기일(302호 법정 09:50) [일방 화상장치]"
export function parseHearing(contents: string): { kind: string; room: string; time: string; video: boolean } {
  const s = String(contents || "");
  const kind = s.split("(")[0].trim();
  const inner = s.match(/\(([^)]*)\)/)?.[1] || "";
  const time = inner.match(/(\d{1,2}):(\d{2})/);
  const room = inner.replace(/\d{1,2}:\d{2}/, "").trim();
  return { kind, room, time: time ? time[1].padStart(2, "0") + ":" + time[2] : "", video: /화상|영상/.test(s) };
}

export function kindWord(kind: string, criminal: boolean): string {
  const k = kind.replace(/\s/g, "");
  if (/^판결선고/.test(k)) return "판결선고";
  if (/^선고/.test(k)) return criminal ? "선고" : "판결선고";
  return k.replace(/기일$/, "") || "기일";
}

export type Plan = {
  summary: string; date: string; time: string; location: string; description: string; lawyer: string | null;
};

export function buildPlan(o: {
  roomTitle: string; caseNo: string; client: string; another: string; court: string; gukseon: boolean;
  date: string; time: string; contents: string;
}): Plan {
  const lw = lawyerFromTitle(o.roomTitle);
  const crim = isCriminal(o.caseNo);
  const h = parseHearing(o.contents);
  const client = String(o.client || "").split(/[,(]/)[0].trim();
  const who = crim ? (o.gukseon ? "국선 " : "") + client : [client, String(o.another || "").trim()].filter(Boolean).join("/");
  const summary = (h.video ? "(영상)" : "") + (lw?.head || "") + kindWord(h.kind, crim) + "_" + who;
  const location = [String(o.court || "").trim(), h.room].filter(Boolean).join(" ");
  return {
    summary, date: o.date, time: o.time || h.time, location,
    description: [o.caseNo, o.contents].filter(Boolean).join(" ") + "\n(로웨어 기일 기준, 도우미가 채움)",
    lawyer: lw?.name || null,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export function calendarUrl(p: Plan): string {
  const q = new URLSearchParams({ action: "insert", bRouterPush: "true", summary: p.summary });
  if (p.time) {
    const [h, m] = p.time.split(":").map(Number);
    q.set("startDateTime", `${p.date}T${pad(h)}:${pad(m)}:00`);
    q.set("endDateTime", `${p.date}T${pad((h + 1) % 24)}:${pad(m)}:00`);
  } else {
    q.set("startDateTime", `${p.date}T09:00:00`);
    q.set("endDateTime", `${p.date}T10:00:00`);
  }
  if (p.location) q.set("location", p.location);
  if (p.description) q.set("description", p.description);
  return CAL_EDIT + "?" + q.toString();
}

async function rest(env: SchedEnv, path: string, fetcher: typeof fetch): Promise<any[]> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, { headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey } });
  if (!r.ok) { await r.body?.cancel(); return []; }
  return await r.json();
}

const W = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(d: string): string {
  const t = new Date(d + "T00:00:00Z");
  return `${t.getUTCMonth() + 1}.${t.getUTCDate()}.(${W[t.getUTCDay()]})`;
}

// 방에서 "/일정" → 계획 세우기 (보내기는 따로)
export async function planForRoom(env: SchedEnv, channelId: string, fetcher: typeof fetch = fetch): Promise<{ plan?: Plan; why?: string }> {
  const rooms = await rest(env, "works_room_case?select=l_num,case_no,room_title,status&order=is_primary.desc,updated_at.desc&channel_id=eq." + encodeURIComponent(channelId), fetcher);
  const room = rooms.find((r) => r.status !== "보류" && r.l_num) || null;
  if (!room) return { why: "이 방에 연결된 사건이 없습니다." };
  const nums = [...new Set(rooms.filter((r) => r.l_num && r.status !== "보류").map((r) => r.l_num))];
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const ev = await rest(env, `lw_process_events?select=l_num,l_code,lp_appoint_date,lp_appoint_time,lp_contents,court&lp_set=eq.${encodeURIComponent("기일")}&lp_appoint_date=gte.${today}&l_num=in.(${nums.join(",")})&order=lp_appoint_date.asc,lp_appoint_time.asc&limit=1`, fetcher);
  const cs = await rest(env, `case_all?select=l_num,l_code,l_client,court,next_date,next_time,next_contents,raw->>l_another&l_num=in.(${nums.join(",")})`, fetcher);
  let h: { l_num: number; date: string; time: string; contents: string } | null = null;
  if (ev[0]) h = { l_num: ev[0].l_num, date: String(ev[0].lp_appoint_date).slice(0, 10), time: String(ev[0].lp_appoint_time || "").slice(0, 5), contents: ev[0].lp_contents || "" };
  else {
    const c = cs.filter((c) => c.next_date && String(c.next_date).slice(0, 10) >= today && /기일/.test(c.next_contents || "")).sort((a, b) => String(a.next_date).localeCompare(String(b.next_date)))[0];
    if (c) h = { l_num: c.l_num, date: String(c.next_date).slice(0, 10), time: String(c.next_time || "").slice(0, 5), contents: c.next_contents || "" };
  }
  if (!h) return { why: "로웨어에 앞으로 잡힌 기일이 없습니다." };
  const c = cs.find((x) => x.l_num === h!.l_num) || cs[0] || {};
  const caseNo = String(c.l_code || room.case_no || "");
  const gk = await rest(env, "gukseon_cases?select=data->>caseNumber&limit=3000", fetcher);
  const norm = (s: string) => String(s || "").replace(/\s/g, "");
  const gukseon = gk.some((g) => norm(g.caseNumber) === norm(caseNo));
  const plan = buildPlan({
    roomTitle: room.room_title || "", caseNo, client: c.l_client || "", another: c.l_another || "", court: c.court || "",
    gukseon, date: h.date, time: h.time, contents: h.contents,
  });
  return { plan };
}

export async function sendToRoom(env: SchedEnv, botId: string, channelId: string, content: unknown, fetcher: typeof fetch = fetch) {
  const tok = await botToken(env as any, fetcher);
  const r = await fetcher(`https://www.worksapis.com/v1.0/bots/${encodeURIComponent(botId)}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error("보내기 실패 " + r.status + " " + (await r.text()).slice(0, 120));
  await r.body?.cancel();
}

export function planMessage(p: Plan): unknown {
  const when = dayLabel(p.date) + (p.time ? " " + p.time : "");
  return {
    type: "button_template",
    contentText: `${p.summary}\n${when} · ${p.location || "장소 없음"}` + (p.lawyer ? `\n캘린더: ${p.lawyer}` : ""),
    actions: [{ type: "uri", label: "일정 입력 창 열기", uri: calendarUrl(p) }],
  };
}

export async function handleScheduleCmd(env: SchedEnv, botId: string, channelId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const r = await planForRoom(env, channelId, fetcher);
  const content = r.plan ? planMessage(r.plan) : { type: "text", text: "일정을 채우지 못했습니다: " + r.why };
  await sendToRoom(env, botId, channelId, content, fetcher);
  return r.plan ? "sent" : "none:" + r.why;
}

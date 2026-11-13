// ============================================================================
//  case-view — 웍스 사건 화면(woff/case.html)에 실제 사건 자료를 주는 곳 (Supabase Edge Function)
//
//  모든 요청은 먼저 "누가 열었는지" 확인한다.
//    화면이 보낸 웍스 로그인 토큰을 웍스 API(users/me)에 직접 물어본다.
//    화면이 스스로 말하는 이름(getProfile)은 믿지 않는다.
//  확인된 직원에게만 자료를 주고, 열 때마다 case_view_log 에 기록한다.
//
//  호출: POST + 헤더 X-Works-Token: <woff.getAccessToken()>
//    { "action": "whoami" }                         → 누구인지
//    { "action": "case", "room": "<방ID>" }          → 방↔사건 표(works_room_case)로 찾은 사건
//    { "action": "case", "case": "<사건번호>" }       → 사건번호로 찾은 사건
//    { "action": "mycases" }                        → 내가 담당인 진행 사건 (고르기 화면용)
//    { "action": "save_info", "lNum": 123, "fields": {...} } → 사건 정보 저장(case_info, 수정 기록 case_info_log)
//    { "action": "file_open", "id": 12 }             → 사건방에 올린 서면 파일 열람 주소(5분짜리, 비공개 저장소 case-files)
//    { "action": "set_file", "lNum": 1, "lp": 55, "id": 12 } → 타임라인 제출 줄에 붙을 파일을 직원이 직접 고름
//    { "action": "locate" }                         → PC: 이 직원 PC 도우미에게 웍스 창 방 제목을 읽게 해서 지금 방을 찾음(최대 8초)
//    { "action": "link_room", "room": "<방ID>", "case": "<사건번호>" } → 연결 안 된 방에 고른 사건 기억
//    { "action": "helper_token" }                   → 이 직원의 PC 도우미 연결 코드 발급(한 번만 보여 줌, 서버엔 해시만)
//  사건 정보 칸은 우리가 직접 입력·수정한다. 로웨어와 연동하지 않는다(자동으로 덮어쓰지 않음).
//    저장된 값이 없을 때만 처음 값으로 로웨어 값을 한 번 보여 준다(PREFILL_FROM_LAWWARE).
//  보류 방은 사건을 붙이지 않는다(잘못 붙이느니 안 붙인다) → { hold: true }
//    단, 그 방 대화에서 AI가 뽑은 일정(room_event)이 있으면 그것만으로 화면을 준다({ roomOnly: true, ... })
//  가져오지 않는 것: 주민번호·주소 등 개인정보 칸
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

import { computeDeadlines, deadlineEvents } from "./deadlines.ts";
export const DEADLINE_NOTE = "잠정 계산입니다(형사 항소·상고·이유서만). 선고일·기록접수통지 도달일로 계산했고, 알림은 보내지 않습니다. 꼭 나의사건 기록으로 한 번 더 확인해 주세요.";
export type Env = { sbUrl: string; sbKey: string };
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

// ── DB (PostgREST, 서비스 키) ────────────────────────────
async function rest(env: Env, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error("DB " + r.status + " " + (await r.text()).slice(0, 200));
  const t = r.status === 204 ? "" : await r.text();
  return t ? JSON.parse(t) : null;
}
const enc = (s: string) => encodeURIComponent(s);
const inList = (xs: string[]) => "(" + xs.map((x) => '"' + x.replace(/"/g, "") + '"').join(",") + ")";

// 사건번호 모양 바꾸기: 2026고단01234 / 26고단1234 → 후보 여러 개로 찾기
export function caseNoVariants(p: string): string[] {
  const s = (p || "").replace(/\s/g, "");
  const out = new Set<string>([s]);
  const m = s.match(/^(\d{2}|\d{4})([가-힣]+)0*(\d+)$/);
  if (m) {
    const y4 = m[1].length === 2 ? "20" + m[1] : m[1];
    out.add(y4 + m[2] + m[3]);
    out.add(y4.slice(2) + m[2] + m[3]);
  }
  return [...out].filter(Boolean);
}

// ── 자료를 화면 모양으로 바꾸기 ─────────────────────────
// "보정서"처럼 "정서"가 들어간 낱말과 헷갈리지 않게 "법무법인 정서"로 찾음
const OUR_FIRM = /법무법인\s*정서/;
export const PREFILL_FROM_LAWWARE = true;
export const INFO_FIELDS = ["case_name", "client_name", "client_phone", "lawyer", "court_dept", "court_phone", "investigator", "investigator_phone", "memo", "extra_phones"] as const;
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
export const kstToday = () => kstNow().toISOString().slice(0, 10);
const dot = (d: string) => d.replace(/-/g, ".");
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
const nz = (v: unknown) => (v == null ? "" : String(v).trim());

// 기일 내용 "공판기일(411호 법정 10:10)" → 법정 "411호 법정"
function placeOf(contents: string): string {
  const m = contents.match(/\(([^()]*)\)\s*$/);
  return m ? m[1].replace(/\s*\d{1,2}:\d{2}\s*$/, "").trim() : "";
}

// 추가 전화(가족 등): [{n:"어머니", p:"010-…"}] 를 JSON 글자로. 최대 10개, 빈 줄은 버림
export function cleanPhones(v: unknown): string {
  let a: any[] = [];
  try { a = JSON.parse(nz(v) || "[]"); } catch { return ""; }
  if (!Array.isArray(a)) return "";
  const out = a.map((x) => ({ n: nz(x?.n).slice(0, 20), p: nz(x?.p).slice(0, 30) })).filter((x) => x.n || x.p).slice(0, 10);
  return out.length ? JSON.stringify(out) : "";
}

// 사건 정보: 저장된 값(case_info)이 있으면 그것만, 없으면 처음 값으로 로웨어 값을 한 번 보여 줌
export function infoFields(c: any, saved: any | null, prefill = PREFILL_FROM_LAWWARE) {
  const raw = c.raw || {};
  const f: Record<string, string> = {};
  if (saved) { for (const k of INFO_FIELDS) f[k] = nz(saved[k]); }
  else if (prefill) {
    const police = [nz(raw.l_police_station), nz(raw.l_police_detective)].filter(Boolean).join(" ");
    const pros = nz(raw.l_prosecutor);
    Object.assign(f, {
      case_name: nz(c.l_name).replace(/^\[전자\]\s*/, ""), client_name: nz(raw.l_client), client_phone: nz(raw.l_client_hp),
      lawyer: nz(c.charge_lawyer).split(/[,\s]+/)[0] || "",
      court_dept: [nz(c.court), nz(raw.l_justice_dept).replace(/\s*\(?\s*전화.*$/, "")].filter(Boolean).join(" "),
      court_phone: (nz(raw.l_justice_dept).match(/전화\s*:?\s*([\d-]{7,})/) || [])[1] || "",
      investigator: police || (pros ? "검사 " + pros : ""), investigator_phone: nz(raw.l_police_tel) || nz(raw.l_prosecutor_tel), memo: "", extra_phones: "",
    });
  } else for (const k of INFO_FIELDS) f[k] = "";
  return { fields: f, saved: !!saved, updatedBy: saved ? nz(saved.updated_by) : "", updatedAt: saved ? nz(saved.updated_at) : "" };
}

export function shapeCase(c: any, evs: any[], opts: { today: string; linked: string[]; myHearings: any[]; status?: string; saved?: any }) {
  const raw = c.raw || {};
  const today = opts.today;
  const title = nz(c.l_name).replace(/^\[전자\]\s*/, "");
  const court = [nz(c.court), nz(raw.l_justice_dept).replace(/\s*\(?\s*전화.*$/, "")].filter(Boolean).join(" ");
  const list = evs
    .filter((e) => isDate(e.lp_appoint_date) && e.lp_set !== "문자" && e.lp_set !== "메일")
    .sort((a, b) => (a.lp_appoint_date + (a.lp_appoint_time || "")).localeCompare(b.lp_appoint_date + (b.lp_appoint_time || "")) || (a.lp_num || 0) - (b.lp_num || 0));

  const ours = (e: any) => e.lp_set === "서면" && OUR_FIRM.test(nz(e.lp_contents));
  const toUs = (e: any) => e.lp_set === "송달" && OUR_FIRM.test(nz(e.lp_contents));

  // 타임라인 (석원 결정 2026-11-13): "우리가 이 사건에서 한 일·해야 할 일"만.
  //   선임(수임일) → 기일 출석 → 우리 서면 제출(항소장 등) → 선고. 앞으로의 기일은 "예정".
  //   법원·상대방 기록(송달, 남의 서면, 명령, 번호 변경)은 나의사건 탭에만 둔다.
  //   g: accept 선임 / ours 우리 서면 / hearing 기일·선고 / (방 대화는 src:'chat')
  const events: any[] = [];
  const accept = isDate(raw.l_accept_date) ? raw.l_accept_date.slice(0, 10) : "";
  if (accept) events.push({ d: accept, k: "ours", g: "accept", t: "사건 선임", f: null });
  let verdictSeen = false;
  for (const e of list) {
    const d = e.lp_appoint_date.slice(0, 10);
    if (e.lp_set === "기일") {
      const verdict = /선고/.test(nz(e.lp_contents));
      if (verdict) verdictSeen = true;
      let t = nz(e.lp_contents);
      if (nz(e.lp_remark)) t += " · " + nz(e.lp_remark);
      const future = d >= today;
      events.push({ d, k: future ? "due" : verdict ? "ours" : "done", g: "hearing", t: (future ? "" : verdict ? "" : "출석 ") + t, f: null });
    } else if (ours(e)) {
      events.push({ d, k: "ours", g: "ours", t: nz(e.lp_contents).replace(/^.*?법무법인\s*정서\s*/, "") || nz(e.lp_contents), f: null, lp: e.lp_num });
    }
  }
  // 의뢰인에게 보낸 안내 문자도 우리가 한 일 (석원 2026-11-13). 인사말은 빼고 앞부분만.
  for (const e of evs) {
    if (e.lp_set !== "문자" || !isDate(e.lp_appoint_date)) continue;
    events.push({ d: e.lp_appoint_date.slice(0, 10), k: "done", g: "msg", t: "안내 문자 · " + smsGist(nz(e.lp_contents)), f: null });
  }
  const jd = isDate(raw.l_judgment_date) ? raw.l_judgment_date.slice(0, 10) : "";
  if (jd && !verdictSeen) events.push({ d: jd, k: jd >= today ? "due" : "ours", g: "hearing", t: "선고", f: null });
  const nextDate = isDate(c.next_date) ? c.next_date.slice(0, 10) : "";
  const hasNext = nextDate && list.some((e) => e.lp_set === "기일" && e.lp_appoint_date.slice(0, 10) === nextDate);
  if (nextDate >= today && !hasNext) {
    events.push({ d: nextDate, k: "due", g: "hearing", t: "다음 기일 " + [nz(c.next_time), nz(c.next_contents)].filter(Boolean).join(" ") });
  }
  // 법정기한(형사, 잠정 계산) — 석원 2026-11-13. 규칙서 엔진이 생기면 그 결과로 바꾼다.
  const deadlines = computeDeadlines(c.l_code, evs, today);
  events.push(...deadlineEvents(deadlines, today));
  events.sort((a, b) => a.d.localeCompare(b.d));

  // 기일: 이 사건 기일 + 내 다른 사건의 다가오는 기일(“내 사건 전체” 보기용)
  const hearings: any[] = list.filter((e) => e.lp_set === "기일").map((e) => ({
    c: c.l_code, d: e.lp_appoint_date.slice(0, 10), tm: nz(e.lp_appoint_time) || "",
    t: nz(e.lp_contents).replace(/\([^()]*\)\s*$/, "") + (nz(e.lp_remark) ? " (" + nz(e.lp_remark) + ")" : ""),
    p: placeOf(nz(e.lp_contents)) || nz(e.court),
  }));
  if (nextDate >= today && !hasNext) hearings.push({ c: c.l_code, d: nextDate, tm: nz(c.next_time), t: nz(c.next_contents) || "다음 기일", p: court });
  for (const h of opts.myHearings) if (h.c !== c.l_code) hearings.push(h);

  // 진행내용: 로웨어 진행내역 전부(문자·메일 빼고)
  const kind: Record<string, string> = { 기일: "기일", 송달: "송달", 서면: "제출" };
  const rows = list.slice(-400).map((e) => ({
    d: dot(e.lp_appoint_date.slice(0, 10)), c: nz(e.lp_contents), r: nz(e.lp_remark), k: kind[e.lp_set] || "",
    o: ours(e) ? 1 : 0, u: toUs(e) ? 1 : 0, x: e.lp_set === "송달" && !toUs(e) ? 1 : 0, p: e.lp_appoint_date.slice(0, 10) > today ? 1 : 0,
  }));
  const seen = evs.map((e) => nz(e.last_seen_at)).filter(Boolean).sort().pop();
  const updated = seen ? kstMdHm(seen) : "기록 없음";
  // 이 사건 진행내역이 로웨어에서 마지막으로 추가·수정된 날 (lp_append_udate)
  const ud = evs.map((e) => nz(e.lp_append_udate).slice(0, 10)).filter(isDate).sort().pop();
  const changed = ud ? ud.slice(0, 4) + "." + ud.slice(5, 7) + "." + ud.slice(8, 10) : "";

  const info = { ...infoFields(c, opts.saved ?? null), linked: opts.linked };

  return {
    caseNo: c.l_code, lNum: c.l_num, title, court: court || "법원 정보 없음", today, closed: opts.status === "종결",
    events, deadlines, deadlineNote: DEADLINE_NOTE,
    hearings, progress: { updated, checked: "", changed, rows }, info,
  };
}
const kstMdHm = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, "$1.$2 $3");
// 로웨어를 마지막으로 성공해서 읽어 온 시각 (lawware-feed, 15분마다)
async function lastFeedRun(env: Env, fetcher: typeof fetch): Promise<string> {
  const r = await rest(env, `lw_feed_runs?select=finished_at&error=is.null&finished_at=not.is.null&order=id.desc&limit=1`, {}, fetcher).catch(() => []);
  return r?.[0]?.finished_at ? kstMdHm(r[0].finished_at) : "";
}
export function smsGist(c: string): string {
  let t = c.replace(/^\[(SMS|LMS|MMS)\]\s*/i, "").replace(/^\[법무법인\s*정서\]\s*/, "");
  const m = t.slice(0, 45).match(/^.*?(입니다|사무실입니다)[.\s]*/);
  if (m) t = t.slice(m[0].length);
  t = t.replace(/^안녕하세요[.,\s]*/, "");
  const cut = t.search(/[.!]|\s{2}/);
  t = (cut > 4 ? t.slice(0, cut) : t).trim();
  return t.length > 32 ? t.slice(0, 32) + "…" : t || "문자";
}
function md(d: string) { return Number(d.slice(5, 7)) + "." + d.slice(8, 10); }

// 담당자 이름으로 내 사건 찾기 (담당 직원·담당 변호사·수행 변호사 칸)
async function myCases(env: Env, name: string, fetcher: typeof fetch) {
  if (!name) return [];
  const n = enc("*" + name.replace(/[*,()]/g, "") + "*");
  return await rest(env, `cases?select=l_num,l_code,l_name,next_date,next_time,next_contents,court&state=neq.종결` +
    `&or=(charge_staff.ilike.${n},charge_lawyer.ilike.${n},perform_lawyer.ilike.${n})&order=next_date.asc.nullslast&limit=300`, {}, fetcher) || [];
}

// 사건방에 올린 파일: 이 사건 번호로 붙은 것 + 이 사건과 짝지어진 방에 올라온 것
export async function caseFiles(env: Env, lNum: string, fetcher: typeof fetch = fetch) {
  const rooms = await rest(env, `works_room_case?select=channel_id&l_num=eq.${enc(lNum)}`, {}, fetcher) || [];
  const ch = [...new Set(rooms.map((r: any) => nz(r.channel_id)).filter(Boolean))] as string[];
  const or = ch.length ? `or=(l_num.eq.${enc(lNum)},channel_id.in.${enc(inList(ch))})` : `l_num=eq.${enc(lNum)}`;
  const rows = await rest(env, `case_file?select=id,file_name,content_type,size_bytes,status,works_user_id,posted_at,lp_num&status=eq.보관&${or}&order=posted_at.desc&limit=300`, {}, fetcher) || [];
  // 올린 사람 이름: 사건 화면을 연 적이 있는 직원이면 열람 기록에서 이름을 찾음
  const ids = [...new Set(rows.map((r: any) => nz(r.works_user_id)).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (ids.length) {
    const seen = await rest(env, `case_view_log?select=works_user_id,viewer_name&works_user_id=in.${enc(inList(ids))}&viewer_name=not.is.null&order=viewed_at.desc&limit=500`, {}, fetcher).catch(() => []) || [];
    for (const v of seen) if (!names[v.works_user_id]) names[v.works_user_id] = nz(v.viewer_name);
  }
  return rows.map((r: any) => {
    const k = new Date(Date.parse(r.posted_at) + 9 * 3600e3).toISOString();
    return { id: r.id, n: nz(r.file_name) || "파일", d: k.slice(0, 10), tm: k.slice(11, 16), by: names[r.works_user_id] || "",
      sz: Number(r.size_bytes) || 0, pdf: /pdf/i.test(nz(r.content_type)) || /\.pdf$/i.test(nz(r.file_name)) ? 1 : 0,
      at: Date.parse(r.posted_at), lp: r.lp_num ?? null };
  });
}

// 사건방 대화에서 AI가 뽑은 일정(room_event): 수사 단계처럼 로웨어에 없는 일정
export async function roomEvents(env: Env, lNum: string | null, channels: string[], fetcher: typeof fetch = fetch) {
  const ors: string[] = [];
  if (lNum) ors.push(`l_num.eq.${enc(lNum)}`);
  if (channels.length) ors.push(`channel_id.in.${enc(inList(channels))}`);
  if (!ors.length) return [];
  return await rest(env, `room_event?select=id,kind,ev_date,ev_time,summary,state&hidden=eq.false&or=(${ors.join(",")})&order=ev_date.asc&limit=500`, {}, fetcher) || [];
}
const MEET = new Set(["조사", "출석요구", "기일"]);
export function mergeRoomEvents(shaped: any, rows: any[], caseNo: string) {
  const seen = new Set<string>();
  for (const r of rows) {
    const d = String(r.ev_date).slice(0, 10), tm = nz(r.ev_time);
    const key = d + tm + r.summary;
    if (seen.has(key)) continue; seen.add(key);
    const t = (tm ? tm + " " : "") + nz(r.summary);
    shaped.events.push({ d, k: d >= shaped.today && r.state !== "완료" ? "due" : "room", t, f: null, g: "chat", src: "chat" });
    if (MEET.has(r.kind)) shaped.hearings.push({ c: caseNo, d, tm, t: nz(r.summary), p: "사건방 대화" });
  }
  shaped.events.sort((a: any, b: any) => a.d.localeCompare(b.d));
}
// 접견(웍스 캘린더 → meet_event): 우리가 한 일. 앞으로의 접견은 "예정"
export function mergeMeets(shaped: any, rows: any[]) {
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.event_id)) continue; seen.add(r.event_id);
    const d = String(r.ev_date).slice(0, 10), tm = nz(r.ev_time), future = d >= shaped.today;
    const t = (tm ? tm + " " : "") + "접견" + (future ? " 예정" : "") + (nz(r.lawyer) ? " · " + nz(r.lawyer) : "") + (nz(r.place) ? " (" + nz(r.place) + ")" : "");
    shaped.events.push({ d, k: future ? "due" : "done", g: "meet", t, f: null });
  }
  shaped.events.sort((a: any, b: any) => a.d.localeCompare(b.d));
}
// 로웨어 사건이 없는 방(보류·미연결)이라도 대화 일정이 있으면 그것만으로 화면을 만든다
export function roomOnlyShape(title: string, rows: any[], today: string, myHearings: any[]) {
  const shaped: any = {
    caseNo: "", lNum: null, title: title || "사건방", court: "수사 단계 · 사건방 대화 기준", today, closed: false, roomOnly: true,
    events: [], deadlines: [], deadlineNote: "기한 계산은 새 규칙서 엔진이 완성되면 이곳에 표시됩니다.",
    hearings: [], progress: { updated: "로웨어 사건 없음", rows: [] },
    info: { fields: Object.fromEntries(INFO_FIELDS.map((k) => [k, ""])), saved: false, updatedBy: "", updatedAt: "", linked: [] },
  };
  mergeRoomEvents(shaped, rows, "");
  for (const h of myHearings) shaped.hearings.push(h);
  return shaped;
}

// 최종 제출본 고르기 (석원 결정 2026-11-13: "규칙은 어쨌든 마지막 서면")
//   로웨어에 "법무법인 정서 … 제출"(우리 서면)이 찍힌 날 D마다,
//   그 날짜(D)에 방에 올라온 문서 파일 중 마지막 하나만 그 줄에 붙인다 (석원: "그 날짜 최종서면만").
//   로웨어 제출 기록엔 시각이 없어서 "그날의 마지막"으로 본다. 초안·수정본은 화면에 내지 않는다.
//   실시간일 필요 없음: 로웨어에 제출이 뜬 뒤 사건 화면을 열 때 계산된다.
//   직원이 직접 고른 파일(lp_num)이 있으면 그것이 우선.
const DOC_RE = /\.(pdf|hwp|hwpx|doc|docx)$/i;
// 계약서(석원 2026-11-13): 방에 올라온 파일 이름에 "계약"·"약정서"가 들어가면 서면 후보에서 빼고
//   "사건 선임" 줄에 가장 최근 것 하나를 붙인다.
export const CONTRACT_RE = /계약|약정서/;
export function attachContract(events: any[], files: any[]) {
  const acc = events.find((e) => e.g === "accept");
  const c = files.filter((f) => CONTRACT_RE.test(f.n) && f.lp == null).sort((a, b) => b.at - a.at)[0];
  if (acc && c) acc.cf = { id: c.id, n: c.n };
  return events;
}
export function attachFinalFiles(events: any[], files: any[]) {
  const docs = files.filter((f) => (f.pdf || DOC_RE.test(f.n)) && (f.lp != null || !CONTRACT_RE.test(f.n)));
  const used = new Set<number>();
  const picked = new Map<string, any>();
  for (const f of docs) if (f.lp != null && !picked.has(String(f.lp))) { picked.set(String(f.lp), f); used.add(f.id); }
  const ours = events.filter((e) => e.k === "ours" && e.lp != null).sort((a, b) => a.d.localeCompare(b.d) || a.lp - b.lp);
  for (const e of ours) {
    const m = picked.get(String(e.lp));
    if (m) { e.f = { id: m.id, n: m.n, pick: 1 }; continue; }
    const pool = docs.filter((f) => !used.has(f.id) && f.lp == null && f.d === e.d)
      .sort((a, b) => b.at - a.at);
    if (pool[0]) { used.add(pool[0].id); e.f = { id: pool[0].id, n: pool[0].n, pick: 0 }; }
  }
  return events;
}

// 방 제목에서 사건번호 꺼내기 (OCR이 0을 O로 읽는 것까지)
export function caseNosIn(s: string): string[] {
  const out = new Set<string>();
  // 연도는 2026 처럼 4자리도, 26 처럼 2자리도 받는다(석원 2026-11-13)
  for (const m of String(s || "").matchAll(/(?<!\d)((?:19|20)\d{2}|\d{2})\s*([가-힣]{1,4})\s*([0-9OolI|]{1,7})/g)) {
    const n = m[3].replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/^0+/, "");
    const y = m[1].length === 2 ? "20" + m[1] : m[1];
    if (n) out.add(y + m[2] + n);
  }
  return [...out];
}

// 아직 연결 안 된 방 자동 연결: works-bot-callback 함수에 부탁 (웍스 봇 열쇠가 거기 있음). 실패해도 화면은 계속
async function autoLink(env: Env, body: { channelId: string; lNum?: number }, fetcher: typeof fetch): Promise<{ linked: number; how: string } | null> {
  try {
    const r = await fetcher(env.sbUrl + "/functions/v1/works-bot-callback", {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": env.sbKey }, body: JSON.stringify(body),
    });
    return r.ok ? await r.json() : (await r.body?.cancel(), null);
  } catch { return null; }
}

async function logView(env: Env, who: WhoAmI, action: string, room: string, c: any, fetcher: typeof fetch) {
  try {
    await rest(env, "case_view_log", { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ works_user_id: who.userId, viewer_name: who.name, action, channel_id: room || null, l_num: c?.l_num ?? null, case_no: c?.l_code ?? null }) }, fetcher);
  } catch (e) { console.log("log fail", String(e).slice(0, 120)); }
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* 빈 몸 허용 */ }
  const token = req.headers.get("x-works-token") || "";
  const who = await worksWhoAmI(token, fetcher);
  console.log("whoami", body?.action, who.ok, who.status, who.error ? who.error.slice(0, 80) : "");
  if (body?.action === "whoami") return json(who, who.ok ? 200 : 401);
  if (!who.ok) return json({ error: "직원 확인이 안 됐습니다. 웍스에서 다시 열어 주세요.", status: who.status }, 401);

  try {
    const today = kstToday();
    if (body?.action === "mycases") {
      const mine = await myCases(env, who.name || "", fetcher);
      return json({ name: who.name, cases: mine.map((c: any) => ({
        c: c.l_code, t: nz(c.l_name).replace(/^\[전자\]\s*/, ""),
        next: isDate(c.next_date) ? (c.next_date.slice(0, 10) >= today ? md(c.next_date) + " " + (nz(c.next_contents) || "기일") : "예정 기일 없음") : "예정 기일 없음",
      })) });
    }

    if (body?.action === "case") {
      const room = nz(body.room), caseParam = nz(body.case);
      let c: any = null, status: string | undefined, linked: string[] = [];
      if (room) {
        const q = `works_room_case?select=l_num,case_no,is_primary,status&channel_id=eq.${enc(room)}&order=is_primary.desc,updated_at.desc`;
        let maps = await rest(env, q, {}, fetcher) || [];
        // 아직 연결 안 된 새 방: 그 자리에서 방 제목 사건번호로 자동 연결 시도
        if (!maps.length && (await autoLink(env, { channelId: room }, fetcher))?.linked) maps = await rest(env, q, {}, fetcher) || [];
        const main = maps[0];
        if (!main || main.status === "보류") {
          // 로웨어 사건은 없지만 사건방 대화에서 뽑은 일정이 있으면 그것으로 보여 준다
          const rows = await roomEvents(env, null, [room], fetcher).catch(() => []);
          const act = !main ? "case:unpaired" : "case:hold";
          if (rows.length) {
            const t = (await rest(env, `works_room_case?select=room_title&channel_id=eq.${enc(room)}&room_title=not.is.null&limit=1`, {}, fetcher).catch(() => []))?.[0]?.room_title;
            await logView(env, who, act + ":chat", room, null, fetcher);
            return json(roomOnlyShape(nz(t), rows, today, []));
          }
          await logView(env, who, act, room, null, fetcher);
          return json(!main ? { unpaired: true } : { hold: true });
        }
        status = main.status;
        linked = maps.slice(1).map((m: any) => nz(m.case_no)).filter(Boolean);
        if (main.l_num != null) c = (await rest(env, `cases?select=*&l_num=eq.${main.l_num}`, {}, fetcher))[0];
        else if (main.case_no) c = (await rest(env, `cases?select=*&l_code=in.${enc(inList(caseNoVariants(main.case_no)))}&limit=1`, {}, fetcher))[0];
        if (!c) return json({ notfound: true, caseNo: main.case_no || "" });
      } else if (caseParam) {
        c = (await rest(env, `cases?select=*&l_code=in.${enc(inList(caseNoVariants(caseParam)))}&order=l_num.desc&limit=1`, {}, fetcher))[0];
        if (!c) return json({ notfound: true, caseNo: caseParam });
        if (c.state === "종결") status = "종결";
      } else return json({ error: "방이나 사건번호가 없습니다" }, 400);

      const roomRows = await rest(env, `works_room_case?select=channel_id&l_num=eq.${c.l_num}`, {}, fetcher).catch(() => []) || [];
      const chans = [...new Set([room, ...roomRows.map((r: any) => nz(r.channel_id))].filter(Boolean))] as string[];
      const [evs, mine, saved, files, chat, checked, meets] = await Promise.all([
        rest(env, `lw_process_events?select=lp_num,lp_set,lp_appoint_date,lp_appoint_time,lp_contents,lp_remark,delivered_date,court,last_seen_at,lp_append_udate&l_num=eq.${c.l_num}&order=lp_appoint_date.asc&limit=2000`, {}, fetcher),
        myCases(env, who.name || "", fetcher),
        rest(env, `case_info?select=*&l_num=eq.${c.l_num}`, {}, fetcher).then((r: any[]) => r?.[0] ?? null).catch(() => null),
        caseFiles(env, String(c.l_num), fetcher).catch((e) => { console.log("files fail", String(e).slice(0, 120)); return []; }),
        roomEvents(env, String(c.l_num), chans, fetcher).catch(() => []),
        lastFeedRun(env, fetcher),
        rest(env, `meet_event?select=event_id,ev_date,ev_time,lawyer,place&l_num=eq.${c.l_num}&order=ev_date.asc&limit=300`, {}, fetcher).catch(() => []),
      ]);
      const end = new Date(Date.parse(today) + 28 * 864e5).toISOString().slice(0, 10);
      const myHearings = mine.filter((m: any) => isDate(m.next_date) && m.next_date.slice(0, 10) >= today && m.next_date.slice(0, 10) <= end)
        .map((m: any) => ({ c: m.l_code, d: m.next_date.slice(0, 10), tm: nz(m.next_time), t: nz(m.next_contents) || "기일", p: nz(m.court) }));
      await logView(env, who, "case", room, c, fetcher);
      const shaped = shapeCase(c, evs || [], { today, linked, myHearings, status, saved });
      shaped.progress.checked = checked;
      attachFinalFiles(shaped.events, files);
      attachContract(shaped.events, files);
      mergeRoomEvents(shaped, chat, c.l_code);
      mergeMeets(shaped, meets || []);
      // 직원이 줄마다 파일을 바꿀 때 고를 목록 (화면에 따로 나열하지 않음)
      const fileChoices = files.map((f: any) => ({ id: f.id, n: f.n, d: f.d, tm: f.tm, by: f.by }));
      return json({ ...shaped, fileChoices });
    }

    if (body?.action === "file_open") {
      const id = Number(body.id);
      if (!Number.isFinite(id) || id <= 0) return json({ error: "파일이 없습니다" }, 400);
      const f = (await rest(env, `case_file?select=id,l_num,case_no,channel_id,storage_path,file_name,status&id=eq.${id}`, {}, fetcher))[0];
      if (!f || f.status !== "보관" || !f.storage_path) return json({ error: "보관된 파일이 아닙니다" }, 404);
      const r = await fetcher(env.sbUrl + "/storage/v1/object/sign/case-files/" + f.storage_path.split("/").map(enc).join("/"), {
        method: "POST", headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 300 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.signedURL) { console.log("sign fail", r.status); return json({ error: "파일을 열지 못했습니다" }, 500); }
      await logView(env, who, "file_open:" + id, f.channel_id || "", { l_num: f.l_num, l_code: f.case_no }, fetcher);
      return json({ url: env.sbUrl + "/storage/v1" + j.signedURL, name: f.file_name || "" });
    }

    if (body?.action === "set_file") {
      const lNum = String(body.lNum ?? ""), lp = Number(body.lp), id = Number(body.id);
      if (!lNum || !Number.isFinite(lp) || !Number.isFinite(id) || id <= 0) return json({ error: "고를 파일이 없습니다" }, 400);
      const mine = await caseFiles(env, lNum, fetcher);
      if (!mine.some((f: any) => f.id === id)) return json({ error: "이 사건 파일이 아닙니다" }, 404);
      const ev = await rest(env, `lw_process_events?select=lp_num&l_num=eq.${enc(lNum)}&lp_num=eq.${lp}&limit=1`, {}, fetcher);
      if (!ev?.length) return json({ error: "제출 기록이 없습니다" }, 404);
      const others = mine.filter((f: any) => f.lp === lp && f.id !== id).map((f: any) => f.id);
      if (others.length) await rest(env, `case_file?id=in.(${others.join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ lp_num: null, pick_by: null, pick_at: null }) }, fetcher);
      await rest(env, `case_file?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ lp_num: lp, pick_by: who.name || who.userId, pick_at: new Date().toISOString() }) }, fetcher);
      await logView(env, who, "set_file:" + id, "", { l_num: lNum, l_code: null }, fetcher);
      return json({ ok: true });
    }

    if (body?.action === "locate") {
      if (!who.userId) return json({ error: "직원 확인이 안 됐습니다" }, 401);
      // 도우미가 최근 90초 안에 서버에 들렀어야 켜져 있는 것
      const alive = new Date(Date.now() - 90_000).toISOString();
      const devs = await rest(env, `pc_helper_device?select=id&revoked_at=is.null&works_user_id=eq.${enc(who.userId)}&last_seen_at=gte.${enc(alive)}&limit=1`, {}, fetcher);
      if (!devs?.length) return json({ nohelper: true });
      const ins = await rest(env, "pc_locate", { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ works_user_id: who.userId }) }, fetcher);
      const id = ins?.[0]?.id;
      if (!id) return json({ error: "요청을 만들지 못했습니다" }, 500);
      const until = Date.now() + (body.waitMs ?? 8000);
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 300));
        const row = (await rest(env, `pc_locate?select=taken_at,done_at,channel_id,how,header_text&id=eq.${id}`, {}, fetcher))?.[0];
        if (row?.done_at) {
          await logView(env, who, "locate:" + nz(row.how), nz(row.channel_id), null, fetcher);
          if (row.channel_id) return json({ room: row.channel_id });
          // 방 표에 없는 새 방이라도 제목에 사건번호가 있고 로웨어에 딱 하나 있으면 그 사건을 연다
          const nos = row.how === "error" ? [] : caseNosIn(nz(row.header_text));
          if (nos.length) {
            const hit = await rest(env, `cases?select=l_code&l_code=in.${enc(inList(nos.flatMap(caseNoVariants)))}&limit=2`, {}, fetcher) || [];
            if (hit.length === 1) return json({ case: hit[0].l_code });
          }
          return json({ notfound: true, how: row.how });
        }
        if (!row?.taken_at && Date.now() > until - 5000) break; // 3초 안에 도우미가 안 받아 가면 꺼진 것(또는 옛 버전)
      }
      await logView(env, who, "locate:timeout", "", null, fetcher);
      return json({ timeout: true });
    }

    // 사건 고르기에서 고른 사건을 아직 연결 안 된 이 방에 기억 (휴대폰: 방을 아는 경우만)
    if (body?.action === "link_room") {
      const room = nz(body.room), code = nz(body.case);
      if (!room || !code) return json({ error: "방과 사건이 필요합니다" }, 400);
      const c = (await rest(env, `cases?select=l_num,l_code&l_code=in.${enc(inList(caseNoVariants(code)))}&order=l_num.desc&limit=1`, {}, fetcher))?.[0];
      if (!c) return json({ linked: 0, how: "no-case" });
      const r = await autoLink(env, { channelId: room, lNum: c.l_num }, fetcher);
      await logView(env, who, "link_room:" + nz(r?.how), room, c, fetcher);
      return json(r || { linked: 0, how: "error" });
    }

    if (body?.action === "helper_token") {
      if (!who.userId) return json({ error: "직원 확인이 안 됐습니다" }, 401);
      const label = (who.name || "직원") + " PC " + today;
      const token = await rest(env, "rpc/pc_helper_issue", { method: "POST", body: JSON.stringify({ p_user: who.userId, p_label: label }) }, fetcher);
      await logView(env, who, "helper_token", "", null, fetcher);
      return json({ token, label });
    }

    if (body?.action === "save_info") {
      const lNum = Number(body.lNum);
      if (!Number.isFinite(lNum) || lNum <= 0) return json({ error: "사건이 없습니다" }, 400);
      const c = (await rest(env, `cases?select=l_num,l_code&l_num=eq.${lNum}`, {}, fetcher))[0];
      if (!c) return json({ error: "사건이 없습니다" }, 404);
      const prev = (await rest(env, `case_info?select=*&l_num=eq.${lNum}`, {}, fetcher))[0] || {};
      const next: Record<string, string> = {};
      for (const k of INFO_FIELDS) next[k] = k === "extra_phones" ? cleanPhones(body.fields?.[k]) : nz(body.fields?.[k]).slice(0, k === "memo" ? 2000 : 200);
      const changed = INFO_FIELDS.filter((k) => nz(prev[k]) !== next[k]);
      const now = new Date().toISOString();
      await rest(env, "case_info?on_conflict=l_num", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ l_num: lNum, case_no: c.l_code, ...next, updated_by: who.name, updated_by_id: who.userId, updated_at: now }) }, fetcher);
      if (changed.length) {
        await rest(env, "case_info_log", { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify(changed.map((k) => ({ l_num: lNum, field: k, old_value: prev[k] ?? null, new_value: next[k], editor: who.name, editor_id: who.userId }))) }, fetcher);
      }
      await logView(env, who, "save_info", "", c, fetcher);
      return json({ ok: true, changed: changed.length, ...infoFields(c, { ...next, updated_by: who.name, updated_at: now }) });
    }
    return json({ error: "모르는 요청" }, 400);
  } catch (e) {
    console.log("error", String(e).slice(0, 300));
    return json({ error: "자료를 불러오지 못했습니다" }, 500);
  }
}

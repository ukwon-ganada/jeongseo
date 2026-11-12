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
//  보류 방은 사건을 붙이지 않는다(잘못 붙이느니 안 붙인다) → { hold: true }
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
  return r.status === 201 || r.status === 204 ? null : r.json();
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
const OUR_FIRM = "정서";
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

export function shapeCase(c: any, evs: any[], opts: { today: string; linked: string[]; myHearings: any[]; status?: string }) {
  const raw = c.raw || {};
  const today = opts.today;
  const title = nz(c.l_name).replace(/^\[전자\]\s*/, "");
  const court = [nz(c.court), nz(raw.l_justice_dept)].filter(Boolean).join(" ");
  const list = evs
    .filter((e) => isDate(e.lp_appoint_date) && e.lp_set !== "문자" && e.lp_set !== "메일")
    .sort((a, b) => (a.lp_appoint_date + (a.lp_appoint_time || "")).localeCompare(b.lp_appoint_date + (b.lp_appoint_time || "")) || (a.lp_num || 0) - (b.lp_num || 0));

  const ours = (e: any) => e.lp_set === "서면" && nz(e.lp_contents).includes(OUR_FIRM);
  const toUs = (e: any) => e.lp_set === "송달" && nz(e.lp_contents).includes(OUR_FIRM);

  // 타임라인: 다른 당사자에게 가는 송달은 너무 많아서 우리에게 온 송달만
  const events: any[] = [];
  for (const e of list) {
    if (e.lp_set === "송달" && !toUs(e)) continue;
    const d = e.lp_appoint_date.slice(0, 10);
    let t = nz(e.lp_contents);
    if (e.lp_set === "기일" && nz(e.lp_remark)) t += " · " + nz(e.lp_remark);
    if (e.lp_set === "송달" && e.delivered_date) t += " · " + md(e.delivered_date) + " 도달";
    events.push({ d, k: e.lp_set === "기일" ? (d >= today ? "due" : "court") : ours(e) ? "ours" : "court", t, f: null });
  }
  const nextDate = isDate(c.next_date) ? c.next_date.slice(0, 10) : "";
  const hasNext = nextDate && list.some((e) => e.lp_set === "기일" && e.lp_appoint_date.slice(0, 10) === nextDate);
  if (nextDate >= today && !hasNext) {
    events.push({ d: nextDate, k: "due", t: "다음 기일 " + [nz(c.next_time), nz(c.next_contents)].filter(Boolean).join(" ") });
  }

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
    o: ours(e) ? 1 : 0, p: e.lp_appoint_date.slice(0, 10) > today ? 1 : 0,
  }));
  const seen = evs.map((e) => nz(e.last_seen_at)).filter(Boolean).sort().pop();
  const updated = seen ? new Date(Date.parse(seen) + 9 * 3600e3).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, "$1.$2 $3") : "기록 없음";

  // 사건 정보: 값이 있는 칸만, 개인정보(주민번호·주소)는 넣지 않음
  const row = (l: string, v: unknown, src = "로웨어") => ({ l, v: nz(v), src: nz(v) ? src : null });
  const info: any[] = [
    { h: "사건", rows: [row("사건번호", c.l_code), row("사건명", title), row("상태", c.state), row("수임일", c.accept_date),
      row("담당 변호사", c.charge_lawyer), row("수행 변호사", c.perform_lawyer), row("담당 직원", c.charge_staff)] },
    { h: "의뢰인", rows: [row("이름", raw.l_client), row("휴대전화", raw.l_client_hp)] },
    { h: "재판부", rows: [row("법원·재판부", court), row("비고", raw.l_court_remark)].filter((r) => r.v || r.l === "법원·재판부") },
  ];
  const inv = [row("경찰서", raw.l_police_station), row("담당 수사관", raw.l_police_detective), row("수사관 전화", raw.l_police_tel),
    row("검사", raw.l_prosecutor), row("검사실 전화", raw.l_prosecutor_tel)].filter((r) => r.v);
  if (inv.length) info.push({ h: "수사", rows: inv });
  if (opts.linked.length) info.push({ h: "연결 사건", note: "원심 등", rows: opts.linked.map((n) => row("사건번호", n)) });

  return {
    caseNo: c.l_code, lNum: c.l_num, title, court: court || "법원 정보 없음", today, closed: opts.status === "종결",
    events, deadlines: [], deadlineNote: "기한 계산은 새 규칙서 엔진이 완성되면 이곳에 표시됩니다. 지금은 기일·진행내용 탭을 봐 주세요.",
    hearings, progress: { updated, rows }, info,
  };
}
function md(d: string) { return Number(d.slice(5, 7)) + "." + d.slice(8, 10); }

// 담당자 이름으로 내 사건 찾기 (담당 직원·담당 변호사·수행 변호사 칸)
async function myCases(env: Env, name: string, fetcher: typeof fetch) {
  if (!name) return [];
  const n = enc("*" + name.replace(/[*,()]/g, "") + "*");
  return await rest(env, `cases?select=l_num,l_code,l_name,next_date,next_time,next_contents,court&state=neq.종결` +
    `&or=(charge_staff.ilike.${n},charge_lawyer.ilike.${n},perform_lawyer.ilike.${n})&order=next_date.asc.nullslast&limit=300`, {}, fetcher) || [];
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
        const maps = await rest(env, `works_room_case?select=l_num,case_no,is_primary,status&channel_id=eq.${enc(room)}&order=is_primary.desc,updated_at.desc`, {}, fetcher) || [];
        const main = maps[0];
        if (!main) { await logView(env, who, "case:unpaired", room, null, fetcher); return json({ unpaired: true }); }
        status = main.status;
        if (status === "보류") { await logView(env, who, "case:hold", room, null, fetcher); return json({ hold: true }); }
        linked = maps.slice(1).map((m: any) => nz(m.case_no)).filter(Boolean);
        if (main.l_num != null) c = (await rest(env, `cases?select=*&l_num=eq.${main.l_num}`, {}, fetcher))[0];
        else if (main.case_no) c = (await rest(env, `cases?select=*&l_code=in.${enc(inList(caseNoVariants(main.case_no)))}&limit=1`, {}, fetcher))[0];
        if (!c) return json({ notfound: true, caseNo: main.case_no || "" });
      } else if (caseParam) {
        c = (await rest(env, `cases?select=*&l_code=in.${enc(inList(caseNoVariants(caseParam)))}&order=l_num.desc&limit=1`, {}, fetcher))[0];
        if (!c) return json({ notfound: true, caseNo: caseParam });
        if (c.state === "종결") status = "종결";
      } else return json({ error: "방이나 사건번호가 없습니다" }, 400);

      const [evs, mine] = await Promise.all([
        rest(env, `lw_process_events?select=lp_num,lp_set,lp_appoint_date,lp_appoint_time,lp_contents,lp_remark,delivered_date,court,last_seen_at&l_num=eq.${c.l_num}&order=lp_appoint_date.asc&limit=2000`, {}, fetcher),
        myCases(env, who.name || "", fetcher),
      ]);
      const end = new Date(Date.parse(today) + 28 * 864e5).toISOString().slice(0, 10);
      const myHearings = mine.filter((m: any) => isDate(m.next_date) && m.next_date.slice(0, 10) >= today && m.next_date.slice(0, 10) <= end)
        .map((m: any) => ({ c: m.l_code, d: m.next_date.slice(0, 10), tm: nz(m.next_time), t: nz(m.next_contents) || "기일", p: nz(m.court) }));
      await logView(env, who, "case", room, c, fetcher);
      return json(shapeCase(c, evs || [], { today, linked, myHearings, status }));
    }
    return json({ error: "모르는 요청" }, 400);
  } catch (e) {
    console.log("error", String(e).slice(0, 300));
    return json({ error: "자료를 불러오지 못했습니다" }, 500);
  }
}

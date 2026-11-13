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
//    { "action": "helper_token" }                   → 이 직원의 PC 도우미 연결 코드 발급(한 번만 보여 줌, 서버엔 해시만)
//  사건 정보 칸은 우리가 직접 입력·수정한다. 로웨어와 연동하지 않는다(자동으로 덮어쓰지 않음).
//    저장된 값이 없을 때만 처음 값으로 로웨어 값을 한 번 보여 준다(PREFILL_FROM_LAWWARE).
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
// "보정서"처럼 "정서"가 들어간 낱말과 헷갈리지 않게 "법무법인 정서"로 찾음
const OUR_FIRM = /법무법인\s*정서/;
export const PREFILL_FROM_LAWWARE = true;
export const INFO_FIELDS = ["case_name", "client_name", "client_phone", "lawyer", "court_dept", "court_phone", "investigator", "investigator_phone", "memo"] as const;
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
      investigator: police || (pros ? "검사 " + pros : ""), investigator_phone: nz(raw.l_police_tel) || nz(raw.l_prosecutor_tel), memo: "",
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
    o: ours(e) ? 1 : 0, u: toUs(e) ? 1 : 0, x: e.lp_set === "송달" && !toUs(e) ? 1 : 0, p: e.lp_appoint_date.slice(0, 10) > today ? 1 : 0,
  }));
  const seen = evs.map((e) => nz(e.last_seen_at)).filter(Boolean).sort().pop();
  const updated = seen ? new Date(Date.parse(seen) + 9 * 3600e3).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, "$1.$2 $3") : "기록 없음";

  const info = { ...infoFields(c, opts.saved ?? null), linked: opts.linked };

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

// 사건방에 올린 파일: 이 사건 번호로 붙은 것 + 이 사건과 짝지어진 방에 올라온 것
export async function caseFiles(env: Env, lNum: string, fetcher: typeof fetch = fetch) {
  const rooms = await rest(env, `works_room_case?select=channel_id&l_num=eq.${enc(lNum)}`, {}, fetcher) || [];
  const ch = [...new Set(rooms.map((r: any) => nz(r.channel_id)).filter(Boolean))] as string[];
  const or = ch.length ? `or=(l_num.eq.${enc(lNum)},channel_id.in.${enc(inList(ch))})` : `l_num=eq.${enc(lNum)}`;
  const rows = await rest(env, `case_file?select=id,file_name,content_type,size_bytes,status,works_user_id,posted_at&status=in.(보관,받는중,실패)&${or}&order=posted_at.desc&limit=300`, {}, fetcher) || [];
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
      st: r.status === "보관" ? "" : r.status };
  });
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

      const [evs, mine, saved, files] = await Promise.all([
        rest(env, `lw_process_events?select=lp_num,lp_set,lp_appoint_date,lp_appoint_time,lp_contents,lp_remark,delivered_date,court,last_seen_at&l_num=eq.${c.l_num}&order=lp_appoint_date.asc&limit=2000`, {}, fetcher),
        myCases(env, who.name || "", fetcher),
        rest(env, `case_info?select=*&l_num=eq.${c.l_num}`, {}, fetcher).then((r: any[]) => r?.[0] ?? null).catch(() => null),
        caseFiles(env, String(c.l_num), fetcher).catch((e) => { console.log("files fail", String(e).slice(0, 120)); return []; }),
      ]);
      const end = new Date(Date.parse(today) + 28 * 864e5).toISOString().slice(0, 10);
      const myHearings = mine.filter((m: any) => isDate(m.next_date) && m.next_date.slice(0, 10) >= today && m.next_date.slice(0, 10) <= end)
        .map((m: any) => ({ c: m.l_code, d: m.next_date.slice(0, 10), tm: nz(m.next_time), t: nz(m.next_contents) || "기일", p: nz(m.court) }));
      await logView(env, who, "case", room, c, fetcher);
      return json({ ...shapeCase(c, evs || [], { today, linked, myHearings, status, saved }), files });
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
      for (const k of INFO_FIELDS) next[k] = nz(body.fields?.[k]).slice(0, k === "memo" ? 2000 : 200);
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

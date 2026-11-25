// ============================================================================
//  admin-api — 관리 화면(woff/admin.html)에 자료를 주고, 관리자가 바꾼 설정을 저장한다 (2026-11-25 석원)
//
//  모든 요청은 웍스 로그인 토큰(X-Works-Token)으로 "누가 열었는지" 웍스 API(users/me)에 물어보고,
//  admin_user 표에 있는 사람만 통과시킨다.
//
//  호출: POST { "action": ... }
//    me                                   → 이름
//    overview                             → 왼쪽 메뉴 숫자
//    search   { q }                       → 사건 찾기 (이름·사건번호)
//    case     { lNum }                    → 사건 하나: 기한(알림과 같은 계산), 끈 알림, 보낸 알림, 방, 보충 기록
//    mute     { lCode, kind?, due?, on }  → 알림 끄기(on=false)/다시 켜기(on=true). kind 없으면 사건 전체
//    due                                  → 다가오는 기한 전부(방 없는 기한 포함)
//    fill_list                            → 앞 심급 줄이 빠진 사건 + 최근 보충 기록
//    fill_preview { lNum, lines:[{d,c,r}] } → 나의사건 진행내용 줄과 지금 기록 비교(저장 안 함)
//    fill_save    { lNum, rows:[{d,c,r}], fileName } → 빠진 줄만 lw_process_events에 넣음(lp_num 음수, lp_work_type '보충')
//    fill_undo    { id }                  → 보충한 줄 지우기
//    rooms                                → 사건이 안 붙은 방, 방 없는 기한
//    link_room { channel, lNum }          → 방에 사건 붙이기
//    status                               → 예약 작업·로웨어 가져오기·알림 발송·PC 도우미
//    settings / set { key, value }        → 기한 알림 전체 켜기/끄기, 관리자 명단
//  배포: verify_jwt=false (웍스 토큰으로 직접 확인)
// ============================================================================
import { buildPlan, type Plan } from "../deadline-notify/handler.ts";
import { TEAM } from "../deadline-notify/plan.ts";

export type Env = { sbUrl: string; sbKey: string; clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string };

const ALLOW_ORIGIN = "https://ukwon-ganada.github.io";
const CORS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, x-works-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json" } });
const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const enc = encodeURIComponent;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(nz(s));

async function rest(env: Env, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(path.split("?")[0] + " " + r.status + " " + t.slice(0, 160));
  return t ? JSON.parse(t) : null;
}
const inList = (xs: (string | number)[]) => "(" + xs.map((x) => typeof x === "number" ? x : '"' + String(x).replace(/"/g, "") + '"').join(",") + ")";

// ── 누가 열었나 ─────────────────────────────────────────
type Who = { ok: boolean; userId?: string; name?: string; status?: number };
const WHO = new Map<string, { who: Who; until: number }>();
async function whoIs(token: string, fetcher: typeof fetch): Promise<Who> {
  if (!token) return { ok: false, status: 401 };
  const hit = WHO.get(token);
  if (hit && hit.until > Date.now()) return hit.who;
  const r = await fetcher("https://www.worksapis.com/v1.0/users/me", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) { await r.body?.cancel(); return { ok: false, status: r.status }; }
  const u = await r.json().catch(() => ({}));
  const name = u?.userName ? [u.userName.lastName, u.userName.firstName].filter(Boolean).join("") : undefined;
  const who = { ok: !!u?.userId, userId: u?.userId, name };
  WHO.set(token, { who, until: Date.now() + 10 * 60e3 });
  return who;
}

// ── 기한 계산(알림과 같은 것)은 1분 동안 재사용 ─────────────────
let PLAN: { at: number; today: string; plan: Plan } | null = null;
async function plan(env: Env, fetcher: typeof fetch, fresh = false): Promise<Plan> {
  const today = kstToday();
  if (!fresh && PLAN && PLAN.today === today && Date.now() - PLAN.at < 60e3) return PLAN.plan;
  const p = await buildPlan(env as any, today, fetcher);
  PLAN = { at: Date.now(), today, plan: p };
  return p;
}
export function resetCache() { PLAN = null; WHO.clear(); }

// ── 나의사건 진행내용 한 줄 → 로웨어 진행내역 모양 ─────────────────
//   로웨어와 같은 구분(lp_set)을 붙여야 기한 계산·타임라인이 그대로 읽는다
export function classify(c: string): string {
  const s = nz(c);
  if (/^(사건접수|공소장접수|신청서접수)$/.test(s) || /종국\s*:/.test(s)) return "접수";
  if (/기일\s*\(.*\)$/.test(s) || /기일$/.test(s)) return "기일";
  if (/\s발송$/.test(s)) return "송달";
  if (/\s(제출|발급)$/.test(s) || /등본$/.test(s)) return "서면";
  if (/^\(.+\)\s/.test(s) || /(결정|명령)$/.test(s)) return "명령";
  return "기타";
}
export function parseDelivery(r: string): { d: string | null; status: string | null } {
  const m = nz(r).match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?\s*(?:\d{1,2}시\s*)?(.+?)\s*$/);
  if (!m) return { d: null, status: null };
  const d = /(도달|송달됨|송달간주)/.test(m[4]) ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  return { d, status: m[4] };
}
const squash = (s: string) => nz(s).replace(/\s+/g, "").replace(/[()]/g, "");
// 로웨어는 이름을 'O'로 가리는 정도가 나의사건과 다를 수 있어 가린 글자는 비교에서 뺀다
const cmpKey = (d: string, c: string) => d + "|" + squash(c).replace(/O+/g, "");

export type InLine = { d: string; c: string; r?: string };
// 출석자 줄('- 검사 ... 출석  속행')은 기일 줄의 결과로 합친다
export function mergeLines(lines: InLine[]): InLine[] {
  const out: InLine[] = [];
  for (const l of lines) {
    const d = nz(l.d).replace(/\./g, "-");
    if (!isDate(d)) continue;
    const c = nz(l.c);
    if (/^-\s/.test(c)) {
      const prev = out[out.length - 1];
      if (prev && prev.d === d && classify(prev.c) === "기일" && !prev.r && nz(l.r)) prev.r = nz(l.r);
      continue;
    }
    out.push({ d, c, r: nz(l.r) });
  }
  return out;
}

async function caseRow(env: Env, lNum: number, fetcher: typeof fetch) {
  const r = await rest(env, `case_all?select=l_num,l_code,l_client,l_kind,court,charge_lawyer,state,client_position&l_num=eq.${lNum}`, {}, fetcher);
  return r?.[0] || null;
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const who = await whoIs(nz(req.headers.get("x-works-token")), fetcher);
  if (!who.ok) return json({ error: "웍스 로그인이 필요합니다", relogin: true }, 401);
  const adm = await rest(env, `admin_user?select=works_user_id&works_user_id=eq.${enc(who.userId!)}`, {}, fetcher);
  if (!adm?.length) return json({ error: "관리자만 쓸 수 있습니다", name: who.name }, 403);

  const b = await req.json().catch(() => ({}));
  const act = nz(b?.action);
  const today = kstToday();
  try {
    if (act === "me") return json({ name: who.name, today });

    if (act === "overview") {
      const [p, fill, rooms, mutes] = await Promise.all([
        plan(env, fetcher),
        rest(env, "rpc/admin_fill_needed", { method: "POST", body: "{}" }, fetcher),
        rest(env, "works_room_case?select=channel_id&or=(status.eq.보류,l_num.is.null)", {}, fetcher),
        rest(env, "deadline_mute?select=id&undone_at=is.null", {}, fetcher),
      ]);
      const due = p.all.filter((x) => x.st === "open" && x.due >= today && x.due <= addDays(today, 14)).length;
      return json({ fill: fill?.length || 0, due, noRoom: p.all.filter((x) => !x.room && x.st === "open" && x.due >= today).length, rooms: new Set((rooms || []).map((r: any) => r.channel_id)).size, muted: mutes?.length || 0 });
    }

    if (act === "search") {
      const q = nz(b?.q).replace(/[,()*%]/g, "");
      if (!q) return json({ rows: [] });
      const f = /\d/.test(q) ? `l_code=ilike.*${enc(q)}*` : `l_client=ilike.*${enc(q)}*`;
      const rows = await rest(env, `case_all?select=l_num,l_code,l_client,court,charge_lawyer,state&${f}&order=l_num.desc&limit=40`, {}, fetcher) || [];
      const codes = rows.map((r: any) => nz(r.l_code)).filter(Boolean);
      const mutes = codes.length ? await rest(env, `deadline_mute?select=l_code,kind&undone_at=is.null&l_code=in.${inList(codes)}`, {}, fetcher) : [];
      const p = await plan(env, fetcher);
      return json({
        rows: rows.map((r: any) => {
          const dls = p.all.filter((x) => x.lNum === Number(r.l_num) && x.st === "open");
          const next = dls.filter((x) => x.due >= today).sort((a, c) => a.due.localeCompare(c.due))[0];
          return { ...r, caseOff: (mutes || []).some((m: any) => m.l_code === r.l_code && !nz(m.kind)), next: next ? { kind: next.kind, due: next.due } : null };
        }),
      });
    }

    if (act === "case") {
      const lNum = Number(b?.lNum);
      const c = await caseRow(env, lNum, fetcher);
      if (!c) return json({ error: "사건을 찾지 못했습니다" }, 404);
      const code = nz(c.l_code);
      const [p, mutes, sent, rooms, fills, confirms] = await Promise.all([
        plan(env, fetcher),
        rest(env, `deadline_mute?select=id,kind,due,by_name,created_at&undone_at=is.null&l_code=eq.${enc(code)}`, {}, fetcher),
        rest(env, `sent?select=sent_at,channel_id,body,sent_by&body=like.*${enc(code)}*&order=sent_at.desc&limit=30`, {}, fetcher),
        rest(env, `works_room_case?select=channel_id,room_title,status,is_primary&l_num=eq.${lNum}`, {}, fetcher),
        rest(env, `record_fill?select=id,file_name,lp_nums,by_name,created_at,undone_at&l_num=eq.${lNum}&order=created_at.desc`, {}, fetcher),
        rest(env, `deadline_confirm?select=kind,due,action,created_at&undone_at=is.null&l_code=eq.${enc(code)}`, {}, fetcher),
      ]);
      const dls = p.all.filter((x) => x.lNum === lNum).map((x) => ({ kind: x.kind, due: x.due, st: x.st, why: x.dlWhy, send: x.send, sendWhy: x.why, muted: x.muted, room: !!x.room,
        confirm: (confirms || []).find((f: any) => f.kind === x.kind && nz(f.due).slice(0, 10) === x.due)?.action || null }));
      const sentRows = (sent || []).map((s: any) => {
        const lines = nz(s.body).split("\n").filter((l) => /제출기한/.test(l)).map((l) => l.replace(/^[^가-힣]+/, "").replace(/\s{2,}/g, " ").trim());
        return { at: s.sent_at, room: !!s.channel_id, by: /^supabase/.test(nz(s.sent_by)) ? "서버" : "사무실 PC", lines };
      });
      return json({ case: c, deadlines: dls, caseOff: (mutes || []).some((m: any) => !nz(m.kind)), mutes, sent: sentRows, rooms, fills });
    }

    if (act === "mute") {
      const code = nz(b?.lCode), kind = nz(b?.kind), due = isDate(b?.due) ? nz(b.due) : "";
      if (!code) return json({ error: "사건번호가 없습니다" }, 400);
      if (b?.on) {
        const f = `l_code=eq.${enc(code)}&undone_at=is.null&kind=eq.${enc(kind)}` + (kind ? (due ? `&due=eq.${due}` : "") : "");
        await rest(env, `deadline_mute?${f}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ undone_at: new Date().toISOString(), undone_by: who.name || who.userId }) }, fetcher);
      } else {
        const have = await rest(env, `deadline_mute?select=id&l_code=eq.${enc(code)}&undone_at=is.null&kind=eq.${enc(kind)}` + (kind && due ? `&due=eq.${due}` : ""), {}, fetcher);
        if (!have?.length) {
          await rest(env, "deadline_mute", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ l_code: code, kind, due: kind && due ? due : null, by_user: who.userId, by_name: who.name }) }, fetcher);
        }
      }
      PLAN = null;
      return json({ ok: true });
    }

    if (act === "due") {
      const p = await plan(env, fetcher, !!b?.fresh);
      const from = addDays(today, -7), to = addDays(today, 30);
      const rows = p.all.filter((x) => x.due && x.due >= from && x.due <= to && x.st !== "expected")
        .sort((a, c) => a.due.localeCompare(c.due) || a.code.localeCompare(c.code))
        .map((x) => ({ lNum: x.lNum, lCode: x.lCode, code: x.code, client: x.client, charge: x.charge, kind: x.kind, due: x.due, st: x.st, why: x.dlWhy, room: !!x.room, send: x.send, sendWhy: x.why, muted: x.muted, team: TEAM.some((n) => x.charge.includes(n)) }));
      return json({ today, rows });
    }

    if (act === "fill_list") {
      const [need, done] = await Promise.all([
        rest(env, "rpc/admin_fill_needed", { method: "POST", body: "{}" }, fetcher),
        rest(env, "record_fill?select=id,l_num,l_code,file_name,lp_nums,by_name,created_at,undone_at&order=created_at.desc&limit=30", {}, fetcher),
      ]);
      return json({ need: need || [], done: done || [] });
    }

    if (act === "fill_preview" || act === "fill_save") {
      const lNum = Number(b?.lNum);
      const c = await caseRow(env, lNum, fetcher);
      if (!c) return json({ error: "사건을 찾지 못했습니다" }, 404);
      const lines = mergeLines(Array.isArray(b?.lines) ? b.lines : Array.isArray(b?.rows) ? b.rows : []);
      if (!lines.length) return json({ error: "읽은 줄이 없습니다" }, 400);
      const have = await rest(env, `lw_process_events?select=lp_appoint_date,lp_contents&l_num=eq.${lNum}&limit=5000`, {}, fetcher) || [];
      const keys = new Set(have.map((e: any) => cmpKey(nz(e.lp_appoint_date).slice(0, 10), nz(e.lp_contents))));
      const rows = lines.map((l) => ({ d: l.d, c: l.c, r: nz(l.r), set: classify(l.c), have: keys.has(cmpKey(l.d, l.c)) }));
      if (act === "fill_preview") return json({ case: { l_num: c.l_num, l_code: c.l_code, l_client: c.l_client }, rows });

      const add = rows.filter((r) => !r.have);
      if (!add.length) return json({ ok: true, added: 0 });
      const base = -(Date.now() * 100);
      const ins = add.map((r, i) => {
        const dv = r.set === "송달" ? parseDelivery(r.r) : { d: null, status: null };
        return {
          lp_num: base - i, l_num: lNum, l_code: c.l_code, lp_set: r.set, lp_work_type: "보충", lp_appoint_date: r.d,
          lp_contents: r.c, lp_remark: r.r || null, delivered_date: dv.d, delivery_status: dv.status,
          lp_regdatetime: "admin:" + (who.name || who.userId), client_position: c.client_position || null,
        };
      });
      await rest(env, "lw_process_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(ins) }, fetcher);
      await rest(env, "record_fill", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ l_num: lNum, l_code: c.l_code, file_name: nz(b?.fileName).slice(0, 200) || null, lp_nums: ins.map((x) => x.lp_num), by_user: who.userId, by_name: who.name }) }, fetcher);
      PLAN = null;
      return json({ ok: true, added: ins.length });
    }

    if (act === "fill_undo") {
      const id = Number(b?.id);
      const f = (await rest(env, `record_fill?select=id,lp_nums,undone_at&id=eq.${id}`, {}, fetcher))?.[0];
      if (!f || f.undone_at) return json({ error: "되돌릴 기록이 없습니다" }, 404);
      const nums: number[] = (f.lp_nums || []).filter((n: number) => n < 0);
      for (let i = 0; i < nums.length; i += 200) {
        await rest(env, `lw_process_events?lp_work_type=eq.보충&lp_num=in.(${nums.slice(i, i + 200).join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } }, fetcher);
      }
      await rest(env, `record_fill?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ undone_at: new Date().toISOString(), undone_by: who.name || who.userId }) }, fetcher);
      PLAN = null;
      return json({ ok: true });
    }

    if (act === "rooms") {
      const [rs, p] = await Promise.all([
        rest(env, "works_room_case?select=channel_id,room_title,status,l_num,updated_at&or=(status.eq.보류,l_num.is.null)&order=updated_at.desc&limit=300", {}, fetcher),
        plan(env, fetcher),
      ]);
      const seen = new Set<string>();
      const rooms = (rs || []).filter((r: any) => !seen.has(r.channel_id) && seen.add(r.channel_id)).map((r: any) => ({ channel: r.channel_id, title: nz(r.room_title), status: nz(r.status), at: r.updated_at }));
      const noRoomMap = new Map<number, any>();
      for (const x of p.all) if (!x.room && x.st === "open" && x.due >= addDays(today, -3)) {
        const o = noRoomMap.get(x.lNum);
        if (!o || x.due < o.due) noRoomMap.set(x.lNum, { lNum: x.lNum, code: x.code, client: x.client, charge: x.charge, kind: x.kind, due: x.due });
      }
      return json({ rooms, noRoom: [...noRoomMap.values()].sort((a, c) => a.due.localeCompare(c.due)) });
    }

    if (act === "link_room") {
      const ch = nz(b?.channel), lNum = Number(b?.lNum);
      const c = await caseRow(env, lNum, fetcher);
      if (!ch || !c) return json({ error: "방 또는 사건이 없습니다" }, 400);
      const patch = { l_num: lNum, case_no: c.l_code, status: "대상", is_primary: true, basis: "관리 화면 " + (who.name || ""), source: "admin", updated_at: new Date().toISOString() };
      const upd = await rest(env, `works_room_case?channel_id=eq.${enc(ch)}&l_num=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) }, fetcher);
      if (!upd?.length) {
        const title = (await rest(env, `works_room_case?select=room_title&channel_id=eq.${enc(ch)}&limit=1`, {}, fetcher))?.[0]?.room_title || null;
        await rest(env, "works_room_case?on_conflict=channel_id,l_num", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ channel_id: ch, room_title: title, ...patch }) }, fetcher);
        await rest(env, `works_room_case?channel_id=eq.${enc(ch)}&status=eq.보류`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "대상" }) }, fetcher);
      }
      PLAN = null;
      return json({ ok: true });
    }

    if (act === "status") {
      const [cron, feed, sent, devs, names, views] = await Promise.all([
        rest(env, "rpc/admin_cron_status", { method: "POST", body: "{}" }, fetcher),
        rest(env, "lw_feed_runs?select=started_at,finished_at,fetched,new_count,error&order=started_at.desc&limit=1", {}, fetcher),
        rest(env, `sent?select=sent_at,sent_by&sent_at=gte.${addDays(today, -7)}&order=sent_at.desc&limit=500`, {}, fetcher),
        rest(env, "pc_helper_device?select=works_user_id,label,last_seen_at,created_at&revoked_at=is.null&order=last_seen_at.desc.nullslast", {}, fetcher),
        rest(env, "works_who_cache?select=user_id,name&order=created_at.desc&limit=500", {}, fetcher),
        rest(env, `case_view_log?select=id&viewed_at=gte.${today}T00:00:00%2B09:00&limit=1000`, {}, fetcher),
      ]);
      const nm = new Map<string, string>();
      for (const n of names || []) if (n.name && !nm.has(n.user_id)) nm.set(n.user_id, n.name);
      const bySrv = (sent || []).filter((s: any) => /^supabase/.test(nz(s.sent_by)));
      const lastDay = bySrv[0] ? nz(bySrv[0].sent_at).slice(0, 10) : null;
      return json({
        cron, feed: feed?.[0] || null,
        notify: { last: bySrv[0]?.sent_at || null, rooms: lastDay ? bySrv.filter((s: any) => nz(s.sent_at).slice(0, 10) === lastDay).length : 0, pc: (sent || []).filter((s: any) => !/^supabase/.test(nz(s.sent_by))).length },
        helpers: (devs || []).map((d: any) => ({ name: nm.get(d.works_user_id) || d.label || "", label: d.label, seen: d.last_seen_at })),
        views: views?.length || 0,
      });
    }

    if (act === "settings") {
      const [set, admins, people] = await Promise.all([
        rest(env, "lw_settings?select=key,value&key=in.(dl_notify_send)", {}, fetcher),
        rest(env, "admin_user?select=works_user_id,name&order=added_at", {}, fetcher),
        rest(env, "works_who_cache?select=user_id,name&order=created_at.desc&limit=500", {}, fetcher),
      ]);
      const ppl = new Map<string, string>();
      for (const p of people || []) if (p.name && !ppl.has(p.user_id)) ppl.set(p.user_id, p.name);
      return json({
        notify: nz((set || []).find((x: any) => x.key === "dl_notify_send")?.value) === "on",
        team: TEAM, admins, people: [...ppl].map(([id, name]) => ({ id, name })).sort((a, c) => a.name.localeCompare(c.name)), me: who.userId,
      });
    }

    if (act === "set") {
      const key = nz(b?.key);
      if (key === "notify") {
        await rest(env, "lw_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "dl_notify_send", value: b?.value ? "on" : "off" }) }, fetcher);
        return json({ ok: true });
      }
      if (key === "admin_add" && nz(b?.id)) {
        await rest(env, "admin_user?on_conflict=works_user_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ works_user_id: nz(b.id), name: nz(b?.name) || null }) }, fetcher);
        return json({ ok: true });
      }
      if (key === "admin_remove" && nz(b?.id)) {
        if (nz(b.id) === who.userId) return json({ error: "자기 자신은 뺄 수 없습니다" }, 400);
        await rest(env, `admin_user?works_user_id=eq.${enc(nz(b.id))}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }, fetcher);
        return json({ ok: true });
      }
      return json({ error: "모르는 설정" }, 400);
    }

    return json({ error: "모르는 요청: " + act }, 400);
  } catch (e) {
    console.log("admin-api", act, String((e as Error)?.message || e).slice(0, 300));
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
}

// ============================================================================
//  meet-sync — 웍스 캘린더의 접견 일정을 사건 타임라인용 표(meet_event)로 (Supabase Edge Function)
//
//  호출: POST, 헤더 x-cron-secret = lw_settings.cron_secret (pg_cron·SQL 의 meet_call 이 붙여 보냄)
//    { "dryRun": true }               → 저장하지 않고 몇 건이 맞는지만 (이름은 가려서)
//    { "from": "2026-11-01", "to": "2026-12-31" } → 그 기간 (기본: 30일 전 ~ 60일 뒤)
//  웍스 권한: 앱 OAuth Scopes 에 calendar.read, user.read (2026-11-13 석원 추가)
//  필요한 시크릿: WORKS_CLIENT_ID, WORKS_CLIENT_SECRET, WORKS_SERVICE_ACCOUNT, WORKS_PRIVATE_KEY (봇 함수와 같음)
//  배포: verify_jwt=false
// ============================================================================
import { worksToken, type AuthEnv } from "./works_auth.ts";
import { buildIndex, type CaseRow, clientNames, kstStart, matchCase, normCaseNo, parseMeet } from "./meet.ts";

export type Env = AuthEnv & { sbUrl: string; sbKey: string };
const API = "https://www.worksapis.com/v1.0";
const SCOPE = "calendar.read user.read";
const json = (b: unknown, status = 200) => Response.json(b, { status });

async function rest(env: Env, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error("DB " + r.status + " " + (await r.text()).slice(0, 200));
  const t = r.status === 204 ? "" : await r.text();
  return t ? JSON.parse(t) : null;
}
async function works(token: string, path: string, fetcher: typeof fetch): Promise<any> {
  const r = await fetcher(API + path, { headers: { Authorization: "Bearer " + token } });
  const t = await r.text();
  if (!r.ok) throw new Error("works " + r.status + " " + path.split("?")[0].replace(/users\/[^/]+/, "users/*") + " " + t.slice(0, 160));
  return t ? JSON.parse(t) : {};
}
const mask = (n: string) => n.slice(0, 1) + "O".repeat(Math.max(1, n.length - 1));
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const sec = await rest(env, "lw_settings?select=value&key=eq.cron_secret", {}, fetcher).catch(() => []);
  if (!sec?.[0]?.value || req.headers.get("x-cron-secret") !== sec[0].value) return json({ error: "forbidden" }, 403);
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || "") ? body.from : addDays(today, -30);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(body.to || "") ? body.to : addDays(today, 60);
  const dry = !!body.dryRun;

  try {
    const token = await worksToken(env, SCOPE, fetcher);
    // 1) 구성원 목록
    const users: { id: string; name: string }[] = [];
    let cursor = "";
    for (let i = 0; i < 20; i++) {
      const j = await works(token, `/users?count=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, fetcher);
      for (const u of j.users || []) {
        const name = [u?.userName?.lastName, u?.userName?.firstName].filter(Boolean).join("");
        if (u?.userId) users.push({ id: u.userId, name });
      }
      cursor = j?.responseMetaData?.nextCursor || "";
      if (!cursor) break;
    }
    // 2) 사건(의뢰인 이름) 목록
    //    의뢰인 칸 + 나의사건 피고인 목록(lw_case_detail.defendants) + 국선 관리표(gukseon_cases)의 피고인
    const cs = await rest(env, "cases?select=l_num,l_code,charge_lawyer,raw->>l_client,raw->>l_accept_date&limit=5000", {}, fetcher) || [];
    const cases: CaseRow[] = cs.map((c: any) => ({ l_num: c.l_num, client: c.l_client || "", lawyer: c.charge_lawyer || "", extra: [], accept: String(c.l_accept_date || "").slice(0, 10) }));
    const byNum = new Map<number, CaseRow>(cases.map((c) => [c.l_num, c]));
    const byCode = new Map<string, CaseRow>();
    cs.forEach((c: any, i: number) => { if (c.l_code) byCode.set(normCaseNo(c.l_code), cases[i]); });
    const dets = await rest(env, "lw_case_detail?select=l_num,defendants&defendants=not.is.null&limit=5000", {}, fetcher).catch(() => []) || [];
    for (const d of dets) { const c = byNum.get(d.l_num); if (c && Array.isArray(d.defendants)) c.extra!.push(...d.defendants.map((x: any) => String(x || "").trim())); }
    const gk = await rest(env, "gukseon_cases?select=data&limit=2000", {}, fetcher).catch(() => []) || [];
    for (const g of gk) {
      const c = byCode.get(normCaseNo(g?.data?.caseNumber || ""));
      if (c && !g?.data?.deleted) c.extra!.push(...clientNames(String(g?.data?.defendant || "")));
    }
    const ix = buildIndex(cases);

    // 3) 사람마다 캘린더 읽기 (30일씩 나눠서)
    const rows: any[] = [], canceledIds = new Set<string>(), seenIds = new Set<string>();
    const stat = { users: users.length, readOk: 0, readFail: 0, meetEvents: 0, canceled: 0, names: 0, matched: 0, unmatched: 0, noCase: 0, sameName: 0, errors: [] as string[] };
    const sample: any[] = [];
    for (const u of users) {
      let ok = true;
      for (let a = from; a <= to; a = addDays(a, 30)) {
        const b = addDays(a, 30) > addDays(to, 1) ? addDays(to, 1) : addDays(a, 30);
        const q = `/users/${encodeURIComponent(u.id)}/calendar/events?fromDateTime=${encodeURIComponent(a + "T00:00:00+09:00")}&untilDateTime=${encodeURIComponent(b + "T00:00:00+09:00")}`;
        let j: any;
        try { j = await works(token, q, fetcher); } catch (e) { ok = false; if (stat.errors.length < 5) stat.errors.push(String((e as Error).message).slice(0, 200)); break; }
        for (const ev of j.events || []) {
          for (const c of ev.eventComponents || [ev]) {
            const p = parseMeet(c?.summary || "");
            if (!p) continue;
            const id = String(c.eventId || "") + (c.recurrenceId ? "@" + c.recurrenceId : "");
            const st = kstStart(c.start);
            if (!id || !st) continue;
            stat.meetEvents++;
            if (p.canceled) { stat.canceled++; canceledIds.add(id); continue; }
            seenIds.add(id);
            for (const n of p.names) {
              stat.names++;
              const l = matchCase(n, u.name, cases, ix, st.date);
              if (l == null) { stat.unmatched++; (ix.get(n)?.length ? stat.sameName++ : stat.noCase++); if (dry && sample.length < 15) sample.push({ who: u.name, d: st.date, name: mask(n), case: null }); continue; }
              stat.matched++;
              if (dry && sample.length < 15) sample.push({ who: u.name, d: st.date, name: mask(n), case: l });
              rows.push({ event_id: id, l_num: l, lawyer: u.name, ev_date: st.date, ev_time: st.time, place: p.place.slice(0, 20), seen_at: new Date().toISOString() });
            }
          }
        }
      }
      ok ? stat.readOk++ : stat.readFail++;
    }
    console.log("meet", JSON.stringify({ ...stat, errors: stat.errors.length, dry }));
    if (dry) return json({ from, to, ...stat, sample });

    // 4) 저장: 맞춘 줄은 넣고, 취소됐거나 캘린더에서 사라진 일정 줄은 지운다
    const uniq = [...new Map(rows.map((r) => [r.event_id + "|" + r.l_num, r])).values()];
    for (let i = 0; i < uniq.length; i += 500) {
      await rest(env, "meet_event?on_conflict=event_id,l_num", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(uniq.slice(i, i + 500)) }, fetcher);
    }
    let removed = 0;
    if (stat.readFail === 0) {
      const old = await rest(env, `meet_event?select=id,event_id&ev_date=gte.${from}&ev_date=lte.${to}`, {}, fetcher) || [];
      const gone = old.filter((r: any) => !seenIds.has(r.event_id) || canceledIds.has(r.event_id)).map((r: any) => r.id);
      for (let i = 0; i < gone.length; i += 200) await rest(env, `meet_event?id=in.(${gone.slice(i, i + 200).join(",")})`, { method: "DELETE" }, fetcher);
      removed = gone.length;
    }
    return json({ from, to, ...stat, saved: uniq.length, removed });
  } catch (e) {
    console.log("meet error", String((e as Error)?.message || e).slice(0, 300));
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
}

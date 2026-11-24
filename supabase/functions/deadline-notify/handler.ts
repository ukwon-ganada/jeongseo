// ============================================================================
//  deadline-notify — 기한 웍스 알림 (사무실 PC notify.py 기한 알림을 대신, 2026-11-20 석원 "슈파베이스로 일원화")
//
//  계산은 사건 화면과 같은 파일(case-view/deadlines.ts, inv_deadlines.ts)을 쓴다 → 화면과 알림이 항상 같다.
//  무엇을·언제 보낼지는 plan.ts.
//
//  부르는 법 (예약 작업과 같은 열쇠 x-cron-secret = lw_settings.cron_secret):
//    { "dryRun": true }                       → 보낼 내용만 돌려준다(발송·기록 없음). 기본값
//    { "dryRun": true, "today": "2026-11-17" } → 그날 기준으로 계산
//    { "dryRun": false }                      → 실제 발송 + sent 표 기록 (lw_settings.dl_notify_send = 'on'일 때만)
//
//  배포: verify_jwt=false. 시크릿: WORKS_CLIENT_ID, WORKS_CLIENT_SECRET, WORKS_SERVICE_ACCOUNT, WORKS_PRIVATE_KEY (봇 함수와 같음)
// ============================================================================
import { computeDeadlines, type Deadline, type OtherCase } from "../case-view/deadlines.ts";
import { computeInvDeadlines } from "../case-view/inv_deadlines.ts";
import { worksToken, type AuthEnv } from "../meet-sync/works_auth.ts";
import { card, isTeamCase, pick, roomMessage, deadlineLines, type SentRow } from "./plan.ts";

export type Env = AuthEnv & { sbUrl: string; sbKey: string; bots?: string[] };
const API = "https://www.worksapis.com/v1.0";
const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const enc = encodeURIComponent;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

async function rest(env: Env, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(path.split("?")[0] + " " + r.status + " " + t.slice(0, 160));
  return t ? JSON.parse(t) : null;
}
async function restAll(env: Env, path: string, fetcher: typeof fetch): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const b = await rest(env, path + "&limit=1000&offset=" + off, {}, fetcher) || [];
    out.push(...b);
    if (b.length < 1000) return out;
  }
}
const inList = (xs: (string | number)[]) => "(" + xs.map((x) => typeof x === "number" ? x : '"' + String(x).replace(/"/g, "") + '"').join(",") + ")";

export type Item = { room: string; code: string; head: string; kind: string; due: string; send: boolean; why: string; lines?: string[] };
export type Plan = { today: string; rooms: { channel: string; text: string; cards: any[] }[]; items: Item[]; noRoom: { code: string; client: string; charge: string; kind: string; due: string; why: string }[] };

export async function buildPlan(env: Env, today: string, fetcher: typeof fetch = fetch): Promise<Plan> {
  // 1) 기한이 생길 수 있는 사건: 최근 선고·기록접수통지가 있는 사건 (7일 + 50일 경과 + 여유)
  const since = addDays(today, -90);
  const trig = await restAll(env, `lw_process_events?select=l_num&lp_appoint_date=gte.${since}&or=(lp_contents.like.*선고*,lp_contents.like.*소송기록접수통지*)`, fetcher);
  const trigNums = [...new Set(trig.map((x) => Number(x.l_num)).filter(Boolean))];

  // 2) 방 목록(종결 방 제외)과 사건 정보
  const rooms = await restAll(env, `works_room_case?select=channel_id,l_num,case_no,is_primary,status,room_title&status=eq.대상&order=is_primary.desc,updated_at.desc`, fetcher);
  const roomNums = [...new Set(rooms.map((r) => Number(r.l_num)).filter((n) => n && Number.isFinite(n)))];
  const nums = [...new Set([...trigNums, ...roomNums])];
  const cases: any[] = [];
  for (let i = 0; i < nums.length; i += 150) {
    cases.push(...await rest(env, `case_all?select=l_num,l_code,l_client,l_kind,charge_lawyer,client_position,state&l_num=in.${inList(nums.slice(i, i + 150))}`, {}, fetcher) || []);
  }
  const caseBy = new Map(cases.map((c) => [Number(c.l_num), c]));
  const roomsOf = new Map<number, any[]>();
  for (const r of rooms) if (r.l_num) (roomsOf.get(Number(r.l_num)) || roomsOf.set(Number(r.l_num), []).get(Number(r.l_num))!).push(r);

  // 3) 재판 단계 대상 사건: 형사·진행·서고은 팀(또는 담당 칸이 비었는데 우리 방이 있는 사건)
  const courtCases = trigNums.map((n) => caseBy.get(n)).filter((c) => c && /형사/.test(nz(c.l_kind)) && nz(c.state) !== "종결" &&
    (isTeamCase(c.charge_lawyer) || (!nz(c.charge_lawyer) && roomsOf.has(Number(c.l_num)))));
  // 같은 방에 함께 연결된 다른 사건(병합 판단용)도 진행내역을 읽는다
  const otherNums = new Map<number, number[]>();
  for (const c of courtCases) {
    const chans = new Set((roomsOf.get(Number(c.l_num)) || []).map((r) => r.channel_id));
    const os = [...new Set(rooms.filter((r) => chans.has(r.channel_id) && r.l_num && Number(r.l_num) !== Number(c.l_num) && Number(r.l_num) > 0).map((r) => Number(r.l_num)))];
    if (os.length) otherNums.set(Number(c.l_num), os);
  }
  const evNums = [...new Set([...courtCases.map((c) => Number(c.l_num)), ...[...otherNums.values()].flat()])];
  const evBy = new Map<number, any[]>();
  for (let i = 0; i < evNums.length; i += 25) {
    const rows = await restAll(env, `lw_process_events?select=lp_num,l_num,lp_set,lp_appoint_date,lp_contents,lp_remark,delivered_date&l_num=in.${inList(evNums.slice(i, i + 25))}&order=lp_appoint_date.asc,lp_num.asc`, fetcher);
    for (const e of rows) (evBy.get(Number(e.l_num)) || evBy.set(Number(e.l_num), []).get(Number(e.l_num))!).push(e);
  }

  // 4) 사람 확정 기록, 지난 발송기록(주기 판단, 사무실 PC 기록 포함)
  const confirms = await restAll(env, `deadline_confirm?select=l_code,kind,due,action,created_at&undone_at=is.null&order=created_at.asc`, fetcher);
  const cfKey = (code: string, kind: string, due: string) => code + "|" + kind + "|" + due;
  const cf = new Map<string, { action: string }>();
  for (const r of confirms) {
    const k = cfKey(nz(r.l_code), nz(r.kind), nz(r.due).slice(0, 10));
    if (cf.get(k)?.action !== "제출함") cf.set(k, { action: nz(r.action) });
  }
  const sent: SentRow[] = (await restAll(env, `sent?select=body,sent_at&sent_at=gte.${addDays(today, -120)}`, fetcher)).map((r) => ({ body: nz(r.body), sent_at: nz(r.sent_at) }));

  const plan: Plan = { today, rooms: [], items: [], noRoom: [] };
  const perRoom = new Map<string, { code: string; client: string; charge: string; lines: string[]; cards: any[] }>();
  const add = (c: any, room: any | null, dls: Deadline[], codeShown: string) => {
    for (const dl of dls) {
      const code = nz(c.l_code);
      const p = pick(dl, code, today, sent, cf.get(cfKey(code, dl.kind, dl.d)));
      if (!room) {
        if (p.send) plan.noRoom.push({ code: codeShown, client: nz(c.l_client), charge: nz(c.charge_lawyer), kind: dl.kind, due: dl.d, why: dl.why });
        continue;
      }
      const it: Item = { room: room.channel_id, code: codeShown, head: nz(c.l_client), kind: dl.kind, due: dl.d, send: p.send, why: p.why };
      plan.items.push(it);
      if (!p.send) continue;
      const g = perRoom.get(room.channel_id) || perRoom.set(room.channel_id, { code: codeShown, client: nz(c.l_client), charge: nz(c.charge_lawyer), lines: [], cards: [] }).get(room.channel_id)!;
      it.lines = deadlineLines(dl, today, cf.get(cfKey(code, dl.kind, dl.d)));
      g.lines.push(...it.lines);
      if (g.cards.length < 10) g.cards.push(card(code, dl.kind, dl.d));
    }
  };

  for (const c of courtCases) {
    const ln = Number(c.l_num);
    const others: OtherCase[] = (otherNums.get(ln) || []).map((n) => ({ code: nz(caseBy.get(n)?.l_code), evs: evBy.get(n) || [] }));
    const dls = computeDeadlines(nz(c.l_code), evBy.get(ln) || [], today, others, nz(c.client_position));
    const rs = roomsOf.get(ln) || [];
    // 사건 화면처럼 방마다 사건 하나: 이 사건이 주 사건인 방을 먼저, 없으면 첫 방
    add(c, rs.find((r) => r.is_primary) || rs[0] || null, dls, nz(c.l_code));
  }

  // 5) 수사 단계 기한: 방 대화에서 뽑은 처분·통지 줄(room_event)로 방마다 계산 (사건 화면 applyInvDeadlines와 같음)
  const evRows = await restAll(env, `room_event?select=channel_id,l_num,kind,ev_date,summary,state,source,filed&hidden=eq.false&order=ev_date.asc`, fetcher);
  // 사건 화면(roomEvents)처럼 '이 방' 줄 + '이 사건(l_num)' 줄을 함께 본다. 대화 가져오기 줄은 방 없이 사건 번호로만 남는다
  const seen = new Set<string>();
  for (const r of rooms) {
    if (seen.has(r.channel_id)) continue;
    seen.add(r.channel_id);
    const c = caseBy.get(Number(r.l_num));
    if (!c || nz(c.state) === "종결" || (nz(c.charge_lawyer) && !isTeamCase(c.charge_lawyer))) continue;
    const nums = new Set(rooms.filter((x) => x.channel_id === r.channel_id && x.l_num).map((x) => Number(x.l_num)));
    const mine = evRows.filter((e) => e.channel_id === r.channel_id || nums.has(Number(e.l_num)));
    if (!mine.length) continue;
    const dls = computeInvDeadlines(mine, nz(r.room_title), today).map(({ strip: _s, ...d }) => d as Deadline);
    if (!dls.length) continue;
    const shown = nz(r.case_no) && !/^수사-/.test(nz(c.l_code)) ? nz(c.l_code) : (nz(r.room_title).match(/\d{4}\s*형제\s*\d+|\d{4}-\d+/)?.[0] || nz(c.l_code));
    add(c, r, dls, shown);
  }

  for (const [channel, g] of perRoom) plan.rooms.push({ channel, text: roomMessage(g.code, g.client, g.charge, g.lines), cards: g.cards });
  return plan;
}

async function fingerprint(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function sendRoom(env: Env, token: string, channel: string, content: unknown, fetcher: typeof fetch): Promise<string> {
  let last = "";
  for (const bot of env.bots || ["12905890", "13580302"]) {
    const r = await fetcher(`${API}/bots/${bot}/channels/${channel}/messages`, {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ content }),
    });
    if (r.ok) return bot;
    last = r.status + " " + (await r.text()).slice(0, 120);
  }
  throw new Error(last);
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const set = await rest(env, "lw_settings?select=key,value&key=in.(cron_secret,dl_notify_send)", {}, fetcher).catch(() => []) || [];
  const val = (k: string) => nz(set.find((x: any) => x.key === k)?.value);
  if (!val("cron_secret") || req.headers.get("x-cron-secret") !== val("cron_secret")) return json({ error: "forbidden" }, 403);
  const b = await req.json().catch(() => ({}));
  const today = /^\d{4}-\d{2}-\d{2}$/.test(nz(b?.today)) ? nz(b.today) : kstToday();
  const plan = await buildPlan(env, today, fetcher);
  if (b?.dryRun !== false) return json({ dryRun: true, ...plan });
  if (val("dl_notify_send") !== "on") return json({ error: "발송 스위치(lw_settings.dl_notify_send)가 꺼져 있습니다", ...plan }, 409);
  if (b?.today) return json({ error: "실제 발송은 오늘 기준으로만" }, 400);

  const token = await worksToken(env, "bot", fetcher);
  const result: any[] = [];
  for (const r of plan.rooms) {
    const fp = await fingerprint(r.channel + "|" + r.text);
    const dup = await rest(env, `sent?select=id&fingerprint=eq.${fp}&limit=1`, {}, fetcher).catch(() => []);
    if (dup?.length) { result.push({ channel: r.channel, skip: "같은 내용 이미 보냄" }); continue; }
    try {
      const bot = await sendRoom(env, token, r.channel, { type: "text", text: r.text }, fetcher);
      // 확정 버튼 카드는 보내지 않는다 (2026-11-24 석원 "버튼기능 삭제"): 웍스 카드는 눌러도 반응을 보여 줄 수 없어서.
      //   기한 확정은 사건 화면 기한 탭 [수정]에서 한다.
      await rest(env, "sent", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ fingerprint: fp, channel_id: r.channel, l_code: null, sent_at: new Date().toISOString(), body: r.text, sent_by: "supabase:" + bot }) }, fetcher);
      result.push({ channel: r.channel, ok: true });
    } catch (e) {
      result.push({ channel: r.channel, error: String((e as Error)?.message || e) });
    }
  }
  return json({ dryRun: false, today, sent: result, noRoom: plan.noRoom });
}

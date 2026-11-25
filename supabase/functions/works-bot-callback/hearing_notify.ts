// ============================================================================
//  새 기일·바뀐 기일 먼저 알리기 (석원 2026-11-25 "3번: 도우미가 알려 주어서 일정에 반영")
//
//  15분마다(pg_cron → works-bot-callback x-cron-secret, action "hearing-notify"):
//    · 로웨어에 최근(기본 2시간) 새로 들어오거나 바뀐 앞으로의 기일을 고른다.
//    · 그 방 담당 변호사(방 제목 앞머리) 웍스 캘린더에 그날 그 의뢰인 일정이 이미 있으면 아무 말도 하지 않는다.
//    · 없으면 사건방에 버튼 한 줄: "새 기일" 또는 "기일 변경 (전 12.10. 10:00)" + [일정 입력 창 열기].
//    · 보낸 것은 hearing_notice 에 남긴다 → 같은 기일은 다시 알리지 않고, 메뉴 [일정 입력]이 이 기일을 쓴다.
//  켜는 범위: notifyRooms(방 ID 목록)가 있으면 그 방만, "*"면 모든 방. notifyBot 으로 보낸다.
// ============================================================================
import { pemToPkcs8 } from "./room_file.ts";
import { buildPlan, calendarUrl, lawyersFromTitle, type Plan, sendToRoom, type SchedEnv } from "./schedule_cmd.ts";

export type NotifyOpts = { force?: boolean; dryRun?: boolean; hours?: number; notifyRooms?: string[]; notifyBot: string; limit?: number; lpNum?: number };

async function rest(env: SchedEnv, path: string, fetcher: typeof fetch, init: RequestInit = {}): Promise<any> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init, headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error("DB " + r.status + " " + (await r.text()).slice(0, 160));
  const t = r.status === 204 ? "" : await r.text();
  return t ? JSON.parse(t) : null;
}

// 캘린더 읽기 토큰 (calendar.read user.read — meet-sync 와 같은 권한)
const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? unescape(encodeURIComponent(b)) : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const calToks = new Map<string, { token: string; until: number }>();
export async function calToken(env: SchedEnv, fetcher: typeof fetch, scope = "calendar.read user.read"): Promise<string> {
  const calTok = calToks.get(scope);
  if (calTok && calTok.until > Date.now()) return calTok.token;
  const { clientId, clientSecret, serviceAccount, privateKey } = env;
  if (!clientId || !clientSecret || !serviceAccount || !privateKey) throw new Error("웍스 열쇠 시크릿 없음");
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(privateKey) as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim)));
  const r = await fetcher("https://auth.worksmobile.com/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ assertion: head + "." + claim + "." + b64url(sig), grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", client_id: clientId, client_secret: clientSecret, scope }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("캘린더 토큰 실패 " + r.status + " " + t.slice(0, 100));
  const j = JSON.parse(t);
  calToks.set(scope, { token: j.access_token, until: Date.now() + 50 * 60e3 });
  return j.access_token;
}
export async function works(tok: string, path: string, fetcher: typeof fetch): Promise<any> {
  const r = await fetcher("https://www.worksapis.com/v1.0" + path, { headers: { Authorization: "Bearer " + tok } });
  const t = await r.text();
  if (!r.ok) throw new Error("works " + r.status + " " + t.slice(0, 100));
  return t ? JSON.parse(t) : {};
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// 캘린더에 이미 있나: 그날 일정 제목에 의뢰인 이름이 있고, 시각이 있으면 시작 시각도 같을 때
export function alreadyInCalendar(events: { summary: string; start: string }[], client: string, time: string): boolean {
  const name = String(client || "").trim();
  if (name.length < 2) return false;
  return events.some((e) => !/취소/.test(e.summary) && e.summary.includes(name) && (!time || !e.start.includes("T") || e.start.slice(11, 16) === time));
}

type Row = { lp_num: number; l_num: number; date: string; time: string; contents: string };

export async function hearingNotify(env: SchedEnv, o: NotifyOpts, fetcher: typeof fetch = fetch) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const since = new Date(Date.now() - (o.hours ?? 2) * 3600e3).toISOString();
  const giil = encodeURIComponent("기일");
  // 1) 후보: 새로 들어온 기일 + 최근 바뀐 기일
  const fresh: any[] = o.lpNum
    ? await rest(env, `lw_process_events?select=lp_num,l_num,lp_appoint_date,lp_appoint_time,lp_contents&lp_num=eq.${o.lpNum}`, fetcher)
    : await rest(env, `lw_process_events?select=lp_num,l_num,lp_appoint_date,lp_appoint_time,lp_contents&lp_set=eq.${giil}&lp_appoint_date=gte.${today}&first_seen_at=gte.${since}&limit=300`, fetcher);
  const ch: any[] = o.lpNum ? [] : await rest(env, `lw_process_event_changes?select=lp_num,old_row&changed_at=gte.${since}&limit=500`, fetcher);
  const oldBy = new Map<number, any>();
  for (const c of ch) oldBy.set(c.lp_num, c.old_row);
  const chNums = [...oldBy.keys()].filter((n) => !fresh.some((f) => f.lp_num === n));
  const changed: any[] = chNums.length
    ? await rest(env, `lw_process_events?select=lp_num,l_num,lp_appoint_date,lp_appoint_time,lp_contents&lp_set=eq.${giil}&lp_appoint_date=gte.${today}&lp_num=in.(${chNums.slice(0, 200).join(",")})`, fetcher)
    : [];
  const rows: Row[] = [...fresh, ...changed].map((e) => ({
    lp_num: e.lp_num, l_num: e.l_num, date: String(e.lp_appoint_date).slice(0, 10), time: String(e.lp_appoint_time || "").slice(0, 5), contents: e.lp_contents || "",
  })).filter((r) => r.l_num && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const out = { candidates: rows.length, sent: 0, inCalendar: 0, noRoom: 0, skipped: 0, done: 0, items: [] as any[] };
  if (!rows.length) return out;

  // 이미 알린 것(같은 기일·같은 시각)은 건너뛴다
  const prev: any[] = await rest(env, `hearing_notice?select=lp_num,ev_date,ev_time&lp_num=in.(${[...new Set(rows.map((r) => r.lp_num))].join(",")})&order=created_at.desc`, fetcher);
  const seen = new Set(prev.map((p) => `${p.lp_num}|${p.ev_date}|${p.ev_time || ""}`));
  const prevBy = new Map<number, any>();
  for (const p of prev) if (!prevBy.has(p.lp_num)) prevBy.set(p.lp_num, p);
  const todo = rows.filter((r) => o.force || !seen.has(`${r.lp_num}|${r.date}|${r.time}`)).slice(0, o.limit ?? 40);
  out.done = rows.length - todo.length;
  if (!todo.length) return out;

  const nums = [...new Set(todo.map((r) => r.l_num))];
  const rooms: any[] = await rest(env, `works_room_case?select=channel_id,l_num,room_title,status,is_primary&l_num=in.(${nums.join(",")})&status=eq.${encodeURIComponent("대상")}&order=is_primary.desc,updated_at.desc`, fetcher);
  const cases: any[] = await rest(env, `case_all?select=l_num,l_code,l_client,court,charge_lawyer,raw->>l_another&l_num=in.(${nums.join(",")})`, fetcher);
  const gk: any[] = await rest(env, "gukseon_cases?select=data->>caseNumber&limit=3000", fetcher).catch(() => []);
  const norm = (s: string) => String(s || "").replace(/\s/g, "");
  const gkSet = new Set(gk.map((g) => norm(g.caseNumber)));

  let tok = "", users: Map<string, string> | null = null;
  const dayCache = new Map<string, { summary: string; start: string }[]>();
  const calEvents = async (lawyer: string, date: string) => {
    const k = lawyer + "|" + date;
    if (dayCache.has(k)) return dayCache.get(k)!;
    tok ||= await calToken(env, fetcher);
    if (!users) {
      users = new Map();
      let cur = "";
      for (let i = 0; i < 20; i++) {
        const j = await works(tok, `/users?count=100${cur ? "&cursor=" + encodeURIComponent(cur) : ""}`, fetcher);
        for (const u of j.users || []) users.set([u?.userName?.lastName, u?.userName?.firstName].filter(Boolean).join(""), u.userId);
        cur = j?.responseMetaData?.nextCursor || "";
        if (!cur) break;
      }
    }
    const uid = users.get(lawyer);
    if (!uid) { dayCache.set(k, []); return []; }
    const j = await works(tok, `/users/${encodeURIComponent(uid)}/calendar/events?fromDateTime=${encodeURIComponent(date + "T00:00:00+09:00")}&untilDateTime=${encodeURIComponent(addDays(date, 1) + "T00:00:00+09:00")}`, fetcher);
    const evs: { summary: string; start: string }[] = [];
    for (const ev of j.events || []) for (const c of ev.eventComponents || [ev]) evs.push({ summary: String(c?.summary || ""), start: String(c?.start?.dateTime || c?.start?.date || "") });
    dayCache.set(k, evs);
    return evs;
  };

  const records: any[] = [];
  for (const r of todo) {
    const room = rooms.find((x) => x.l_num === r.l_num);
    const c = cases.find((x) => x.l_num === r.l_num) || {};
    if (!room) { out.noRoom++; records.push({ ...rec(r, null, "no_room", null) }); continue; }
    if (o.notifyRooms && !o.notifyRooms.includes("*") && !o.notifyRooms.includes(room.channel_id)) { out.skipped++; continue; }
    const plan: Plan = buildPlan({
      roomTitle: room.room_title || "", caseNo: c.l_code || "", client: c.l_client || "", another: c.l_another || "", court: c.court || "",
      gukseon: gkSet.has(norm(c.l_code)), date: r.date, time: r.time, contents: r.contents, source: "도우미 알림",
    });
    const client = String(c.l_client || "").split(/[,(]/)[0].trim();
    const lws = lawyersFromTitle(room.room_title || "");
    // 방 제목에 변호사 표시가 없으면 담당 변호사들 + 기일 일정을 쓰는 변호사 넷의 캘린더를 다 본다
    const who = lws.length ? lws.map((l) => l.name) : [...new Set([...String(c.charge_lawyer || "").split(/[,\s]+/).filter(Boolean), "서고은", "이예나", "박종덕", "강현구"])];
    let inCal = false;
    for (const n of o.force ? [] : who) {
      if (alreadyInCalendar(await calEvents(n, r.date).catch(() => []), client, plan.time)) { inCal = true; break; }
    }
    // 바뀐 기일: 전에 알린 날짜 또는 로웨어 옛 값
    const p = prevBy.get(r.lp_num), old = oldBy.get(r.lp_num);
    const before = p ? `${p.ev_date} ${p.ev_time || ""}`.trim() : old?.lp_appoint_date ? `${String(old.lp_appoint_date).slice(0, 10)} ${String(old.lp_appoint_time || "").slice(0, 5)}`.trim() : "";
    const was = before && before !== `${r.date} ${r.time}`.trim() ? before : "";
    out.items.push({ room: room.channel_id.slice(0, 8), summary: plan.summary, date: r.date, time: plan.time, inCal, was });
    if (inCal) { out.inCalendar++; records.push(rec(r, room.channel_id, "in_calendar", plan)); continue; }
    if (!o.dryRun) {
      await sendToRoom(env, o.notifyBot, room.channel_id, noticeMessage(plan, was), fetcher);
      out.sent++;
    }
    records.push(rec(r, room.channel_id, "sent", plan, was));
  }
  if (!o.dryRun && records.length) {
    await rest(env, "hearing_notice?on_conflict=lp_num,ev_date,ev_time", fetcher, {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(records),
    });
  }
  return out;
}

function rec(r: Row, channel: string | null, status: string, plan: Plan | null, was = "") {
  return { lp_num: r.lp_num, l_num: r.l_num, channel_id: channel, ev_date: r.date, ev_time: r.time || "", contents: r.contents.slice(0, 200), status, summary: plan?.summary || null, was: was || null };
}

const W = ["일", "월", "화", "수", "목", "금", "토"];
const dl = (d: string) => { const t = new Date(d + "T00:00:00Z"); return `${t.getUTCMonth() + 1}.${t.getUTCDate()}.(${W[t.getUTCDay()]})`; };
export function noticeMessage(p: Plan, was: string): unknown {
  const head = was ? `기일 변경 · 전 ${dl(was.slice(0, 10))}${was.slice(11) ? " " + was.slice(11) : ""}` : "새 기일";
  return {
    type: "button_template",
    contentText: `${head}\n${p.summary}\n${dl(p.date)}${p.time ? " " + p.time : ""} · ${p.location || "장소 없음"}` + (p.lawyer ? `\n캘린더: ${p.lawyer}` : ""),
    actions: [{ type: "uri", label: "일정 입력 창 열기", uri: calendarUrl(p) }],
  };
}

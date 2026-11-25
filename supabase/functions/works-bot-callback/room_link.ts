// ============================================================================
//  새 사건방 자동 연결 (works-bot-callback 이 부름)
//
//  봇이 새 방에 초대되면(웍스 'join' 신호) 그 방 제목을 웍스 API로 읽고,
//  제목 속 사건번호(2026고단1234 등)로 로웨어 사건(cases)을 찾아 works_room_case 에 넣는다.
//    - 사건번호가 하나도 없거나 로웨어에 없는 번호면 로웨어 사건에는 연결하지 않는다(잘못 붙이느니 안 붙인다)
//    - 여러 사건이면 모두 넣고, 가장 최근 등록 사건(l_num 큰 것 = 보통 상급심)을 주 사건으로
//    - 이미 연결된 방은 건드리지 않는다
//    - 로웨어 사건을 못 찾았는데 수사단계 방(형사 표시·수사기관 이름)이면 수사 사건을 만들어 붙인다(inv_case.ts)
//  기록: source='auto', basis='방 제목 사건번호'
// ============================================================================
import { botToken, type FileEnv } from "./room_file.ts";
import { createInvCase, invFields } from "./inv_case.ts";

export type LinkResult = { linked: number; how: string };

// OCR 글자 헷갈림까지는 필요 없음(방 제목은 글자 그대로) → 단순히 연·부호·번호
export function caseNosInTitle(s: string): string[] {
  const out = new Set<string>();
  for (const m of String(s || "").matchAll(/(?<!\d)((?:19|20)\d{2}|\d{2})\s*([가-힣]{1,4})\s*(\d{1,7})/g)) {
    const y = m[1].length === 2 ? "20" + m[1] : m[1];
    const n = m[3].replace(/^0+/, "");
    if (n) out.add(y + m[2] + n);
  }
  return [...out];
}

// cases.l_code 는 '2026고단1234' 또는 '26고단1234' 모양이 섞여 있을 수 있음
export function codeVariants(no: string): string[] {
  const m = no.match(/^(\d{4})(.+)$/);
  return m ? [no, m[1].slice(2) + m[2]] : [no];
}

async function rest(env: FileEnv, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  return fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

// 직원이 "이 방 사건이 아니다"라고 푼 사건들 (자동 연결이 다시 붙이지 않게)
export async function rejectedLNums(env: FileEnv, channelId: string, fetcher: typeof fetch = fetch): Promise<Set<number>> {
  const r = await rest(env, `room_link_reject?select=l_num&channel_id=eq.${encodeURIComponent(channelId)}`, {}, fetcher);
  if (!r.ok) { await r.body?.cancel(); return new Set(); }
  return new Set(((await r.json()) as any[]).map((x) => Number(x.l_num)));
}

export async function roomTitle(env: FileEnv, botId: string, channelId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const tok = await botToken(env, fetcher);
  const r = await fetcher(`https://www.worksapis.com/v1.0/bots/${botId}/channels/${encodeURIComponent(channelId)}`,
    { headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) throw new Error("방 정보 " + r.status);
  return String((await r.json())?.title || "");
}

export async function linkRoom(env: FileEnv, botId: string, channelId: string, fetcher: typeof fetch = fetch, title?: string): Promise<LinkResult> {
  const had = await rest(env, `works_room_case?select=channel_id&limit=1&channel_id=eq.${encodeURIComponent(channelId)}`, {}, fetcher);
  if (had.ok && (await had.json()).length) return { linked: 0, how: "already" };
  const t = title ?? await roomTitle(env, botId, channelId, fetcher);
  const nos = caseNosInTitle(t);
  // 규칙(석원 2026-11-16): 도우미가 있는 방은 무조건 사건 하나. 로웨어 사건을 못 찾으면 도우미 자체 사건을 만들어 두고,
  // 나중에 제목의 번호가 로웨어에 생기면 합친다(inv_case.ts recheckInv). 수사 단계 방이 아니어도(민사·제목 없음) 만든다.
  const inv = async (how: string): Promise<LinkResult> => {
    await createInvCase(env, channelId, t, invFields(t), fetcher);
    return { linked: 1, how: "inv-created:" + how };
  };
  if (!nos.length) return await inv("no-case-no");
  const codes = [...new Set(nos.flatMap(codeVariants))];
  const inList = "(" + codes.map((c) => '"' + c.replace(/"/g, "") + '"').join(",") + ")";
  const r = await rest(env, `cases?select=l_num,l_code,state&l_code=in.${encodeURIComponent(inList)}`, {}, fetcher);
  let found: any[] = r.ok ? await r.json() : [];
  if (found.length) { const no = await rejectedLNums(env, channelId, fetcher); found = found.filter((c) => !no.has(Number(c.l_num))); }
  if (!found.length) return await inv("not-in-lawware");
  found.sort((a, b) => Number(b.l_num) - Number(a.l_num));
  const now = new Date().toISOString();
  const rows = found.map((c, i) => ({
    channel_id: channelId, l_num: Number(c.l_num), case_no: caseNosInTitle(c.l_code)[0] || c.l_code,
    is_primary: i === 0, status: found[0].state === "종결" ? "종결" : "대상",
    room_title: t, basis: "방 제목 사건번호", confidence: found.length === 1 ? "높음" : "보통", source: "auto", updated_at: now,
  }));
  const ins = await rest(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) }, fetcher);
  if (!ins.ok) throw new Error("방 연결 저장 실패 " + ins.status + " " + (await ins.text()).slice(0, 120));
  await ins.body?.cancel();
  return { linked: rows.length, how: "case-no" };
}

// 사건 고르기 화면에서 직원이 고른 사건을 그 방에 기억 (아직 연결 안 된 방만)
export async function linkPicked(env: FileEnv, botIds: string[], channelId: string, lNum: number, fetcher: typeof fetch = fetch): Promise<LinkResult> {
  const had = await rest(env, `works_room_case?select=channel_id&limit=1&channel_id=eq.${encodeURIComponent(channelId)}`, {}, fetcher);
  if (had.ok && (await had.json()).length) return { linked: 0, how: "already" };
  const r = await rest(env, `cases?select=l_num,l_code,state&l_num=eq.${lNum}`, {}, fetcher);
  const c = r.ok ? (await r.json())[0] : null;
  if (!c) return { linked: 0, how: "no-case" };
  let t: string | null = null;
  for (const b of botIds) { try { t = await roomTitle(env, b, channelId, fetcher); break; } catch { /* 다음 봇 */ } }
  const ins = await rest(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
    channel_id: channelId, l_num: Number(c.l_num), case_no: caseNosInTitle(c.l_code)[0] || c.l_code, is_primary: true,
    status: c.state === "종결" ? "종결" : "대상", room_title: t, basis: "직원이 고름", confidence: "높음", source: "picked",
    updated_at: new Date().toISOString(),
  }]) }, fetcher);
  if (!ins.ok) throw new Error("방 연결 저장 실패 " + ins.status);
  await ins.body?.cancel();
  return { linked: 1, how: "picked" };
}

// 봇 여러 개(운영·시험) 중 그 방에 들어가 있는 봇으로 자동 연결 시도
// 방 제목을 어느 봇으로도 못 읽어도(권한·일시 오류) 빈 제목으로 사건을 만들고, 제목은 하루 4번 다시 읽어 채운다
// 같은 방에서 신호가 거의 동시에 여러 개 오면 사건이 두 번 만들어지지 않게, 이 서버에서 처리 중인 방은 기다렸다가 같은 결과를 쓴다
const inflight = new Map<string, Promise<LinkResult>>();
export function linkRoomAnyBot(env: FileEnv, botIds: string[], channelId: string, fetcher: typeof fetch = fetch): Promise<LinkResult> {
  const cur = inflight.get(channelId);
  if (cur) return cur.then(() => ({ linked: 0, how: "already" }));
  const p = linkRoomAnyBot1(env, botIds, channelId, fetcher).finally(() => inflight.delete(channelId));
  inflight.set(channelId, p);
  return p;
}
async function linkRoomAnyBot1(env: FileEnv, botIds: string[], channelId: string, fetcher: typeof fetch): Promise<LinkResult> {
  const had = await rest(env, `works_room_case?select=channel_id&limit=1&channel_id=eq.${encodeURIComponent(channelId)}`, {}, fetcher);
  if (had.ok && (await had.json()).length) return { linked: 0, how: "already" };
  let t: string | null = null;
  for (const b of botIds) { try { t = await roomTitle(env, b, channelId, fetcher); break; } catch { /* 다음 봇 */ } }
  if (t && await isScheduleRoom(env, channelId, t, fetcher)) return { linked: 0, how: "schedule-room" };
  return await linkRoom(env, botIds[0], channelId, fetcher, t ?? "");
}

// 일정 방(석원 2026-11-25): 빠진 기일 알림을 모아 받는 방. 사건 방이 아니므로 사건을 만들지 않는다.
// 방 제목이 lw_settings.schedule_room_title 과 같으면 그 채널을 schedule_room_channel 에 적는다.
export const sameTitle = (a: string, b: string) => !!a && !!b && a.replace(/\s/g, "") === b.replace(/\s/g, "");
async function isScheduleRoom(env: FileEnv, channelId: string, title: string, fetcher: typeof fetch): Promise<boolean> {
  const r = await rest(env, "lw_settings?select=key,value&key=in.(schedule_room_title,schedule_room_channel)", {}, fetcher);
  const kv = new Map<string, string>(r.ok ? (await r.json()).map((x: any) => [x.key, x.value]) : []);
  if (kv.get("schedule_room_channel") === channelId) return true;
  if (!sameTitle(kv.get("schedule_room_title") || "", title)) return false;
  const w = await rest(env, "lw_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "schedule_room_channel", value: channelId }) }, fetcher);
  await w.body?.cancel();
  return true;
}

// 이 방에서 받은 서면 파일·대화 일정은 방을 따라간다
async function moveRoomRows(env: FileEnv, channelId: string, lNum: number, caseNo: string | null, fetcher: typeof fetch) {
  const enc = encodeURIComponent(channelId);
  const h = { method: "PATCH", headers: { Prefer: "return=minimal" } };
  await rest(env, `case_file?channel_id=eq.${enc}`, { ...h, body: JSON.stringify({ l_num: lNum, case_no: caseNo }) }, fetcher).then((x) => x.body?.cancel()).catch(() => {});
  await rest(env, `room_event?channel_id=eq.${enc}`, { ...h, body: JSON.stringify({ l_num: lNum }) }, fetcher).then((x) => x.body?.cancel()).catch(() => {});
}

// 직원이 사건정보에서 연결 사건을 바꾸거나 풀 때. lNum 이 없으면 연결을 풀고 그 방 자체 사건(로웨어 미등록)으로 둔다.
// 풀린 로웨어 사건은 room_link_reject 에 적어 자동 연결이 다시 붙이지 않게 한다.
export async function relinkRoom(env: FileEnv, botIds: string[], channelId: string, lNum: number | null, by: string, fetcher: typeof fetch = fetch): Promise<LinkResult> {
  const enc = encodeURIComponent(channelId);
  const r0 = await rest(env, `works_room_case?select=l_num,room_title,status&channel_id=eq.${enc}`, {}, fetcher);
  const old: any[] = r0.ok ? await r0.json() : [];
  if (lNum && old.some((x) => Number(x.l_num) === lNum) && old.length === 1) return { linked: 0, how: "same" };
  let c: any = null;
  if (lNum) {
    const rc = await rest(env, `cases?select=l_num,l_code,state&l_num=eq.${lNum}`, {}, fetcher);
    c = rc.ok ? (await rc.json())[0] : null;
    if (!c) return { linked: 0, how: "no-case" };
  }
  const reject = old.map((x) => Number(x.l_num)).filter((n) => n > 0 && n !== lNum)
    .map((n) => ({ channel_id: channelId, l_num: n, rejected_by: by || null }));
  if (reject.length) {
    const ri = await rest(env, "room_link_reject?on_conflict=channel_id,l_num", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(reject) }, fetcher);
    if (!ri.ok) throw new Error("기록 실패 " + ri.status);
    await ri.body?.cancel();
  }
  if (lNum) await rest(env, `room_link_reject?channel_id=eq.${enc}&l_num=eq.${lNum}`, { method: "DELETE" }, fetcher).then((x) => x.body?.cancel());
  const closed = old.some((x) => x.status === "종결");
  const del = await rest(env, `works_room_case?channel_id=eq.${enc}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }, fetcher);
  if (!del.ok) throw new Error("연결 지우기 실패 " + del.status);
  await del.body?.cancel();
  let t = String(old.find((x) => x.room_title)?.room_title || "");
  if (!t) { for (const b of botIds) { try { t = await roomTitle(env, b, channelId, fetcher); break; } catch { /* 다음 봇 */ } } }
  if (!lNum) {
    // 이 방에 예전에 만든 자체 사건이 있으면 다시 쓴다(입력해 둔 사건정보 유지)
    const ri = await rest(env, `inv_case?select=l_num&channel_id=eq.${enc}&order=l_num.desc&limit=1`, {}, fetcher);
    const prev = ri.ok ? (await ri.json())[0] : null;
    if (prev) {
      await rest(env, `inv_case?l_num=eq.${prev.l_num}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ merged_into: null }) }, fetcher).then((x) => x.body?.cancel());
      const ins = await rest(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
        channel_id: channelId, l_num: Number(prev.l_num), case_no: "수사-" + (-Number(prev.l_num)), is_primary: true, status: closed ? "종결" : "대상",
        room_title: t, basis: "직원이 연결 해지", confidence: "높음", source: "inv", updated_at: new Date().toISOString(),
      }]) }, fetcher);
      if (!ins.ok) throw new Error("방 저장 실패 " + ins.status);
      await ins.body?.cancel();
      await moveRoomRows(env, channelId, Number(prev.l_num), "수사-" + (-Number(prev.l_num)), fetcher);
      return { linked: 1, how: "unlinked:reuse" };
    }
    const n = await createInvCase(env, channelId, t, invFields(t), fetcher);
    await moveRoomRows(env, channelId, n, "수사-" + (-n), fetcher);
    return { linked: 1, how: "unlinked:new" };
  }
  const ins = await rest(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{
    channel_id: channelId, l_num: Number(c.l_num), case_no: caseNosInTitle(c.l_code)[0] || c.l_code, is_primary: true,
    status: c.state === "종결" ? "종결" : "대상", room_title: t || null, basis: "직원이 고름", confidence: "높음", source: "picked",
    updated_at: new Date().toISOString(),
  }]) }, fetcher);
  if (!ins.ok) throw new Error("방 연결 저장 실패 " + ins.status);
  await ins.body?.cancel();
  await moveRoomRows(env, channelId, Number(c.l_num), c.l_code, fetcher);
  return { linked: 1, how: "relinked" };
}

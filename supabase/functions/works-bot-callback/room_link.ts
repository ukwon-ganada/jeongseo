// ============================================================================
//  새 사건방 자동 연결 (works-bot-callback 이 부름)
//
//  봇이 새 방에 초대되면(웍스 'join' 신호) 그 방 제목을 웍스 API로 읽고,
//  제목 속 사건번호(2026고단1234 등)로 로웨어 사건(cases)을 찾아 works_room_case 에 넣는다.
//    - 사건번호가 하나도 없거나 로웨어에 없는 번호면 연결하지 않는다(잘못 붙이느니 안 붙인다)
//    - 여러 사건이면 모두 넣고, 가장 최근 등록 사건(l_num 큰 것 = 보통 상급심)을 주 사건으로
//    - 이미 연결된 방은 건드리지 않는다
//  기록: source='auto', basis='방 제목 사건번호'
// ============================================================================
import { botToken, type FileEnv } from "./room_file.ts";

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
  if (!nos.length) return { linked: 0, how: "no-case-no" };
  const codes = [...new Set(nos.flatMap(codeVariants))];
  const inList = "(" + codes.map((c) => '"' + c.replace(/"/g, "") + '"').join(",") + ")";
  const r = await rest(env, `cases?select=l_num,l_code,state&l_code=in.${encodeURIComponent(inList)}`, {}, fetcher);
  const found: any[] = r.ok ? await r.json() : [];
  if (!found.length) return { linked: 0, how: "not-in-lawware" };
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
export async function linkRoomAnyBot(env: FileEnv, botIds: string[], channelId: string, fetcher: typeof fetch = fetch): Promise<LinkResult> {
  let last: LinkResult = { linked: 0, how: "no-bot" };
  for (const b of botIds) {
    try { return await linkRoom(env, b, channelId, fetcher); } catch (e) { last = { linked: 0, how: "error:" + String((e as Error)?.message || e).slice(0, 60) }; }
  }
  return last;
}

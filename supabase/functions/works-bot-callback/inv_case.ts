// ============================================================================
//  수사 사건 만들기·합치기 (석원 2026-11-16)
//
//  1) 봇이 방에 초대됐는데 방 제목으로 로웨어 사건을 못 찾으면(수사단계 방),
//     도우미가 "수사 사건"(inv_case, l_num 음수)을 만들어 그 방에 붙인다.
//     의뢰인 이름·죄명·수사기관·기관 사건번호는 방 제목에서 읽어 둔다.
//  2) 웍스는 "방 제목이 바뀌었다"는 신호를 주지 않는다. 그래서
//     · 하루 몇 번(pg_cron → inv_recheck_call) 아직 안 합쳐진 수사 사건 방의 제목을 다시 읽고
//     · 누가 그 방에서 메뉴를 누르거나 파일을 올릴 때도 다시 읽는다.
//     제목에 든 사건번호가 로웨어(cases)에 있으면 inv_case_merge 로 하나로 합친다.
//  3) 예전 '보류' 방 중 수사단계 방을 수사 사건으로 바꾸기(inv-backfill, 먼저 dryRun 으로 미리보기).
// ============================================================================
import { caseNosInTitle, codeVariants, roomTitle } from "./room_link.ts";
import type { FileEnv } from "./room_file.ts";

export type InvParsed = { client: string; charge: string; role: string; agency: string; agencyNo: string };

// 수사기관 이름 (제목 조각이 이걸로 끝나면 기관으로 본다)
const AGENCY = /(경찰서|경찰청|지방경찰청|광역수사대|수사대|공소청|검찰청|지방검찰청|지청|검찰|특별사법경찰|세관|국세청|고용노동청|노동청|해양경찰서|해경|공수처|중앙지검|지검)$/;
const AGENCY_ANY = /(경찰서|경찰청|수사대|공소청|검찰|지청|지검|공수처|세관|노동청|해양경찰)/;
// 기관 사건번호 모양: 2025형제28244 / 2026고불항28 / 2026-6419 / 2026-000123
const AGENCY_NO = /((?:19|20)\d{2}\s*(?:형제|고불항|고불|형|진정|내사|수제|조제|불항)\s*\d+|(?:19|20)\d{2}-\d{3,7})/;
// 법원 사건 부호 (이게 보이면 재판 단계 번호)
const COURT_MARK = /^(고단|고합|고정|고약|고약전|노|도|초기|초재|초|로|모|오|감고|감노|감도|코|버|보|가단|가합|가소|나|다|머|차|카|즈|드|르|므|구|누|두|하|허|후|개회|개확|하단|하면|회단|회합|정|푸|크|트|타|라|마)$/;

// 방 제목: "서)신)◎(형/피의)박정미 경규범_상해_부평경찰서_2026-6419", "%★(형/고소)이경옥_사기(안병근)_부천지청 2025형제28244"
export function parseInvTitle(title: string): InvParsed | null {
  const t = String(title || "").replace(/^\s*\[?종결\]?\s*/, "").trim();
  if (!t) return null;
  const head = t.match(/\((형|형사)(?:\s*\/\s*([^)]*))?\)/);
  if (!head && !AGENCY_ANY.test(t)) return null; // 형사 표시도 수사기관 이름도 없으면 수사단계 방으로 보지 않는다
  const body = head ? t.slice((head.index || 0) + head[0].length) : t.replace(/^[^가-힣A-Za-z0-9(]+/, "");
  const parts = body.split(/[_]/).map((s) => s.trim()).filter(Boolean);
  const out: InvParsed = { client: "", charge: "", role: head?.[2]?.trim() || "", agency: "", agencyNo: "" };
  const no = t.match(AGENCY_NO);
  if (no) out.agencyNo = no[1].replace(/\s+/g, "");
  const rest: string[] = [];
  for (const p of parts) {
    const noAgencyNo = p.replace(AGENCY_NO, "").trim();
    const words = noAgencyNo.split(/\s+/);
    const agencyWord = words.find((w) => AGENCY.test(w));
    if (!out.agency && agencyWord) { out.agency = agencyWord; continue; }
    if (noAgencyNo) rest.push(noAgencyNo);
  }
  out.client = rest[0] || "";
  out.charge = rest[1] || "";
  return out;
}

// 제목에 법원 사건번호(고단·노·초기 …)가 있으면 그 번호들
export function courtNosInTitle(title: string): string[] {
  return caseNosInTitle(title).filter((n) => COURT_MARK.test(n.replace(/^\d{4}/, "").replace(/\d+$/, "")));
}

async function rest(env: FileEnv, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  return fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
async function restJson(env: FileEnv, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<any> {
  const r = await rest(env, path, init, fetcher);
  if (!r.ok) throw new Error(path.split("?")[0] + " " + r.status + " " + (await r.text()).slice(0, 120));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// 수사 사건 만들기 + 방 연결. holdRowId 가 있으면 예전 '보류' 줄을 이 사건으로 바꾼다.
export async function createInvCase(env: FileEnv, channelId: string, title: string, p: InvParsed, fetcher: typeof fetch = fetch, holdRowId?: number) {
  const made = await restJson(env, "inv_case", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{
    channel_id: channelId, room_title: title, client_name: p.client, charge: p.charge, role: p.role, agency: p.agency, agency_no: p.agencyNo,
    title_checked_at: new Date().toISOString(),
  }]) }, fetcher);
  const lNum = Number(made?.[0]?.l_num);
  if (!lNum) throw new Error("수사 사건 만들기 실패");
  const row = { l_num: lNum, case_no: "수사-" + (-lNum), is_primary: true, status: /^\s*\[?종결\]?/.test(title) ? "종결" : "대상", room_title: title,
    basis: "수사 사건(자동 생성)", confidence: "높음", source: "inv", updated_at: new Date().toISOString() };
  if (holdRowId) {
    await restJson(env, `works_room_case?id=eq.${holdRowId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }, fetcher);
  } else {
    await restJson(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ channel_id: channelId, ...row }]) }, fetcher);
  }
  return lNum;
}

// 제목 속 사건번호로 로웨어 사건 찾기 (l_num 큰 것 = 보통 상급심이 먼저)
async function lawwareCases(env: FileEnv, title: string, fetcher: typeof fetch): Promise<any[]> {
  const nos = caseNosInTitle(title);
  if (!nos.length) return [];
  const codes = [...new Set(nos.flatMap(codeVariants))];
  const inList = "(" + codes.map((c) => '"' + c.replace(/"/g, "") + '"').join(",") + ")";
  const found: any[] = await restJson(env, `cases?select=l_num,l_code,state&l_code=in.${encodeURIComponent(inList)}`, {}, fetcher) || [];
  return found.sort((a, b) => Number(b.l_num) - Number(a.l_num));
}

export type RecheckResult = { lNum: number; how: string; into?: number; caseNo?: string };

// 수사 사건 하나: 방 제목 다시 읽고, 로웨어 사건이 생겼으면 합친다
export async function recheckInv(env: FileEnv, botIds: string[], inv: { l_num: number; channel_id: string; room_title?: string }, fetcher: typeof fetch = fetch): Promise<RecheckResult> {
  let title: string | null = null;
  for (const b of botIds) { try { title = await roomTitle(env, b, inv.channel_id, fetcher); break; } catch { /* 다음 봇 */ } }
  const now = new Date().toISOString();
  if (title === null) {
    await rest(env, `inv_case?l_num=eq.${inv.l_num}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ title_checked_at: now }) }, fetcher).then((r) => r.body?.cancel());
    return { lNum: inv.l_num, how: "no-title" };
  }
  const found = await lawwareCases(env, title, fetcher);
  const patch: Record<string, unknown> = { title_checked_at: now };
  if (title !== (inv.room_title ?? "")) {
    patch.room_title = title;
    await rest(env, `works_room_case?l_num=eq.${inv.l_num}&channel_id=eq.${encodeURIComponent(inv.channel_id)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ room_title: title }) }, fetcher).then((r) => r.body?.cancel());
  }
  await rest(env, `inv_case?l_num=eq.${inv.l_num}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }, fetcher).then((r) => r.body?.cancel());
  if (!found.length) return { lNum: inv.l_num, how: courtNosInTitle(title).length ? "wait-lawware" : "same" };
  // 주 사건(상급심)으로 합치고, 나머지 사건은 이 방에 덧붙인다(원심·항소심 함께)
  const main = found[0];
  const r = await restJson(env, "rpc/inv_case_merge", { method: "POST", body: JSON.stringify({ p_inv: inv.l_num, p_real: Number(main.l_num) }) }, fetcher);
  if (!r?.ok) return { lNum: inv.l_num, how: "merge-fail:" + String(r?.error || "") };
  const extra = found.slice(1).map((c) => ({
    channel_id: inv.channel_id, l_num: Number(c.l_num), case_no: caseNosInTitle(c.l_code)[0] || c.l_code, is_primary: false,
    status: c.state === "종결" ? "종결" : "대상", room_title: title, basis: "방 제목 사건번호", confidence: "보통", source: "auto", updated_at: now,
  }));
  if (extra.length) {
    const have: any[] = await restJson(env, `works_room_case?select=l_num&channel_id=eq.${encodeURIComponent(inv.channel_id)}`, {}, fetcher).catch(() => []) || [];
    const add = extra.filter((x) => !have.some((h) => Number(h.l_num) === x.l_num));
    if (add.length) await rest(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(add) }, fetcher).then((x) => x.body?.cancel()).catch(() => {});
  }
  return { lNum: inv.l_num, how: "merged", into: Number(main.l_num), caseNo: main.l_code };
}

// 아직 안 합쳐진 수사 사건 전부 (오래 안 읽은 방부터)
export async function recheckAll(env: FileEnv, botIds: string[], fetcher: typeof fetch = fetch, limit = 300) {
  const list: any[] = await restJson(env, `inv_case?select=l_num,channel_id,room_title&merged_into=is.null&channel_id=not.is.null&order=title_checked_at.asc.nullsfirst&limit=${limit}`, {}, fetcher) || [];
  const out: RecheckResult[] = [];
  for (const inv of list) {
    try { out.push(await recheckInv(env, botIds, inv, fetcher)); } catch (e) { out.push({ lNum: inv.l_num, how: "error:" + String((e as Error)?.message || e).slice(0, 80) }); }
  }
  const count = (h: string) => out.filter((x) => x.how === h).length;
  return { checked: out.length, merged: count("merged"), waiting: count("wait-lawware"), results: out.filter((x) => x.how !== "same") };
}

// 방 하나(메뉴 클릭·파일 올림 때): 그 방이 수사 사건이면 제목 다시 읽기. 10분 안에 읽었으면 건너뜀
export async function recheckRoom(env: FileEnv, botIds: string[], channelId: string, fetcher: typeof fetch = fetch) {
  const since = new Date(Date.now() - 10 * 60e3).toISOString();
  const list: any[] = await restJson(env, `inv_case?select=l_num,channel_id,room_title,title_checked_at&merged_into=is.null&channel_id=eq.${encodeURIComponent(channelId)}`, {}, fetcher) || [];
  const out: RecheckResult[] = [];
  for (const inv of list) {
    if (inv.title_checked_at && inv.title_checked_at > since) continue;
    out.push(await recheckInv(env, botIds, inv, fetcher));
  }
  return out;
}

// 예전 '보류' 방 중 수사단계 방 → 수사 사건으로 (dryRun 이면 바꾸지 않고 목록만)
export async function backfillHold(env: FileEnv, botIds: string[], dryRun: boolean, fetcher: typeof fetch = fetch, limit = 200) {
  const rows: any[] = await restJson(env, `works_room_case?select=id,channel_id,room_title,basis&status=eq.보류&l_num=is.null&limit=${limit}`, {}, fetcher) || [];
  const plan: any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const ch = String(r.channel_id || "");
    if (!ch || seen.has(ch)) continue;
    seen.add(ch);
    let title = String(r.room_title || "");
    if (!title) { for (const b of botIds) { try { title = await roomTitle(env, b, ch, fetcher); break; } catch { /* */ } } }
    const p = parseInvTitle(title);
    // 제목 번호가 로웨어에 있는 방은 '후보 여러 개' 등으로 일부러 보류한 방이라 건드리지 않는다(직원 확인)
    const cand = p ? await lawwareCases(env, title, fetcher).catch(() => []) : [];
    const why = !title ? "제목 없음" : !p ? "수사단계 방 아님" : cand.length ? "로웨어 사건 후보 있음(" + cand.map((c) => c.l_code).join(",") + ")" : "";
    plan.push({ id: r.id, title, parsed: p, make: !why, why });
    if (!why && !dryRun) {
      try { const lNum = await createInvCase(env, ch, title, p!, fetcher, Number(r.id)); plan[plan.length - 1].lNum = lNum; }
      catch (e) { plan[plan.length - 1].error = String((e as Error)?.message || e).slice(0, 80); }
    }
  }
  return { dryRun, total: plan.length, make: plan.filter((x) => x.make).length, plan };
}

// ============================================================================
//  로웨어 사건에 이미 연결된 방도 제목 다시 읽기 (석원 2026-11-16)
//  수사 단계 로웨어 사건은 중복·누락될 수 있지만, 재판번호가 붙으면 로웨어에 반드시 하나 생긴다.
//  → 방 제목에 새 재판번호(1·2·3심)가 생기고 로웨어에 그 사건이 있으면, 그 사건을 이 방의 주 사건으로 붙인다.
//    예전 사건 줄은 지우지 않고 '덧붙은 사건'으로 남긴다(사건 화면이 같은 방의 이전 사건 기록을 이어서 보여 줌).
// ============================================================================
export function trialRank(code: string): number {
  const k = (String(code || "").match(/\d{2,4}\s*([가-힣]+)\s*\d/) || [])[1] || "";
  if (/^(재)?도$/.test(k)) return 3;
  if (/^(재)?노$/.test(k)) return 2;
  if (/^고(단|합|정|약|약전)?$/.test(k)) return 1;
  return 0;
}

export async function recheckLinkedRoom(env: FileEnv, botIds: string[], channelId: string, rows: any[], fetcher: typeof fetch = fetch) {
  let title: string | null = null;
  for (const b of botIds) { try { title = await roomTitle(env, b, channelId, fetcher); break; } catch { /* 다음 봇 */ } }
  if (title === null) return { channelId, how: "no-title" };
  const now = new Date().toISOString();
  if (rows.some((r) => String(r.room_title || "") !== title)) {
    await rest(env, `works_room_case?channel_id=eq.${encodeURIComponent(channelId)}&l_num=gt.0`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ room_title: title }) }, fetcher).then((r) => r.body?.cancel());
  }
  const trials = (await lawwareCases(env, title, fetcher)).filter((c) => trialRank(c.l_code) > 0)
    .sort((a, b) => trialRank(b.l_code) - trialRank(a.l_code) || Number(b.l_num) - Number(a.l_num));
  if (!trials.length) return { channelId, how: "same" };
  const top = trials[0];
  const have = new Map(rows.map((r) => [Number(r.l_num), r]));
  const primary = rows.find((r) => r.is_primary);
  // 주 사건은 심급이 올라갈 때만 바꾼다(같은 심급의 병합 사건 등은 주 사건을 그대로 둔다)
  const move = !primary || trialRank(top.l_code) > trialRank(String(primary.case_no || ""));
  if (!move && trials.every((t) => have.has(Number(t.l_num)))) return { channelId, how: "same" };
  const add = trials.filter((t) => !have.has(Number(t.l_num))).map((t) => ({
    channel_id: channelId, l_num: Number(t.l_num), case_no: caseNosInTitle(t.l_code)[0] || t.l_code, is_primary: false,
    status: t.state === "종결" ? "종결" : "대상", room_title: title, basis: "제목에 새 재판번호", confidence: "높음", source: "auto", updated_at: now,
  }));
  if (add.length) await restJson(env, "works_room_case", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(add) }, fetcher);
  if (!move) return { channelId, how: "added", added: add.length };
  {
    await restJson(env, `works_room_case?channel_id=eq.${encodeURIComponent(channelId)}&is_primary=eq.true`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_primary: false, updated_at: now }) }, fetcher);
    await restJson(env, `works_room_case?channel_id=eq.${encodeURIComponent(channelId)}&l_num=eq.${Number(top.l_num)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ is_primary: true, updated_at: now }) }, fetcher);
  }
  return { channelId, how: "moved", to: Number(top.l_num), caseNo: top.l_code, from: primary ? Number(primary.l_num) : null, added: add.length };
}

// 하루 4번 중 이번 차례 몫(방을 4묶음으로 나눠 한 번에 1/4씩)
export async function recheckLinked(env: FileEnv, botIds: string[], fetcher: typeof fetch = fetch, part?: number) {
  const rows: any[] = await restJson(env, `works_room_case?select=channel_id,l_num,case_no,is_primary,room_title&status=eq.대상&l_num=gt.0&limit=2000`, {}, fetcher) || [];
  const by = new Map<string, any[]>();
  for (const r of rows) { const ch = String(r.channel_id || ""); if (ch) (by.get(ch) || by.set(ch, []).get(ch)!).push(r); }
  const hour = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const p = part ?? Math.floor(hour / 3) % 4;
  const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const out: any[] = [];
  for (const [ch, list] of by) {
    if (part !== -1 && hash(ch) % 4 !== p) continue;
    try { out.push(await recheckLinkedRoom(env, botIds, ch, list, fetcher)); } catch (e) { out.push({ channelId: ch, how: "error:" + String((e as Error)?.message || e).slice(0, 80) }); }
  }
  return { checked: out.length, moved: out.filter((x) => x.how === "moved").length, results: out.filter((x) => x.how !== "same") };
}

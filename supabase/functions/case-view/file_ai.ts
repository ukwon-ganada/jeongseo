// ============================================================================
//  방에 올라온 서면 파일을 타임라인의 어느 줄에 붙일지 AI가 고른다 (2026-11-18 석원 결정)
//
//  예외가 계속 생겨 규칙을 하나씩 만들 수 없으니, 파일 이름·그 무렵 방 대화·사건 타임라인 줄을 함께 보여 주고
//  AI가 "붙일 줄" 또는 "안 붙음"을 고른다. 꼭 지킬 것만 규칙으로 남긴다.
//    · 직원이 [수정]에서 고르거나 뺀 것이 항상 우선(고른 파일·뺀 줄은 AI에 보내지 않음)
//    · 열람복사신청 같은 중요하지 않은 줄(MINOR_RE)에는 붙이지 않음
//    · 초안·수정 중 파일은 붙이지 않음, 한 줄에 여러 파일이 가면 가장 늦게 올라온 것(마지막 서면)
//    · 애매하면 안 붙음. 안 붙은 파일도 이유와 함께 표(case_file_match)에 남는다
//  한 번 판단한 파일은 표에 기억하고, 그 파일 무렵의 줄 목록이 바뀔 때만 다시 묻는다(비용·속도).
//  AI를 못 쓰면(열쇠 없음·오류·시간 초과) 부른 쪽이 예전 이름 규칙으로 붙인다.
//
//  사무실 업무 방식(2026-11-19 석원): 방에 한글(hwp) 파일로 올라오는 서면은 최종 제출본이 아니다.
//  최종본은 PDF로 올라오고, 서고은 변호사가 "ㄱㄱ" 등으로 제출을 지시하면 낸다(분명한 지시가 없는 예외도 있음).
//  그래서 자동으로 붙이는 후보는 PDF만. 한글·워드 파일은 AI에 "참고(초안)"로만 보여 준다.
//  단, 서면의 첨부서류(증거·참고자료 등)도 PDF로 올라오니 서면 본문과 구분해야 한다.
// ============================================================================

export type MatchRow = { file_id: number; line_key: string | null; sig: string; reason?: string };
export type AiEnv = { key?: string; model?: string };

const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const DOC_RE = /\.(pdf|hwp|hwpx|doc|docx)$/i;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
export const BEFORE_DAYS = 60;   // 파일보다 앞선 줄(판결문은 선고 뒤에 올라옴)
// 파일 이름 규칙으로 가르지 않는다(2026-11-20 석원 "서면 이름이 딱 맞게 올라오지 않으니 AI로"):
// 받은 문서는 한참 뒤에 올라오기도 하니, 모든 파일에 약 2년 앞의 줄까지 보여 주고 AI가 날짜를 보고 고른다
const beforeDays = (_f: any) => 730;
export const AFTER_DAYS = 10;    // 파일보다 뒤의 줄(서면을 먼저 올리고 며칠 뒤 제출·기록)
export const MAX_FILES = 20;

// 줄을 가리키는 이름: 로웨어 줄은 lp, 방 대화 줄은 rid, 그 밖(선고 등)은 날짜+글
export function lineKey(e: any): string {
  if (e.lp != null) return "lp:" + e.lp;
  if (e.rid != null) return "r:" + e.rid;
  return "d:" + e.d + ":" + nz(e.t).slice(0, 40);
}
const isDoc = (f: any) => !!(f.pdf || DOC_RE.test(nz(f.n)));
// 자동으로 붙일 수 있는 파일: PDF만 (한글·워드는 초안). 직원이 [수정]에서 고른 파일은 형식과 관계없이 그대로
export const isPdf = (f: any) => !!(f.pdf || /\.pdf$/i.test(nz(f.n)));
// 판단 기준이 바뀌면 올린다: 예전 판단을 모두 다시 묻게 된다
const RULE_VER = "v8-exam";

// AI에게 보여 줄 줄: 지난 일(예정 아님)의 우리 제출·기일/선고·처분 줄. 사소한 제출, 직원이 뺀 줄, 직원이 파일을 고른 줄은 뺀다
// 앞으로의 줄(due)은 빼되, 방 대화에서 뽑은 '우리 제출 예정' 줄과 기일 줄(신문사항은 그 기일에 법정에서 냄, 2026-11-23 석원)은 넣는다(2026-11-20: 선임계 제출 '예정' 줄에 오늘 올린 선임계 PDF)
export function candidateLines(events: any[], minor: RegExp): any[] {
  return events.filter((e) => (e.k !== "due" || (e.src === "chat" && e.g === "ours") || e.g === "hearing") && (e.g === "accept" || e.g === "ours" || e.g === "hearing" || e.g === "notice" || (e.src === "chat" && /통지|결정서|결과\s*(수령|받)/.test(nz(e.t)))) && !e.none && !e.minor && !(e.f && e.f.pick === 1)
    && !minor.test(nz(e.t)));
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// 이 파일 무렵 줄 목록의 지문: 바뀌면(새 줄이 생기면) 다시 묻는다
export function fileSig(f: any, lines: any[]): string {
  const lo = addDays(f.d, -beforeDays(f)), hi = addDays(f.d, AFTER_DAYS);
  return hash(RULE_VER + "#" + lines.filter((e) => e.d >= lo && e.d <= hi).map(lineKey).sort().join("|"));
}
// 아직 판단이 없거나, 판단한 뒤 줄 목록이 바뀐 파일
// 직원이 [수정]에서 직접 고르거나 뺀 판단(sig = MANUAL): AI가 다시 묻지 않고, 같은 줄에선 AI 판단보다 먼저
export const MANUAL = "manual";
export function pendingFiles(files: any[], lines: any[], cache: Map<number, MatchRow>, skip: (f: any) => boolean): any[] {
  return files.filter((f) => isDoc(f) && isPdf(f) && f.lp == null && !skip(f))
    .filter((f) => { const c = cache.get(Number(f.id)); return !c || (c.sig !== MANUAL && c.sig !== fileSig(f, lines)); })
    .sort((a, b) => b.at - a.at).slice(0, MAX_FILES);
}

const SYSTEM = [
  "법무법인 사건 화면의 타임라인에 서면 파일을 붙이는 일을 한다.",
  "직원이 사건 메신저 방에 올린 파일마다, 그 파일이 '실제로 낸(또는 받은) 그 서류'인 타임라인 줄을 하나 고른다.",
  "- 이 사무실은 서면을 한글(hwp) 파일로 방에 올려 검토하고, 최종 제출본은 PDF로 올린 뒤 변호사가 'ㄱㄱ', '제출하세요' 같은 말로 제출을 지시하면 낸다. 지시가 분명하지 않은 때도 있다.",
  "- 그래서 고를 파일(올라온 파일)은 모두 PDF다. '같은 무렵 한글 파일'은 초안이라 고르지 않고, 어떤 서면을 쓰고 있었는지 아는 참고로만 쓴다.",
  "- PDF에는 서면 본문뿐 아니라 그 서면의 첨부서류(증거, 참고자료, 별지, 진단서, 합의서, 영수증, 판결 사본 등)도 섞여 있다. 첨부서류는 붙이지 않는다. 같은 이름의 한글 초안이 있었거나, 제출 지시 바로 앞뒤에 올라온 PDF가 서면 본문일 가능성이 높다.",
  "- 우리와 의뢰인이 맺은 위임계약서·약정서(수임 계약)는 '사건 선임' 줄에 붙인다. 증거로 낸 다른 사람들 사이의 계약서·약정서는 붙이지 않는다.",
  "- 우리가 낸 서면(의견서, 변론요지서, 항소이유서, 선임계·선임신고서, 탄원서, 고소장 등)은 그 제출 줄에 붙인다. 파일은 보통 제출일 당일이나 며칠 전에 올라온다.",
  "- 증인신문사항·피고인신문사항은 전자로 내지 않고 법정에서 내므로 제출 줄이 없다. 그 신문을 하는 공판기일 줄(파일이 올라온 날이나 그 뒤 가장 가까운 공판기일)에 붙인다. 공판기일 줄에는 신문사항 말고 다른 서면은 붙이지 않는다.",
  "- 기관에서 받은 중요한 문서도 붙인다. 판결문·결정문은 선고·결정 줄에, 공소장은 '공소장 부본 도달' 줄(없으면 기소 줄)에, 불송치·송치 결정서, 불기소 결정서·이유서, 고소·고발사건 결정결과 통지서, 수사결과 통지서는 그 처분(송치·불송치·불기소·기소) 줄에, 수사진행상황 통지서는 그 통지 줄에 붙인다. 통지 줄이 따로 없고 수사진행상황 통지서가 알리는 일이 송치·불송치 같은 처분이면(같은 무렵 그 처분 줄이 있으면) 그 처분 줄에 붙인다. 고소·고발사건 결정결과 통지서·수사결과 통지서는 무렵의 처분 줄이 하나뿐이면, 그 줄에 '일부 송치·일부 불송치'처럼 여러 처분이 섞여 있어도 그 줄에 붙인다. 받은 문서는 처분보다 며칠~몇 달 뒤에 올라오기도 한다.",
  "- 판결문·결정문은 사건번호를 본다. '사건:'에 적힌 이 사건 번호와 같은 판결문을 이 사건 선고 줄에 붙인다. 원심(1심) 판결문처럼 다른 사건번호의 판결문은 이 사건 선고 줄에 붙이지 않는다. 판결문은 선고 뒤 몇 달 지나 올라오기도 한다.",
  "- 단, 우리 서면에 첨부한 사본('첨부서류 1. 수사결과 통지서 사본', '증 제○호증' 등)은 받은 문서 줄에 붙이지 않는다.",
  "- 줄 제목이 서류 이름 대신 '우편 제출', '서면 제출'처럼 뭉뚱그려져 있으면 그 무렵 방 대화를 보고 어떤 서류인지 판단한다.",
  "- 초안·검토용·수정 중 파일, 편지·사진·참고자료·증거자료처럼 그 줄의 서류 자체가 아닌 파일은 붙이지 않는다.",
  "- 한 줄에 맞는 파일이 여럿이면 최종본(가장 늦게 올라온 것)만 고르고 나머지는 붙이지 않는다.",
  "- 확신이 없으면 붙이지 않는다(line=null). 엉뚱한 줄에 붙는 것보다 안 붙는 것이 낫다.",
  "- '(이미 붙음: …)' 줄은 다른 파일이 붙어 있는 줄이다. 새 파일이 같은 서류의 더 나중 최종본일 때만 그 줄을 고른다.",
  "모든 파일(F1, F2 …)에 대해 답한다. line에는 줄 번호(L1, L2 …)만 적고, 붙이지 않으면 '없음'. why는 한국어 한 문장으로 짧게.",
].join("\n");
// 파일마다 답을 꼭 받도록(2026-11-19: 답이 비거나 파일 번호를 다르게 적어 "답 없음"이 쌓임) 파일 번호를 칸 이름으로,
// 줄은 정해진 번호 중에서만 고르게 한다
export function answerSchema(fileIds: string[], lineIds: string[]) {
  const one = { type: "object", additionalProperties: false, required: ["line", "why"],
    properties: { line: { type: "string", enum: [...lineIds, "없음"] }, why: { type: "string" } } };
  return { type: "object", additionalProperties: false, required: fileIds, properties: Object.fromEntries(fileIds.map((f) => [f, one])) };
}
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["picks"],
  properties: { picks: { type: "array", items: { type: "object", additionalProperties: false, required: ["file", "line", "why"],
    properties: { file: { type: "string" }, line: { type: ["string", "null"] }, why: { type: "string" } } } } },
};

const KST = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
// AI에게 보낼 글: 줄(L1..), 파일(F1..), 파일 무렵 방 대화
export function buildPrompt(caseTitle: string, lines: any[], files: any[], msgs: { at: number; text: string }[], drafts: any[] = []) {
  const lo = files.map((f) => addDays(f.d, -beforeDays(f))).sort()[0];
  const hi = addDays(files.reduce((m, f) => (f.d > m ? f.d : m), files[0].d), AFTER_DAYS);
  const ls = lines.filter((e) => e.d >= lo && e.d <= hi).sort((a, b) => a.d.localeCompare(b.d));
  const lineIds = new Map<string, string>(), fileIds = new Map<string, any>();
  // 지금 묻는 파일이 예전 판단으로 붙어 있는 줄은 '이미 붙음'으로 보이지 않게(2026-11-20: 자기 자신을 중복으로 보고 빼 버림)
  const asking = new Set(files.map((f) => String(f.id)));
  const lineTxt = ls.map((e, i) => {
    const id = "L" + (i + 1); lineIds.set(id, lineKey(e));
    const kind = e.g === "accept" ? "사건 선임" : e.g === "hearing" ? (e.src === "chat" ? "처분·일정(방 대화)" : "기일·선고") : e.g === "notice" ? "받은 문서" : e.src === "chat" ? "우리 업무(방 대화)" : "우리 제출";
    return `${id} ${e.d} [${kind}] ${nz(e.t).split(" · ")[0]}${e.f && !asking.has(String(e.f.id)) ? ` (이미 붙음: ${e.f.n})` : ""}`;
  });
  const fileTxt = files.map((f, i) => { const id = "F" + (i + 1); fileIds.set(id, f); return `${id} ${f.d} ${nz(f.tm)} ${nz(f.n)}`; });
  // 같은 무렵(파일 앞 14일~뒤 1일) 올라온 한글·워드 초안 이름: 고르지 않고 참고만
  const dr = drafts.filter((d) => !isPdf(d) && files.some((f) => d.at <= f.at + 864e5 && d.at >= f.at - 14 * 864e5))
    .sort((a, b) => a.at - b.at).slice(-15).map((d) => `${d.d} ${nz(d.tm)} ${nz(d.n)}`);
  const near = msgs.filter((m) => files.some((f) => Math.abs(m.at - f.at) <= 6 * 3600e3)).slice(-12)
    .map((m) => `${KST(m.at)} ${nz(m.text).replace(/\s+/g, " ").slice(0, 200)}`);
  const user = `사건: ${caseTitle || "(모름)"}\n\n타임라인 줄:\n${lineTxt.join("\n") || "(없음)"}\n\n올라온 파일:\n${fileTxt.join("\n")}` +
    (dr.length ? `\n\n같은 무렵 한글 파일(초안, 고르지 않음):\n${dr.join("\n")}` : "") +
    (near.length ? `\n\n파일 무렵 방 대화:\n${near.join("\n")}` : "");
  return { user, lineIds, fileIds };
}

export async function askMatch(ai: AiEnv, user: string, fetcher: typeof fetch = fetch, timeoutMs = 9000, ids?: { files: string[]; lines: string[] }): Promise<{ file: string; line: string | null; why: string }[]> {
  if (!ai.key) throw new Error("ANTHROPIC_API_KEY 없음");
  const model = ai.model || "claude-haiku-5-5";
  const haiku = model.includes("haiku");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: {
        "x-api-key": ai.key, "anthropic-version": "2023-06-01", "content-type": "application/json",
        ...(haiku ? {} : { "anthropic-beta": "server-side-fallback-2026-07-01" }),
      },
      body: JSON.stringify({
        model, max_tokens: 3000, system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: ids ? answerSchema(ids.files, ids.lines) : SCHEMA } },
        ...(haiku ? {} : { fallbacks: "default" }),
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
    const data = await res.json();
    if (data?.stop_reason === "refusal") throw new Error("refusal");
    const out = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").trim();
    const j = JSON.parse(out || "{}");
    if (Array.isArray(j?.picks)) return j.picks;
    // 파일 번호를 칸 이름으로 받은 답 → [{file, line, why}]
    return Object.entries(j || {}).map(([file, v]: [string, any]) => ({ file, line: !v?.line || v.line === "없음" ? null : String(v.line), why: nz(v?.why) }));
  } finally { clearTimeout(timer); }
}

// 기억된 판단을 타임라인에 붙인다: 줄마다 가장 늦게 올라온 파일 하나, 직원이 고른 줄·뺀 줄·사소한 줄은 손대지 않음
export function applyMatches(events: any[], files: any[], cache: Map<number, MatchRow>, lines: any[]) {
  for (const e of events) { if (e.f?.ai) e.f = null; if (e.cf?.ai) e.cf = null; }
  const byKey = new Map<string, any>();
  for (const e of lines) byKey.set(lineKey(e), e);
  const used = new Set(events.flatMap((e) => [e.f?.pick === 1 ? e.f.id : null, e.cf?.id]).filter((x) => x != null));
  const best = new Map<string, any>();
  for (const f of files) {
    const m = cache.get(Number(f.id));
    if (!m || !m.line_key || used.has(f.id) || f.lp != null) continue;
    if (!byKey.has(m.line_key)) continue;
    const cur = best.get(m.line_key), man = m.sig === MANUAL, curMan = cur && cache.get(Number(cur.id))?.sig === MANUAL;
    if (!cur || (man && !curMan) || (man === !!curMan && f.at > cur.at)) best.set(m.line_key, f);
  }
  // 사건 선임 줄에 고른 파일은 계약서 자리(cf)에
  for (const [k, f] of best) { const e = byKey.get(k); if (e.g === "accept") e.cf = { id: f.id, n: f.n, ai: 1 }; else e.f = { id: f.id, n: f.n, pick: 0, ai: 1 }; }
  // [수정]에서 직접 고를 수 있게 로웨어 제출 줄(lp)이 아닌 후보 줄에 열쇠를 붙여 둔다
  for (const e of lines) if (e.lp == null) e.lk = lineKey(e);
  return events;
}

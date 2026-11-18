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
// ============================================================================

export type MatchRow = { file_id: number; line_key: string | null; sig: string; reason?: string };
export type AiEnv = { key?: string; model?: string };

const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const DOC_RE = /\.(pdf|hwp|hwpx|doc|docx)$/i;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
export const BEFORE_DAYS = 60;   // 파일보다 앞선 줄(판결문은 선고 뒤에 올라옴)
export const AFTER_DAYS = 10;    // 파일보다 뒤의 줄(서면을 먼저 올리고 며칠 뒤 제출·기록)
export const MAX_FILES = 20;

// 줄을 가리키는 이름: 로웨어 줄은 lp, 방 대화 줄은 rid, 그 밖(선고 등)은 날짜+글
export function lineKey(e: any): string {
  if (e.lp != null) return "lp:" + e.lp;
  if (e.rid != null) return "r:" + e.rid;
  return "d:" + e.d + ":" + nz(e.t).slice(0, 40);
}
const isDoc = (f: any) => !!(f.pdf || DOC_RE.test(nz(f.n)));

// AI에게 보여 줄 줄: 지난 일(예정 아님)의 우리 제출·기일/선고·처분 줄. 사소한 제출, 직원이 뺀 줄, 직원이 파일을 고른 줄은 뺀다
export function candidateLines(events: any[], minor: RegExp): any[] {
  return events.filter((e) => e.k !== "due" && (e.g === "ours" || e.g === "hearing") && !e.none && !e.minor && !(e.f && e.f.pick === 1)
    && !minor.test(nz(e.t)));
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// 이 파일 무렵 줄 목록의 지문: 바뀌면(새 줄이 생기면) 다시 묻는다
export function fileSig(f: any, lines: any[]): string {
  const lo = addDays(f.d, -BEFORE_DAYS), hi = addDays(f.d, AFTER_DAYS);
  return hash(lines.filter((e) => e.d >= lo && e.d <= hi).map(lineKey).sort().join("|"));
}
// 아직 판단이 없거나, 판단한 뒤 줄 목록이 바뀐 파일
export function pendingFiles(files: any[], lines: any[], cache: Map<number, MatchRow>, skip: (f: any) => boolean): any[] {
  return files.filter((f) => isDoc(f) && f.lp == null && !skip(f))
    .filter((f) => { const c = cache.get(Number(f.id)); return !c || c.sig !== fileSig(f, lines); })
    .sort((a, b) => b.at - a.at).slice(0, MAX_FILES);
}

const SYSTEM = [
  "법무법인 사건 화면의 타임라인에 서면 파일을 붙이는 일을 한다.",
  "직원이 사건 메신저 방에 올린 파일마다, 그 파일이 '실제로 낸(또는 받은) 그 서류'인 타임라인 줄을 하나 고른다.",
  "- 우리가 낸 서면(의견서, 변론요지서, 항소이유서, 선임계·선임신고서, 탄원서, 고소장 등)은 그 제출 줄에 붙인다. 파일은 보통 제출일 당일이나 며칠 전에 올라온다.",
  "- 판결문·결정문처럼 법원에서 받은 문서는 그 선고·결정 줄에 붙인다. 보통 선고 뒤에 올라온다.",
  "- 줄 제목이 서류 이름 대신 '우편 제출', '서면 제출'처럼 뭉뚱그려져 있으면 그 무렵 방 대화를 보고 어떤 서류인지 판단한다.",
  "- 초안·검토용·수정 중 파일, 편지·사진·참고자료·증거자료처럼 그 줄의 서류 자체가 아닌 파일은 붙이지 않는다.",
  "- 한 줄에 맞는 파일이 여럿이면 최종본(가장 늦게 올라온 것)만 고르고 나머지는 붙이지 않는다.",
  "- 확신이 없으면 붙이지 않는다(line=null). 엉뚱한 줄에 붙는 것보다 안 붙는 것이 낫다.",
  "- '(이미 붙음: …)' 줄은 다른 파일이 붙어 있는 줄이다. 새 파일이 같은 서류의 더 나중 최종본일 때만 그 줄을 고른다.",
  "모든 파일에 대해 답한다. why는 한국어 한 문장으로 짧게.",
].join("\n");
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["picks"],
  properties: { picks: { type: "array", items: { type: "object", additionalProperties: false, required: ["file", "line", "why"],
    properties: { file: { type: "string" }, line: { type: ["string", "null"] }, why: { type: "string" } } } } },
};

const KST = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
// AI에게 보낼 글: 줄(L1..), 파일(F1..), 파일 무렵 방 대화
export function buildPrompt(caseTitle: string, lines: any[], files: any[], msgs: { at: number; text: string }[]) {
  const lo = addDays(files.reduce((m, f) => (f.d < m ? f.d : m), files[0].d), -BEFORE_DAYS);
  const hi = addDays(files.reduce((m, f) => (f.d > m ? f.d : m), files[0].d), AFTER_DAYS);
  const ls = lines.filter((e) => e.d >= lo && e.d <= hi).sort((a, b) => a.d.localeCompare(b.d));
  const lineIds = new Map<string, string>(), fileIds = new Map<string, any>();
  const lineTxt = ls.map((e, i) => {
    const id = "L" + (i + 1); lineIds.set(id, lineKey(e));
    const kind = e.g === "hearing" ? "기일·선고" : e.src === "chat" ? "우리 업무(방 대화)" : "우리 제출";
    return `${id} ${e.d} [${kind}] ${nz(e.t).split(" · ")[0]}${e.f ? ` (이미 붙음: ${e.f.n})` : ""}`;
  });
  const fileTxt = files.map((f, i) => { const id = "F" + (i + 1); fileIds.set(id, f); return `${id} ${f.d} ${nz(f.tm)} ${nz(f.n)}`; });
  const near = msgs.filter((m) => files.some((f) => Math.abs(m.at - f.at) <= 6 * 3600e3)).slice(-12)
    .map((m) => `${KST(m.at)} ${nz(m.text).replace(/\s+/g, " ").slice(0, 200)}`);
  const user = `사건: ${caseTitle || "(모름)"}\n\n타임라인 줄:\n${lineTxt.join("\n") || "(없음)"}\n\n올라온 파일:\n${fileTxt.join("\n")}` +
    (near.length ? `\n\n파일 무렵 방 대화:\n${near.join("\n")}` : "");
  return { user, lineIds, fileIds };
}

export async function askMatch(ai: AiEnv, user: string, fetcher: typeof fetch = fetch, timeoutMs = 9000): Promise<{ file: string; line: string | null; why: string }[]> {
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
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        ...(haiku ? {} : { fallbacks: "default" }),
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
    const data = await res.json();
    if (data?.stop_reason === "refusal") throw new Error("refusal");
    const out = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").trim();
    const picks = JSON.parse(out || "{}")?.picks;
    return Array.isArray(picks) ? picks : [];
  } finally { clearTimeout(timer); }
}

// 기억된 판단을 타임라인에 붙인다: 줄마다 가장 늦게 올라온 파일 하나, 직원이 고른 줄·뺀 줄·사소한 줄은 손대지 않음
export function applyMatches(events: any[], files: any[], cache: Map<number, MatchRow>, lines: any[]) {
  for (const e of events) if (e.f?.ai) e.f = null;
  const byKey = new Map<string, any>();
  for (const e of lines) byKey.set(lineKey(e), e);
  const used = new Set(events.flatMap((e) => [e.f?.pick === 1 ? e.f.id : null, e.cf?.id]).filter((x) => x != null));
  const best = new Map<string, any>();
  for (const f of files) {
    const m = cache.get(Number(f.id));
    if (!m || !m.line_key || used.has(f.id) || f.lp != null) continue;
    if (!byKey.has(m.line_key)) continue;
    const cur = best.get(m.line_key);
    if (!cur || f.at > cur.at) best.set(m.line_key, f);
  }
  for (const [k, f] of best) { const e = byKey.get(k); e.f = { id: f.id, n: f.n, pick: 0, ai: 1 }; }
  return events;
}

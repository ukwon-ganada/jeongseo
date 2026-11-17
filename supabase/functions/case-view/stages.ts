// ============================================================================
//  사건정보 단계별 칸: 경찰 · 공소청 · 1심 · 2심 · 3심 (석원 2026-11-16)
//
//  · 사건번호는 "지금 단계"의 번호를 대표로 보여 준다(경찰 접수번호 → 형제번호 → 재판번호).
//  · 우리가 선임된 단계부터 칸을 보여 주고, 지난 단계는 화면에서 접어 둔다.
//  · 처음 값은 로웨어(또는 수사 사건 방 제목)에서 한 번만 채우고, 저장하면 case_info.stages 에 남는다.
//  · 수사관·공소관·전화 등을 바꾸면 case_info_log 에 'stage.<단계>.<칸>' 으로 남아 변경 이력이 된다.
// ============================================================================

export const STAGES = ["police", "pros", "c1", "c2", "c3"] as const;
export type StageKey = typeof STAGES[number];
export const STAGE_LABEL: Record<StageKey, string> = { police: "경찰", pros: "공소청", c1: "1심", c2: "2심", c3: "3심" };
export const STAGE_FIELDS = ["org", "no", "dept", "person", "phone", "mobile"] as const;
export type StageVal = { org: string; no: string; dept: string; person: string; phone: string; mobile: string };
// 이력에 남길 칸(사람·전화가 자주 바뀜). 번호·기관도 남긴다.
export const TRACK = ["org", "no", "dept", "person", "phone", "mobile"];

const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const empty = (): StageVal => ({ org: "", no: "", dept: "", person: "", phone: "", mobile: "" });
const PROS_RE = /공소청|검찰|지검|지청/;

// 사건번호 모양으로 단계 고르기
export function stageOfNo(no: string): StageKey | "" {
  const k = (nz(no).match(/\d{2,4}\s*([가-힣]+)\s*\d/) || [])[1] || "";
  if (/^(재)?도$/.test(k)) return "c3";
  if (/^(재)?노$/.test(k)) return "c2";
  if (/^고(단|합|정|약|약전)?$/.test(k)) return "c1";
  if (/형제|형사|형/.test(k)) return "pros";
  return "";
}

export function autoStage(c: any): StageKey {
  const raw = c.raw || {};
  const s = stageOfNo(nz(c.l_code));
  if (s) return s;
  if (c.is_inv) {
    if (stageOfNo(nz(raw.agency_no)) === "pros" || PROS_RE.test(nz(raw.l_police_station))) return "pros";
    return "police";
  }
  if (nz(raw.l_prosecutor) || PROS_RE.test(nz(raw.l_prosecute))) return "pros";
  return "police";
}

// 로웨어·수사 사건에서 처음 채울 값
export function prefillStages(c: any, saved: any | null): Record<StageKey, StageVal> {
  const raw = c.raw || {};
  const out = Object.fromEntries(STAGES.map((s) => [s, empty()])) as Record<StageKey, StageVal>;
  const code = nz(c.l_code);
  if (c.is_inv) {
    const ag = nz(raw.l_police_station), no = nz(raw.agency_no);
    const isPros = stageOfNo(no) === "pros" || PROS_RE.test(ag);
    const t = out[isPros ? "pros" : "police"];
    t.org = ag; t.no = no;
  } else {
    out.police.org = nz(raw.l_police_station);
    out.police.person = nz(raw.l_police_detective);
    out.police.phone = nz(raw.l_police_tel);
    if (/^\d{4}-\d+$/.test(code)) out.police.no = code;
    out.pros.person = nz(raw.l_prosecutor);
    out.pros.phone = nz(raw.l_prosecutor_tel);
    if (stageOfNo(code) === "pros") out.pros.no = code;
    const cs = stageOfNo(code);
    if (cs === "c1" || cs === "c2" || cs === "c3") {
      const jd = nz(raw.l_justice_dept);
      out[cs].org = nz(c.court);
      out[cs].no = code;
      out[cs].dept = jd.replace(/\s*\(?\s*전화.*$/, "");
      out[cs].phone = (jd.match(/전화\s*:?\s*([\d-]{7,})/) || [])[1] || "";
    }
  }
  // 예전 사건정보 칸(수사기관·담당, 법원·재판부)에 직원이 적어 둔 값이 있으면 그것을 쓴다
  if (saved) {
    const inv = nz(saved.investigator), invTel = nz(saved.investigator_phone);
    if (inv || invTel) {
      const t = out[PROS_RE.test(inv) || /^검사/.test(inv) ? "pros" : "police"];
      if (inv) t.person = inv;
      if (invTel) t.phone = invTel;
    }
    const cs = stageOfNo(code);
    if ((cs === "c1" || cs === "c2" || cs === "c3") && (nz(saved.court_dept) || nz(saved.court_phone))) {
      if (nz(saved.court_dept)) { out[cs].dept = nz(saved.court_dept); }
      if (nz(saved.court_phone)) out[cs].phone = nz(saved.court_phone);
    }
  }
  return out;
}

export function cleanStage(v: any): StageVal {
  const o = empty();
  for (const k of STAGE_FIELDS) o[k] = nz(v?.[k]).slice(0, 120);
  return o;
}
// 이전 기록(2026-11-17 석원): 이송 전 기관·지난 수사관 등. 최근 것이 앞. 누가·언제는 남기지 않는다
export function cleanPrev(list: any): StageVal[] {
  return (Array.isArray(list) ? list : []).map(cleanStage).filter(hasAny).slice(0, 30);
}
// 기관·번호·담당이 바뀌면 바뀌기 전 모습을 이전 기록 맨 앞에 남긴다(전화만 바뀐 것은 고친 것으로 봄)
const MOVE_KEYS = ["org", "no", "dept", "person"] as const;
export function movedOut(o: StageVal, n: StageVal): boolean {
  return MOVE_KEYS.some((k) => o[k] && o[k] !== n[k]);
}
const isStage = (s: unknown): s is StageKey => (STAGES as readonly string[]).includes(String(s));
function hasAny(v: StageVal) { return STAGE_FIELDS.some((k) => !!v[k]); }

// 화면에 줄 모양 만들기
export function shapeStages(c: any, saved: any | null, logs: any[]) {
  const pre = prefillStages(c, saved);
  const st = saved?.stages && typeof saved.stages === "object" ? saved.stages : {};
  const vals = Object.fromEntries(STAGES.map((s) => [s, st[s] ? cleanStage(st[s]) : pre[s]])) as Record<StageKey, StageVal>;
  const cur: StageKey = isStage(saved?.cur_stage) ? saved.cur_stage : autoStage(c);
  const ci = STAGES.indexOf(cur);
  let si: number;
  if (isStage(saved?.start_stage)) si = STAGES.indexOf(saved.start_stage);
  else { si = STAGES.findIndex((s) => hasAny(vals[s])); if (si < 0 || si > ci) si = ci; }
  if (si > ci) si = ci;
  // 대표 사건번호: 지금 단계 번호, 없으면 그 앞 단계 번호
  let dispNo = "";
  for (let i = ci; i >= 0 && !dispNo; i--) dispNo = vals[STAGES[i]].no;
  if (!dispNo && !c.is_inv) dispNo = nz(c.l_code);
  const prevNos: { s: string; no: string }[] = [];
  for (let i = 0; i < ci; i++) {
    const v = vals[STAGES[i]];
    if (v.no && v.no !== dispNo) prevNos.push({ s: STAGE_LABEL[STAGES[i]] + (v.org ? " " + v.org : ""), no: v.no });
  }
  // 변경 이력(새 것부터)
  const hist: Record<string, any[]> = {};
  for (const l of logs || []) {
    const m = nz(l.field).match(/^stage\.(\w+)\.(\w+)$/);
    if (!m) continue;
    (hist[m[1] + "." + m[2]] ||= []).push({ o: nz(l.old_value), n: nz(l.new_value), by: nz(l.editor), at: nz(l.edited_at) });
  }
  return {
    cur, start: STAGES[si], dispNo, prevNos,
    list: STAGES.map((s, i) => ({ key: s, label: STAGE_LABEL[s], ...vals[s], idx: i, prev: cleanPrev(st[s]?.prev) })),
    hist,
  };
}

// 저장 준비: 새 값과 바뀐 칸(이력용) 계산
export function diffStages(c: any, saved: any | null, body: any) {
  const before = shapeStages(c, saved, []);
  const prevVals = Object.fromEntries(before.list.map((x: any) => [x.key, cleanStage(x)])) as Record<StageKey, StageVal>;
  const next: Record<string, any> = { ...(saved?.stages && typeof saved.stages === "object" ? saved.stages : {}) };
  const changes: { field: string; old: string; new: string; stage: StageKey; key: string }[] = [];
  const inBody = body && typeof body === "object" ? body : {};
  for (const s of STAGES) {
    if (!inBody[s]) continue;
    const v = cleanStage(inBody[s]);
    const oldPrev = cleanPrev(next[s]?.prev);
    let prev = Array.isArray(inBody[s].prev) ? cleanPrev(inBody[s].prev) : oldPrev;
    if (movedOut(prevVals[s], v)) prev = [prevVals[s], ...prev].slice(0, 30);
    next[s] = { ...v, ...(prev.length ? { prev } : {}) } as any;
    for (const k of TRACK) {
      const o = prevVals[s][k as keyof StageVal], n = v[k as keyof StageVal];
      if (o !== n) changes.push({ field: `stage.${s}.${k}`, old: o, new: n, stage: s, key: k });
    }
  }
  return { stages: next, changes };
}

// 담당자가 바뀌면 타임라인에 남길 회색 줄 문구
export function personChangeLine(s: StageKey, oldV: string, newV: string): string {
  const who = s === "police" ? "수사관" : s === "pros" ? "공소관" : "재판부";
  return `${who} 변경 · ${oldV} → ${newV}`.slice(0, 80);
}
export { isStage };

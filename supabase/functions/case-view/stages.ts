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
export const STAGE_FIELDS = ["org", "no", "dept", "person", "phone", "mobile", "disp"] as const;
export type StageVal = { org: string; no: string; dept: string; person: string; phone: string; mobile: string; disp: string };
// 이력에 남길 칸(사람·전화가 자주 바뀜). 번호·기관도 남긴다.
export const TRACK = ["org", "no", "dept", "person", "phone", "mobile", "disp"];

const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const empty = (): StageVal => ({ org: "", no: "", dept: "", person: "", phone: "", mobile: "", disp: "" });
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

// 방 제목의 공소청(검찰청) 이름·형제번호 (2026-11-19 석원 "1순위": 제목엔 있는데 공소청 칸이 비어 있던 문제)
//   예) "광주지방검찰청 2026형제29256" → { org: "광주지방검찰청", no: "2026형제29256" }
export function prosFromTitle(title: string): { org: string; no: string } | null {
  const t = nz(title);
  const m = t.match(/(?:([가-힣]+(?:\s+[가-힣]+지청)?)[\s_]*)?(\d{4})\s*형제\s*(\d+)/);
  if (!m) return null;
  // 번호 바로 앞 낱말이 청 이름일 때만(…검찰청·공소청·지청·지검·지공·인천공)
  const org = m[1] && /(청|검|공)$/.test(m[1]) ? m[1].replace(/\s+/g, " ") : "";
  return { org, no: m[2] + "형제" + m[3] };
}

export function autoStage(c: any, title = ""): StageKey {
  const raw = c.raw || {};
  const s = stageOfNo(nz(c.l_code));
  if (s) return s;
  if (prosFromTitle(title)) return "pros";
  if (c.is_inv) {
    if (stageOfNo(nz(raw.agency_no)) === "pros" || PROS_RE.test(nz(raw.l_police_station))) return "pros";
    return "police";
  }
  if (nz(raw.l_prosecutor) || PROS_RE.test(nz(raw.l_prosecute))) return "pros";
  return "police";
}

// 로웨어·수사 사건에서 처음 채울 값
export function prefillStages(c: any, saved: any | null, title = ""): Record<StageKey, StageVal> {
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
    if (PROS_RE.test(nz(raw.l_prosecute))) out.pros.org = nz(raw.l_prosecute);
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
  const tp = prosFromTitle(title);
  if (tp) {
    // 로웨어 형제번호와 제목 번호가 다르면 제목(직원이 최근에 고친 것)이 지금 번호, 로웨어 번호는 이전 기록으로(titlePrev)
    if (out.pros.no && out.pros.no !== tp.no) out.pros.org = tp.org || out.pros.org;
    out.pros.no = tp.no;
    if (!out.pros.org && tp.org) out.pros.org = tp.org;
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

// 사건방 처분 줄 → 죄명별 처분 (2026-11-19 석원 "1순위": 일부 송치를 한눈에)
//   "사기 송치, 모욕 불송치 확인" → 경찰 "사기 송치 · 모욕 불송치"
//   "송치(최아름)·불송치(한용탁) 확인" → 경찰 "최아름 송치 · 한용탁 불송치"
//   "사기 사건 구약식 처분" → 공소청 "사기 약식기소"
//   경찰·공소청 각각 가장 최근 날짜의 처분 줄만 쓴다.
const DISP_KW: [RegExp, string, "police" | "pros"][] = [
  [/불송치/, "불송치", "police"], [/각하/, "각하", "police"], [/수사\s*중지/, "수사중지", "police"], [/송치/, "송치", "police"],
  [/기소\s*유예/, "기소유예", "pros"], [/불기소/, "불기소", "pros"], [/구약식|약식\s*기소/, "약식기소", "pros"],
  [/보완\s*수사/, "보완수사요구", "pros"], [/구공판|공소\s*제기|기소/, "기소", "pros"],
];
const DISP_SKIP = /정보공개|이유서|이의신청서|작성|예정|요청|지시|열람|마감|킥스|항고|약식\s*명령/;
const DISP_STOP = /^(사건|피의|검찰|경찰|불구속|구속|증거불충분|혐의없음|상대방|추가|확인|결정|처분|통지|수령|및|등)$|이의신청|청$|지검$|지청$|경찰서$|^\d/;
export function dispFromEvents(rows: any[]): { police: string; pros: string } {
  const by: Record<"police" | "pros", { d: string; list: string[] }> = { police: { d: "", list: [] }, pros: { d: "", list: [] } };
  for (const r of rows || []) {
    if (!/^(처분|송치|기소)$/.test(nz(r.kind))) continue;
    const d = nz(r.ev_date).slice(0, 10);
    for (const seg of nz(r.summary).split(/[,·]|\s및\s/)) {
      if (DISP_SKIP.test(seg)) continue;
      let best: { i: number; len: number; label: string; st: "police" | "pros" } | null = null;
      for (const [re, label, st] of DISP_KW) {
        const m = seg.match(re);
        if (m && m.index != null && (!best || m.index < best.i)) best = { i: m.index, len: m[0].length, label, st };
      }
      if (!best) continue;
      const after = seg.slice(best.i + best.len).match(/^\s*\(([^)]*)\)/);
      const pre = seg.slice(0, best.i).replace(/\([^)]*\)/g, " ").split(/\s+/).map((w) => w.replace(/사건$/, "")).filter((w) => w && !DISP_STOP.test(w));
      const who = after && !/\d|기소|송치/.test(after[1]) ? after[1].trim() : pre.join(" ");
      const item = (who ? who + " " : "") + best.label;
      const b = by[best.st];
      if (d > b.d) { b.d = d; b.list = []; }
      if (d === b.d && !b.list.includes(item)) b.list.push(item);
    }
  }
  return { police: by.police.list.join(" · "), pros: by.pros.list.join(" · ") };
}
export function mixedDisp(s: string): boolean {
  return /(^|[^불])송치/.test(s) && /불송치|각하/.test(s);
}

// 제목 형제번호가 로웨어 형제번호와 다를 때 로웨어 쪽(이송 전 모습)을 처음 이전 기록으로 보여 준다
export function titlePrev(c: any, title: string): StageVal[] {
  const tp = prosFromTitle(title);
  const code = nz(c.l_code), lp = nz(c.raw?.l_prosecute);
  if (!tp || c.is_inv || stageOfNo(code) !== "pros" || code === tp.no) return [];
  return [{ ...empty(), org: PROS_RE.test(lp) ? lp : "", no: code }];
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
export function shapeStages(c: any, saved: any | null, logs: any[], title = "", rows: any[] = []) {
  const pre = prefillStages(c, saved, title);
  const st = saved?.stages && typeof saved.stages === "object" ? saved.stages : {};
  const vals = Object.fromEntries(STAGES.map((s) => [s, st[s] ? cleanStage(st[s]) : pre[s]])) as Record<StageKey, StageVal>;
  // 처분: 직원이 [수정]에서 적은 값이 없으면 사건방 처분 줄에서 뽑은 값
  const auto = dispFromEvents(rows);
  for (const s of ["police", "pros"] as const) if (!vals[s].disp) vals[s].disp = auto[s];
  // 일부 송치(송치와 불송치가 함께): 경찰·공소청 둘 다 진행 중 (2026-11-19 석원, 이재욱 사건)
  const act: StageKey[] = mixedDisp(vals.police.disp) ? ["police", "pros"] : [];
  const cur: StageKey = isStage(saved?.cur_stage) ? saved.cur_stage : autoStage(c, title);
  const ci = STAGES.indexOf(cur);
  let si: number;
  if (isStage(saved?.start_stage)) si = STAGES.indexOf(saved.start_stage);
  else { si = STAGES.findIndex((s) => hasAny(vals[s])); if (si < 0 || si > ci) si = ci; }
  if (si > ci) si = ci;
  // 대표 사건번호: 지금 단계 번호, 없으면 그 앞 단계 번호
  let dispNo = "";
  const top = Math.max(ci, ...act.map((s) => STAGES.indexOf(s)));
  for (let i = top; i >= 0 && !dispNo; i--) dispNo = vals[STAGES[i]].no;
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
    cur, start: STAGES[si], dispNo, prevNos, act,
    list: STAGES.map((s, i) => ({ key: s, label: STAGE_LABEL[s], ...vals[s], dispAuto: (auto as any)[s] || "", idx: i, prev: st[s] ? cleanPrev(st[s].prev) : s === "pros" ? titlePrev(c, title) : [] })),
    hist,
  };
}

// 저장 준비: 새 값과 바뀐 칸(이력용) 계산
export function diffStages(c: any, saved: any | null, body: any, title = "") {
  const before = shapeStages(c, saved, [], title);
  const prevVals = Object.fromEntries(before.list.map((x: any) => [x.key, cleanStage(x)])) as Record<StageKey, StageVal>;
  const next: Record<string, any> = { ...(saved?.stages && typeof saved.stages === "object" ? saved.stages : {}) };
  const changes: { field: string; old: string; new: string; stage: StageKey; key: string }[] = [];
  const inBody = body && typeof body === "object" ? body : {};
  for (const s of STAGES) {
    if (!inBody[s]) continue;
    const v = cleanStage(inBody[s]);
    const oldPrev = cleanPrev(next[s]?.prev);
    let prev = Array.isArray(inBody[s].prev) ? cleanPrev(inBody[s].prev) : oldPrev;
    if (movedOut(prevVals[s], v)) prev = [{ ...prevVals[s], disp: "" }, ...prev].slice(0, 30);
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

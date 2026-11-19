// 타임라인 줄의 중요도(w)와 같은 날 순서 (2026-11-19 석원, 학습 정리본 3·4장)
//   w 1 처분·결과: 송치·불송치·기소·불기소·약식명령·선고·구속·석방·확정 → 가장 크게, 따로 색
//   w 2 핵심 업무·일정: 사건 선임, 선임계·의견서·이의신청서 등 제출, 조사·기일·접견, 이송
//   w 3 진행 메모: 지시, 정보공개·열람복사, 서류 수령, 일정 협의·변경, 배당, 참고자료 우편 제출, 문자
// 글자 하나로 정하지 않는다: '불송치이유서 정보공개청구'는 '송치'가 들어 있어도 3.

const nz = (v: unknown) => (v == null ? "" : String(v)).trim();
const TIME = /^(\d{1,2}:\d{2})\s+/;
const body = (t: string) => nz(t).replace(TIME, "").replace(/^출석\s+/, "");

const DECIDE = /불?송치|불?기소|기소유예|혐의\s*없음|공소\s*제기|공소권\s*없음|약식\s*명령|구약식|구공판|선고|구속|석방|판결\s*확정|확정\s*\(|처분|무죄|기각|각하|파기|재결|보완\s*수사|재수사/;
const FOLLOW = /이유서|정보\s*공개|열람|복사|통지서|결정서|정본|등본|수령|도착|송달|진행\s*(상황|사항)|요청|취하|재신청|확인\s*지시|문의|안내|받음/;
const DOCFILE = /신청서|항고장|항소장|상고장|의견서|탄원서|제출|송부/;
const NOT1 = /예약|발급|일정|신건|접견|증명|예정|사건\s*(킥스|확인)|보완\s*수사\s*후/;
const MEMO = /정보\s*공개|열람|복사|등사|킥스|도착|송달\s*완료|예정|발급|재송부|교부|속기록|수령|받음|중간\s*통지|통지|진행\s*(상황|사항)|통화|연락|문의|안내|배당|배정|지정\s*확인|사건\s*번호|형제\s*번호|일정|변경|연기|취소|조율|잡음|출석\s*요구|요청|참고\s*자료|보정|정정본|위임장|영상재판|불출석|담당\s*변호사\s*(추가|지정)|메일\s*회신|예약|지시/;
const HARD3 = /정보\s*공개|열람|복사|등사|킥스|도착|송달\s*완료|예정|수령|받음|지시|제출\s*요청|정정본|의뢰인\S*\s*(우편\s*)?송부|증거기록\s.*송부/;
const KEEP2 = /이의\s*신청서|항고장|항소장|상고장|재정신청서|정식재판\s*청구|이유서\s*제출|이유\s*보충서|의견서|선임계|선임\s*신고|선임서|고소장|고발장|취하서|합의서|형사\s*보상|사임/;
const MOVE = /이송|이관|인계/;

// 처분·결과 줄 (1등급) 판단
export const isDecision = (t: string) => DECIDE.test(t) && !FOLLOW.test(t) && !DOCFILE.test(t) && !NOT1.test(t);

export function lineTier(e: any): 1 | 2 | 3 {
  const g = nz(e?.g), t = body(e?.t);
  if (g === "limit") return 2;
  if (g === "msg") return 3;
  if (/^지시(\s|·|$)/.test(t)) return 3;
  if (isDecision(t)) return 1;
  if (MOVE.test(t) && !/예정|요청|신청|후\s*사건\s*번호|통지\s*수령/.test(t)) return 2;
  if (MEMO.test(t) && !(KEEP2.test(t) && !HARD3.test(t))) return 3;
  if (["ours", "hearing", "meet", "accept"].includes(g)) return 2;
  if (KEEP2.test(t) || /수임|신건|사건\s*선임|조사|기일|접견|면담|선고|검사\s*항소|제출|송부/.test(t)) return 2;
  return 3;
}

// 같은 날 순서 (정리본 4장): 시각이 둘 다 있으면 시각순, 아니면 절차 순서
function stepOf(t: string, g: string): number {
  if (g === "accept" || /^(사건\s*선임|신건\s*(수임|접수)|수임)/.test(t)) return 1;
  if (/선임계|선임\s*신고|고소장|고발장/.test(t) && !/지시/.test(t)) return 3;
  if (/이의\s*신청|항고장|항소장|상고장|재정신청서|항소\s*이유서|상고\s*이유서/.test(t) && !/정보\s*공개|열람/.test(t)) return 11;
  if (/이유서|결정서|통지서|판결문|등본|결과\s*수령|수령/.test(t)) return 10;
  if (isDecision(t)) return 9;
  if (/이송|배당|담당/.test(t)) return 4;
  if (/정보\s*공개|열람|복사/.test(t)) return 5;
  if (/출석\s*요구|일정/.test(t)) return 6;
  if (g === "hearing" || g === "meet" || /조사|기일|접견/.test(t)) return 7;
  if (/사임|형사\s*보상/.test(t)) return 12;
  if (g === "limit") return 13;
  return 8;
}
export function sameDayStep(e: any): number {
  const g = nz(e?.g), t = body(e?.t);
  const m = t.match(/^지시\s*·?\s*(.*)$/);
  // 지시는 그 일을 하기 바로 앞: 지시 대상의 순서보다 반 칸 앞
  if (m) return Math.max(2, stepOf(m[1].replace(/\s*지시\s*(\(.*\))?\s*$/, ""), "") - 0.5);
  return stepOf(t, g);
}
const timeOf = (e: any) => (nz(e?.t).match(TIME) || [])[1] || "";

export function rankEvents(events: any[]) {
  const idx = new Map<any, number>();
  events.forEach((e, i) => { idx.set(e, i); if (e && e.w == null) e.w = lineTier(e); });
  // 처분 통지·결정서 수령만 있고 처분 줄이 없으면 그 줄을 처분 줄로 (같은 처분은 한 번만 1등급)
  const ones = events.filter((e) => e?.w === 1).map((e) => Date.parse(nz(e.d)));
  for (const e of events) {
    const t = body(e?.t);
    if (e?.w !== 3 || /^지시/.test(t) || !DECIDE.test(t) || /이유서|정보\s*공개|열람/.test(t) || !/통지|결정서|정본|수령/.test(t)) continue;
    const d = Date.parse(nz(e.d));
    if (ones.some((x) => x >= d - 30 * 864e5 && x <= d + 3 * 864e5)) continue;
    e.w = 1; ones.push(d);
  }
  const kept = dedupeEvents(events);
  events.length = 0; events.push(...kept);
  events.sort((a, b) => {
    // 심급(lv)이 다르면 심급 순서가 먼저: 화면의 심급 띠가 한 번씩만 나오게
    const l = (a?.lv ?? 0) - (b?.lv ?? 0);
    if (l) return l;
    const d = nz(a.d).localeCompare(nz(b.d));
    if (d) return d;
    const ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta.localeCompare(tb);
    return sameDayStep(a) - sameDayStep(b) || (idx.get(a)! - idx.get(b)!);
  });
  return events;
}

// ── 같은 일 여러 줄 합치기 (2026-11-19 석원 "중복 이벤트는 알아서", "선고·선고기일·선고 모두 선고 하나")
//   화면에서만 합친다. 저장된 줄은 그대로라 [수정]에서 다시 볼 수 있다.
const DOCS: [string, RegExp][] = [
  ["선임계", /선임계|선임\s*신고|선임서|변호인\s*선임/], ["고소장", /고소장/], ["고발장", /고발장/],
  ["의견서", /의견서/], ["이의신청서", /이의\s*신청서?/], ["항고장", /항고장/], ["재정신청서", /재정\s*신청서?/], ["재항고장", /재항고/], ["항소장", /항소장/], ["상고장", /상고장/],
  ["항소이유서", /항소\s*(보충\s*)?이유서/], ["상고이유서", /상고\s*이유서/], ["참고자료", /참고\s*자료/], ["탄원서", /탄원서/],
  ["합의서", /합의서/], ["변론요지서", /변론\s*요지서/], ["정식재판청구", /정식\s*재판\s*청구/], ["취하서", /취하서/],
  ["판결문", /판결\s*(문|등본|정본)/], ["정보공개", /정보\s*공개/], ["열람복사", /열람|복사|등사/],
];
const ORG_RE = /[가-힣]+(경찰서|경찰청|공소청|지검|지청|검찰청|지방법원|법원|지원|수사센터)/g;
const orgsOf = (t: string) => new Set((t.match(ORG_RE) || []).map((x) => x.replace(/^(서울|인천|경기|광주|대전|부산|대구|울산)?/, "")));
function actOf(e: any, t: string): string {
  if (/^지시/.test(t)) return "지시";
  if (/도착|송달\s*완료/.test(t)) return "도착";
  if (/결과\s*(수령|받)|수령|받음/.test(t)) return "수령";
  if (/정보\s*공개|열람|복사|등사/.test(t)) return "신청";
  if (/조사/.test(t) && !/제출|송부/.test(t)) return "조사:" + ((t.match(/피의자|고소인|참고인|대질/) || [""])[0]);
  if (/접견|면회/.test(t) || e.g === "meet") return "접견";
  if (e.g === "hearing" && /선고/.test(t)) return "선고";
  if (e.g === "hearing" && /기일/.test(t)) return "기일";
  if (/제출|송부|우편|팩스|접수|재제출/.test(t) || e.g === "ours") return "제출";
  if (/사건\s*선임|수임|신건/.test(t) || e.g === "accept") return "선임";
  return "";
}
const docsOf = (t: string) => DOCS.filter(([, re]) => re.test(t)).map(([k]) => k).sort().join("+");
const DEC_WORDS: [string, RegExp][] = [["불송치", /불송치/], ["송치", /(^|[^불])송치/], ["불기소", /불기소|혐의\s*없음|기소\s*유예/], ["기소", /(^|[^불])기소|구공판|구약식|공소\s*제기/],
  ["약식명령", /약식\s*명령/], ["선고", /선고/], ["보완수사", /보완\s*수사/], ["기각", /기각/], ["각하", /각하/], ["확정", /확정/]];
const decOf = (t: string) => DEC_WORDS.filter(([, re]) => re.test(t)).map(([k]) => k).sort().join("+");
const dayDiff = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;
const GUESS = /추정|불명|미상/;
const better = (a: any, b: any) => {
  // 나의사건 줄 > 이미 한 일(예정 아님) > 파일 있는 줄 > 긴 줄
  const sc = (x: any) => (x.src === "chat" ? 0 : 4) + (x.k === "due" ? 0 : 2) + (x.f ? 1 : 0);
  const sa = sc(a), sb = sc(b);
  if (sa !== sb) return sa > sb ? a : b;
  return nz(a.t).length >= nz(b.t).length ? a : b;
};
const extraOf = (t: string) => ((t.match(/\(([^()]*)\)\s*$/) || [])[1] || "").trim();

export function dedupeEvents(events: any[]): any[] {
  const drop = new Set<any>();
  const live = () => events.filter((e) => !drop.has(e) && e?.g !== "limit");
  const merge = (keep: any, gone: any) => {
    drop.add(gone);
    if (!keep.f && gone.f) keep.f = gone.f;
    if (keep.w != null && gone.w != null && gone.w < keep.w) keep.w = gone.w;
    const x = extraOf(body(gone.t));
    if (x && !nz(keep.t).includes(x) && !/경찰서|공소청|지청|지검|법원|변호사/.test(x) && keep.g === "hearing") keep.t = nz(keep.t) + " · " + x;
  };
  // 1) 같은 날 같은 일: 선고·처분·기일·조사·접견·같은 서류 제출
  const byDay = new Map<string, any[]>();
  for (const e of live()) (byDay.get(nz(e.d)) || byDay.set(nz(e.d), []).get(nz(e.d))!).push(e);
  for (const list of byDay.values()) {
    const seen = new Map<string, any>();
    for (const e of list) {
      const t = body(e.t), act = actOf(e, t);
      if (!act || act === "지시") continue;
      let key = "";
      if (e.w === 1) key = "결과:" + (act === "선고" || /선고/.test(t) ? "선고" : decOf(t));
      else if (act === "선고" || act === "기일" || act.startsWith("조사") || act === "접견" || act === "선임") key = act;
      else if (docsOf(t)) key = act + ":" + docsOf(t);
      if (!key || key === "결과:") continue;
      if (e.w !== 1) key += "#" + (e.w ?? "");
      key += "@" + (e.lv ?? "");
      const prev = seen.get(key);
      if (!prev) { seen.set(key, e); continue; }
      const oa = orgsOf(body(prev.t)), ob = orgsOf(t);
      // 제출처가 달라도 AI가 짐작한 곳(추정·불명)이거나 한쪽이 '예정'이면 같은 제출로 본다 (2026-11-19 재정신청서 세 줄)
      const loose = GUESS.test(body(prev.t)) || GUESS.test(t) || prev.k === "due" || e.k === "due";
      if (!loose && oa.size && ob.size && ![...oa].some((o) => ob.has(o))) continue;
      const keep = better(prev, e), gone = keep === prev ? e : prev;
      merge(keep, gone); seen.set(key, keep);
      // 남긴 줄의 제출처가 짐작이면, 짐작 아닌 줄의 내용으로
      const sure = [keep, gone].find((x) => !GUESS.test(body(x.t)));
      if (GUESS.test(body(keep.t)) && sure) keep.t = (nz(keep.t).match(TIME)?.[0] || "") + body(sure.t);
      if (act === "선임") { keep.t = "사건 선임"; keep.g = "accept"; }
    }
    // 그날 실행된 일의 지시는 숨김
    const done = list.filter((e) => !drop.has(e) && !/^지시/.test(body(e.t))).map((e) => docsOf(body(e.t))).filter(Boolean);
    for (const e of list) {
      const t = body(e.t);
      if (!/^지시/.test(t)) continue;
      const k = docsOf(t);
      if (k && done.some((d) => d === k || d.split("+").some((x) => k.split("+").includes(x)))) drop.add(e);
    }
  }
  // 2) 처분 통지·결정서 수령: 앞 30일 안에 같은 처분 줄이 있으면 숨김
  const results = live().filter((e) => e.w === 1);
  for (const e of live()) {
    if (e.w === 1) continue;
    const t = body(e.t);
    if (/^지시|이유서|정보\s*공개|열람/.test(t) || !/통지|결정서|정본|수령/.test(t)) continue;
    const k = decOf(t);
    if (!k) continue;
    if (results.some((r) => decOf(body(r.t)).split("+").some((x) => k.split("+").includes(x)) && dayDiff(nz(r.d), nz(e.d)) >= 0 && dayDiff(nz(r.d), nz(e.d)) <= 30)) drop.add(e);
  }
  // 3) 우편 도착 확인: 앞 21일 안에 같은 서류 제출 줄이 있으면 숨김
  const subs = live().filter((e) => actOf(e, body(e.t)) === "제출");
  for (const e of live()) {
    const t = body(e.t);
    if (actOf(e, t) !== "도착") continue;
    const k = docsOf(t).split("+").filter(Boolean);
    if (!k.length) continue;
    if (subs.some((s) => dayDiff(nz(s.d), nz(e.d)) >= 0 && dayDiff(nz(s.d), nz(e.d)) <= 21 && docsOf(body(s.t)).split("+").some((x) => k.includes(x)))) drop.add(e);
  }
  // 4) 선고 뒤 판결등본·판결정본 → "판결문". 파일은 선고 줄에 붙이고 줄은 합침
  const verdicts = live().filter((e) => e.w === 1 && /선고/.test(body(e.t)));
  for (const e of live()) {
    const t = body(e.t);
    if (e.w === 1 || !/판결\s*(문|등본|정본)|판결등본/.test(t) || /의뢰인|송부|발송/.test(t)) continue;
    const v = verdicts.filter((x) => dayDiff(nz(x.d), nz(e.d)) >= 0 && dayDiff(nz(x.d), nz(e.d)) <= 30).pop();
    if (!v) continue;
    if (e.f && !v.f) { v.f = e.f; drop.add(e); continue; }
    if (!e.f) { drop.add(e); continue; }
    e.t = nz(e.t).replace(/판결\s*(등본|정본)|판결등본/, "판결문");
  }
  return events.filter((e) => !drop.has(e));
}

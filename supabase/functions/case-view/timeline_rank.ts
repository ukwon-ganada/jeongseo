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
  events.sort((a, b) => {
    const d = nz(a.d).localeCompare(nz(b.d));
    if (d) return d;
    const ta = timeOf(a), tb = timeOf(b);
    if (ta && tb && ta !== tb) return ta.localeCompare(tb);
    return sameDayStep(a) - sameDayStep(b) || (idx.get(a)! - idx.get(b)!);
  });
  return events;
}

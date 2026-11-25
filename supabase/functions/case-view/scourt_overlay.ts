// ============================================================================
//  대법원 원문 우선 (2026-11-25 석원 결정: "원문 우선, 없으면 로웨어")
//   석원 PC 크롬 확장이 로웨어가 연 대법원 사건 창을 읽어 scourt_progress_rows에 쌓는다.
//   그 사건의 원문이 있으면 로웨어 진행내역 줄을 원문 기준으로 고친다.
//   - 같은 날·같은 내용 줄: 원문의 결과(기일변경·송달됨·폐문부재 등)와 도달일로 바꾼다
//   - 원문에만 있는 줄: 로웨어가 빠뜨린 줄로 보고 더한다(lp_num 없음, sc: true)
//   - 원문이 없는 사건: 아무것도 바꾸지 않는다
// ============================================================================
const nz = (v: unknown) => (v == null ? "" : String(v));
const norm = (s: string) => nz(s).replace(/\s+/g, "");

export type ScRow = { ev_date: string; content: string; result: string | null; result_date: string | null; is_attendee?: boolean };

// 원문 줄 내용으로 로웨어 구분(lp_set)을 짐작
export function setOf(content: string): string {
  const c = nz(content);
  if (/기일\(|기일$|조정사무수행일\(/.test(c) && !/발송$/.test(c)) return "기일";
  if (/발송$|송달$/.test(c)) return "송달";
  if (/제출$/.test(c)) return "서면";
  if (/접수$/.test(c)) return "접수";
  return "명령";
}

// 가림 표기(법OOOOOO, 김OO) 차이를 넘어 같은 줄인지
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function maskRe(s: string): RegExp { return new RegExp("^" + esc(norm(s)).replace(/O{2,}/g, ".{1,12}") + "$"); }
export function sameLine(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return x === y || (/O{2,}/.test(x) && maskRe(a).test(y)) || (/O{2,}/.test(y) && maskRe(b).test(x));
}

// 기일 줄은 "변론기일(법정 시각)"까지만 비교(뒤에 붙는 추정기일(…)·[화상장치] 표기 차이 무시)
const hearingBase = (s: string) => norm(nz(s).replace(/\s*\[[^\]]*\]/g, "").replace(/\s*추정기일\(.*$/, ""));

const DELIVERED = /송달됨|도달|송달간주|교부송달|전자송달/;

export function overlayScourt(evs: any[], rows: ScRow[]): any[] {
  const sc = (rows || []).filter((r) => !r.is_attendee && !/^\s*-/.test(nz(r.content)) && /^\d{4}-\d{2}-\d{2}/.test(nz(r.ev_date)));
  if (!sc.length) return evs;
  const used = new Set<number>();
  const out = evs.map((e) => e);
  const extra: any[] = [];
  for (const r of sc) {
    const d = nz(r.ev_date).slice(0, 10);
    const cand = evs.map((e, i) => i).filter((i) => !used.has(i) && nz(evs[i].lp_appoint_date).slice(0, 10) === d);
    const res = nz(r.result).trim();
    // 같은 날 같은 내용 줄이 여럿이면 결과까지 같은 줄을 먼저 짝짓는다
    const same = cand.filter((i) => norm(evs[i].lp_contents) === norm(r.content));
    const idx = same.find((i) => norm(evs[i].lp_remark) === norm(res)) ?? same[0] ?? cand.find((i) => sameLine(evs[i].lp_contents, r.content))
      ?? (setOf(r.content) === "기일" ? cand.find((i) => evs[i].lp_set === "기일" && hearingBase(evs[i].lp_contents) === hearingBase(r.content)) : undefined);
    if (idx != null) {
      used.add(idx);
      const e = out[idx];
      // 원문 결과가 비었거나, 로웨어 결과가 원문을 이미 담고 더 자세하면(예: "판결선고 2026-11-12 도달") 그대로
      if (!res || norm(e.lp_remark).includes(norm(res))) continue;
      const fix: any = { ...e, lp_remark: res, sc: true };
      if (e.lp_set === "송달") fix.delivered_date = DELIVERED.test(res) && r.result_date ? r.result_date : null;
      out[idx] = fix;
      continue;
    }
    const set = setOf(r.content);
    const tm = set === "기일" ? (nz(r.content).match(/(\d{1,2}:\d{2})\)/) || [])[1] || null : null;
    extra.push({
      lp_num: null, lp_set: set, lp_appoint_date: d, lp_appoint_time: tm, lp_contents: nz(r.content),
      lp_remark: res || null, delivered_date: set === "송달" && DELIVERED.test(res) ? r.result_date : null,
      court: null, sc: true, scAdded: true,
    });
  }
  return extra.length ? [...out, ...extra] : out;
}

// PC 방 찾기에서 못 찾은 방: 직원이 한 번 고른 사건을 "읽은 제목"으로 기억(pc_title_pick)했다가
// 다음에 비슷한 제목을 읽으면 그 사건을 연다. (pc-helper-wait/match.ts 와 같은 비교 방식)
export const normTitle = (s: string) => String(s || "").replace(/[^0-9A-Za-z가-힣]/g, "");

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
export function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}
// 한쪽이 잘렸을 수 있으니 짧은 쪽 길이만큼 앞부분끼리도 비교(앞 잡글자는 12글자까지 떼어 봄)
function prefixScore(h: string, t: string): number {
  let best = dice(h, t);
  for (let skip = 0; skip <= Math.min(12, h.length - 8); skip++) {
    const hh = h.slice(skip);
    if (hh.length < 8 || hh.length >= t.length) continue;
    best = Math.max(best, dice(hh, t.slice(0, hh.length)));
  }
  return best;
}
export const titleScore = (a: string, b: string) => Math.max(prefixScore(a, b), prefixScore(b, a));

export type Pick = { header_norm: string; l_num: number; case_no?: string | null };
// 충분히 닮고(0.75↑) 두 번째 후보(다른 사건)와 차이가 나야(0.08↑) 인정
export function findPick(header: string, picks: Pick[]): Pick | null {
  const h = normTitle(header);
  if (h.length < 8) return null;
  let best: Pick | null = null, bs = 0, second = 0;
  for (const p of picks) {
    const s = titleScore(h, p.header_norm);
    if (s > bs) { if (!best || best.l_num !== p.l_num) second = Math.max(second, bs); best = p; bs = s; }
    else if (best && p.l_num !== best.l_num && s > second) second = s;
  }
  return best && bs >= 0.75 && bs - second >= 0.08 ? best : null;
}

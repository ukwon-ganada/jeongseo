// ============================================================================
//  웍스 PC 창에서 읽은 방 제목(OCR) → 어느 사건방인지 찾기
//
//  도우미는 웍스 메인 창 위쪽에서 읽은 줄들을 위치(x,y: 창 왼쪽/위에서 몇 %)와 함께 보낸다.
//  2026-11-13 사무실 PC 시험: 왼쪽 방 목록은 x < 25%, 열린 방 제목은 x≈28%, y≈7%,
//  그 아래(y ≥ 13%)는 대화 내용. → 오른쪽 위 띠만 방 제목으로 본다.
//
//  찾는 순서
//   1) 제목 안 사건번호(2026고정100189 등)가 정확히 한 방의 제목에만 있으면 그 방
//   2) 아니면 글자 두 개씩 묶어 비교(Dice)해서 가장 닮은 방. 충분히 닮고(0.6↑)
//      두 번째와 차이가 나야(0.08↑) 인정 — 애매하면 고르지 않는다(엉뚱한 사건을 띄우지 않게)
// ============================================================================

export type OcrLine = { x: number; y: number; t: string };
export type Room = { channel_id: string; room_title: string | null };
export type MatchResult = { channelId: string | null; how: string; score: number; header: string };

export const HEADER_ZONE = { xMin: 22, xMax: 88, yMax: 11 };

export const norm = (s: string) => String(s || "").replace(/[^0-9A-Za-z가-힣]/g, "");

// OCR이 자주 헷갈리는 글자(숫자 0/O, 1/l/I)는 사건번호 비교 때만 맞춘다
const digitFix = (s: string) => s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");

export function caseNos(s: string): string[] {
  const out = new Set<string>();
  const re = /((?:19|20)\d{2})\s*([가-힣]{1,4})\s*([0-9OolI|]{1,7})/g;
  for (const m of String(s || "").matchAll(re)) {
    const num = digitFix(m[3]).replace(/^0+/, "");
    if (num) out.add(m[1] + m[2] + num);
  }
  return [...out];
}

export function headerText(lines: OcrLine[]): string {
  return lines
    .filter((l) => l.x >= HEADER_ZONE.xMin && l.x <= HEADER_ZONE.xMax && l.y <= HEADER_ZONE.yMax && norm(l.t).length >= 2)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((l) => l.t.trim())
    .join(" ");
}

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

export function matchRoom(lines: OcrLine[], rooms: Room[]): MatchResult {
  const header = headerText(lines);
  const h = norm(header);
  if (h.length < 4) return { channelId: null, how: "no-header", score: 0, header };

  // 같은 방이 여러 줄(사건 여러 개)로 들어 있으므로 방 단위로 묶는다
  const titles = new Map<string, string>();
  for (const r of rooms) if (r.room_title && !titles.has(r.channel_id)) titles.set(r.channel_id, r.room_title);

  // 1) 사건번호
  const nos = caseNos(header);
  if (nos.length) {
    const hit = new Set<string>();
    for (const [ch, t] of titles) {
      const tn = caseNos(t);
      if (nos.some((n) => tn.includes(n))) hit.add(ch);
    }
    if (hit.size === 1) return { channelId: [...hit][0], how: "case-no", score: 1, header };
  }

  // 2) 제목 닮은 정도
  let best = { ch: "", s: 0 }, second = 0;
  for (const [ch, t] of titles) {
    const s = dice(h, norm(t));
    if (s > best.s) { second = best.s; best = { ch, s }; } else if (s > second) second = s;
  }
  if (best.s >= 0.6 && best.s - second >= 0.08) return { channelId: best.ch, how: "title", score: best.s, header };
  return { channelId: null, how: best.s >= 0.6 ? "ambiguous" : "no-match", score: best.s, header };
}

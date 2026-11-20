// ============================================================================
//  웍스 PC 창에서 읽은 방 제목(OCR) → 어느 사건방인지 찾기
//
//  도우미는 웍스 메인 창 위쪽에서 읽은 줄들을 위치(x,y: 창 왼쪽/위에서 몇 %)와 함께 보낸다.
//  2026-11-13 사무실 PC 시험: 왼쪽 방 목록은 x < 25%, 열린 방 제목은 x≈28%, y≈7%,
//  그 아래(y ≥ 13%)는 대화 내용. → 오른쪽 위 띠만 방 제목으로 본다.
//
//  찾는 순서
//   1) 제목 안 사건번호(2026고정100189 등)가 정확히 한 방의 제목에만 있으면 그 방
//   2) 아니면 글자 두 개씩 묶어 비교(Dice)해서 가장 닮은 방(의뢰인 이름이 다른 방은 제외). 충분히 닮고(0.6↑)
//      두 번째와 차이가 나야(0.08↑) 인정 — 애매하면 고르지 않는다(엉뚱한 사건을 띄우지 않게)
//      창이 좁아 제목 뒤가 잘려도 되게(석원 2026-11-16): 저장된 제목의 "앞부분"(읽은 길이만큼)과도
//      비교하고, OCR이 앞에 붙인 잡글자("80t", "*" 등)는 몇 글자까지 떼어 보고 가장 높은 점수를 쓴다.
//      → 방을 찾으면 봇이 저장해 둔 전체 제목(사건번호 포함)·연결된 로웨어 사건으로 연다.
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

// 읽은 제목 h 와 저장된 제목 t 가 얼마나 닮았나. 뒤가 잘렸으면 t 의 앞부분과 비교.
//   너무 짧은 앞부분(8글자 미만)으로는 판단하지 않는다.
export function titleScore(h: string, t: string): number {
  let best = dice(h, t);
  for (let skip = 0; skip <= Math.min(12, h.length - 8); skip++) {
    const hh = h.slice(skip);
    if (hh.length < 8 || hh.length >= t.length) continue;
    const s = dice(hh, t.slice(0, hh.length));
    if (s > best) best = s;
  }
  return best;
}

// 방 제목의 의뢰인 이름: "(형/피의)최병환_..." 처럼 괄호 바로 뒤 한글 이름
export function clientName(s: string): string {
  let name = "";
  for (const m of String(s || "").matchAll(/\((?:형|형사|국선)[^)]*\)\s*([가-힣]{2,})/g)) name = m[1];
  return name;
}
// 이름이 서로 다르면 false (OCR이 한 글자 틀리는 건 봐준다: 두 글자 묶음이 절반 이상 같으면 같은 이름)
export function sameClient(a: string, b: string): boolean {
  if (!a || !b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g] of B) if (A.has(g)) inter++;
  return inter * 2 >= Math.min(A.size, B.size);
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

  // 2) 제목 닮은 정도 (잘린 제목·앞 잡글자 고려, 의뢰인 이름이 다른 방은 아무리 닮아도 제외)
  const hName = clientName(header);
  let best = { ch: "", s: 0 }, second = 0;
  for (const [ch, t] of titles) {
    if (!sameClient(hName, clientName(t))) continue;
    const s = titleScore(h, norm(t));
    if (s > best.s) { second = best.s; best = { ch, s }; } else if (s > second) second = s;
  }
  if (best.s >= 0.6 && best.s - second >= 0.08) return { channelId: best.ch, how: "title", score: best.s, header };
  return { channelId: null, how: best.s >= 0.6 ? "ambiguous" : "no-match", score: best.s, header };
}

// 방을 못 찾았을 때: 저장된 제목이 옛 제목일 수 있으니, 비슷한 방 몇 개의 현재 제목을 웍스에서 다시 읽어 보기 위한 후보
export function nearRooms(lines: OcrLine[], rooms: Room[], n = 4): string[] {
  const header = headerText(lines);
  const h = norm(header);
  if (h.length < 4) return [];
  const hName = clientName(header);
  const seen = new Map<string, number>();
  for (const r of rooms) {
    if (!r.room_title || seen.has(r.channel_id)) continue;
    if (hName && !sameClient(hName, clientName(r.room_title))) continue;
    seen.set(r.channel_id, titleScore(h, norm(r.room_title)));
  }
  return [...seen].filter(([, s]) => s >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, n).map(([ch]) => ch);
}

// 한 방에서 심급(수사·1심·2심·3심)을 이어 맡을 때 묶음 (2026-11-17 석원 결정, 추천안)
// - 같은 심급끼리 묶고, 그 안에서 본 사건·병합 사건을 가린다(mergeRoles)
// - 심급 시작일 = 그 심급 사건들 기록의 가장 이른 날(없으면 선임일)
import { courtStage, mergeRoles } from "./deadlines.ts";

export const LV_LABEL = ["수사", "1심", "2심", "3심"];
const nz = (v: unknown) => (v == null ? "" : String(v).trim());
const isDate = (s: unknown): s is string => /^\d{4}-\d{2}-\d{2}/.test(nz(s));

export type LvCase = { code: string; evs: any[]; accept?: string };
export type Level = { lv: number; label: string; main: string; cases: string[]; merged: string[]; start: string };

export const levelOf = (code: string) => courtStage(code);

export function buildLevels(cases: LvCase[], title = ""): Level[] {
  const by = new Map<number, LvCase[]>();
  for (const x of cases || []) {
    if (!nz(x.code)) continue;
    const lv = levelOf(x.code);
    if (!by.has(lv)) by.set(lv, []);
    by.get(lv)!.push(x);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([lv, list]) => {
    const mr = list.length > 1 ? mergeRoles(list.map((x) => ({ code: x.code, evs: x.evs })), title) : null;
    const main = mr?.main || list[0].code;
    const evDays = list.flatMap((x) => (x.evs || []).map((e: any) => nz(e.lp_appoint_date).slice(0, 10))).filter(isDate).sort();
    const acc = list.map((x) => nz(x.accept).slice(0, 10)).filter(isDate).sort();
    return {
      lv, label: LV_LABEL[lv] || "", main,
      cases: [main, ...list.map((x) => x.code).filter((c) => c !== main)],
      merged: mr?.merged || [],
      start: evDays[0] || acc[0] || "",
    };
  });
}

export function lvByDate(levels: Level[], d: string): number {
  let lv = levels[0]?.lv ?? 0;
  for (const L of levels) if (L.start && d >= L.start) lv = L.lv;
  return lv;
}

export const shortNo = (code: string) => (nz(code).match(/(\d+)\s*$/) || [])[1] || nz(code);

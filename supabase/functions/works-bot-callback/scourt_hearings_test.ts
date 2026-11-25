import { fakeLp, scourtAdjust } from "./scourt_hearings.ts";
Deno.test("원문 결과가 붙은 기일은 빼고, 원문에만 있는 기일은 더한다", () => {
  const lw = [
    { lp_num: 1, l_num: 7, date: "2026-11-26", time: "17:00", contents: "변론기일(제705호 법정 17:00) [일방 화상장치]" },
    { lp_num: 2, l_num: 7, date: "2026-12-03", time: "10:40", contents: "변론기일(10:40) [쌍방 화상장치]" },
  ];
  const sc = [
    { l_num: 7, date: "2026-11-26", content: "변론기일(제705호 법정 17:00) [일방 화상장치]", result: "기일변경" },
    { l_num: 7, date: "2026-12-03", content: "변론기일(10:40) [쌍방 화상장치]", result: null },
    { l_num: 7, date: "2027-01-07", content: "변론기일(제705호 법정 10:40)", result: null },
    { l_num: 7, date: "2026-12-01", content: "원고 변론기일통지서발송", result: null },
    { l_num: 9, date: "2027-01-08", content: "판결선고기일(제419호 법정 13:50)", result: "기일변경" },
  ];
  const r = scourtAdjust(lw, sc);
  if (!r.drop.has(1) || r.drop.has(2) || r.drop.size !== 1) throw new Error("drop " + [...r.drop]);
  if (r.add.length !== 1 || r.add[0].date !== "2027-01-07" || r.add[0].time !== "10:40") throw new Error(JSON.stringify(r.add));
  if (r.add[0].lp_num !== fakeLp(7, "2027-01-07", "10:40") || r.add[0].lp_num >= 0 || !Number.isSafeInteger(r.add[0].lp_num)) throw new Error("lp " + r.add[0].lp_num);
});

// 실행: deno test supabase/functions/case-view/shape_test.ts
import { caseNoVariants, shapeCase } from "./handler.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("사건번호 후보", () => {
  const v = caseNoVariants("26고단01234");
  assert(v.includes("2026고단1234") && v.includes("26고단1234"), v.join());
  assert(caseNoVariants("2025-0000")[0] === "2025-0000", "모양 다른 번호는 그대로");
});

Deno.test("화면 모양", () => {
  const c = { l_num: 1, l_code: "2026고단1234", l_name: "[전자]사기", court: "인천지방법원", state: "진행", next_date: "2026-12-08", next_time: "14:00", next_contents: "공판기일",
    raw: { l_justice_dept: "형사3단독", l_client: "김OO", l_client_hp: "010", l_client_rrn: "비밀", l_police_station: "" } };
  const evs = [
    { lp_num: 1, lp_set: "기일", lp_appoint_date: "2026-11-10", lp_appoint_time: "10:30", lp_contents: "공판기일(411호 법정 10:30)", lp_remark: "속행", last_seen_at: "2026-11-12T00:31:00Z" },
    { lp_num: 2, lp_set: "서면", lp_appoint_date: "2026-11-05", lp_contents: "피고인 변호인 법무법인 정서 의견서 제출" },
    { lp_num: 3, lp_set: "송달", lp_appoint_date: "2026-11-01", lp_contents: "피고인2 이OO 공소장 발송" },
    { lp_num: 4, lp_set: "송달", lp_appoint_date: "2026-11-02", lp_contents: "변호인 법무법인 정서 기일통지서 발송", delivered_date: "2026-11-04" },
    { lp_num: 5, lp_set: "문자", lp_appoint_date: "2026-11-03", lp_contents: "[SMS] 안내" },
  ];
  const d = shapeCase(c, evs, { today: "2026-11-12", linked: ["2025고단9"], myHearings: [{ c: "2026노1", d: "2026-11-20", tm: "10:00", t: "공판", p: "" }], status: "대상" });
  assert(d.title === "사기" && d.court === "인천지방법원 형사3단독", "제목·법원");
  assert(!d.events.some((e: any) => e.t.includes("이OO")), "남에게 가는 송달은 타임라인에서 뺌");
  assert(d.events.some((e: any) => e.k === "ours"), "우리 서면");
  assert(d.events.some((e: any) => e.k === "due" && e.d === "2026-12-08"), "다음 기일");
  assert(d.hearings.some((h: any) => h.p === "411호 법정") && d.hearings.some((h: any) => h.c === "2026노1"), "기일");
  assert(d.progress.rows.length === 4 && d.progress.updated === "11.12 09:31", "진행내용 " + d.progress.updated);
  assert(!JSON.stringify(d).includes("비밀"), "주민번호 안 나감");
  assert(d.info.some((s: any) => s.h === "연결 사건"), "연결 사건");
});

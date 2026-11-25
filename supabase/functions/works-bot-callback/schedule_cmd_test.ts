import { assertEquals } from "jsr:@std/assert@1";
import { buildPlan, calendarUrl, isCriminal, isScheduleCmd, lawyerFromTitle, parseHearing } from "./schedule_cmd.ts";

Deno.test("명령 알아보기", () => {
  assertEquals(isScheduleCmd("/일정"), true);
  assertEquals(isScheduleCmd(" / 일정 "), true);
  assertEquals(isScheduleCmd("/일정 잡아줘"), false);
  assertEquals(isScheduleCmd("일정"), false);
});

Deno.test("방 제목 → 변호사", () => {
  assertEquals(lawyerFromTitle("강)신)!(형/피고인)임윤선_업무상횡령_인천지방법원 2026고단1048")?.name, "강현구");
  assertEquals(lawyerFromTitle("이)◎(민/피고)홍길동_대여금")?.head, "예)");
  assertEquals(lawyerFromTitle("서)신)◎(형/피의)박정미")?.head, "");
  assertEquals(lawyerFromTitle("박)신)★(형/고소)김가나_사기_인천 2026고단55")?.name, "박종덕");
  assertEquals(lawyerFromTitle("신)(형/피고)홍길동"), null);
  assertEquals(lawyerFromTitle("(형/고소)이경옥_사기(안병근)"), null); // 괄호 안 "근)" 같은 건 안 봄
});

Deno.test("기일 내용 읽기", () => {
  assertEquals(parseHearing("공판기일(316호법정 14:00)"), { kind: "공판기일", room: "316호법정", time: "14:00", video: false });
  assertEquals(parseHearing("변론기일(302호 법정 09:50) [일방 화상장치]").video, true);
  assertEquals(isCriminal("2026고단1048"), true);
  assertEquals(isCriminal("2026노100191"), true);
  assertEquals(isCriminal("2026가단201543"), false);
  assertEquals(isCriminal("2026드단101574"), false);
});

Deno.test("임윤선 사건 = 직원이 손으로 올린 일정과 같게", () => {
  const p = buildPlan({ roomTitle: "강)신)!(형/피고인)임윤선_업무상횡령_인천지방법원 2026고단1048", caseNo: "2026고단1048", client: "임윤선", another: "", court: "인천지방법원", gukseon: false, date: "2027-01-28", time: "14:00", contents: "공판기일(316호법정 14:00)" });
  assertEquals(p.summary, "강)공판_임윤선");
  assertEquals(p.location, "인천지방법원 316호법정");
  const u = new URL(calendarUrl(p));
  assertEquals(u.searchParams.get("startDateTime"), "2027-01-28T14:00:00");
  assertEquals(u.searchParams.get("endDateTime"), "2027-01-28T15:00:00");
  assertEquals(u.searchParams.get("summary"), "강)공판_임윤선");
});

Deno.test("민사·국선·선고", () => {
  const civ = buildPlan({ roomTitle: "강)(민/피고)이윤정", caseNo: "2026가단201543", client: "이윤정", another: "신용보증기금", court: "인천지방법원", gukseon: false, date: "2026-12-23", time: "10:00", contents: "판결선고기일(별관동 법정 303호 10:00)" });
  assertEquals(civ.summary, "강)판결선고_이윤정/신용보증기금");
  const gk = buildPlan({ roomTitle: "이)(형/피고)김철우", caseNo: "2026고단3346", client: "김철우", another: "", court: "인천지방법원", gukseon: true, date: "2026-12-09", time: "", contents: "선고기일(319호법정 10:30)" });
  assertEquals(gk.summary, "예)선고_국선 김철우");
  assertEquals(gk.time, "10:30");
  const vid = buildPlan({ roomTitle: "서)(가사)유선희", caseNo: "2026드단101574", client: "유선희", another: "", court: "인천가정법원", gukseon: false, date: "2026-11-27", time: "09:50", contents: "변론기일(302호 법정 09:50) [일방 화상장치]" });
  assertEquals(vid.summary, "(영상)변론_유선희");
});

// 실행: deno test supabase/functions/case-view/shape_test.ts
import { attachContract, byDay, earliestAccept, attachFinalFiles, caseNoVariants, caseNosIn, cleanPhones, infoFields, mergeMeets, ourFilingTest, shapeCase, smsGist } from "./handler.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("사건번호 후보", () => {
  const v = caseNoVariants("26고단01234");
  assert(v.includes("2026고단1234") && v.includes("26고단1234"), v.join());
  assert(caseNoVariants("2025-0000")[0] === "2025-0000", "모양 다른 번호는 그대로");
});

Deno.test("화면 모양", () => {
  const c = { l_num: 1, l_code: "2026고단1234", l_name: "[전자]사기", court: "인천지방법원", state: "진행", next_date: "2026-12-08", next_time: "14:00", next_contents: "공판기일",
    raw: { l_justice_dept: "형사3단독", l_client: "김OO", l_client_hp: "010", l_client_rrn: "비밀", l_police_station: "", l_accept_date: "2026-10-01", l_judgment_date: "2026-12-20" } };
  const evs = [
    { lp_num: 1, lp_set: "기일", lp_appoint_date: "2026-11-10", lp_appoint_time: "10:30", lp_contents: "공판기일(411호 법정 10:30)", lp_remark: "속행", last_seen_at: "2026-11-12T00:31:00Z" },
    { lp_num: 2, lp_set: "서면", lp_appoint_date: "2026-11-05", lp_contents: "피고인 변호인 법무법인 정서 의견서 제출" },
    { lp_num: 3, lp_set: "송달", lp_appoint_date: "2026-11-01", lp_contents: "피고인2 이OO 공소장 발송" },
    { lp_num: 4, lp_set: "송달", lp_appoint_date: "2026-11-02", lp_contents: "변호인 법무법인 정서 기일통지서 발송", delivered_date: "2026-11-04" },
    { lp_num: 6, lp_set: "서면", lp_appoint_date: "2026-11-06", lp_contents: "원고 소송대리인 박혁 보정서 제출" },
    { lp_num: 5, lp_set: "문자", lp_appoint_date: "2026-11-03", lp_contents: "[SMS] 안내" },
  ];
  const d = shapeCase(c, evs, { today: "2026-11-12", linked: ["2025고단9"], myHearings: [{ c: "2026노1", d: "2026-11-20", tm: "10:00", t: "공판", p: "" }], status: "대상" });
  assert(d.title === "사기" && d.court === "인천지방법원 형사3단독", "제목·법원");
  assert(!d.events.some((e: any) => e.t.includes("이OO")), "남에게 가는 송달은 타임라인에서 뺌");
  assert(d.events.some((e: any) => e.k === "ours"), "우리 서면");
  assert(d.events.some((e: any) => e.k === "due" && e.d === "2026-12-08"), "다음 기일");
  assert(d.hearings.some((h: any) => h.p === "411호 법정") && d.hearings.some((h: any) => h.c === "2026노1"), "기일");
  assert(!d.events.some((e: any) => e.t.includes("보정서")), "남의 서면은 타임라인에서 뺌");
  assert(!d.events.some((e: any) => e.t.includes("기일통지서")), "우리에게 온 송달도 타임라인에서 뺌(나의사건 탭에만)");
  assert(d.events.find((e: any) => e.g === "ours")!.t === "의견서 제출", "우리 서면 줄 " + JSON.stringify(d.events));
  assert(d.events[0].g === "accept" && d.events[0].d === "2026-10-01", "선임이 맨 앞");
  assert(d.events.some((e: any) => e.k === "done" && e.t.startsWith("출석 공판기일")), "지난 기일은 출석");
  assert(d.events.some((e: any) => e.t === "선고" && e.d === "2026-12-20"), "선고일");
  assert(d.events.some((e: any) => e.g === "msg" && e.d === "2026-11-03"), "안내 문자");
  assert(d.progress.rows.length === 5 && d.progress.updated === "11.12 09:31", "진행내용 " + d.progress.updated);
  assert(!JSON.stringify(d).includes("비밀"), "주민번호 안 나감");
  assert(d.info.linked[0] === "2025고단9", "연결 사건");
  assert(d.info.fields.client_name === "김OO" && d.info.fields.case_name === "사기" && !d.info.saved, "처음 값");
  assert(d.progress.rows.find((r: any) => r.c.includes("이OO"))!.x === 1 && d.progress.rows.find((r: any) => r.c.includes("기일통지서"))!.u === 1, "송달 진하게/흐리게");
});

Deno.test("저장된 사건 정보만 씀", () => {
  const c = { l_num: 1, l_code: "x", l_name: "사기", charge_lawyer: "서고은,이예나", raw: { l_client: "로웨어이름", l_justice_dept: "가사 3 단독 (전화:032-620-4441(매주 금요일은 재판))" } };
  const p = infoFields(c, null);
  assert(p.fields.lawyer === "서고은" && p.fields.court_phone === "032-620-4441", "처음 값 " + JSON.stringify(p.fields));
  const s = infoFields(c, { client_name: "우리가 고친 이름", updated_by: "서석원" });
  assert(s.fields.client_name === "우리가 고친 이름" && s.fields.case_name === "" && s.saved, "저장값 우선, 로웨어 안 섞음");
});

Deno.test("안내 문자 요약", () => {
  assert(smsGist("[SMS]안녕하세요 김OO님, 법무법인 정서 입니다.변론기일 안내 드립니다.사건번호 : 2026가단1") === "변론기일 안내 드립니다", smsGist("[SMS]안녕하세요 김OO님, 법무법인 정서 입니다.변론기일 안내 드립니다.사건번호"));
  assert(smsGist("[SMS]안녕하세요.서OO 사무실입니다.김OO님 조사일정안내드립니다.1.2026") === "김OO님 조사일정안내드립니다", smsGist("[SMS]안녕하세요.서OO 사무실입니다.김OO님 조사일정안내드립니다.1.2026"));
});

Deno.test("접견 줄", () => {
  const sh: any = { today: "2026-11-13", events: [] };
  mergeMeets(sh, [{ event_id: "a", ev_date: "2026-11-10", ev_time: "14:00", lawyer: "서고은", place: "인천" }, { event_id: "a", ev_date: "2026-11-10" },
    { event_id: "b", ev_date: "2026-11-20", ev_time: "", lawyer: "이예나", place: "" }]);
  assert(sh.events.length === 2 && sh.events[0].t === "14:00 접견 · 서고은 (인천)" && sh.events[0].k === "done", JSON.stringify(sh.events));
  assert(sh.events[1].t === "접견 예정 · 이예나" && sh.events[1].k === "due", JSON.stringify(sh.events));
});

Deno.test("계약서는 선임 줄에, 서면 후보에서는 빠짐", () => {
  const ev = [{ d: "2026-10-01", k: "ours", g: "accept", t: "사건 선임" }, { d: "2026-10-01", k: "ours", g: "ours", t: "의견서 제출", lp: 7 }];
  const files = [
    { id: 1, n: "위임계약서_홍길동.pdf", d: "2026-10-01", at: 3, pdf: 1, lp: null },
    { id: 2, n: "의견서.hwp", d: "2026-10-01", at: 2, pdf: 0, lp: null },
  ];
  attachFinalFiles(ev, files);
  attachContract(ev, files);
  if ((ev[0] as any).cf?.id !== 1) throw new Error("계약서 안 붙음");
  if ((ev[1] as any).f?.id !== 2) throw new Error("서면에 계약서가 붙음");
});

Deno.test("추가 전화 정리", () => {
  const t = cleanPhones(JSON.stringify([{ n: "어머니", p: "010-1234-5678" }, { n: "", p: "" }, "x"]));
  if (t !== JSON.stringify([{ n: "어머니", p: "010-1234-5678" }])) throw new Error(t);
  if (cleanPhones("깨진 글자") !== "") throw new Error("깨진 값");
  if (cleanPhones("") !== "") throw new Error("빈 값");
});

Deno.test("방 제목 사건번호: 2자리 연도도", () => {
  const a = caseNosIn("박)신)★(형/피의)홍길동_사기_인천26고단103412");
  if (!a.includes("2026고단103412")) throw new Error(JSON.stringify(a));
  const b = caseNosIn("인천 2026고합100351");
  if (!b.includes("2026고합100351")) throw new Error(JSON.stringify(b));
});

import { mergeRoomEvents as _mre, roomGroup as _rg } from "./handler.ts";
import { assertEquals } from "jsr:@std/assert@1";
Deno.test("수사 단계 줄 색: 선임계·서면 초록, 조사 파랑, 송치 파랑 굵게, 정보공개청구는 흐린 줄", () => {
  assertEquals(_rg("서면제출", "선임계 우편 제출"), "ours");
  assertEquals(_rg("기타", "선임계 킥스 다시 제출, 수사관 확인"), "ours");
  assertEquals(_rg("조사", "피의자 조사 참여 (인천광역시경찰청)"), "hearing");
  assertEquals(_rg("송치", "검찰 송치"), "decision");
  assertEquals(_rg("기타", "피신조서 정보공개 결과 받음"), "chat");
  const sh: any = { today: "2026-11-16", events: [], hearings: [] };
  _mre(sh, [
    { id: 1, kind: "조사", ev_date: "2026-11-05", ev_time: "11:00", summary: "피의자 조사 참여", state: "완료" },
    { id: 2, kind: "송치", ev_date: "2026-11-10", ev_time: "", summary: "검찰 송치", state: "완료" },
    { id: 3, kind: "조사", ev_date: "2026-11-20", ev_time: "", summary: "피의자 2회 조사", state: "예정" },
  ], "수사-1");
  assertEquals(sh.events.map((e: any) => [e.g, e.k]), [["hearing", "done"], ["hearing", "ours"], ["hearing", "due"]]);
  assertEquals(sh.hearings.length, 2);
});

import { fixAccept as _fa } from "./handler.ts";
import { firstDate as _fd } from "./chat_import.ts";
Deno.test("수사 사건 선임일: 방 첫날·가장 이른 업무 날로 당김, 로웨어 사건은 그대로", () => {
  assertEquals(_fd("NAVER WORKS\n2026년 10월 7일 수요일\n13:20 원가을"), "2026-10-07");
  const inv: any = { events: [
    { d: "2026-11-16", k: "ours", g: "accept", t: "사건 선임" },
    { d: "2026-10-07", k: "ours", g: "accept", src: "chat", t: "사건 선임" },
    { d: "2026-10-08", k: "ours", g: "ours", src: "chat", t: "선임계 우편 제출" },
  ] };
  _fa(inv, true);
  assertEquals(inv.events.filter((e: any) => e.g === "accept").map((e: any) => e.d), ["2026-10-07"]);
  const law: any = { events: [
    { d: "2026-10-07", k: "ours", g: "accept", t: "사건 선임" },
    { d: "2026-10-01", k: "ours", g: "accept", src: "chat", t: "사건 선임" },
  ] };
  _fa(law, false);
  assertEquals(law.events.map((e: any) => e.d), ["2026-10-07"]);
});

Deno.test("같은 방 이전 사건 선임일이 더 이르면 그날로", async () => {
  const { earliestAccept } = await import("./handler.ts");
  const shaped: any = { events: [{ d: "2026-10-01", k: "ours", g: "accept", t: "사건 선임" }, { d: "2026-10-05", k: "ours", g: "ours", t: "x" }] };
  earliestAccept(shaped, [{ raw: { l_accept_date: "2026-06-03 00:00:00" } }, { raw: {} }]);
  assertEquals(shaped.events[0].d, "2026-06-03");
  const s2: any = { events: [] };
  earliestAccept(s2, [{ raw: { l_accept_date: "2026-06-03" } }]);
  assertEquals(s2.events[0].t, "사건 선임");
});

Deno.test("같은 날 사건 선임이 맨 위", () => {
  const shaped: any = { today: "2026-11-16", events: [], hearings: [] };
  shaped.events.push({ d: "2026-08-25", k: "ours", g: "ours", t: "선임계 우편 제출", src: "chat" });
  shaped.events.push({ d: "2026-08-24", k: "done", g: "chat", t: "앞날" });
  shaped.events.push({ d: "2026-08-25", k: "ours", g: "accept", t: "사건 선임" });
  shaped.events.push({ d: "2026-08-25", k: "done", g: "chat", t: "기타" });
  earliestAccept(shaped, []);
  shaped.events.sort(byDay);
  assertEquals(shaped.events.map((e: any) => e.t), ["앞날", "사건 선임", "선임계 우편 제출", "기타"]);
});

Deno.test("대화에서 뽑은 마감 줄은 기한 탭으로, 기일 탭에서는 뺀다", () => {
  const shaped: any = { today: "2026-11-16", events: [], hearings: [], deadlines: [] };
  _mre(shaped, [
    { id: 1, kind: "기일", ev_date: "2026-12-06", ev_time: "", summary: "항고 마감일", state: "예정" },
    { id: 2, kind: "지시", ev_date: "2026-11-16", ev_time: "", summary: "항고장 작성 지시 (서변호사)", state: "완료" },
    { id: 3, kind: "조사", ev_date: "2026-12-01", ev_time: "14:00", summary: "피의자 조사", state: "예정" },
  ], "");
  assertEquals(shaped.deadlines.map((x: any) => [x.t, x.d, x.kind]), [["항고 마감일", "2026-12-06", "대화"]]);
  assertEquals(shaped.hearings.map((h: any) => h.t), ["피의자 조사"]);
  assertEquals(shaped.events.find((e: any) => e.rid === 1).g, "limit");
});

Deno.test("법원 기록에서 가려진 우리 이름(법OOOOOO)도 우리 서면으로 본다", () => {
  const L = (d: string, set: string, c: string) => ({ lp_appoint_date: d, lp_set: set, lp_contents: c });
  const t = ourFilingTest([
    L("2026-07-29", "서면", "피고인1 변호인  법OOOOOO 항소이유서 제출"),   // 우리 선임 전 → 전 변호인
    L("2026-08-04", "서면", "변호인  법무법인 정서 변호인선임계 제출"),
    L("2026-08-21", "송달", "피고인1 변호인  법무법인 정서 공판기일통지서(변호인용) 발송"),
    L("2026-09-29", "서면", "피고인1 변호인  법OOOOOO 변호인 의견서 제출"),
    L("2026-10-12", "서면", "피고인2 변호인  법OOOOOOO 참고자료 제출"),
    L("2026-10-13", "서면", "피고인2 변호인  법OOOOOO 의견서 제출"),
  ]);
  assertEquals([
    "2026-07-29|피고인1 변호인  법OOOOOO 항소이유서 제출", "2026-08-04|변호인  법무법인 정서 변호인선임계 제출",
    "2026-09-29|피고인1 변호인  법OOOOOO 변호인 의견서 제출", "2026-10-12|피고인2 변호인  법OOOOOOO 참고자료 제출",
    "2026-10-13|피고인2 변호인  법OOOOOO 의견서 제출",
  ].map((x) => t({ lp_set: "서면", lp_appoint_date: x.split("|")[0], lp_contents: x.split("|")[1] })), [false, true, true, false, false]);
  // 맡은 자리를 모를 때: 선임 뒤 가려진 자리가 하나뿐이면 그 자리
  const u = ourFilingTest([L("2026-11-02", "서면", "변호인  법무법인 정서 변호인선임계 제출"), L("2026-11-03", "서면", "피고인1 변호인  법OOOOOO 기일변경신청서 제출")]);
  assertEquals(u(L("2026-11-03", "서면", "피고인1 변호인  법OOOOOO 기일변경신청서 제출")), true);
});

Deno.test("최종 서면: 제목이 비슷한 파일만, 중요하지 않은 제출·뺀 줄은 비움", () => {
  // 2026고합100415 실제 사례(2026-11-18): 선임계·열람복사신청 같은 날 제출, 방엔 선임신고서·편지·계약서
  const ev: any[] = [
    { d: "2026-11-17", k: "ours", g: "ours", t: "변호인선임계 제출", lp: 75860 },
    { d: "2026-11-17", k: "ours", g: "ours", t: "변호사 서고은 열람및복사신청 제출", lp: 75861 },
    { d: "2026-11-20", k: "ours", g: "ours", t: "변호사 서고은 의견서 제출", lp: 9 },
    { d: "2026-11-25", k: "ours", g: "ours", t: "보석허가청구서 제출", lp: 10 },
  ];
  const files = [
    { id: 35, n: "이상한_변호인선임신고서_261117.pdf", d: "2026-11-17", at: 3, pdf: 1, lp: null },
    { id: 26, n: "이상한_편지_261117.pdf", d: "2026-11-17", at: 2, pdf: 1, lp: null },
    { id: 15, n: "(형사)송무위임계약서_이상한.pdf", d: "2026-11-16", at: 1, pdf: 1, lp: null },
    { id: 40, n: "서고은_메모.pdf", d: "2026-11-20", at: 5, pdf: 1, lp: null },
    { id: 41, n: "보석허가청구서_최종.pdf", d: "2026-11-24", at: 6, pdf: 1, lp: null },
  ];
  attachFinalFiles(ev, files, new Set(["10"]));
  if (ev[0].f?.id !== 35) throw new Error("선임계 " + JSON.stringify(ev[0]));
  if (ev[1].f || !ev[1].minor) throw new Error("열람복사에 파일 " + JSON.stringify(ev[1]));
  if (ev[2].f) throw new Error("변호사 이름만 겹친 파일이 붙음 " + JSON.stringify(ev[2]));
  if (ev[3].f) throw new Error("뺀 줄에 다시 붙음");
});

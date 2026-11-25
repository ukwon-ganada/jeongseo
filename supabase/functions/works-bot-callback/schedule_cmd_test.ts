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
  assertEquals(lawyerFromTitle("서)박)신!(형/피고인7)이강현_폭처벌")?.name, "박종덕");
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

import { planForRoom } from "./schedule_cmd.ts";
// 가짜 서버: DB·웍스·AI
function fake(ai: any, lwDate = "2026-12-01") {
  return (async (input: string | URL | Request, _init?: RequestInit) => {
    const u = String(input);
    const j = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    if (u.includes("/works_room_case")) return j([{ l_num: 1, case_no: "2026고단1048", room_title: "강)신)!(형/피고인)임윤선_업무상횡령", status: "대상" }]);
    if (u.includes("/lw_process_events")) return j(lwDate ? [{ l_num: 1, lp_appoint_date: lwDate, lp_appoint_time: "10:00", lp_contents: "공판기일(316호법정 10:00)" }] : []);
    if (u.includes("/case_all")) return j([{ l_num: 1, l_code: "2026고단1048", l_client: "임윤선", court: "인천지방법원", next_date: null }]);
    if (u.includes("/gukseon_cases")) return j([]);
    if (u.includes("/room_image")) return j([{ bot_id: "b", file_id: "f1" }]);
    if (u.includes("auth.worksmobile.com")) return j({ access_token: "t", expires_in: 3600 });
    if (u.includes("/attachments/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    if (u.includes("api.anthropic.com")) return j({ content: [{ type: "text", text: JSON.stringify(ai) }] });
    return j([]);
  }) as typeof fetch;
}
const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey)))) + "\n-----END PRIVATE KEY-----";
const ENV = { sbUrl: "https://x", sbKey: "k", anthropicKey: "a", clientId: "c", clientSecret: "s", serviceAccount: "sa", privateKey: pem };

Deno.test("사진이 로웨어와 다르면 사진 기준, 메모에 로웨어 값", async () => {
  const r = await planForRoom(ENV, "ch", fake({ found: true, date: "2099-01-28", time: "14:00", kind: "공판기일", room: "316호법정", court: "인천지방법원" }, "2099-01-10"));
  assertEquals(r.plan?.summary, "강)공판_임윤선");
  assertEquals(r.plan?.date, "2099-01-28");
  assertEquals(r.plan?.time, "14:00");
  assertEquals(r.plan?.location, "인천지방법원 316호법정");
  assertEquals(r.plan?.source.includes("사진 기준 · 로웨어: 2099-01-10"), true);
  assertEquals(r.plan?.description.includes("도우미"), false);
});
Deno.test("사진이 로웨어와 같으면 로웨어 그대로", async () => {
  const r = await planForRoom(ENV, "ch", fake({ found: true, date: "2099-01-10", time: "10:00", kind: "공판기일", room: "316호법정", court: "" }, "2099-01-10"));
  assertEquals(r.plan?.source.includes("로웨어 기일 기준 · 사진과 같음"), true);
});
Deno.test("로웨어에 없으면 사진으로", async () => {
  const r = await planForRoom(ENV, "ch", fake({ found: true, date: "2099-02-02", time: "9:30", kind: "선고기일", room: "318호법정", court: "인천지방법원" }, ""));
  assertEquals(r.plan?.summary, "강)선고_임윤선");
  assertEquals(r.plan?.time, "09:30");
});

Deno.test("도우미가 알린 기일이 사진보다 늦으면 알린 기일", async () => {
  const base = fake({ found: true, date: "2099-03-01", time: "10:00", kind: "공판기일", room: "1호", court: "" }, "2099-01-10");
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    if (u.includes("/hearing_notice")) return new Response(JSON.stringify([{ l_num: 1, ev_date: "2099-02-02", ev_time: "11:10", contents: "선고기일(318호법정 11:10)", created_at: new Date().toISOString() }]));
    if (u.includes("/room_image") && u.includes("select=created_at")) return new Response(JSON.stringify([{ created_at: new Date(Date.now() - 3600e3).toISOString() }]));
    return base(input, init);
  }) as typeof fetch;
  const r = await planForRoom(ENV, "ch", f);
  assertEquals(r.plan?.summary, "강)선고_임윤선");
  assertEquals(r.plan?.date, "2099-02-02");
  assertEquals(r.plan?.source, "도우미 알림 기준");
});

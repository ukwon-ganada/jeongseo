import { assertEquals } from "jsr:@std/assert@1";
import { cleanItems, handleAttendText, looksLikeAttend } from "./attend_text.ts";

Deno.test("출석 글 고르기", () => {
  assertEquals(looksLikeAttend("김우석은 4월 15일 선거만 갑니다."), true);
  assertEquals(looksLikeAttend("1/14 기일은 안 가도 됩니다"), true);
  assertEquals(looksLikeAttend("12월 3일 접견 잡았습니다"), false);
  assertEquals(looksLikeAttend("저희 언제 참석해야 해요?"), false); // 날짜 없음
});

Deno.test("AI 결과 다듬기", () => {
  const j = { applies: true, items: [
    { date: "2027-04-15", attend: true, kind: "선고기일", time: "14:00", place: "412호법정" },
    { date: "2027-01-14", attend: false, kind: "공판기일", time: null, place: null },
    { date: "2026-11-01", attend: false, kind: "", time: null, place: null },
    { date: "2027-01-14", attend: true, kind: "", time: null, place: null },
  ] };
  assertEquals(cleanItems(j, "2026-11-26").map((x) => x.date + x.attend), ["2027-04-15true", "2027-01-14false"]);
  assertEquals(cleanItems({ applies: false, items: j.items }, "2026-11-26"), []);
});

Deno.test("방 글 → 저장(직원이 정한 날은 건너뜀)", async () => {
  const posted: any[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const J = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (u.includes("works_room_case")) return J([{ l_num: 2958, room_title: "(국선)(형/피고인5)김우석_사기_인천지방법원_2026고단1492", status: "대상" }]);
    if (u.includes("lw_process_events")) return J(["2027-01-14", "2027-02-11", "2027-03-11"].map((d) => ({ l_num: 2958, lp_appoint_date: d, lp_appoint_time: "10:30", lp_contents: "공판기일(412호법정 10:30)" })));
    if (u.includes("api.anthropic.com")) return J({ content: [{ type: "text", text: JSON.stringify({ applies: true, items: [
      { date: "2027-01-14", attend: false, kind: "공판기일", time: null, place: null },
      { date: "2027-02-11", attend: false, kind: "공판기일", time: null, place: null },
      { date: "2027-03-11", attend: false, kind: "공판기일", time: null, place: null },
      { date: "2027-04-15", attend: true, kind: "선고기일", time: "14:00", place: "412호법정" },
    ] }) }] });
    if (u.includes("hearing_attend?select")) return J([{ l_num: 2958, hdate: "2027-02-11" }]);
    if (u.includes("hearing_attend?on_conflict")) { posted.push(...JSON.parse(String(init?.body))); return new Response(null, { status: 201 }); }
    throw new Error("unexpected " + u);
  }) as typeof fetch;
  const r = await handleAttendText({ sbUrl: "https://x", sbKey: "k", anthropicKey: "a" }, { channelId: "c", text: "김우석은 4월 15일 선거만 갑니다.", sentAt: "2026-11-26T04:06:00Z" }, fetcher);
  assertEquals(r, { how: "saved", saved: 3 });
  assertEquals(posted.map((p) => p.hdate + ":" + p.attend + ":" + p.source), ["2027-01-14:false:방 글", "2027-03-11:false:방 글", "2027-04-15:true:방 글"]);
});

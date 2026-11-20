import { assertEquals } from "jsr:@std/assert@1";
import { chunkExport, extractFromExport, tidyExport, toRows, dropKnown, msgsToExport } from "./chat_import.ts";

const SAMPLE = `2026년 10월 7일 수요일
13:20 원가을
선임계 제출하겠습니다.

13:54 원가을
(파일)

10:23 원가을
연락처 010-1234-5678
2026년 10월 8일 목요일
14:01 원가을
변호인선임신고서 우편도착완료하였습니다
강민지님이 메시지를 회수하였습니다.`;

Deno.test("tidyExport: 사진·파일·회수 줄 빼고 전화번호 지움", () => {
  const t = tidyExport(SAMPLE);
  assertEquals(t.includes("(파일)"), false);
  assertEquals(t.includes("010-1234-5678"), false);
  assertEquals(t.includes("[번호]"), true);
  assertEquals(t.includes("회수"), false);
});

Deno.test("chunkExport: 날짜 머리줄 기준으로 나눔", () => {
  const t = tidyExport(SAMPLE);
  const c = chunkExport(t, t.indexOf("2026년 10월 8일") + 2);
  assertEquals(c.length, 2);
  assertEquals(c[1].startsWith("2026년 10월 8일"), true);
});

Deno.test("toRows: 같은 날·같은 종류는 보낸 시각으로 구분", () => {
  const rows = toRows(2960, [
    { kind: "기타", date: "2026-10-08", time: "", msg_time: "14:01", summary: "선임신고서 도착", state: "완료" },
    { kind: "기타", date: "2026-10-08", time: "", msg_time: "14:35", summary: "정보공개 결과", state: "완료" },
    { kind: "이상한종류", date: "2026-13-40", time: "", msg_time: "", summary: "x", state: "완료" },
  ]);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].ev_time, "");
  assertEquals(rows[1].ev_time, "14:35");
  assertEquals(rows[0].channel_id, "export:2960");
  assertEquals(rows[0].source, "chat-export");
});

Deno.test("extractFromExport: AI 응답을 정리해 날짜순으로", async () => {
  let sent = "";
  const fake = (async (_u: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ events: [
      { kind: "기타", date: "2026-10-08", time: "", msg_time: "14:01", summary: "선임신고서 도착 010-1111-2222", state: "완료" },
      { kind: "서면제출", date: "2026-10-07", time: "", msg_time: "16:37", summary: "선임계 우편 제출", state: "완료" },
    ] }) }] }));
  }) as typeof fetch;
  const r = await extractFromExport({ key: "k", text: SAMPLE, title: "t" }, fake);
  assertEquals(r.events.map((e) => e.date), ["2026-10-07", "2026-10-08"]);
  assertEquals(r.events[1].summary.includes("010"), false);
  assertEquals(sent.includes("010-1234-5678"), false);
});

Deno.test("갱신: 보관 글을 내보내기 모양으로, 이미 있는 줄은 빼기", () => {
  const t = msgsToExport([
    { sent_at: "2026-11-15T23:30:00Z", text: "선임계 우편\n제출했습니다", works_user_id: "u1" },
    { sent_at: "2026-11-16T01:00:00Z", text: "조사 11/20 14시", works_user_id: "u2" },
  ], { u1: "김직원" });
  assertEquals(t, "2026년 11월 16일 월요일\n김직원 08:30 선임계 우편 제출했습니다\n직원 10:00 조사 11/20 14시");
  const evs = [
    { kind: "서면제출", date: "2026-11-16", time: "", msg_time: "08:30", summary: "선임계 우편 제출", state: "완료" as const },
    { kind: "조사", date: "2026-11-20", time: "14:00", msg_time: "10:00", summary: "피의자 조사", state: "예정" as const },
    { kind: "지시", date: "2026-11-16", time: "", msg_time: "", summary: "의견서 제출 지시 (서변호사)", state: "완료" as const },
  ];
  const left = dropKnown(evs, [{ ev_date: "2026-11-20", kind: "조사" }, { ev_date: "2026-11-16", kind: "지시", summary: "다른 지시" }]);
  assertEquals(left.map((e) => e.kind), ["서면제출", "지시"]);
  assertEquals(toRows(-5, left, "refresh:", "chat-refresh")[0].channel_id, "refresh:-5");
});

Deno.test("대화파일 다시 올려도 같은 날·같은 내용 줄은 다시 넣지 않는다", async () => {
  const { dropSame } = await import("./chat_import.ts");
  const evs: any[] = [
    { date: "2026-10-08", kind: "서면제출", summary: "변론병합신청서 제출" },
    { date: "2026-10-08", kind: "서면제출", summary: "참고자료 제출" },
  ];
  const out = dropSame(evs, [{ ev_date: "2026-10-08", kind: "서면제출", summary: "변론병합 신청서 제출" }]);
  if (out.length !== 1 || out[0].summary !== "참고자료 제출") throw new Error(JSON.stringify(out));
});

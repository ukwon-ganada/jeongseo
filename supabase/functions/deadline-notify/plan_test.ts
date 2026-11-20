import { assertEquals } from "jsr:@std/assert@1";
import { announced, card, isTeamCase, lawyersLine, pick, roomMessage, deadlineLines } from "./plan.ts";

const dl = (d: string, extra: any = {}) => ({ t: "항소이유서 마감", d, why: "기록접수통지 도달 11.18(피고인) + 20일", st: "open" as const, kind: "항소이유서", ...extra });
const S = (body: string, at: string) => ({ body, sent_at: at + "T02:10:00+00:00" });

Deno.test("서고은 팀만: 정필성 사건 빼고, 팀 이름 하나라도 있으면 포함", () => {
  assertEquals(["서고은,우숭민,양선화", "정필성", "이예나", "[정필성팀]", "정필성, 원가을", ""].map(isTeamCase), [true, false, true, false, false, false]);
  assertEquals(lawyersLine("서고은,우숭민,양선화"), "서고은변호사, 양선화변호사");
});

Deno.test("주기: 처음 계산된 날 → 보냄, 그다음 날 → 쉼, D-7 → 보냄, D-3부터 매일, 경과도 매일(50일까지)", () => {
  const sent = [S("📋 2026노9001 · 홍길동\n🔴 항소이유서 제출기한  2026-12-08(Tue)  · D-18", "2026-11-20")];
  assertEquals(pick(dl("2026-12-08"), "2026노9001", "2026-11-20", []).why, "처음 계산됨");
  assertEquals(pick(dl("2026-12-08"), "2026노9001", "2026-11-23", sent).send, false);
  assertEquals(pick(dl("2026-12-08"), "2026노9001", "2026-12-01", sent).why, "7일 전");
  assertEquals(pick(dl("2026-12-08"), "2026노9001", "2026-12-02", [...sent, S("2026노9001 항소이유서 제출기한  2026-12-08", "2026-12-01")]).send, false);
  assertEquals(pick(dl("2026-12-08"), "2026노9001", "2026-12-05", sent).send, true);
  assertEquals(pick(dl("2026-12-08"), "2026노9001", "2026-12-20", sent).why, "경과");
  assertEquals(pick(dl("2026-09-01"), "2026노1", "2026-11-20", sent).send, false);
});

Deno.test("사무실 PC가 보낸 기록도 이어서 본다(본문 글자 같음)", () => {
  assertEquals(announced([S("📋 2026노9002 · 이을동\n\n🔴 항소이유서 제출기한  2026-11-25(Wed)  · D-6", "2026-11-19")], "2026노9002", "항소이유서", "2026-11-25"), true);
});

Deno.test("사람 확정: 제출함 → 안 보냄, 상소 안 함 → 마감 전날만", () => {
  assertEquals(pick(dl("2026-11-25"), "x", "2026-11-23", [], { action: "제출함" }).send, false);
  assertEquals(pick(dl("2026-11-25"), "x", "2026-11-23", [], { action: "상소 안 함" }).send, false);
  assertEquals(pick(dl("2026-11-25"), "x", "2026-11-24", [], { action: "상소 안 함" }).send, true);
});

Deno.test("상소장·수사 서류는 마감 지나면 안 보냄, 이유서만 경과 알림", () => {
  assertEquals(pick(dl("2026-11-18", { kind: "항소" }), "x", "2026-11-20", []).why, "마감 지남");
  assertEquals(pick(dl("2026-11-18", { kind: "항고" }), "x", "2026-11-20", []).send, false);
  assertEquals(pick(dl("2026-11-20", { kind: "항소" }), "x", "2026-11-20", []).send, true);
  assertEquals(pick(dl("2026-11-18"), "x", "2026-11-20", []).send, true);
});

Deno.test("제출·보류·선고 전·도달 전은 안 보냄", () => {
  assertEquals(pick(dl("2026-11-25", { st: "done", doneOn: "2026-11-20" }), "x", "2026-11-23", []).send, false);
  assertEquals(pick(dl("2026-11-25", { st: "done", hold: "공판기일 진행 11.21" }), "x", "2026-11-23", []).why, "공판기일 진행 11.21");
  assertEquals(pick(dl("2026-11-27", { st: "expected" }), "x", "2026-11-20", []).send, false);
  assertEquals(pick(dl(""), "x", "2026-11-20", []).send, false);
});

Deno.test("본문 모양: 경고 있으면 노랑, 카드 버튼 3개", () => {
  const lines = deadlineLines(dl("2026-11-30", { warn: "우리 법인 수신 기록이 없어 의뢰인 수신일로 계산했습니다" }), "2026-11-20");
  assertEquals(lines[0], "🟡 항소이유서 제출기한  2026-11-30(월)  · D-10");
  assertEquals(roomMessage("2026노9003", "김갑동", "이예나", lines).split("\n").slice(0, 3), ["📋 2026노9003 · 김갑동", "담당 이예나변호사", ""]);
  const c = card("2026노9003", "항소", "2026-11-25");
  assertEquals([c.title, c.actions.map((a) => a.data)], ["2026노9003 항소장", ["dl|f|2026노9003|항소|2026-11-25", "dl|n|2026노9003|항소|2026-11-25", "dl|c|2026노9003|항소|2026-11-25"]]);
});

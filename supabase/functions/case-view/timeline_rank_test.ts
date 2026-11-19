import { assertEquals } from "jsr:@std/assert@1";
import { lineTier, rankEvents } from "./timeline_rank.ts";

Deno.test("중요도: 처분 결과만 1, 후속 업무·지시는 3", () => {
  const t = (s: string, g = "hearing") => lineTier({ g, t: s });
  assertEquals(t("사기 송치, 모욕 불송치 확인"), 1);
  assertEquals(t("불송치이유서 정보공개청구"), 3);
  assertEquals(t("지시 · 송치이유서 정보공개청구 지시 (서변호사)"), 3);
  assertEquals(t("불송치 이의신청서 우편 제출 (파주경찰서)", "ours"), 2);
  assertEquals(t("고양지청→광주지검 타관이송", "chat"), 2);
  assertEquals(t("킥스 등록 및 송치이유서 정보공개청구", "chat"), 3);
  assertEquals(t("피의자 조사 일정 확정 (10/28 15:00)"), 3);
  assertEquals(t("피의자 조사 참여 (인천논현경찰서)"), 2);
  assertEquals(t("1심 선고 (무죄)"), 1);
  assertEquals(t("참고자료 우편 제출", "ours"), 3);
  assertEquals(t("구속 피의자 접견 예약", "chat"), 3);
});

Deno.test("같은 날 순서: 선임 → 선임계, 처분 → 지시 → 정보공개", () => {
  const ev = rankEvents([
    { d: "2026-08-20", g: "chat", t: "불송치이유서 정보공개청구" },
    { d: "2026-08-20", g: "chat", t: "지시 · 송치이유서 정보공개청구 지시 (서변호사)" },
    { d: "2026-08-20", g: "hearing", t: "사기 송치, 모욕 불송치 확인" },
    { d: "2026-03-01", g: "ours", t: "선임계 우편 제출" },
    { d: "2026-03-01", g: "accept", t: "사건 선임" },
  ]);
  assertEquals(ev.map((e) => e.t.slice(0, 4)), ["사건 선", "선임계 ", "사기 송", "지시 ·", "불송치이"]);
});

Deno.test("처분 줄이 없으면 통지 수령 줄을 처분으로", () => {
  const ev = rankEvents([{ d: "2026-05-01", g: "chat", t: "무고 피의사건 각하 통지 수령" }]);
  assertEquals(ev[0].w, 1);
  const ev2 = rankEvents([{ d: "2026-05-01", g: "hearing", t: "불송치 결정" }, { d: "2026-05-04", g: "chat", t: "불송치 통지서 수령" }]);
  assertEquals(ev2.map((e) => e.w), [1, 3]);
});

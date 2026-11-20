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

Deno.test("같은 날 순서: 선임 → 선임계, 처분 → 정보공개 (실행된 지시는 숨김)", () => {
  const ev = rankEvents([
    { d: "2026-08-20", g: "chat", t: "불송치이유서 정보공개청구" },
    { d: "2026-08-20", g: "chat", t: "지시 · 송치이유서 정보공개청구 지시 (서변호사)" },
    { d: "2026-08-20", g: "hearing", t: "사기 송치, 모욕 불송치 확인" },
    { d: "2026-03-01", g: "ours", t: "선임계 우편 제출" },
    { d: "2026-03-01", g: "accept", t: "사건 선임" },
  ]);
  assertEquals(ev.map((e) => e.t.slice(0, 4)), ["사건 선", "선임계 ", "사기 송", "불송치이"]);
});

Deno.test("처분 줄이 없으면 통지 수령 줄을 처분으로", () => {
  const ev = rankEvents([{ d: "2026-05-01", g: "chat", t: "무고 피의사건 각하 통지 수령" }]);
  assertEquals(ev[0].w, 1);
  const ev2 = rankEvents([{ d: "2026-05-01", g: "hearing", t: "불송치 결정" }, { d: "2026-05-04", g: "chat", t: "불송치 통지서 수령" }]);
  assertEquals(ev2.map((e) => e.t), ["불송치 결정"]);
});

Deno.test("중복 합치기: 선고·선고기일·선고는 한 줄, 판결등본은 선고 줄로", () => {
  const ev = rankEvents([
    { d: "2026-10-28", g: "hearing", k: "ours", t: "선고" },
    { d: "2026-10-28", g: "hearing", k: "ours", t: "선고기일(제452호 법정 14:00) · 판결선고" },
    { d: "2026-10-28", g: "hearing", src: "chat", t: "1심 선고 (징역2년6월)" },
    { d: "2026-10-28", g: "ours", t: "판결등본", f: { id: 7 } },
    { d: "2026-11-04", g: "meet", t: "16:00 접견 · 서고은 (인천)" },
  ]);
  assertEquals(ev.length, 2);
  assertEquals(ev[0].t, "선고기일(제452호 법정 14:00) · 판결선고 · 징역2년6월");
  assertEquals(ev[0].f?.id, 7);
});

Deno.test("중복 합치기: 같은 날 같은 서류·조사, 끝난 지시, 도착 확인", () => {
  const ev = rankEvents([
    { d: "2026-11-17", g: "ours", src: "chat", t: "선임계 제출" },
    { d: "2026-11-17", g: "ours", src: "chat", t: "변호인선임신고서 우편 제출(인천제물포경찰서)" },
    { d: "2026-11-17", g: "hearing", src: "chat", t: "10:00 고소인 조사 (인천논현경찰서)" },
    { d: "2026-11-17", g: "hearing", src: "chat", t: "인천논현경찰서 고소인 조사" },
    { d: "2026-11-17", g: "chat", src: "chat", t: "지시 · 선임계 제출 지시 (서변호사)" },
    { d: "2026-11-19", g: "chat", src: "chat", t: "선임계 우편 도착 확인" },
    { d: "2026-11-18", g: "hearing", src: "chat", t: "14:43 피의자 조사 참여" },
    { d: "2026-11-18", g: "hearing", src: "chat", t: "16:00 피의자 조사 일정 확정" },
  ]);
  assertEquals(ev.map((e) => e.t), [
    "변호인선임신고서 우편 제출(인천제물포경찰서)", "10:00 고소인 조사 (인천논현경찰서)",
    "14:43 피의자 조사 참여", "16:00 피의자 조사 일정 확정",
  ]);
});

Deno.test("심급 구분: 심급이 다른 같은 날 선임은 합치지 않고, 심급 순서대로 놓는다 (박큰별 2026-11-19)", () => {
  const ev = rankEvents([
    { d: "2026-11-17", t: "접수", g: "court", lv: 2 },
    { d: "2026-06-16", t: "2심 선임", g: "accept", k: "ours", lv: 2 },
    { d: "2026-06-16", t: "사건 선임", g: "accept", k: "ours", lv: 1 },
    { d: "2026-07-20", t: "공판기일", g: "hearing", lv: 1 },
  ]);
  assertEquals(ev.map((e: any) => e.lv + ":" + e.d), ["1:2026-06-16", "1:2026-07-20", "2:2026-06-16", "2:2026-11-17"]);
});

Deno.test("중복 합치기: AI가 제출처를 짐작한 같은 날 제출 줄은 한 줄 (재정신청서)", () => {
  const ev = rankEvents([
    { d: "2026-11-19", k: "due", g: "ours", src: "chat", t: "재정신청서 제출(서울고검 추정 우편 발송)" },
    { d: "2026-11-19", k: "ours", g: "ours", src: "chat", t: "15:10 재정신청서 제출(서울고등법원 추정 불명, 재정신청)" },
    { d: "2026-11-19", k: "due", g: "ours", src: "chat", t: "15:13 재정신청서 제출(인천지방공소청)" },
  ]);
  assertEquals(ev.length, 1);
  assertEquals(ev[0].k, "ours");
  assertEquals(ev[0].t, "15:10 재정신청서 제출(인천지방공소청)");
});

// 2026-11-20 석원 (2026노364): 대화파일에서 뽑은 줄이 법원 기록과 겹쳐 같은 날 두 줄. 법원 전산에 실제로 두 줄이면 그대로
Deno.test("같은 일 겹침 막기: 법원 줄+대화 줄은 하나, 법원 전산의 실제 두 줄은 그대로", () => {
  const ev = [
    { d: "2026-10-08", k: "ours", g: "ours", t: "변론병합신청서 제출", f: null, lp: 1, row: 1, lc: 9 },
    { d: "2026-10-08", k: "ours", g: "ours", t: "변론병합신청서 제출", f: null, src: "chat" },
    { d: "2026-10-27", k: "ours", g: "ours", t: "사실조회신청서 제출", f: null, lp: 2, row: 2, lc: 9 },
    { d: "2026-10-27", k: "ours", g: "ours", t: "사실조회신청서 제출", f: null, src: "chat" },
    { d: "2026-10-27", k: "ours", g: "ours", t: "사실조회신청서 제출", f: null, src: "chat" },
    { d: "2026-10-30", k: "ours", g: "ours", t: "증인신청서 제출", f: null, lp: 3, row: 3, lc: 9 },
    { d: "2026-10-30", k: "ours", g: "ours", t: "증인신청서 제출", f: null, lp: 4, row: 4, lc: 9 },
    { d: "2026-10-31", k: "room", g: "chat", t: "지시 · 사실조회신청 지시 (서변호사)", f: null, src: "chat" },
    { d: "2026-10-31", k: "room", g: "chat", t: "지시 · 사실조회신청 지시 (서변호사)", f: null, src: "chat" },
    { d: "2026-11-02", k: "ours", g: "ours", t: "사실조회신청서 고양경찰서 제출", f: null, src: "chat" },
    { d: "2026-11-02", k: "ours", g: "ours", t: "증인신청서 고양경찰서 제출", f: null, src: "chat" },
  ];
  rankEvents(ev);
  const by = (d: string) => ev.filter((e) => e.d === d).map((e) => e.t);
  assertEquals(by("2026-10-08"), ["변론병합신청서 제출"]);
  assertEquals(ev.find((e) => e.d === "2026-10-08")!.src, undefined);
  assertEquals(by("2026-10-27"), ["사실조회신청서 제출"]);
  assertEquals(by("2026-10-30").length, 2);
  assertEquals(by("2026-10-31").length, 1);
  assertEquals(by("2026-11-02").length, 2);
});

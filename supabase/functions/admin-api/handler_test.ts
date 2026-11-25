// 관리 화면 서버: 나의사건 진행내용 줄 정리 (실제 이름·사건번호 대신 가짜 예시)
import { assertEquals } from "jsr:@std/assert@1";
import { classify, mergeLines, parseDelivery } from "./handler.ts";
import { isMuted } from "../deadline-notify/handler.ts";

Deno.test("진행내용 줄 구분이 로웨어 진행내역과 같다", () => {
  assertEquals(classify("공소장접수"), "접수");
  assertEquals(classify("피고인 홍OO 종국 : 선고"), "접수");
  assertEquals(classify("선고기일(제300호 법정 14:00)"), "기일");
  assertEquals(classify("피고인1 변호인 법무법인 정서 공소장부본 발송"), "송달");
  assertEquals(classify("검사 홍길동 항소장 제출"), "서면");
  assertEquals(classify("피고인1 변호인 법OOOOOO 판결등본"), "서면");
  assertEquals(classify("(피고인 홍OO) 피고인 구속기간갱신결정"), "명령");
});

Deno.test("출석자 줄은 기일 줄의 결과로 합친다", () => {
  const m = mergeLines([
    { d: "2026-10-01", c: "선고기일(제300호 법정 14:00)", r: "" },
    { d: "2026-10-01", c: "- 검사 홍길동 출석", r: "판결선고" },
    { d: "2026-10-01", c: "- 피고인 홍OO 출석", r: "판결선고" },
    { d: "2026.10.08", c: "검사 홍길동 항소장 제출", r: "" },
  ]);
  assertEquals(m.length, 2);
  assertEquals(m[0].r, "판결선고");
  assertEquals(m[1].d, "2026-10-08");
});

Deno.test("송달 결과에서 도달일", () => {
  assertEquals(parseDelivery("2026.10.15 송달됨"), { d: "2026-10-15", status: "송달됨" });
  assertEquals(parseDelivery("2026.10.02 발급").d, null);
});

Deno.test("알림 끄기: 사건 전체 / 기한 하나", () => {
  const mutes = [{ l_code: "2026노1", kind: "", due: null }, { l_code: "2026노2", kind: "항소이유서", due: "2026-12-01" }];
  assertEquals(isMuted(mutes, "2026노1", "상고", "2026-12-09"), true);
  assertEquals(isMuted(mutes, "2026노2", "항소이유서", "2026-12-01"), true);
  assertEquals(isMuted(mutes, "2026노2", "항소이유서", "2026-12-02"), false);
  assertEquals(isMuted(mutes, "2026노3", "항소", "2026-12-01"), false);
});

// 서버 흐름: 관리자 확인과 각 요청이 빈 자료에서도 오류 없이 답하는지 (가짜 DB)
import { handle, resetCache } from "./handler.ts";
function fakeFetch(admin: boolean, calls: string[]): typeof fetch {
  return (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    calls.push((init?.method || "GET") + " " + url.replace(/^https:\/\/x\/rest\/v1\//, ""));
    if (url.includes("users/me")) return new Response(JSON.stringify({ userId: "u1", userName: { lastName: "홍", firstName: "길동" } }));
    if (url.includes("admin_user?select")) return new Response(JSON.stringify(admin ? [{ works_user_id: "u1" }] : []));
    if (url.includes("case_all?select=l_num,l_code,l_client,l_kind")) return new Response(JSON.stringify([{ l_num: 1, l_code: "2026노1", l_client: "홍OO" }]));
    if (url.includes("lw_process_events?select=lp_appoint_date")) return new Response(JSON.stringify([{ lp_appoint_date: "2026-05-20", lp_contents: "공소장접수" }]));
    if (url.includes("works_room_case?select=channel_id&")) return new Response(JSON.stringify([]));
    return new Response(init?.method && init.method !== "GET" ? "" : "[]", { status: init?.method === "POST" && !url.includes("rpc/") ? 201 : 200 });
  }) as typeof fetch;
}
const env = { sbUrl: "https://x", sbKey: "k" };
const call = (body: unknown, f: typeof fetch) => handle(new Request("https://f", { method: "POST", headers: { "x-works-token": "t" }, body: JSON.stringify(body) }), env, f);

Deno.test("관리자가 아니면 403", async () => {
  resetCache();
  const r = await call({ action: "me" }, fakeFetch(false, []));
  assertEquals(r.status, 403);
});

Deno.test("요청마다 빈 자료에서도 답한다", async () => {
  for (const action of ["me", "overview", "search", "case", "due", "fill_list", "rooms", "status", "settings"]) {
    resetCache();
    const r = await call({ action, q: "홍", lNum: 1 }, fakeFetch(true, []));
    assertEquals(r.status, 200, action + " " + (await r.clone().text()));
  }
});

Deno.test("기록 보충: 이미 있는 줄은 빼고 넣는다", async () => {
  resetCache();
  const calls: string[] = [];
  const lines = [{ d: "2026-05-20", c: "공소장접수" }, { d: "2026-10-01", c: "피고인 홍OO 종국 : 선고" }];
  const p = await (await call({ action: "fill_preview", lNum: 1, lines }, fakeFetch(true, calls))).json();
  assertEquals(p.rows.map((r: any) => r.have), [true, false]);
  const s = await (await call({ action: "fill_save", lNum: 1, rows: lines, fileName: "a.pdf" }, fakeFetch(true, calls))).json();
  assertEquals(s.added, 1);
  assertEquals(calls.filter((c) => c.startsWith("POST lw_process_events")).length, 1);
  assertEquals(calls.filter((c) => c.startsWith("POST record_fill")).length, 1);
});

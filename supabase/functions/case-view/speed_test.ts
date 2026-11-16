// 실행: deno test -A supabase/functions/case-view/speed_test.ts
import { clearWhoCache, handle, worksWhoAmI } from "./handler.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const env = { sbUrl: "https://sb.test", sbKey: "k" };
const TOK = "t".repeat(30);

function fake() {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input), m = init?.method || "GET";
    calls.push(m + " " + u);
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.includes("worksapis.com")) return j({ userId: "u1", userName: { lastName: "김", firstName: "직원" } });
    if (u.includes("pc_helper_device")) return j([{ id: 1 }]);
    if (u.endsWith("/rest/v1/pc_locate") && m === "POST") return j([{ id: 7 }]);
    if (u.includes("pc_locate?select")) return j([{ taken_at: "x", done_at: "x", channel_id: "room-1", how: "list" }]);
    if (u.includes("works_room_case?select=l_num,case_no")) return j([{ l_num: 5, case_no: "2026고단1", is_primary: true, status: "대상" }]);
    if (u.includes("case_all?select=*")) return j([{ l_num: 5, l_code: "2026고단1", l_name: "시험", raw: {} }]);
    if (u.includes("/rest/v1/")) return j(m === "GET" ? [] : null);
    return j({});
  }) as typeof fetch;
  return { f, calls };
}
const req = (b: unknown) => new Request("https://x/case-view", { method: "POST", headers: { "x-works-token": TOK }, body: JSON.stringify(b) });

Deno.test("직원 확인은 5분 동안 기억해 웍스에 다시 묻지 않는다", async () => {
  clearWhoCache();
  const { f, calls } = fake();
  const a = await worksWhoAmI(TOK, f), b = await worksWhoAmI(TOK, f);
  assert(a.ok && b.ok && b.userId === "u1", "확인 결과");
  assert(calls.filter((c) => c.includes("worksapis")).length === 1, "웍스는 한 번만");
});

Deno.test("방 찾기(open)는 찾은 방의 사건 자료까지 한 번에 준다", async () => {
  clearWhoCache();
  const { f } = fake();
  const r = await handle(req({ action: "locate", open: 1 }), env, f);
  const j = await r.json();
  assert(j.located?.room === "room-1", "찾은 방 " + JSON.stringify(j).slice(0, 200));
  assert(j.caseNo || j.title || j.events, "사건 자료가 같이 와야 함 " + Object.keys(j).join(","));
});

Deno.test("open 없이 부르면 예전처럼 방만 준다", async () => {
  clearWhoCache();
  const { f } = fake();
  const j = await (await handle(req({ action: "locate" }), env, f)).json();
  assert(j.room === "room-1" && !j.events, "방만");
});

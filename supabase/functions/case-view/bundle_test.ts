// 실행: deno test -A --no-check supabase/functions/case-view/bundle_test.ts
// DB 함수 한 번(case_view_bundle)으로 받은 자료와 예전 방식(PostgREST 여러 번)으로 받은 자료가 같은 화면을 만드는지
import { handle } from "./handler.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const env = { sbUrl: "https://sb.test", sbKey: "k" };
const ROOM = "room-aaaa-1";
const F = {
  maps: [{ l_num: 5, case_no: "2026노100", is_primary: true, status: "대상" }, { l_num: 4, case_no: "2026고단9", is_primary: false, status: "대상" }],
  c: { l_num: 5, l_code: "2026노100", l_name: "홍길동", court: "서울고등법원", state: "진행", raw: { l_accept_date: "2026-08-01" }, is_inv: false },
  rel: [4],
  evs: [{ lp_num: 11, lp_set: "1", lp_appoint_date: "2026-09-01", lp_contents: "사건접수", court: "서울고등법원" },
        { lp_num: 12, lp_set: "2", lp_appoint_date: "2026-10-02", lp_contents: "변호인 법무법인 정서 항소이유서 제출", court: "서울고등법원" }],
  relEvs: [{ l_num: 4, lp_num: 1, lp_set: "1", lp_appoint_date: "2026-05-01", lp_contents: "공소장접수", court: "서울중앙지방법원" },
           { l_num: 4, lp_num: 2, lp_set: "2", lp_appoint_date: "2026-07-20", lp_contents: "판결선고", court: "서울중앙지방법원" }],
  relCases: [{ l_num: 4, l_code: "2026고단9", raw: { l_accept_date: "2026-05-02" } }],
  mine: [{ l_num: 5, l_code: "2026노100", l_name: "홍길동", next_date: "2099-01-01", next_time: "10:00", next_contents: "공판", court: "서울고등법원" }],
  files: [{ id: 7, file_name: "항소이유서.pdf", content_type: "application/pdf", size_bytes: 10, status: "보관", works_user_id: "w1", posted_at: "2026-10-01T01:00:00+00:00", lp_num: null }],
  names: { w1: "김직원" },
  chat: [{ id: 3, kind: "조사", ev_date: "2026-04-01", ev_time: "", summary: "경찰 조사", state: "완료", source: "room" }],
  feed: "2026-11-20T01:00:00+00:00",
  meets: [{ event_id: "e1", ev_date: "2026-06-01", ev_time: "14:00", lawyer: "서고은", place: "서울구치소" }],
  stageLogs: [], titles: [{ room_title: "홍길동 2026노100 (구속)" }], hist: [], noMsgs: [{ sent_at: "2026-04-01T00:00:00+00:00", text: "서울중앙 2026형제1234호" }],
  none: [], dlc: [], matches: [], saved: null, inherited: { l_num: 4, cur_stage: "1심", phone: "010" },
};
function fake() {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = decodeURIComponent(String(input)), m = init?.method || "GET";
    seen.push(m + " " + u.replace(env.sbUrl, ""));
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes("worksapis")) return j({ userId: "u1", userName: { lastName: "김", firstName: "직원" } });
    const t = u.replace(env.sbUrl + "/rest/v1/", "");
    if (t.startsWith("rpc/case_view_bundle")) return j({ ...F, chans: [ROOM], c: F.c, ...((globalThis as any).BREAK || {}) });
    if (t.startsWith("lw_settings")) return j([{ value: "s3" }]);
    if (t.startsWith("works_room_case?select=channel_id&l_num=not.is.null")) return j([{ channel_id: ROOM }]);
    if (t.startsWith("works_room_case?select=l_num,case_no")) return j(F.maps);
    if (t.startsWith("works_room_case?select=channel_id&l_num=eq")) return j([{ channel_id: ROOM }]);
    if (t.startsWith("works_room_case?select=l_num&")) return j([{ l_num: 5 }, { l_num: 4 }]);
    if (t.startsWith("works_room_case?select=room_title")) return j(F.titles);
    if (t.startsWith("case_all?select=*")) return j([F.c]);
    if (t.startsWith("case_all?select=l_num,l_code,raw")) return j(F.relCases);
    if (t.startsWith("lw_process_events?select=lp_num")) return j(F.evs);
    if (t.startsWith("lw_process_events?select=l_num")) return j(F.relEvs);
    if (t.startsWith("cases?")) return j(F.mine);
    if (t.startsWith("case_info?select=*&l_num=eq")) return j([]);
    if (t.startsWith("case_info?select=*&l_num=in")) return j([F.inherited]);
    if (t.startsWith("case_file?")) return j(F.files);
    if (t.startsWith("case_view_log?select")) return j([{ works_user_id: "w1", viewer_name: "김직원" }]);
    if (t.startsWith("room_event?")) return j(F.chat);
    if (t.startsWith("lw_feed_runs")) return j([{ finished_at: F.feed }]);
    if (t.startsWith("meet_event?")) return j(F.meets);
    if (t.startsWith("case_no_hist?")) return j(F.hist);
    if (t.startsWith("room_msg?")) return j(F.noMsgs);
    if (m === "GET") return j([]);
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { f, seen };
}

Deno.test("bundle_check: DB 함수 한 번으로 만든 화면 = 예전 방식으로 만든 화면", async () => {
  const { f, seen } = fake();
  const r = await handle(new Request("https://x/", { method: "POST", headers: { "x-cron-secret": "s3" }, body: JSON.stringify({ action: "bundle_check", name: "김직원" }) }), env, f);
  const j = await r.json();
  assert(j.rooms === 1 && j.same === 1, JSON.stringify(j));
  assert(seen.some((s) => s.includes("rpc/case_view_bundle")), "DB 함수를 불러야 함");
});

Deno.test("bundle_check는 cron 비밀값이 없으면 거절", async () => {
  const { f } = fake();
  const r = await handle(new Request("https://x/", { method: "POST", body: JSON.stringify({ action: "bundle_check" }) }), env, f);
  assert(r.status === 403, "403");
});

Deno.test("자료가 다르면 bundle_check가 차이를 찾아낸다", async () => {
  (globalThis as any).BREAK = { meets: [] };
  try {
    const { f } = fake();
    const j = await (await handle(new Request("https://x/", { method: "POST", headers: { "x-cron-secret": "s3" }, body: JSON.stringify({ action: "bundle_check", name: "김직원" }) }), env, f)).json();
    assert(j.same === 0 && j.details.some((d: any) => d.diff), JSON.stringify(j).slice(0, 300));
  } finally { delete (globalThis as any).BREAK; }
});

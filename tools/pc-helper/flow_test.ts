// 모의 시험: 웍스 콜백 → 기록 → 도우미 대기 함수가 주소를 돌려주는지 (실제 Supabase 없이)
// 실행: deno test --allow-net tools/pc-helper/flow_test.ts
import { handle as callback, hmacBase64 } from "../../supabase/functions/works-bot-callback/handler.ts";
import { handle as wait } from "../../supabase/functions/pc-helper-wait/handler.ts";
import { handle as caseView } from "../../supabase/functions/case-view/handler.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const TOKEN = "a".repeat(48);
async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// 아주 작은 PostgREST 흉내 (이 시험에 필요한 모양만)
async function mockDb() {
  const db: Record<string, any[]> = {
    works_room_case: [
      { channel_id: "room-A", l_num: "L1", case_no: "2026고단1234", is_primary: false },
      { channel_id: "room-A", l_num: "L2", case_no: "2026노1821", is_primary: true, status: "대상" },
      { channel_id: "room-H", l_num: "L9", case_no: "2026고단9", is_primary: true, status: "보류" },
      { channel_id: "room-T", l_num: "L5", case_no: "2026고정100189", is_primary: true, status: "대상", room_title: "(형)홍길동-성폭력-부천지원 2026고정100189" },
      { channel_id: "room-U", l_num: "L6", case_no: "2026고단55", is_primary: true, status: "대상", room_title: "(형)김갑동-사기 2026고단55" },
    ],
    pc_locate: [],
    case_view_log: [],
    pc_helper_device: [{ id: "d1", works_user_id: "u1", token_hash: await sha(TOKEN), revoked_at: null, last_seen_at: null }],
    pc_open_request: [],
  };
  let seq = 0;
  const match = (row: any, q: URLSearchParams) => {
    for (const [k, v] of q) {
      if (["select", "order", "limit"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq" && String(row[k]) !== val) return false;
      if (op === "is" && val === "null" && row[k] != null) return false;
      if (op === "gte" && !(row[k] >= val)) return false;
    }
    return true;
  };
  const srv = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    const u = new URL(req.url); const t = u.pathname.split("/").pop()!;
    const rows = db[t].filter((r) => match(r, u.searchParams));
    if (req.method === "GET") {
      const ord = u.searchParams.get("order") || "";
      rows.sort(ord.startsWith("is_primary") ? (a, b) => Number(b.is_primary) - Number(a.is_primary)
        : (a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return Response.json(rows.slice(0, Number(u.searchParams.get("limit") || 99)));
    }
    const body = await req.json();
    if (req.method === "POST") {
      const row = { id: ++seq, created_at: new Date().toISOString(), delivered_at: null, taken_at: null, done_at: null, ...body };
      db[t].push(row);
      return (req.headers.get("prefer") || "").includes("representation") ? Response.json([row], { status: 201 }) : new Response(null, { status: 201 });
    }
    if (req.method === "PATCH") { rows.forEach((r) => Object.assign(r, body)); return Response.json(rows); }
    return new Response(null, { status: 405 });
  });
  return { db, srv, url: "http://localhost:" + (srv.addr as Deno.NetAddr).port };
}

Deno.test("한 번 클릭 흐름", async () => {
  const { db, srv, url } = await mockDb();
  const env = { sbUrl: url, sbKey: "k", botSecret: "s3cret", waitMs: 3000, stepMs: 100 };
  try {
    const body = JSON.stringify({ type: "postback", data: "room-case", source: { userId: "u1", channelId: "room-A" } });

    // 서명 틀리면 거부, 기록 안 됨
    let r = await callback(new Request("http://x", { method: "POST", body, headers: { "x-works-signature": "bad" } }), env);
    assert(r.status === 401 && db.pc_open_request.length === 0, "잘못된 서명 거부");

    // 토큰 틀리면 거부
    r = await wait(new Request("http://x", { headers: { authorization: "Bearer " + "b".repeat(48) } }), env);
    assert(r.status === 401, "잘못된 토큰 거부");

    // 도우미가 먼저 기다리고 있다가 → 클릭 → 주소 받기
    const waiting = wait(new Request("http://x", { headers: { authorization: "Bearer " + TOKEN } }), env);
    await new Promise((s) => setTimeout(s, 300));
    r = await callback(new Request("http://x", { method: "POST", body, headers: { "x-works-signature": await hmacBase64(body, env.botSecret) } }), env);
    assert(r.status === 200 && db.pc_open_request.length === 1 && db.pc_open_request[0].l_num === "L2", "클릭 기록(주 사건)");
    const got = await waiting;
    const j = await got.json();
    assert(got.status === 200 && decodeURIComponent(j.url).includes("case=2026노1821"), "사건 주소 받음: " + j.url);

    // 한 번 받은 건 다시 안 옴
    const again = await wait(new Request("http://x", { headers: { authorization: "Bearer " + TOKEN } }), { ...env, waitMs: 400 });
    assert(again.status === 204, "두 번 열리지 않음");

    // 짝 없는 방이면 room= 으로
    const b2 = JSON.stringify({ type: "postback", data: "room-case", source: { userId: "u1", channelId: "room-Z" } });
    await callback(new Request("http://x", { method: "POST", body: b2, headers: { "x-works-signature": await hmacBase64(b2, env.botSecret) } }), env);
    const z = await (await wait(new Request("http://x", { headers: { authorization: "Bearer " + TOKEN } }), env)).json();
    assert(z.url.includes("room=room-Z"), "짝 없는 방");
    // 보류 방이면 사건을 붙이지 않음
    const b3 = JSON.stringify({ type: "postback", data: "room-case", source: { userId: "u1", channelId: "room-H" } });
    await callback(new Request("http://x", { method: "POST", body: b3, headers: { "x-works-signature": await hmacBase64(b3, env.botSecret) } }), env);
    const hz = await (await wait(new Request("http://x", { headers: { authorization: "Bearer " + TOKEN } }), env)).json();
    assert(hz.url.includes("hold=1") && !hz.url.includes("case="), "보류 방은 사건 안 붙임: " + hz.url);
    // 운영 봇 시크릿으로 서명해도 통과
    const b4 = JSON.stringify({ type: "postback", data: "room-case", source: { userId: "u1", channelId: "room-A" } });
    const r4 = await callback(new Request("http://x", { method: "POST", body: b4, headers: { "x-works-signature": await hmacBase64(b4, "prodsecret") } }), { ...env, botSecrets: ["prodsecret"] });
    assert(r4.status === 200, "운영 봇 서명 통과");
    await (await wait(new Request("http://x", { headers: { authorization: "Bearer " + TOKEN } }), env)).body?.cancel();
    console.log("열 주소:", decodeURIComponent(j.url));
  } finally { await srv.shutdown(); }
});

Deno.test("PC 방 찾기 흐름 (사건 화면 → 도우미 글자 읽기 → 방)", async () => {
  const { db, srv, url } = await mockDb();
  const env = { sbUrl: url, sbKey: "k", waitMs: 3000, stepMs: 100 };
  // 웍스 직원 확인은 가짜로
  const fetcher: typeof fetch = (input, init) => String(input).startsWith("https://www.worksapis.com/")
    ? Promise.resolve(Response.json({ userId: "u1", userName: { lastName: "김", firstName: "석원" } }))
    : fetch(input, init);
  const ask = () => caseView(new Request("http://x", { method: "POST", headers: { "x-works-token": "t".repeat(30) }, body: JSON.stringify({ action: "locate" }) }), env, fetcher);
  const helperGet = (v = "2") => wait(new Request("http://x/pc-helper-wait?v=" + v, { headers: { authorization: "Bearer " + TOKEN } }), env);
  const helperPost = (b: unknown) => wait(new Request("http://x/pc-helper-wait", { method: "POST", headers: { authorization: "Bearer " + TOKEN }, body: JSON.stringify(b) }), env);
  try {
    // 도우미가 한 번도 안 들렀으면 '도우미 없음'
    let j = await (await ask()).json();
    assert(j.nohelper === true, "도우미 없음: " + JSON.stringify(j));

    // 도우미 v2가 기다리는 중 → 화면이 물음 → 도우미가 읽은 줄 보냄 → 방 찾음
    await (await wait(new Request("http://x?v=2", { headers: { authorization: "Bearer " + TOKEN } }), { ...env, waitMs: 10 })).body?.cancel();
    const helper = (async () => {
      const r = await helperGet();
      const m = await r.json();
      assert(m.task === "ocr" && m.id, "도우미가 일 받음: " + JSON.stringify(m));
      const lines = [
        { x: 9, y: 9, t: "(형)김갑동-사기 2026고단55" }, // 왼쪽 목록 (무시돼야 함)
        { x: 28, y: 7, t: "*` (형)홍길동-성폭력-부천지원 2026고정100189" },
      ];
      const p = await (await helperPost({ id: m.id, lines })).json();
      assert(p.found === true && p.how === "case-no", "서버가 방 찾음: " + JSON.stringify(p));
    })();
    j = await (await ask()).json();
    await helper;
    assert(j.room === "room-T", "사건 화면이 방 받음: " + JSON.stringify(j));

    // 옛 도우미(v 없음)는 방 찾기 일을 안 받고, 화면은 3초 뒤 시간 초과
    const old = helperGet("1");
    j = await (await ask()).json();
    assert(j.timeout === true, "옛 도우미면 시간 초과: " + JSON.stringify(j));
    assert((await old).status === 204, "옛 도우미에겐 일 안 줌");

    // 다른 사람 요청에는 결과를 못 적음
    db.pc_locate.push({ id: 999, works_user_id: "u2", created_at: new Date().toISOString(), taken_at: null, done_at: null });
    assert((await helperPost({ id: 999, lines: [] })).status === 404, "남의 요청 거부");
  } finally { await srv.shutdown(); }
});

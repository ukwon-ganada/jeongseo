// 실행: deno test supabase/functions/works-bot-callback/inv_case_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { courtNosInTitle, parseInvTitle, recheckInv, recheckLinkedRoom, trialRank } from "./inv_case.ts";
import { linkRoom, linkRoomAnyBot } from "./room_link.ts";

Deno.test("방 제목 읽기: 수사단계 방", () => {
  assertEquals(parseInvTitle("●(형/고소)김특별_사기_관악경찰서"),
    { client: "김특별", charge: "사기", role: "고소", agency: "관악경찰서", agencyNo: "" });
  assertEquals(parseInvTitle("서)신)◎(형/피의)박정미 경규범_상해_부평경찰서_2026-6419"),
    { client: "박정미 경규범", charge: "상해", role: "피의", agency: "부평경찰서", agencyNo: "2026-6419" });
  assertEquals(parseInvTitle("%★(형/고소)이경옥_사기(안병근)_부천지청 2025형제28244"),
    { client: "이경옥", charge: "사기(안병근)", role: "고소", agency: "부천지청", agencyNo: "2025형제28244" });
  assertEquals(parseInvTitle("$＃★(형)김종민_보이스피싱_경기남부경찰청")?.agency, "경기남부경찰청");
  assertEquals(parseInvTitle("●(형/고소)김동훈_사기_")?.client, "김동훈");
  assertEquals(parseInvTitle("(민)을지문덕-대여금"), null);
  assertEquals(parseInvTitle(""), null);
});

Deno.test("법원 사건번호만 골라내기", () => {
  assertEquals(courtNosInTitle("(형/고소)박지영_저작권법위반_인천지방검찰청 2026고불항28"), []);
  assertEquals(courtNosInTitle("(형/고소)이경옥_사기_부천지청 2025형제28244"), []);
  assertEquals(courtNosInTitle("(형/피고)홍길동_사기_인천지법 2026고단1234"), ["2026고단1234"]);
});

// 가짜 서버: 웍스 토큰·방 제목·PostgREST(works_room_case·cases·inv_case·rpc)
function fake(db: { rooms: any[]; cases: any[]; inv: any[]; merged: any[] }, title: () => string) {
  const f: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    const m = (init?.method || "GET");
    if (u.host === "auth.worksmobile.com") return Response.json({ access_token: "t", expires_in: 3600 });
    if (u.pathname.includes("/channels/")) return Response.json({ channelId: "c", title: title() });
    const t = u.pathname.split("/rest/v1/")[1];
    if (t === "works_room_case") {
      if (m === "GET") { const ch = u.searchParams.get("channel_id")?.slice(3); return Response.json(db.rooms.filter((r) => r.channel_id === ch)); }
      if (m === "POST") { db.rooms.push(...JSON.parse(String(init!.body))); return new Response(null, { status: 201 }); }
      return new Response(null, { status: 204 });
    }
    if (t === "cases") {
      const codes = u.searchParams.get("l_code")!.slice(4, -1).split(",").map((x) => x.replace(/"/g, ""));
      return Response.json(db.cases.filter((c) => codes.includes(c.l_code)));
    }
    if (t === "inv_case") {
      if (m === "POST") { const r = { l_num: -100001 - db.inv.length, ...JSON.parse(String(init!.body))[0] }; db.inv.push(r); return Response.json([r], { status: 201 }); }
      if (m === "PATCH") (db as any).patches?.push(JSON.parse(String(init!.body)));
      return new Response(null, { status: 204 });
    }
    if (t === "rpc/inv_case_merge") { const b = JSON.parse(String(init!.body)); db.merged.push(b); return Response.json({ ok: true, into: b.p_real }); }
    return new Response("?", { status: 404 });
  };
  return f;
}
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pk = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey)))) + "\n-----END PRIVATE KEY-----";
const ENV = { sbUrl: "http://db", sbKey: "k", clientId: "a", clientSecret: "b", serviceAccount: "s", privateKey: pk };

Deno.test("수사단계 방 초대 → 수사 사건 생성, 제목이 재판번호로 바뀌면 합치기", async () => {
  const db = { rooms: [] as any[], cases: [{ l_num: 3100, l_code: "2026고단555", state: "진행" }], inv: [] as any[], merged: [] as any[] };
  let title = "◎(형/피의)홍길동_사기_부평경찰서_2026-6419";
  const f = fake(db, () => title);
  const r = await linkRoom(ENV, "b", "ch1", f);
  assertEquals(r.how, "inv-created:no-case-no");
  assertEquals(db.inv[0].client_name, "홍길동");
  assertEquals(db.rooms[0].l_num, -100001);
  assertEquals(db.rooms[0].case_no, "수사-100001");
  // 제목 그대로면 아무 일 없음
  assertEquals((await recheckInv(ENV, ["b"], { l_num: -100001, channel_id: "ch1", room_title: title }, f)).how, "same");
  // 재판번호로 바뀌었는데 로웨어에 아직 없음 → 기다림
  title = "◎(형/피고)홍길동_사기_인천지법 2026고단999";
  assertEquals((await recheckInv(ENV, ["b"], { l_num: -100001, channel_id: "ch1" }, f)).how, "wait-lawware");
  // 로웨어에 생김 → 합침
  title = "◎(형/피고)홍길동_사기_인천지법 2026고단555";
  const m = await recheckInv(ENV, ["b"], { l_num: -100001, channel_id: "ch1" }, f);
  assertEquals(m.how, "merged");
  assertEquals(db.merged, [{ p_inv: -100001, p_real: 3100 }]);
});

Deno.test("도우미가 있는 방은 무조건 사건 하나: 민사 방·로웨어에 없는 번호·제목 못 읽은 방", async () => {
  const db = { rooms: [] as any[], cases: [], inv: [] as any[], merged: [] as any[], patches: [] as any[] };
  const r = await linkRoom(ENV, "b", "ch2", fake(db, () => "(민)을지문덕-대여금"));
  assertEquals(r.how, "inv-created:no-case-no");
  assertEquals([db.inv[0].client_name, db.inv[0].charge], ["", "(민)을지문덕-대여금"]);
  const r2 = await linkRoom(ENV, "b", "ch5", fake(db, () => "서)*(형/피고)김태율-사기 등-2026고단7905의 항소심"));
  assertEquals(r2.how, "inv-created:not-in-lawware");
  // 제목을 못 읽어도 빈 제목으로 만들고, 나중에 읽으면 채운다
  let fail = true;
  const base = fake(db, () => "(형/피의)갑돌_사기_관악경찰서");
  const f: typeof fetch = (i, init) => fail && String(i).includes("/channels/") ? Promise.resolve(new Response("no", { status: 403 })) : base(i, init);
  const r3 = await linkRoomAnyBot(ENV, ["b", "c"], "ch6", f);
  assertEquals(r3.linked, 1);
  assertEquals(db.inv[2].room_title, "");
  assertEquals((await linkRoomAnyBot(ENV, ["b"], "ch6", f)).how, "already");
  fail = false;
  await recheckInv(ENV, ["b"], { l_num: db.rooms[2].l_num, channel_id: "ch6", room_title: "" }, f);
  assertEquals(db.patches.at(-1).client_name, "갑돌");
});

Deno.test("로웨어 형제 사건에 연결된 방: 제목에 재판번호가 생기면 그 재판 사건을 주 사건으로", async () => {
  assertEquals([trialRank("2026고단1"), trialRank("2026노2"), trialRank("2026도3"), trialRank("2026형제4"), trialRank("2026-5")], [1, 2, 3, 0, 0]);
  const db = { rooms: [] as any[], cases: [{ l_num: 3072, l_code: "2025형제60934", state: "진행" }, { l_num: 3200, l_code: "2026고단777", state: "진행" }], inv: [] as any[], merged: [] as any[] };
  const rows = [{ channel_id: "ch3", l_num: 3072, case_no: "2025형제60934", is_primary: true, room_title: "(형/피의)김갑동_사기_부천지청 2025형제60934" }];
  let title = rows[0].room_title;
  const f = fake(db, () => title);
  assertEquals((await recheckLinkedRoom(ENV, ["b"], "ch3", rows, f)).how, "same");
  title = "(형/피고)김갑동_사기_부천지원 2026고단777";
  const r: any = await recheckLinkedRoom(ENV, ["b"], "ch3", rows, f);
  assertEquals([r.how, r.to, r.from, r.added], ["moved", 3200, 3072, 1]);
  assertEquals(db.rooms.map((x) => [x.l_num, x.basis]), [[3200, "제목에 새 재판번호"]]);
});

Deno.test("같은 심급 병합 사건은 주 사건을 바꾸지 않는다", async () => {
  const db = { rooms: [] as any[], cases: [{ l_num: 2639, l_code: "2025고단1888", state: "진행" }, { l_num: 2813, l_code: "2026고단101287", state: "진행" }], inv: [] as any[], merged: [] as any[] };
  const title = "(형/피)갑_사기_부천지원 2025고단1888(병합 2026고단101287)";
  const rows = [{ channel_id: "ch4", l_num: 2639, case_no: "2025고단1888", is_primary: true, room_title: title }, { channel_id: "ch4", l_num: 2813, case_no: "2026고단101287", is_primary: false, room_title: title }];
  assertEquals((await recheckLinkedRoom(ENV, ["b"], "ch4", rows, fake(db, () => title))).how, "same");
  const r: any = await recheckLinkedRoom(ENV, ["b"], "ch4", [rows[0]], fake(db, () => title));
  assertEquals([r.how, r.added], ["added", 1]);
  const up: any = await recheckLinkedRoom(ENV, ["b"], "ch4", rows, fake({ ...db, cases: [...db.cases, { l_num: 2900, l_code: "2026노55", state: "진행" }] }, () => title + " 2026노55"));
  assertEquals([up.how, up.to], ["moved", 2900]);
});

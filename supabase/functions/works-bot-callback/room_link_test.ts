// 실행: deno test supabase/functions/works-bot-callback/room_link_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { caseNosInTitle, linkPicked, linkRoom, relinkRoom } from "./room_link.ts";

Deno.test("방 제목에서 사건번호", () => {
  assertEquals(caseNosInTitle("(형)홍길동-사기-서울중앙 2026고단01234, 2025노987"), ["2026고단1234", "2025노987"]);
  assertEquals(caseNosInTitle("(민)을지문덕-대여금"), []);
  assertEquals(caseNosInTitle("010-1234-5678 26가단55"), ["2026가단55"]);
});

// 아주 작은 가짜 서버: 웍스 토큰·방 정보·PostgREST
function fake(db: { rooms: any[]; cases: any[] }, title: string) {
  const calls: string[] = [];
  const f: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    calls.push((init?.method || "GET") + " " + u.pathname);
    if (u.host === "auth.worksmobile.com") return Response.json({ access_token: "t", expires_in: 3600 });
    if (u.pathname.includes("/channels/")) return Response.json({ channelId: "c", title });
    if (u.pathname.endsWith("/works_room_case") && (init?.method || "GET") === "GET") {
      const ch = u.searchParams.get("channel_id")!.slice(3);
      return Response.json(db.rooms.filter((r) => r.channel_id === ch));
    }
    if (u.pathname.endsWith("/works_room_case")) { db.rooms.push(...JSON.parse(String(init!.body))); return new Response(null, { status: 201 }); }
    if (u.pathname.endsWith("/cases")) {
      const inq = u.searchParams.get("l_code"), lq = u.searchParams.get("l_num");
      if (lq) return Response.json(db.cases.filter((c) => String(c.l_num) === lq.slice(3)));
      const codes = inq!.slice(4, -1).split(",").map((x) => x.replace(/"/g, ""));
      return Response.json(db.cases.filter((c) => codes.includes(c.l_code)));
    }
    return new Response("?", { status: 404 });
  };
  return { f, calls };
}
// 시험용 RSA 열쇠
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pk = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey)))) + "\n-----END PRIVATE KEY-----";
const ENV = { sbUrl: "http://db", sbKey: "k", clientId: "a", clientSecret: "b", serviceAccount: "s", privateKey: pk };

Deno.test("새 방: 제목 사건번호로 연결, 여러 사건이면 최근 사건이 주 사건", async () => {
  const db = { rooms: [] as any[], cases: [{ l_num: 10, l_code: "2025고단987", state: "진행" }, { l_num: 20, l_code: "2026노55", state: "진행" }] };
  const { f } = fake(db, "(형)홍길동-사기 2025고단987, 2026노55");
  const r = await linkRoom(ENV, "1", "room-N", f);
  assertEquals([r.linked, r.how], [2, "case-no"]);
  assertEquals(db.rooms.find((x) => x.is_primary).l_num, 20);
  assertEquals(db.rooms.every((x) => x.source === "auto" && x.status === "대상"), true);
  // 다시 불러도 그대로
  assertEquals((await linkRoom(ENV, "1", "room-N", f)).how, "already");
});

// 로웨어에 없거나 번호가 없는 방은 자체 사건을 만든다(inv_case_test.ts)

Deno.test("직원이 고른 사건 기억", async () => {
  const db = { rooms: [] as any[], cases: [{ l_num: 10, l_code: "2025고단987", state: "종결" }] };
  const r = await linkPicked(ENV, ["1"], "r3", 10, fake(db, "어떤 방").f);
  assertEquals([r.linked, db.rooms[0].source, db.rooms[0].status, db.rooms[0].room_title], [1, "picked", "종결", "어떤 방"]);
});

// 연결 바꾸기·풀기용 가짜 DB (방 연결·거절 기록·자체 사건)
function fake2(db: { rooms: any[]; cases: any[]; rejects: any[]; inv: any[]; moved: string[] }, title: string) {
  const f: typeof fetch = async (input, init) => {
    const u = new URL(String(input)), m = init?.method || "GET", p = u.pathname;
    const ch = (u.searchParams.get("channel_id") || "").slice(3);
    if (u.host === "auth.worksmobile.com") return Response.json({ access_token: "t", expires_in: 3600 });
    if (p.includes("/channels/")) return Response.json({ title });
    if (p.endsWith("/works_room_case")) {
      if (m === "GET") return Response.json(db.rooms.filter((r) => r.channel_id === ch));
      if (m === "DELETE") { db.rooms = db.rooms.filter((r) => r.channel_id !== ch); return new Response(null, { status: 204 }); }
      db.rooms.push(...JSON.parse(String(init!.body))); return new Response(null, { status: 201 });
    }
    if (p.endsWith("/room_link_reject")) {
      if (m === "GET") return Response.json(db.rejects.filter((r) => r.channel_id === ch));
      if (m === "DELETE") { const l = Number(u.searchParams.get("l_num")!.slice(3)); db.rejects = db.rejects.filter((r) => !(r.channel_id === ch && r.l_num === l)); return new Response(null, { status: 204 }); }
      db.rejects.push(...JSON.parse(String(init!.body))); return new Response(null, { status: 201 });
    }
    if (p.endsWith("/cases")) {
      const lq = u.searchParams.get("l_num"), inq = u.searchParams.get("l_code");
      if (lq) return Response.json(db.cases.filter((c) => String(c.l_num) === lq.slice(3)));
      const codes = inq!.slice(4, -1).split(",").map((x) => x.replace(/"/g, ""));
      return Response.json(db.cases.filter((c) => codes.includes(c.l_code)));
    }
    if (p.endsWith("/inv_case")) {
      if (m === "GET") return Response.json(db.inv.filter((r) => r.channel_id === ch));
      if (m === "PATCH") return new Response(null, { status: 204 });
      const row = { ...JSON.parse(String(init!.body))[0], l_num: -100000 - db.inv.length - 1 }; db.inv.push(row);
      return Response.json([row], { status: 201 });
    }
    if (p.endsWith("/case_file") || p.endsWith("/room_event")) { db.moved.push(p.split("/").pop() + ":" + JSON.parse(String(init!.body)).l_num); return new Response(null, { status: 204 }); }
    return new Response("?", { status: 404 });
  };
  return f;
}

Deno.test("연결 풀기: 자체 사건으로 남고, 자동 연결이 같은 사건을 다시 붙이지 않는다", async () => {
  const title = "박)신)★(형/고소)김가나_사기_인천 2026고단55";
  const db = { rooms: [{ channel_id: "r", l_num: 10, case_no: "2026고단55", is_primary: true, status: "대상", room_title: title }] as any[],
    cases: [{ l_num: 10, l_code: "2026고단55", state: "진행" }, { l_num: 11, l_code: "2026고단77", state: "진행" }], rejects: [] as any[], inv: [] as any[], moved: [] as string[] };
  const f = fake2(db, title);
  const r = await relinkRoom(ENV, ["1"], "r", null, "석원", f);
  assertEquals(r.how, "unlinked:new");
  assertEquals([db.rooms.length, db.rooms[0].l_num < 0, db.rooms[0].source], [1, true, "inv"]);
  assertEquals(db.rejects.map((x) => [x.l_num, x.rejected_by]), [[10, "석원"]]);
  assertEquals(db.moved, ["case_file:" + db.rooms[0].l_num, "room_event:" + db.rooms[0].l_num]);
  // 같은 방에 새 신호가 와도 다시 붙지 않음(이미 자체 사건이 있음) + 연결 로직에서 거절 사건 제외
  db.rooms = [];
  assertEquals((await linkRoom(ENV, "1", "r", f, title)).how, "inv-created:not-in-lawware");
  // 다른 사건으로 바꾸기: 거절 기록에서 그 사건은 빠지고 직원이 고른 사건이 주 사건
  const r2 = await relinkRoom(ENV, ["1"], "r", 11, "석원", f);
  assertEquals([r2.how, db.rooms.length, db.rooms[0].l_num, db.rooms[0].source], ["relinked", 1, 11, "picked"]);
  // 원래 사건으로 되돌리면 거절 기록도 지운다
  await relinkRoom(ENV, ["1"], "r", 10, "석원", f);
  assertEquals(db.rejects.map((x) => x.l_num), [11]);
});

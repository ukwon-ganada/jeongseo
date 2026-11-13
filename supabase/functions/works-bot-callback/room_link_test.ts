// 실행: deno test supabase/functions/works-bot-callback/room_link_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { caseNosInTitle, linkPicked, linkRoom } from "./room_link.ts";

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

Deno.test("사건번호 없거나 로웨어에 없으면 연결 안 함", async () => {
  const db = { rooms: [] as any[], cases: [{ l_num: 10, l_code: "2025고단987", state: "진행" }] };
  assertEquals((await linkRoom(ENV, "1", "r1", fake(db, "(민)을지문덕-대여금").f)).how, "no-case-no");
  assertEquals((await linkRoom(ENV, "1", "r2", fake(db, "(형)갑-사기 2024고단1").f)).how, "not-in-lawware");
  assertEquals(db.rooms.length, 0);
});

Deno.test("직원이 고른 사건 기억", async () => {
  const db = { rooms: [] as any[], cases: [{ l_num: 10, l_code: "2025고단987", state: "종결" }] };
  const r = await linkPicked(ENV, ["1"], "r3", 10, fake(db, "어떤 방").f);
  assertEquals([r.linked, db.rooms[0].source, db.rooms[0].status, db.rooms[0].room_title], [1, "picked", "종결", "어떤 방"]);
});

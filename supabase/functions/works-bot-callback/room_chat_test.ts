// 실행: deno test supabase/functions/works-bot-callback/room_chat_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { cleanEvents, handleRoomText, looksLikeEvent } from "./room_chat.ts";

Deno.test("일정 낌새 없는 글은 AI에 안 보냄", () => {
  assertEquals(looksLikeEvent("네 알겠습니다"), false);
  assertEquals(looksLikeEvent("다음 주 화요일 14시 논현서 피의자 조사입니다"), true);
  assertEquals(looksLikeEvent("고소장 오늘 접수했습니다"), true);
});

Deno.test("AI 결과 다듬기: 틀린 날짜·전화번호 걸러냄", () => {
  const r = cleanEvents({ events: [
    { kind: "조사", date: "2026-11-17", time: "14:00", summary: "논현서 피의자 조사 010-1234-5678", state: "예정" },
    { kind: "이상한것", date: "2026-11-20", time: null, summary: "고소장 제출", state: "완료" },
    { kind: "조사", date: "11월 17일", time: null, summary: "x", state: "예정" },
  ] });
  assertEquals(r.length, 2);
  assertEquals(r[0].summary, "논현서 피의자 조사");
  assertEquals([r[1].kind, r[1].time, r[1].state], ["기타", null, "완료"]);
});

Deno.test("글 → AI → room_event 저장(원문은 보내지 않음)", async () => {
  const sent: any[] = [];
  const f: typeof fetch = async (input, init) => {
    const u = String(input);
    if (u.includes("api.anthropic.com")) {
      const b = JSON.parse(String(init!.body));
      assertEquals(b.output_config.format.type, "json_schema");
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ events: [{ kind: "조사", date: "2026-11-17", time: "14:00", summary: "논현서 피의자 조사", state: "예정" }] }) }] });
    }
    if (u.includes("/works_room_case")) return Response.json([{ l_num: 3018, room_title: "시험", status: "대상" }]);
    if (u.includes("/room_event")) { sent.push(...JSON.parse(String(init!.body))); return new Response(null, { status: 201 }); }
    return new Response("?", { status: 404 });
  };
  const env = { sbUrl: "http://db", sbKey: "k", anthropicKey: "a" };
  assertEquals((await handleRoomText(env, { channelId: "c1", text: "ㅇㅋ" }, f)).how, "no-cue");
  const r = await handleRoomText(env, { channelId: "c1", text: "다음 주 월요일 14시 논현서 조사 잡혔습니다", sentAt: "2026-11-13T04:00:00Z" }, f);
  assertEquals([r.how, r.saved], ["ai", 1]);
  assertEquals(sent[0], { channel_id: "c1", l_num: 3018, kind: "조사", ev_date: "2026-11-17", ev_time: "14:00", summary: "논현서 피의자 조사", state: "예정", msg_at: "2026-11-13T04:00:00.000Z", source: "chat-ai" });
  assertEquals(Object.values(sent[0]).some((v) => String(v).includes("잡혔습니다")), false);
});

Deno.test("운영 봇: 수사 사건 방(자체 사건)만 AI로 읽음", async () => {
  let lNum = 3018; const calls: any[] = [];
  const f: typeof fetch = async (input, init) => {
    const u = String(input);
    if (u.includes("api.anthropic.com")) {
      calls.push({ body: JSON.parse(String(init!.body)), beta: (init!.headers as any)["anthropic-beta"] });
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ events: [] }) }] });
    }
    if (u.includes("/works_room_case")) return Response.json([{ l_num: lNum, room_title: "시험", status: "대상" }]);
    return new Response(null, { status: 201 });
  };
  const env = { sbUrl: "http://db", sbKey: "k", anthropicKey: "a", model: "claude-sonnet-5-5" };
  const text = "내일 14시 논현서 조사 잡혔습니다";
  assertEquals((await handleRoomText(env, { channelId: "c1", text, invOnly: true }, f)).how, "not-inv");
  assertEquals(calls.length, 0);
  lNum = -100061;
  assertEquals((await handleRoomText(env, { channelId: "c1", text, invOnly: true }, f)).how, "none");
  assertEquals([calls[0].body.model, calls[0].body.fallbacks, calls[0].beta], ["claude-sonnet-5-5", "default", "server-side-fallback-2026-07-01"]);
});

Deno.test("수사 사건방 글은 번호를 지우고 보관, 다른 방은 보관 안 함", async () => {
  let lNum = -100061; const kept: any[] = [];
  const f: typeof fetch = async (input, init) => {
    const u = String(input);
    if (u.includes("/works_room_case")) return Response.json([{ l_num: lNum, room_title: "시험", status: "대상" }]);
    if (u.includes("/room_msg")) { kept.push(...JSON.parse(String(init!.body))); return new Response(null, { status: 201 }); }
    return new Response(null, { status: 201 });
  };
  const env = { sbUrl: "http://db", sbKey: "k", anthropicKey: "a" };
  assertEquals((await handleRoomText(env, { channelId: "c1", text: "네 연락처 010-1234-5678 입니다", userId: "u1", sentAt: "2026-11-13T04:00:00Z" }, f)).how, "no-cue");
  assertEquals(kept, [{ channel_id: "c1", works_user_id: "u1", sent_at: "2026-11-13T04:00:00.000Z", text: "네 연락처 [번호] 입니다" }]);
  lNum = 3018;
  await handleRoomText(env, { channelId: "c1", text: "네 알겠습니다", invOnly: true }, f);
  assertEquals(kept.length, 1);
});

Deno.test("짧은 답글도 앞 글·파일 이름을 함께 AI에 보냄(정상우 사례 2026-11-18)", async () => {
  let prompt = "";
  const f: typeof fetch = async (input, init) => {
    const u = String(input);
    if (u.includes("api.anthropic.com")) { prompt = JSON.parse(String(init!.body)).messages[0].content; return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ events: [] }) }] }); }
    if (u.includes("/works_room_case")) return Response.json([{ l_num: -100086, room_title: "시험", status: "대상" }]);
    if (u.includes("/room_msg?select")) return Response.json([{ sent_at: "2026-11-18T07:55:00Z", text: "우편제출완료하였습니다" }, { sent_at: "2026-11-18T00:35:00Z", text: "선임신고서 우편제출하겠습니다" }]);
    if (u.includes("/case_file?select")) return Response.json([{ file_name: "변호인선임신고서_홍길동.pdf", posted_at: "2026-11-18T00:32:00Z" }]);
    return new Response(null, { status: 201 });
  };
  await handleRoomText({ sbUrl: "http://db", sbKey: "k", anthropicKey: "a" }, { channelId: "c1", text: "우편제출완료하였습니다", sentAt: "2026-11-18T07:55:00Z", invOnly: true }, f);
  assertEquals([prompt.includes("선임신고서 우편제출하겠습니다"), prompt.includes("변호인선임신고서_홍길동.pdf"), prompt.split("우편제출완료하였습니다").length - 1], [true, true, 1]);
});

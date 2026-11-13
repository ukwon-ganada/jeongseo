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

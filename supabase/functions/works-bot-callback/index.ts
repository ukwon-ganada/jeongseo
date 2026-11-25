// 진입점: 설명은 handler.ts 맨 위 참고
import { handle } from "./handler.ts";

Deno.serve((req) =>
    handle(req, {
      sbUrl: Deno.env.get("SUPABASE_URL")!,
      sbKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      botSecret: Deno.env.get("WORKS_BOT_SECRET") || "",
      botSecrets: [Deno.env.get("WORKS_BOT_SECRET_PROD") || ""],
      clientId: Deno.env.get("WORKS_CLIENT_ID"),
      clientSecret: Deno.env.get("WORKS_CLIENT_SECRET"),
      serviceAccount: Deno.env.get("WORKS_SERVICE_ACCOUNT"),
      privateKey: Deno.env.get("WORKS_PRIVATE_KEY"),
      anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
      chatModel: Deno.env.get("ROOM_CHAT_MODEL") || undefined,
      chatBots: (Deno.env.get("ROOM_CHAT_BOTS") || "13580302").split(",").map((s) => s.trim()).filter(Boolean),
      invChatBots: (Deno.env.get("ROOM_CHAT_INV_BOTS") || "12905890").split(",").map((s) => s.trim()).filter(Boolean),
      scheduleBots: (Deno.env.get("SCHEDULE_BOTS") || "13580302").split(",").map((s) => s.trim()).filter(Boolean),
      // 새 기일 먼저 알리기: 방 목록(쉼표, "*"=모든 방)·보내는 봇. 기본은 테스트방·시험봇만
      notifyRooms: (Deno.env.get("HEARING_NOTIFY_ROOMS") || "074adf53-c531-3fc4-5c71-75fab19f22da").split(",").map((s) => s.trim()).filter(Boolean),
      notifyBot: Deno.env.get("HEARING_NOTIFY_BOT") || "13580302",
      invChatModel: Deno.env.get("ROOM_CHAT_INV_MODEL") || undefined,
    })
  );

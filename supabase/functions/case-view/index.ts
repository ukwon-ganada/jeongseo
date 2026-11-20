// 진입점: 설명은 handler.ts 맨 위 참고
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    sbUrl: Deno.env.get("SUPABASE_URL")!,
    sbKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
    chatModel: Deno.env.get("ROOM_CHAT_MODEL") || undefined,
    refreshModel: Deno.env.get("TL_REFRESH_MODEL") || undefined,
    fileModel: Deno.env.get("FILE_MATCH_MODEL") || undefined,
  })
);

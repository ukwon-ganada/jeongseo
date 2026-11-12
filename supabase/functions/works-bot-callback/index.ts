// 진입점: 설명은 handler.ts 맨 위 참고
import { handle } from "./handler.ts";

Deno.serve((req) =>
    handle(req, {
      sbUrl: Deno.env.get("SUPABASE_URL")!,
      sbKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      botSecret: Deno.env.get("WORKS_BOT_SECRET") || "",
    })
  );

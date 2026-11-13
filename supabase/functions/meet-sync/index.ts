// 진입점: 설명은 handler.ts 맨 위 참고
import { handle } from "./handler.ts";

Deno.serve((req) =>
  handle(req, {
    sbUrl: Deno.env.get("SUPABASE_URL")!,
    sbKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    clientId: Deno.env.get("WORKS_CLIENT_ID"),
    clientSecret: Deno.env.get("WORKS_CLIENT_SECRET"),
    serviceAccount: Deno.env.get("WORKS_SERVICE_ACCOUNT"),
    privateKey: Deno.env.get("WORKS_PRIVATE_KEY"),
  })
);

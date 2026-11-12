// 진입점: 설명은 handler.ts 맨 위 참고
import { handle } from "./handler.ts";

Deno.serve((req) => handle(req));

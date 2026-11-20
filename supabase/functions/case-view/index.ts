// 진입점: 설명은 handler.ts 맨 위 참고
// db: 이 서버가 깨어 있는 동안 DB 연결 하나를 붙잡아 두고 사건 자료 묶음(case_view_bundle)을 받는다 (2026-11-20 속도)
//   배포본 index.ts도 이 내용을 그대로 쓰고 handler만 GitHub 커밋 주소로 바꾼다
import postgres from "npm:postgres@3.4.4";
import { handle, type DbLink } from "./handler.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
let sql: ReturnType<typeof postgres> | null = null;
const conn = () => (sql ??= postgres(dbUrl!, { max: 1, prepare: false, idle_timeout: 0, connect_timeout: 5 }));
const db: DbLink | undefined = dbUrl ? {
  async bundle(room, name) {
    const r = await conn()`select public.case_view_bundle(${room}, ${name}) as j`;
    return r[0]?.j ?? null;
  },
  async warm() {
    // 묶음 함수를 한 번 불러 이 연결의 준비(표 정보·계획)를 해 둔다
    await conn()`select public.case_view_bundle((select channel_id from public.works_room_case where l_num is not null order by updated_at desc limit 1), '') is not null as ok`;
  },
} : undefined;

Deno.serve((req) =>
  handle(req, {
    sbUrl: Deno.env.get("SUPABASE_URL")!,
    sbKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
    chatModel: Deno.env.get("ROOM_CHAT_MODEL") || undefined,
    refreshModel: Deno.env.get("TL_REFRESH_MODEL") || undefined,
    fileModel: Deno.env.get("FILE_MATCH_MODEL") || undefined,
    db,
  })
);

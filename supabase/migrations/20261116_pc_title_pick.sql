-- PC 방 찾기: 방 목록에 없는 방에서 직원이 한 번 고른 사건을 "읽은 방 제목"과 함께 기억 (석원 2026-11-16)
-- 다음부터 같은 제목을 읽으면 바로 그 사건을 연다. 서버(서비스 키)만 읽고 쓴다.
create table if not exists public.pc_title_pick (
  id bigserial primary key,
  header_norm text not null unique,     -- 읽은 제목에서 글자·숫자만 남긴 것 (비교용)
  header_text text,                     -- 읽은 제목 그대로 (확인용)
  l_num bigint not null,                -- 고른 로웨어 사건
  case_no text,
  picked_by text,                       -- 고른 직원 이름
  works_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pc_title_pick enable row level security;

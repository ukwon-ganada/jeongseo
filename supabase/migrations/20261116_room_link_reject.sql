-- 직원이 "이 방은 이 사건이 아니다"라고 연결을 풀거나 바꾼 기록.
-- 자동 연결(방 제목 사건번호, 하루 4번 점검)이 같은 사건을 다시 붙이지 않게 한다.
create table if not exists public.room_link_reject (
  channel_id text not null,
  l_num bigint not null,
  rejected_by text,
  created_at timestamptz not null default now(),
  primary key (channel_id, l_num)
);
alter table public.room_link_reject enable row level security;

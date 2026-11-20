-- 변호사 지시 모음 (2026-11-20 석원 요청, "지시" 탭)
-- 서고은·강현구·이예나·박종덕 변호사가 사건방에 쓴 글 중 직원에게 일을 시키는 지시만 AI가 골라
-- 앞 글 맥락으로 풀어 적어 둔다. 직원이 끝냈다고 쓰면 끝난 지시로 옮긴다. 서버 함수(서비스 키)만 읽고 쓴다.
create table if not exists public.room_order (
  id bigint generated always as identity primary key,
  channel_id text not null,
  l_num bigint,
  lawyer text not null,              -- 지시한 변호사 이름
  lawyer_user_id text,
  msg_at timestamptz not null,       -- 지시 글을 보낸 때
  text text not null,                -- AI가 정돈한 지시
  assignee text not null default '', -- 지목된 사람(없으면 빈칸)
  state text not null default '남음' check (state in ('남음', '끝남')),
  note text not null default '',     -- 진행·끝난 내용 한 줄
  done_at timestamptz,
  orig text not null default '',     -- 변호사 원문(번호 지움, 지시를 이룬 글만)
  hidden boolean not null default false,
  source text not null default 'ai', -- ai | manual
  edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists room_order_channel on public.room_order (channel_id, msg_at desc);
create index if not exists room_order_lnum on public.room_order (l_num);
alter table public.room_order enable row level security;
revoke all on public.room_order from anon, authenticated;

-- 웍스 구성원 이름 캐시(글쓴이가 지시 대상 변호사인지 알아보려고)
create table if not exists public.works_user_name (
  user_id text primary key,
  name text not null default '',
  fetched_at timestamptz not null default now()
);
alter table public.works_user_name enable row level security;
revoke all on public.works_user_name from anon, authenticated;

-- 대화 보관: 수사 방은 그대로 30일, 그 밖의 사건방 글은 지시 맥락용으로 3일만 (2026-11-20 석원 결정)
alter table public.room_msg add column if not exists ctx_only boolean not null default false;
select cron.schedule('room-msg-expire-ctx', '10 * * * *', $$delete from public.room_msg where ctx_only and sent_at < now() - interval '3 days'$$);

-- 지시 대상 변호사(이름, 쉼표로). 바꾸려면 이 값만 고치면 된다.
insert into public.lw_settings (key, value) values ('order_lawyers', '서고은,강현구,이예나,박종덕')
  on conflict (key) do nothing;

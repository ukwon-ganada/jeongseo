-- 새 기일·바뀐 기일 먼저 알리기 기록 (2026-11-25, works-bot-callback hearing_notify.ts)
--   status: sent(방에 알림) · in_calendar(캘린더에 이미 있어 안 알림) · no_room(사건방 없음)
create table if not exists public.hearing_notice (
  id bigserial primary key,
  lp_num bigint not null,
  l_num bigint,
  channel_id text,
  ev_date date not null,
  ev_time text not null default '',
  contents text,
  status text not null,
  summary text,
  was text,
  created_at timestamptz not null default now(),
  unique (lp_num, ev_date, ev_time)
);
create index if not exists hearing_notice_channel on public.hearing_notice (channel_id, created_at desc);
alter table public.hearing_notice enable row level security;

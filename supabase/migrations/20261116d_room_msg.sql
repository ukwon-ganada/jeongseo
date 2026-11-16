-- 수사 사건방 글 보관 (2026-11-16 석원 결정: 타임라인 [갱신] 때 다시 읽도록 기간을 정해 원문 보관)
-- 전화번호·주민번호는 지운 뒤 저장. 서버 함수(서비스 키)만 읽고 쓴다. 30일 지난 글은 매일 지운다.
create table if not exists public.room_msg (
  id bigint generated always as identity primary key,
  channel_id text not null,
  works_user_id text,
  sent_at timestamptz not null,
  text text not null,
  text_hash text generated always as (md5(text)) stored,
  created_at timestamptz not null default now(),
  unique (channel_id, sent_at, text_hash)
);
create index if not exists room_msg_channel_sent on public.room_msg (channel_id, sent_at);
alter table public.room_msg enable row level security;
revoke all on public.room_msg from anon, authenticated;

select cron.schedule('room-msg-expire', '40 18 * * *', $$delete from public.room_msg where sent_at < now() - interval '30 days'$$);

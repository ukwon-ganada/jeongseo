-- "/일정"이 최근 사진(나의사건 캡처 등)을 읽을 수 있게, 사건방에 올라온 사진의 웍스 파일 번호만 기록 (2026-11-25)
-- 사진 자체는 보관하지 않는다. 7일 지난 줄은 도우미가 지운다.
create table if not exists public.room_image (
  id bigserial primary key,
  bot_id text not null,
  channel_id text not null,
  file_id text not null unique,
  works_user_id text,
  created_at timestamptz not null default now()
);
create index if not exists room_image_channel_at on public.room_image (channel_id, created_at desc);
alter table public.room_image enable row level security;
-- 정책 없음: 서버(서비스 키)만 읽고 씀

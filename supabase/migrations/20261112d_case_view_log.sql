-- 사건 화면(case-view) 열람 기록: 누가·언제·어느 방/사건을 열었는지
-- (2026-11-12 법인 Supabase 에 이미 만들어 둠. 기록 보관용 파일)
create table if not exists public.case_view_log (
  id            bigserial primary key,
  works_user_id text not null,
  viewer_name   text,
  action        text not null,      -- case / case:hold / case:unpaired …
  channel_id    text,
  l_num         bigint,
  case_no       text,
  viewed_at     timestamptz not null default now()
);
create index if not exists case_view_log_viewed on public.case_view_log (viewed_at desc);
alter table public.case_view_log enable row level security;

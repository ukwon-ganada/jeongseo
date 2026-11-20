-- 방에 올라온 서면 파일을 어느 타임라인 줄에 붙일지 AI가 고른 결과 (2026-11-18 석원 결정)
-- line_key 가 비어 있으면 "안 붙음"(이유는 reason). sig 는 그때 본 줄 목록의 지문: 바뀌면 다시 묻는다.
create table if not exists public.case_file_match (
  file_id    bigint primary key references public.case_file(id) on delete cascade,
  line_key   text,
  sig        text not null,
  reason     text,
  model      text,
  decided_at timestamptz not null default now()
);
alter table public.case_file_match enable row level security;

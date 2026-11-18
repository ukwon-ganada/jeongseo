-- 타임라인 제출 줄에서 직원이 [빼기]로 파일을 뗀 줄 (그 줄엔 자동으로 다시 붙이지 않음)
create table if not exists public.case_file_none (
  lp_num   bigint primary key,
  l_num    text,
  pick_by  text,
  pick_at  timestamptz not null default now()
);
alter table public.case_file_none enable row level security;

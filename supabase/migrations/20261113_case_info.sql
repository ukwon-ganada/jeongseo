-- 사건 정보(우리가 직접 입력·수정하는 칸). 로웨어와 연동하지 않는다(자동으로 덮어쓰지 않음).
create table if not exists public.case_info (
  l_num          bigint primary key,
  case_no        text,
  case_name      text,
  client_name    text,
  client_phone   text,
  lawyer         text,     -- 담당변호사 한 명
  court_dept     text,     -- 법원·재판부
  court_phone    text,
  investigator   text,     -- 수사기관·담당 수사관
  investigator_phone text,
  memo           text,
  updated_by     text,
  updated_by_id  text,
  updated_at     timestamptz not null default now()
);
alter table public.case_info enable row level security;

-- 수정 기록: 누가 언제 어떤 칸을 무엇에서 무엇으로
create table if not exists public.case_info_log (
  id          bigserial primary key,
  l_num       bigint not null,
  field       text not null,
  old_value   text,
  new_value   text,
  editor      text,
  editor_id   text,
  edited_at   timestamptz not null default now()
);
create index if not exists case_info_log_lnum on public.case_info_log (l_num, edited_at desc);
alter table public.case_info_log enable row level security;

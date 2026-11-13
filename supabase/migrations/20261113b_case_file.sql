-- ============================================================================
--  법무법인 정서 — 사건방에 올린 서면 파일 모으기
--
--  흐름:
--    직원이 웍스 사건방에 PDF 등 파일을 올림
--      → 봇 콜백(works-bot-callback)이 "파일 왔음" 신호를 받음 (글 내용은 받지 않음)
--      → 바로 웍스에서 파일을 내려받아 비공개 저장소 case-files 에 보관, 이 표에 기록
--      → 사건 화면(case-view) 진행내용 탭에서 직원 확인된 사람만 [열기]
--
--  표·저장소 모두 서버 함수(service role)만 씀. 익명·직원 직접 접근은 막음(정책 없음).
--  적용: SQL Editor에 전체 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================

-- 1) 비공개 저장소 (공개 주소 없음. 열 때마다 서버가 5분짜리 열람 주소를 만들어 줌)
insert into storage.buckets (id, name, public, file_size_limit)
values ('case-files', 'case-files', false, 52428800)   -- 한 파일 최대 50MB
on conflict (id) do update set public = false;

-- 2) 받은 파일 기록
create table if not exists public.case_file (
  id            bigserial primary key,
  file_id       text not null unique,          -- 웍스 파일 번호 (하루쯤만 유효 → 받자마자 내려받음)
  bot_id        text,
  channel_id    text not null,                 -- 올라온 사건방
  l_num         text,                          -- 그때 방에 붙어 있던 주 사건 (보류·미연결 방이면 비움)
  case_no       text,
  works_user_id text,                          -- 올린 직원 (웍스 사용자 ID)
  file_name     text,                          -- 원래 파일 이름
  content_type  text,
  size_bytes    bigint,
  storage_path  text,                          -- case-files 안의 위치
  status        text not null default '받는중' check (status in ('받는중','보관','실패','숨김')),
  error         text,
  posted_at     timestamptz not null default now(),
  saved_at      timestamptz
);
create index if not exists case_file_lnum on public.case_file (l_num, posted_at desc);
create index if not exists case_file_channel on public.case_file (channel_id, posted_at desc);
alter table public.case_file enable row level security;

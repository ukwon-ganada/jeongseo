-- ============================================================================
--  법무법인 정서 — 사건방 대화에서 AI가 뽑은 일정 (수사 단계 타임라인)
--
--  works-bot-callback 이 사건방 글을 받으면 AI가 고소장 제출·조사·송치 같은 일정만 골라 여기에 넣는다.
--  대화 원문은 저장하지 않는다(요약 한 줄만). 사건 화면(case-view)이 타임라인·기일에 보여 준다.
--  서버 함수(service role)만 씀. 적용: SQL Editor에 전체 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================
create table if not exists public.room_event (
  id          bigserial primary key,
  channel_id  text not null,               -- 웍스 사건방
  l_num       bigint,                      -- 그때 방에 연결된 사건(보류·미연결 방이면 비움)
  kind        text not null,               -- 사건접수/고소장제출/조사/출석요구/송치/처분/기소/기일/서면제출/기타
  ev_date     date not null,
  ev_time     text not null default '',    -- 'HH:MM' 또는 ''(시각 모름)
  summary     text not null,               -- 한 줄 요약(이름·전화번호 없이)
  state       text not null default '예정', -- 예정/완료
  msg_at      timestamptz,                 -- 그 글이 올라온 시각
  source      text not null default 'chat-ai',
  hidden      boolean not null default false, -- 틀린 줄 숨기기
  created_at  timestamptz not null default now(),
  unique (channel_id, kind, ev_date, ev_time)
);
create index if not exists room_event_ch on public.room_event (channel_id, ev_date);
create index if not exists room_event_lnum on public.room_event (l_num, ev_date) where l_num is not null;
alter table public.room_event enable row level security;

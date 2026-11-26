-- 기일별 우리 출석 여부 (2026-11-26 석원 결정, 김우석 2026고단1492)
-- 공범이 많은 사건은 기일이 여러 개 잡히고 피고인마다 출석하는 기일이 다르다. 전자기록에는 나오지 않는다.
--   · 줄이 없는 기일은 출석으로 본다(지금처럼 가장 빠른 기일이 우리 기일).
--   · attend=false 인 기일은 사건 화면에서 흐리게, [문자]·[일정]·빠진 기일 알림에서 빠진다.
--   · attend=true 인 줄은 로웨어에 아직 없는 기일(방 글로 안 선고기일 등)을 우리 기일로 보여 줄 때 시각·종류·법정을 함께 둔다.
--   · source: '직원'(사건 화면 [수정]) / '방 글'(도우미가 방 글을 읽어 미리 채움). 직원이 정한 줄은 방 글이 덮어쓰지 않는다.
create table if not exists public.hearing_attend (
  l_num bigint not null,
  hdate date not null,
  attend boolean not null,
  htime text,
  kind text,
  place text,
  source text not null default '직원',
  note text,
  by_name text,
  channel_id text,
  updated_at timestamptz not null default now(),
  primary key (l_num, hdate)
);
alter table public.hearing_attend enable row level security;
revoke all on public.hearing_attend from anon, authenticated;
grant all on public.hearing_attend to service_role;

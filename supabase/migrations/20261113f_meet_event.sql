-- ============================================================================
--  법무법인 정서 — 접견 일정 (웍스 캘린더 → 사건 타임라인)
--
--  meet-sync 함수가 변호사 각자 캘린더의 "접견_이름(장소)" 일정을 읽어 의뢰인 이름으로 사건을 맞춰 넣는다.
--  일정 제목 원문·의뢰인 이름은 저장하지 않는다(사건·날짜·시각·변호사·장소만).
--  적용: SQL Editor에 전체 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================
create table if not exists public.meet_event (
  id        bigserial primary key,
  event_id  text not null,              -- 웍스 일정 ID
  l_num     bigint not null,            -- 맞춘 사건
  lawyer    text not null default '',   -- 일정 주인(캘린더 이름)
  ev_date   date not null,
  ev_time   text not null default '',   -- 'HH:MM' 또는 ''(종일)
  place     text not null default '',   -- 제목 끝 괄호(인천·수원·화상 등)
  seen_at   timestamptz not null default now(),
  unique (event_id, l_num)
);
create index if not exists meet_event_lnum on public.meet_event (l_num, ev_date);
create index if not exists meet_event_date on public.meet_event (ev_date);
alter table public.meet_event enable row level security;

-- 손으로 부르기: select meet_call('{"dryRun":true}');  → 결과는 net._http_response 에서 확인
create or replace function public.meet_call(body jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://nyjyemjsperpakrrgzcc.supabase.co/functions/v1/meet-sync',
    headers := jsonb_build_object('content-type','application/json',
                 'x-cron-secret', (select value from public.lw_settings where key='cron_secret')),
    body := body,
    timeout_milliseconds := 120000
  );
$$;
revoke all on function public.meet_call(jsonb) from public, anon, authenticated;

-- 시험(dryRun)이 잘 되면 아래 한 줄로 하루 세 번(한국 08:10, 12:10, 17:10) 돌린다. 지금은 주석.
-- select cron.schedule('meet-sync', '10 23,3,8 * * *', $$select public.meet_call('{}'::jsonb)$$);

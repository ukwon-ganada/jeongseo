-- 사건 화면 여는 속도(2026-11-20, 스레드 "사건 화면 여는 속도 줄이기")
-- 1) 직원 확인 기억: 새로 깨어난 서버도 웍스(users/me)에 다시 묻지 않게. 토큰 원문은 저장하지 않고 SHA-256 해시만
create table if not exists public.works_who_cache (
  token_hash text primary key,
  user_id text not null,
  domain_id text,
  name text,
  until timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.works_who_cache enable row level security;  -- 정책 없음 = 서비스 키(case-view)만

-- 2) case-view 깨워 두기: 75초 쉬면 꺼지므로 근무 시간(KST 7시~23시 59분)에 1분마다 부른다
create or replace function public.case_view_warm()
returns bigint language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := 'https://nyjyemjsperpakrrgzcc.supabase.co/functions/v1/case-view',
    headers := jsonb_build_object('content-type', 'application/json'),
    body := '{"action":"warm"}'::jsonb,
    timeout_milliseconds := 10000
  );
$$;

-- 3) AI 파일 판단 미리 하기: 최근 3시간 안에 파일이 올라온 방만, 근무 시간 15분마다
create or replace function public.case_file_prefetch()
returns bigint language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := 'https://nyjyemjsperpakrrgzcc.supabase.co/functions/v1/case-view',
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-cron-secret', (select value from public.lw_settings where key = 'cron_secret')),
    body := '{"action":"file_backfill","sinceHours":3}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;

select cron.unschedule(jobname) from cron.job where jobname in ('case-view-warm', 'case-file-prefetch', 'who-cache-expire');
select cron.schedule('case-view-warm', '* 22-23,0-14 * * *', 'select public.case_view_warm()');
select cron.schedule('case-file-prefetch', '7,22,37,52 22-23,0-11 * * *', 'select public.case_file_prefetch()');
select cron.schedule('who-cache-expire', '45 18 * * *', 'delete from public.works_who_cache where until < now()');

-- 오류 알림 (2026-11-20): 실패해도 아무도 모르던 문제 보완
-- 15분마다 ops_health_check()가 최근 문제를 모아, 있으면 works-bot-callback(action=alert)으로 웍스 한 줄 알림.
-- 같은 문제는 3시간에 한 번만 알린다. 받는 곳: lw_settings.alert_to = {"userId": "..."} 또는 {"channelId": "..."}

-- 서버 함수가 뒤에서 조용히 실패한 일(파일 보관·AI 일정 뽑기 등) 기록
create table if not exists public.ops_error (
  id bigserial primary key,
  at timestamptz not null default now(),
  fn text not null,
  what text not null,
  msg text not null default ''
);
create index if not exists ops_error_at on public.ops_error (at desc);
alter table public.ops_error enable row level security;
revoke all on public.ops_error from anon, authenticated;

create table if not exists public.ops_alert_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table public.ops_alert_sent enable row level security;
revoke all on public.ops_alert_sent from anon, authenticated;

create or replace function public.ops_health_check(p_dry boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  win interval := interval '20 minutes';
  issues jsonb := '[]'::jsonb;
  fresh jsonb := '[]'::jsonb;
  r record;
  msg text;
  kst_hour int := extract(hour from now() at time zone 'Asia/Seoul');
begin
  -- 1) 예약 작업 실패
  for r in
    select j.jobname, count(*) n, left(max(d.return_message), 80) m
    from cron.job_run_details d join cron.job j using (jobid)
    where d.start_time > now() - win and d.status = 'failed' and j.jobname <> 'ops-health'
    group by j.jobname
  loop
    issues := issues || jsonb_build_object('key', 'cron:' || r.jobname, 'line', '예약 작업 ' || r.jobname || ' 실패 ' || r.n || '회: ' || coalesce(r.m, ''));
  end loop;

  -- 2) 예약 작업이 부른 서버 함수가 5xx·시간 초과(또는 401·403이 3번 이상)
  select count(*) filter (where status_code >= 500 or status_code is null or timed_out) as bad,
         count(*) filter (where status_code in (401, 403)) as denied,
         left(max(coalesce(error_msg, status_code::text)) filter (where status_code >= 500 or status_code is null or timed_out), 80) as m
    into r
    from net._http_response where created > now() - win;
  if r.bad > 0 then
    issues := issues || jsonb_build_object('key', 'net:5xx', 'line', '서버 함수 호출 실패 ' || r.bad || '건 (' || coalesce(r.m, '') || ')');
  end if;
  if r.denied >= 3 then
    issues := issues || jsonb_build_object('key', 'net:auth', 'line', '서버 함수가 권한 거절(401·403) ' || r.denied || '건 — 비밀값이 바뀌었는지 확인 필요');
  end if;

  -- 3) 로웨어 사건정보 받기: 오류, 또는 근무 시간(8~20시)에 50분 넘게 성공이 없음
  for r in select left(error, 80) e, count(*) n from lw_feed_runs where started_at > now() - win and error is not null group by 1 loop
    issues := issues || jsonb_build_object('key', 'feed:error', 'line', '로웨어 사건정보 받기 오류 ' || r.n || '회: ' || r.e);
  end loop;
  if kst_hour between 8 and 20
     and coalesce((select max(finished_at) from lw_feed_runs where error is null), 'epoch') < now() - interval '50 minutes' then
    issues := issues || jsonb_build_object('key', 'feed:stale', 'line', '로웨어 사건정보를 50분 넘게 못 받고 있음');
  end if;

  -- 4) 서버 함수가 뒤에서 조용히 실패한 일
  for r in select fn, what, count(*) n, left(max(msg), 100) m from ops_error where at > now() - win group by fn, what loop
    issues := issues || jsonb_build_object('key', 'fn:' || r.fn || ':' || r.what, 'line', r.what || ' 실패 ' || r.n || '건: ' || r.m);
  end loop;

  -- 같은 문제는 3시간에 한 번만
  select coalesce(jsonb_agg(i), '[]'::jsonb) into fresh
    from jsonb_array_elements(issues) i
   where not exists (select 1 from ops_alert_sent s where s.key = i->>'key' and s.sent_at > now() - interval '3 hours');

  if p_dry or jsonb_array_length(fresh) = 0 then
    return jsonb_build_object('issues', issues, 'fresh', fresh, 'sent', false);
  end if;

  msg := '⚠️ 사건관리 도우미 오류 알림' || chr(10) ||
         (select string_agg('· ' || (i->>'line'), chr(10)) from jsonb_array_elements(fresh) i);
  perform net.http_post(
    url := 'https://nyjyemjsperpakrrgzcc.supabase.co/functions/v1/works-bot-callback',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from lw_settings where key = 'cron_secret')),
    body := jsonb_build_object('action', 'alert', 'text', msg),
    timeout_milliseconds := 30000);
  insert into ops_alert_sent (key, sent_at)
    select i->>'key', now() from jsonb_array_elements(fresh) i
    on conflict (key) do update set sent_at = excluded.sent_at;
  delete from ops_error where at < now() - interval '30 days';
  return jsonb_build_object('issues', issues, 'fresh', fresh, 'sent', true);
end;
$$;
revoke execute on function public.ops_health_check(boolean) from public, anon, authenticated;

-- 15분마다 (KST 7~22시)
select cron.schedule('ops-health', '3,18,33,48 22-23,0-13 * * *', $$select public.ops_health_check()$$);

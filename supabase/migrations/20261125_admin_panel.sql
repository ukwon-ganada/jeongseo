-- 관리 화면(woff/admin.html + Edge Function admin-api) — 2026-11-25 석원 "내 PC에서 설정할 수 있는 프로그램"
-- 표는 모두 서버(service_role)만 읽고 쓴다. anon·authenticated 정책 없음.

-- 1) 관리자: 웍스 계정으로 확인된 사람 중 여기 있는 사람만 관리 화면을 쓴다
create table if not exists public.admin_user (
  works_user_id text primary key,
  name text,
  added_at timestamptz not null default now()
);
alter table public.admin_user enable row level security;
insert into public.admin_user(works_user_id, name) values ('858e98d2-a6cc-4150-1493-03d454a86b2d', '서석원')
on conflict do nothing;

-- 2) 기한 알림 끄기: kind = '' 이면 사건 전체, 아니면 그 기한 하나(종류 + 만료일)
create table if not exists public.deadline_mute (
  id bigserial primary key,
  l_code text not null,
  kind text not null default '',
  due date,
  by_user text,
  by_name text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by text
);
create index if not exists deadline_mute_live on public.deadline_mute(l_code) where undone_at is null;
alter table public.deadline_mute enable row level security;

-- 3) 기록 보충: 나의사건 진행내용(PDF)에서 빠진 줄을 lw_process_events에 넣은 기록 (되돌리기용)
--    넣은 줄은 lp_num이 음수(로웨어 번호와 겹치지 않음), lp_work_type = '보충'
create table if not exists public.record_fill (
  id bigserial primary key,
  l_num bigint not null,
  l_code text,
  file_name text,
  lp_nums bigint[] not null default '{}',
  by_user text,
  by_name text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by text
);
alter table public.record_fill enable row level security;
create sequence if not exists public.record_fill_lp_seq start 1;

-- 4) 앞 심급 줄이 빠진 상소심 사건 찾기
--    노: 앞 심급 줄이 남아 있는데(처음부터 항소심만 맡은 사건은 제외) 1심 선고가 없거나, 선고는 있는데 항소장 줄이 없음
--    도: 항소심 선고가 없거나, 상고장 줄이 없음
create or replace function public.admin_fill_needed()
returns table(l_num bigint, l_code text, l_client text, charge_lawyer text, lower_code text, kind text, stage_start date)
language sql stable security definer set search_path = public as $$
  with c as (
    select c.l_num, c.l_code, c.l_client, c.charge_lawyer
    from case_all c
    where c.l_code ~ '^20\d\d(노|도)\d' and c.l_kind like '%형사%' and coalesce(c.state,'') <> '종결'
  ), a as (
    select c.*,
      case when c.l_code ~ '노' then
        least((select min(e.lp_appoint_date) from lw_process_events e where e.l_num = c.l_num and e.lp_set = '접수' and e.lp_contents = '사건접수'),
              (select min(e.lp_appoint_date) from lw_process_events e where e.l_num = c.l_num and e.lp_set = '송달' and e.lp_contents like '%소송기록접수통지%'))
      else (select max(e.lp_appoint_date) from lw_process_events e where e.l_num = c.l_num and e.lp_set = '송달' and e.lp_contents like '%소송기록접수통지%') end as st
    from c
  ), b as (
    select a.*,
      (select count(*) from lw_process_events e where e.l_num = a.l_num and e.lp_appoint_date < a.st - 20 and e.lp_set in ('기일','송달','서면','명령')) as pre,
      (select count(*) from lw_process_events e where e.l_num = a.l_num and e.lp_appoint_date < a.st
         and ((e.lp_set = '기일' and e.lp_contents like '%선고%' and e.lp_remark like '%선고%') or (e.lp_set = '접수' and e.lp_contents ~ '종국\s*:\s*선고'))) as sun,
      (select count(*) from lw_process_events e where e.l_num = a.l_num and e.lp_appoint_date < a.st and e.lp_set = '서면' and e.lp_contents ~ '(항소장|상고장)\s*제출') as app,
      (select string_agg(e.lp_contents, ',' order by e.lp_appoint_date) from lw_process_events e where e.l_num = a.l_num and e.lp_set = '변경') as chg
    from a where a.st is not null
  )
  select b.l_num, b.l_code, b.l_client, b.charge_lawyer,
    -- 앞 심급 번호: '2026고합100177→2026노100191' 같은 번호 변경 줄 중 가장 늦은, 앞 심급 모양(노 → 고○, 도 → 노)의 번호
    (select (regexp_match(x, case when b.l_code ~ '노' then '^(\d{4}고[가-힣]*\d+(?:\(\d+\))?)→' else '^(\d{4}노\d+(?:\(\d+\))?)→' end))[1]
       from unnest(string_to_array(coalesce(b.chg,''), ',')) with ordinality as t(x, i)
      where x ~ case when b.l_code ~ '노' then '^\d{4}고' else '^\d{4}노' end
      order by i desc limit 1) as lower_code,
    case when b.sun = 0 then (case when b.l_code ~ '노' then '선고부터' else '항소심 선고' end) else '상소장' end as kind,
    b.st as stage_start
  from b
  where b.pre > 0 and (b.sun = 0 or b.app = 0)
    and not exists (select 1 from record_fill f where f.l_num = b.l_num and f.undone_at is null)
  order by b.st desc;
$$;
revoke all on function public.admin_fill_needed() from public, anon, authenticated;

-- 5) 작동 상태: 예약 작업마다 마지막 실행 결과
create or replace function public.admin_cron_status()
returns table(jobname text, schedule text, active boolean, last_start timestamptz, last_status text, last_message text, fails_24h bigint)
language sql stable security definer set search_path = public, cron as $$
  select j.jobname::text, j.schedule::text, j.active,
    d.start_time, d.status::text, left(d.return_message, 200),
    (select count(*) from cron.job_run_details f where f.jobid = j.jobid and f.status <> 'succeeded' and f.start_time > now() - interval '24 hours')
  from cron.job j
  left join lateral (select * from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
  order by j.jobname;
$$;
revoke all on function public.admin_cron_status() from public, anon, authenticated;

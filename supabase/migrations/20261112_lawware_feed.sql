-- 로웨어 '하루 변경분'·송달 도달일·사건 상세 수집 (2026-11-12, 법인 Supabase에 적용 완료)
-- 이 파일은 보관용 기록이다. 운영 DB에는 같은 내용이 마이그레이션 4개로 이미 들어가 있다.

create table if not exists public.lw_process_events (
  lp_num bigint primary key,
  l_num bigint,
  l_code text,
  lp_set text,              -- 기일/송달/서면/명령/접수/문자/메일 ...
  lp_work_type text,        -- 추가/기일변경/추가(변경건)/변론재개 ...
  lp_appoint_date date,
  lp_appoint_time text,
  lp_contents text,
  lp_remark text,
  delivered_date date,      -- 송달 비고 'YYYY.MM.DD 도달/송달됨'에서 뽑은 실제 송달일
  delivery_status text,     -- 도달/송달됨/폐문부재/수취인불명 ...
  lp_docu_appoint_limit text,
  lp_docu_submit_date text,
  lp_attach_file text,
  lp_regdatetime text,
  lp_append_wdate date,
  lp_append_udate date,
  client_position text,
  court text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  changed_count int not null default 0
);
create index if not exists lw_process_events_lnum on public.lw_process_events(l_num);
create index if not exists lw_process_events_udate on public.lw_process_events(lp_append_udate);

create table if not exists public.lw_process_event_changes (
  id bigserial primary key,
  lp_num bigint not null,
  changed_at timestamptz not null default now(),
  old_row jsonb not null,
  new_row jsonb not null
);
create index if not exists lw_process_event_changes_lp on public.lw_process_event_changes(lp_num);

-- 사건 상세(주민번호·주소·연락처·수임료 칸은 받지 않음)
create table if not exists public.lw_case_detail (
  l_num bigint primary key,
  l_code text,
  info jsonb not null,
  scourt_appoint_log text,   -- 나의사건 기일 이력 원문
  defendants text[],         -- @@DEFENDANTS 최근 값
  related jsonb,             -- @@RELATED 목록
  fetched_at timestamptz not null default now()
);

create table if not exists public.lw_feed_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  date_from date,
  date_to date,
  fetched int default 0,
  new_count int default 0,
  changed_count int default 0,
  detail_count int default 0,
  error text
);

-- 서버 안에서만 쓰는 설정(자동 실행 열쇠). 정책이 없으니 웹앱에서는 못 읽음
create table if not exists public.lw_settings (key text primary key, value text not null);
insert into public.lw_settings(key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

alter table public.lw_process_events enable row level security;
alter table public.lw_process_event_changes enable row level security;
alter table public.lw_case_detail enable row level security;
alter table public.lw_feed_runs enable row level security;
alter table public.lw_settings enable row level security;

create or replace function public.lw_parse_delivery(remark text, out d date, out status text)
language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(coalesce(remark,''), '^\s*(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?\s*(?:\d{1,2}시\s*)?(.+?)\s*$');
  if m is null then d := null; status := null; return; end if;
  status := m[4];
  d := case when m[4] ~ '(도달|송달됨|송달간주)' then make_date(m[1]::int, m[2]::int, m[3]::int) else null end;
end $$;

create or replace function public.lw_ingest_events(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  old public.lw_process_events;
  n_new int := 0;
  n_chg int := 0;
  p record;
  v_date date;
begin
  for r in select * from jsonb_array_elements(rows) loop
    select * into p from public.lw_parse_delivery(case when r->>'lp_set' = '송달' then r->>'lp_remark' end);
    v_date := nullif(nullif(r->>'lp_appoint_date',''),'0000-00-00')::date;

    select * into old from public.lw_process_events where lp_num = (r->>'lp_num')::bigint;

    if not found then
      insert into public.lw_process_events(lp_num,l_num,l_code,lp_set,lp_work_type,lp_appoint_date,lp_appoint_time,
        lp_contents,lp_remark,delivered_date,delivery_status,lp_docu_appoint_limit,lp_docu_submit_date,lp_attach_file,
        lp_regdatetime,lp_append_wdate,lp_append_udate,client_position,court)
      values ((r->>'lp_num')::bigint, nullif(r->>'l_num','')::bigint, r->>'l_code', r->>'lp_set', r->>'lp_work_type',
        v_date, nullif(r->>'lp_appoint_time',''), r->>'lp_contents', nullif(r->>'lp_remark',''), p.d, p.status,
        nullif(r->>'lp_docu_appoint_limit',''), nullif(r->>'lp_docu_submit_date',''), nullif(r->>'lp_attach_file',''),
        r->>'lp_regdatetime',
        nullif(nullif(r->>'lp_append_wdate',''),'0000-00-00')::date, nullif(nullif(r->>'lp_append_udate',''),'0000-00-00')::date,
        nullif(r->>'l_client_postion',''), nullif(r->>'l_court',''));
      n_new := n_new + 1;
    elsif old.lp_appoint_date is distinct from v_date
       or old.lp_appoint_time is distinct from nullif(r->>'lp_appoint_time','')
       or old.lp_contents is distinct from r->>'lp_contents'
       or old.lp_remark is distinct from nullif(r->>'lp_remark','')
       or old.lp_docu_appoint_limit is distinct from nullif(r->>'lp_docu_appoint_limit','')
       or old.lp_docu_submit_date is distinct from nullif(r->>'lp_docu_submit_date','') then
      -- 바뀌기 전 값을 남긴다 (기일 변경 등)
      insert into public.lw_process_event_changes(lp_num, old_row, new_row)
      values (old.lp_num, to_jsonb(old), r);
      update public.lw_process_events set
        lp_set = r->>'lp_set', lp_work_type = r->>'lp_work_type',
        lp_appoint_date = v_date, lp_appoint_time = nullif(r->>'lp_appoint_time',''),
        lp_contents = r->>'lp_contents', lp_remark = nullif(r->>'lp_remark',''),
        delivered_date = p.d, delivery_status = p.status,
        lp_docu_appoint_limit = nullif(r->>'lp_docu_appoint_limit',''),
        lp_docu_submit_date = nullif(r->>'lp_docu_submit_date',''),
        lp_attach_file = nullif(r->>'lp_attach_file',''), lp_regdatetime = r->>'lp_regdatetime',
        lp_append_udate = nullif(nullif(r->>'lp_append_udate',''),'0000-00-00')::date,
        last_seen_at = now(), changed_count = changed_count + 1
      where lp_num = old.lp_num;
      n_chg := n_chg + 1;
    else
      update public.lw_process_events set last_seen_at = now(), lp_work_type = r->>'lp_work_type'
      where lp_num = old.lp_num;
    end if;
  end loop;
  return jsonb_build_object('new', n_new, 'changed', n_chg);
end $$;

revoke all on function public.lw_ingest_events(jsonb) from public, anon, authenticated;
grant execute on function public.lw_ingest_events(jsonb) to service_role;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.lw_call_feed(body jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://nyjyemjsperpakrrgzcc.supabase.co/functions/v1/lawware-feed',
    headers := jsonb_build_object('content-type','application/json',
                 'x-cron-secret', (select value from public.lw_settings where key='cron_secret')),
    body := body,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function public.lw_call_feed(jsonb) from public, anon, authenticated;

-- 한국시간 08:00~20:59, 15분마다 (UTC 23시, 0~11시)
select cron.schedule('lawware-feed-15min', '*/15 23,0-11 * * *', $$select public.lw_call_feed('{}'::jsonb)$$);

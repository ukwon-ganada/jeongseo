-- ============================================================================
--  수사 사건 (석원 2026-11-16)
--
--  수사단계(경찰·공소청)에서는 로웨어에 사건을 만들지 않아서 사건방이 사건과 연결되지 않았다.
--  → 봇이 방에 초대됐는데 로웨어 사건을 못 찾으면, 도우미가 직접 "수사 사건"을 하나 만들어 방에 붙인다.
--    타임라인·사건정보·서면 파일·접견이 이 사건에 쌓인다.
--  → 나중에 방 제목이 재판부 사건번호로 바뀌고 그 사건이 로웨어에 생기면, inv_case_merge 로
--    수사 사건에 쌓인 기록을 전부 로웨어 사건으로 옮긴다(합치기).
--
--  번호: 수사 사건 l_num 은 -100001, -100002 … (로웨어 l_num 은 양수라 절대 안 겹친다.
--        works_room_case 의 고유 색인이 coalesce(l_num,-1) 이라 -1 근처는 피함)
--  적용: SQL Editor에 전체 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================

create sequence if not exists public.inv_case_seq start with -100001 increment by -1 maxvalue -100001 minvalue -999999999;

create table if not exists public.inv_case (
  l_num        bigint primary key default nextval('public.inv_case_seq'),
  channel_id   text,                    -- 처음 만든 사건방
  room_title   text,                    -- 마지막으로 읽은 방 제목
  client_name  text not null default '',-- 방 제목에서 읽은 의뢰인 이름
  charge       text not null default '',-- 죄명
  role         text not null default '',-- 고소·피의·피고 등 (제목 괄호 속)
  agency       text not null default '',-- 수사기관 (부평경찰서, 부천지청 …)
  agency_no    text not null default '',-- 기관 사건번호 (2025형제28244, 2026-6419 …)
  created_at   timestamptz not null default now(),
  title_checked_at timestamptz,         -- 방 제목을 마지막으로 다시 읽은 때
  merged_into  bigint,                  -- 합쳐진 로웨어 사건 l_num (합쳐지면 사건 목록에서 빠짐)
  merged_at    timestamptz
);
create index if not exists inv_case_open on public.inv_case (merged_into) where merged_into is null;
create index if not exists inv_case_channel on public.inv_case (channel_id);
alter table public.inv_case enable row level security;
alter sequence public.inv_case_seq owned by public.inv_case.l_num;

-- 로웨어 사건 + 아직 안 합쳐진 수사 사건을 한 목록으로 (사건 화면·접견 맞추기가 읽는 곳)
create or replace view public.case_all with (security_invoker = true) as
  select l_num, l_code, l_name, l_kind, l_client, client_position, court, charge_lawyer, perform_lawyer, charge_staff,
         state, accept_date, next_date, next_time, next_contents, last_process, raw, updated_at,
         false as is_inv
    from public.cases
  union all
  select i.l_num,
         '수사-' || (-i.l_num)::text,
         i.charge,
         '형사/수사단계',
         i.client_name,
         i.role,
         '',                      -- court: 수사 사건은 법원이 없다(기관은 raw.l_police_station)
         null, null, null,
         '진행',
         to_char(i.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
         null, null, null, null,
         jsonb_build_object('l_client', i.client_name, 'l_accept_date', to_char(i.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
                            'l_police_station', i.agency, 'agency_no', i.agency_no),
         i.created_at,
         true
    from public.inv_case i
   where i.merged_into is null;
revoke all on public.case_all from anon, authenticated;

-- ----------------------------------------------------------------------------
--  합치기: 수사 사건(p_inv) → 로웨어 사건(p_real)
--    사건정보: 직원이 입력한 값은 그대로, 빈칸만 로웨어 값으로 채운다
--    방 연결·서면 파일·방 대화 일정·접견·열람 기록·PC 제목 기억: 사건 번호만 바꾼다
--  여러 번 불러도 안전(이미 합쳐졌으면 아무것도 안 함).
-- ----------------------------------------------------------------------------
create or replace function public.inv_case_merge(p_inv bigint, p_real bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c   public.cases%rowtype;
  inv public.inv_case%rowtype;
  n_room int := 0; n_file int := 0; n_ev int := 0; n_meet int := 0; n_log int := 0;
  info_how text := 'none';
begin
  select * into inv from public.inv_case where l_num = p_inv for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no inv case'); end if;
  if inv.merged_into is not null then return jsonb_build_object('ok', true, 'already', inv.merged_into); end if;
  select * into c from public.cases where l_num = p_real;
  if not found then return jsonb_build_object('ok', false, 'error', 'no lawware case'); end if;

  -- 1) 방 연결: 이미 그 방이 로웨어 사건에도 붙어 있으면 수사 쪽 줄은 지운다
  delete from public.works_room_case w
   where w.l_num = p_inv
     and exists (select 1 from public.works_room_case x where x.channel_id = w.channel_id and x.l_num = p_real);
  update public.works_room_case
     set l_num = p_real, case_no = c.l_code, status = case when c.state = '종결' then '종결' else '대상' end,
         basis = '수사 사건 합침', updated_at = now()
   where l_num = p_inv;
  get diagnostics n_room = row_count;

  -- 2) 사건정보
  if exists (select 1 from public.case_info where l_num = p_inv) then
    if exists (select 1 from public.case_info where l_num = p_real) then
      -- 둘 다 있으면: 로웨어 사건 쪽에 직원이 이미 쓴 값 우선, 빈칸은 수사 사건 값으로
      update public.case_info r set
        case_name   = coalesce(nullif(r.case_name,''), i.case_name),
        client_name = coalesce(nullif(r.client_name,''), i.client_name),
        client_phone= coalesce(nullif(r.client_phone,''), i.client_phone),
        lawyer      = coalesce(nullif(r.lawyer,''), i.lawyer),
        court_dept  = coalesce(nullif(r.court_dept,''), i.court_dept),
        court_phone = coalesce(nullif(r.court_phone,''), i.court_phone),
        investigator= coalesce(nullif(r.investigator,''), i.investigator),
        investigator_phone = coalesce(nullif(r.investigator_phone,''), i.investigator_phone),
        memo        = coalesce(nullif(r.memo,''), i.memo),
        extra_phones= coalesce(nullif(r.extra_phones,''), i.extra_phones),
        updated_at  = now()
      from public.case_info i where r.l_num = p_real and i.l_num = p_inv;
      delete from public.case_info where l_num = p_inv;
      info_how := 'both';
    else
      update public.case_info set l_num = p_real, case_no = c.l_code where l_num = p_inv;
      info_how := 'moved';
    end if;
    -- 빈칸만 로웨어 값으로 (처음 한 번 복사하는 것과 같은 칸들)
    update public.case_info r set
      case_name    = coalesce(nullif(r.case_name,''), nullif(regexp_replace(coalesce(c.l_name,''), '^\[전자\]\s*', ''), '')),
      client_name  = coalesce(nullif(r.client_name,''), nullif(c.raw->>'l_client','')),
      client_phone = coalesce(nullif(r.client_phone,''), nullif(c.raw->>'l_client_hp','')),
      lawyer       = coalesce(nullif(r.lawyer,''), nullif(split_part(coalesce(c.charge_lawyer,''), ',', 1), '')),
      court_dept   = coalesce(nullif(r.court_dept,''), nullif(trim(coalesce(c.court,'') || ' ' ||
                       regexp_replace(coalesce(c.raw->>'l_justice_dept',''), '\s*\(?\s*전화.*$', '')), '')),
      court_phone  = coalesce(nullif(r.court_phone,''), substring(coalesce(c.raw->>'l_justice_dept','') from '전화\s*:?\s*([0-9-]{7,})'))
    where r.l_num = p_real;
  end if;
  update public.case_info_log set l_num = p_real where l_num = p_inv;

  -- 3) 서면 파일 (l_num 칸이 글자)
  update public.case_file set l_num = p_real::text, case_no = c.l_code where l_num = p_inv::text;
  get diagnostics n_file = row_count;

  -- 4) 방 대화에서 뽑은 일정
  update public.room_event set l_num = p_real where l_num = p_inv;
  get diagnostics n_ev = row_count;

  -- 5) 접견 (같은 일정이 이미 로웨어 사건에 붙어 있으면 수사 쪽은 지움)
  delete from public.meet_event m where m.l_num = p_inv
     and exists (select 1 from public.meet_event x where x.event_id = m.event_id and x.l_num = p_real);
  update public.meet_event set l_num = p_real where l_num = p_inv;
  get diagnostics n_meet = row_count;

  -- 6) 열람 기록·PC 요청·PC 제목 기억
  update public.case_view_log set l_num = p_real, case_no = c.l_code where l_num = p_inv;
  get diagnostics n_log = row_count;
  update public.pc_open_request set l_num = p_real, case_no = c.l_code where l_num = p_inv;
  update public.pc_title_pick set l_num = p_real, case_no = c.l_code, updated_at = now() where l_num = p_inv;

  update public.inv_case set merged_into = p_real, merged_at = now() where l_num = p_inv;
  return jsonb_build_object('ok', true, 'into', p_real, 'case_no', c.l_code, 'rooms', n_room, 'files', n_file,
                            'chat_events', n_ev, 'meets', n_meet, 'view_logs', n_log, 'info', info_how);
end $$;
revoke all on function public.inv_case_merge(bigint, bigint) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
--  방 제목 다시 읽기(하루 몇 번): works-bot-callback 에 부탁 (웍스 봇 열쇠가 거기 있음)
--  손으로 부르기: select inv_recheck_call('{"action":"inv-recheck"}');
--  보류 방 미리보기: select inv_recheck_call('{"action":"inv-backfill","dryRun":true}');
--  결과는 net._http_response 에서 확인
-- ----------------------------------------------------------------------------
create or replace function public.inv_recheck_call(body jsonb default '{"action":"inv-recheck"}'::jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://nyjyemjsperpakrrgzcc.supabase.co/functions/v1/works-bot-callback',
    headers := jsonb_build_object('content-type','application/json',
                 'x-cron-secret', (select value from public.lw_settings where key='cron_secret')),
    body := body,
    timeout_milliseconds := 120000
  );
$$;
revoke all on function public.inv_recheck_call(jsonb) from public, anon, authenticated;

-- 시험이 잘 되면 아래 한 줄로 하루 네 번(한국 08:20, 11:20, 14:20, 17:20) 돌린다. 지금은 주석.
-- select cron.schedule('inv-recheck', '20 23,2,5,8 * * *', $$select public.inv_recheck_call()$$);

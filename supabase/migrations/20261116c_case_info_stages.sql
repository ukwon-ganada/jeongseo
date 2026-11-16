-- ============================================================================
--  사건정보 단계별 칸 (석원 2026-11-16)
--
--  경찰 · 공소청 · 1심 · 2심 · 3심 칸을 사건마다 따로 적는다.
--    stages      : {"police":{"org","no","dept","person","phone"}, "pros":{…}, "c1":{…}, "c2":{…}, "c3":{…}}
--    cur_stage   : 직원이 고른 "지금 단계" (비어 있으면 사건번호 모양으로 자동)
--    start_stage : 직원이 고른 "선임 단계" (비어 있으면 자동)
--  수사관·공소관·전화를 바꾸면 case_info_log 에 field 'stage.police.person' 처럼 남는다.
--  inv_case_merge: 합칠 때 단계 칸도 합친다(로웨어 사건 쪽에 이미 적은 단계가 우선).
--  여러 번 실행해도 안전.
-- ============================================================================
alter table public.case_info add column if not exists stages jsonb not null default '{}'::jsonb;
alter table public.case_info add column if not exists cur_stage text;
alter table public.case_info add column if not exists start_stage text;

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
        stages      = coalesce(i.stages,'{}'::jsonb) || coalesce(r.stages,'{}'::jsonb),
        cur_stage   = coalesce(r.cur_stage, i.cur_stage),
        start_stage = coalesce(r.start_stage, i.start_stage),
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

-- 사건 화면 자료를 DB에 한 번만 묻기(2026-11-20, 속도 개선 4번)
-- case-view가 방으로 사건을 열 때 하던 PostgREST 요청 약 20번(차례로 6단계)을 이 함수 하나로 받는다.
-- 각 묶음은 handler.ts의 원래 요청과 같은 조건·순서·개수 제한. 처리할 수 없는 방(연결 없음·보류·사건번호만 있음)은
-- {"fallback": true}를 돌려주고 case-view가 예전 방식으로 연다.
create or replace function public.case_view_bundle(p_room text, p_name text default '')
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_maps jsonb; v_main record; v_c jsonb; v_l bigint; v_code text;
  v_chans text[]; v_rel bigint[]; v_all bigint[]; v_files jsonb; v_ids bigint[]; v_uids text[]; v_n text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('l_num', l_num, 'case_no', case_no, 'is_primary', is_primary, 'status', status)
           order by is_primary desc, updated_at desc), '[]'::jsonb)
    into v_maps from works_room_case where channel_id = p_room;
  if jsonb_array_length(v_maps) = 0 then return jsonb_build_object('fallback', true); end if;
  select * into v_main from jsonb_to_record(v_maps->0) as x(l_num bigint, case_no text, status text);
  if v_main.status = '보류' or v_main.l_num is null then return jsonb_build_object('fallback', true); end if;
  select to_jsonb(a) into v_c from case_all a where a.l_num = v_main.l_num limit 1;
  if v_c is null then return jsonb_build_object('fallback', true); end if;
  v_l := v_main.l_num; v_code := v_c->>'l_code';

  -- 이 사건과 짝지어진 방들(+지금 방), 같은 방들에 함께 연결된 다른 사건
  select array_agg(distinct ch) into v_chans from (
    select p_room as ch union all select channel_id from works_room_case where l_num = v_l) s where coalesce(ch, '') <> '';
  v_chans := coalesce(v_chans, '{}');
  select coalesce(array_agg(distinct l_num order by l_num), '{}') into v_rel from works_room_case
    where channel_id = any(v_chans) and l_num is not null and l_num <> 0 and l_num <> v_l;
  v_all := array[v_l] || v_rel;

  -- 사건방에 올린 파일(이 사건 번호로 붙은 것 + 이 사건과 짝지어진 방에 올라온 것)
  select coalesce(jsonb_agg(to_jsonb(f) order by f.posted_at desc), '[]'::jsonb), coalesce(array_agg(f.id), '{}'),
         coalesce(array_agg(distinct f.works_user_id) filter (where coalesce(f.works_user_id, '') <> ''), '{}')
    into v_files, v_ids, v_uids from (
      select id, file_name, content_type, size_bytes, status, works_user_id, posted_at, lp_num from case_file
      where status = '보관' and (l_num = v_l::text or channel_id in (select channel_id from works_room_case where l_num = v_l and channel_id is not null))
      order by posted_at desc limit 300) f;

  v_n := regexp_replace(coalesce(p_name, ''), '[*,()%_\\]', '', 'g');

  return jsonb_build_object(
    'maps', v_maps, 'c', v_c, 'chans', to_jsonb(v_chans), 'rel', to_jsonb(v_rel),
    'evs', (select coalesce(jsonb_agg(to_jsonb(e) order by e.lp_appoint_date), '[]') from (
        select lp_num, lp_set, lp_appoint_date, lp_appoint_time, lp_contents, lp_remark, delivered_date, court, last_seen_at, lp_append_udate
        from lw_process_events where l_num = v_l order by lp_appoint_date limit 2000) e),
    'mine', case when v_n = '' then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(m) order by m.next_date nulls last), '[]') from (
        select l_num, l_code, l_name, next_date, next_time, next_contents, court from cases
        where state <> '종결' and (charge_staff ilike '%' || v_n || '%' or charge_lawyer ilike '%' || v_n || '%' or perform_lawyer ilike '%' || v_n || '%')
        order by next_date nulls last limit 300) m) end,
    'saved', (select to_jsonb(i) from case_info i where i.l_num = v_l limit 1),
    'inherited', case when cardinality(v_rel) = 0 then null else (select to_jsonb(i) from case_info i where i.l_num = any(v_rel) order by i.updated_at desc limit 1) end,
    'files', v_files,
    'names', (select coalesce(jsonb_object_agg(works_user_id, viewer_name), '{}') from (
        select distinct on (works_user_id) works_user_id, viewer_name from case_view_log
        where works_user_id = any(v_uids) and viewer_name is not null order by works_user_id, viewed_at desc) n),
    'chat', (select coalesce(jsonb_agg(to_jsonb(r) order by r.ev_date), '[]') from (
        select id, kind, ev_date, ev_time, summary, state, source from room_event
        where hidden = false and (l_num = any(v_all) or channel_id = any(v_chans)) order by ev_date limit 500) r),
    'feed', (select finished_at from lw_feed_runs where error is null and finished_at is not null order by id desc limit 1),
    'meets', (select coalesce(jsonb_agg(to_jsonb(m) order by m.ev_date), '[]') from (
        select event_id, ev_date, ev_time, lawyer, place from meet_event where l_num = any(v_all) order by ev_date limit 300) m),
    'stageLogs', (select coalesce(jsonb_agg(to_jsonb(s) order by s.edited_at desc), '[]') from (
        select field, old_value, new_value, editor, edited_at from case_info_log
        where l_num = any(v_all) and field like 'stage.%' order by edited_at desc limit 300) s),
    'relCases', (select coalesce(jsonb_agg(jsonb_build_object('l_num', a.l_num, 'l_code', a.l_code, 'raw', a.raw)), '[]') from case_all a where a.l_num = any(v_rel)),
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('room_title', t.room_title)), '[]') from (
        select room_title from works_room_case where channel_id = any(v_chans) and room_title is not null limit 5) t),
    'relEvs', (select coalesce(jsonb_agg(to_jsonb(e) order by e.lp_appoint_date), '[]') from (
        select l_num, lp_num, lp_set, lp_appoint_date, lp_appoint_time, lp_contents, lp_remark, delivered_date, court, last_seen_at, lp_append_udate
        from lw_process_events where l_num = any(v_rel) order by lp_appoint_date limit 6000) e),
    'hist', (select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]') from (
        select id, stage, org, no, seen_on, hidden from case_no_hist where l_num = any(v_all) and l_num <> 0 order by id limit 200) h),
    'noMsgs', (select coalesce(jsonb_agg(to_jsonb(m) order by m.sent_at), '[]') from (
        select sent_at, text from room_msg where channel_id = any(v_chans) and (text like '%형제%' or text like '%경찰서%') order by sent_at limit 200) m),
    'none', (select coalesce(jsonb_agg(n.lp_num), '[]') from case_file_none n
        where n.lp_num in (select lp_num from lw_process_events where l_num = any(v_all))),
    'dlc', (select coalesce(jsonb_agg(to_jsonb(d) - 'created_at' order by d.created_at desc), '[]') from (
        select id, kind, due, action, undone_at, created_at from deadline_confirm
        where undone_at is null and l_code = v_code order by created_at desc limit 100) d),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object('file_id', m.file_id, 'line_key', m.line_key, 'sig', m.sig)), '[]')
        from case_file_match m where m.file_id = any(v_ids))
  );
end $$;
revoke execute on function public.case_view_bundle(text, text) from public, anon, authenticated;
grant execute on function public.case_view_bundle(text, text) to service_role;

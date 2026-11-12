-- ============================================================================
--  방 ↔ 사건 짝을 사무실 PC 매칭 결과(channel_map_title.csv)에서 가져오기
--
--  원칙(재설계 스레드와 합의): 매칭 규칙(R11~R13)을 여기서 새로 짜지 않는다.
--  사무실 PC match_by_title.py 가 매일 만드는 CSV 결과를 그대로 옮긴다.
--    1) tools/works/import_room_map.py 가 CSV 행을 works_room_map_raw 에 통째로 올리고
--    2) works_room_case_import() 가 works_room_case 를 다시 채운다(여러 번 돌려도 같은 결과).
--  손으로 넣은 행(source='manual')은 건드리지 않는다.
-- ============================================================================

-- 1) works_room_case: 보류 방은 l_num 이 없으므로 l_num 을 비워 둘 수 있게, l_num 은 cases.l_num 과 같은 bigint
alter table public.works_room_case drop constraint if exists works_room_case_pkey;
alter table public.works_room_case alter column l_num drop not null;
alter table public.works_room_case
  alter column l_num type bigint using (case when l_num ~ '^\d+$' then l_num::bigint end);
alter table public.works_room_case add column if not exists id bigserial primary key;
alter table public.works_room_case add column if not exists basis text;       -- 매칭 근거(사건번호/이름/이름+법원/…)
alter table public.works_room_case add column if not exists confidence text;  -- 신뢰도
alter table public.works_room_case add column if not exists source text not null default 'manual';
create unique index if not exists works_room_case_room_case on public.works_room_case (channel_id, coalesce(l_num, -1));
create index if not exists works_room_case_channel on public.works_room_case (channel_id);

alter table public.pc_open_request
  alter column l_num type bigint using (case when l_num ~ '^\d+$' then l_num::bigint end);

-- 2) CSV 원본 그대로 받는 칸 (매번 비우고 다시 채움)
create table if not exists public.works_room_map_raw (
  channel_id  text not null,
  room_title  text,
  l_num       text,
  linked      text,   -- 연결사건: " / " 로 구분된 사건번호
  target      text,   -- 알림대상: 대상 / 보류(사건미상) / 제외(종결)
  basis       text,
  confidence  text,
  imported_at timestamptz not null default now()
);
alter table public.works_room_map_raw enable row level security;

-- 3) 사건번호 정규화: 26노1821 → 2026노1821, 2026고단01234 → 2026고단1234 (모양이 다르면 그대로)
create or replace function public.norm_case_no(p text)
returns text language sql immutable as $$
  select case
    when m is null then nullif(trim(p), '')
    else (case when length(m[1]) = 2 then '20' || m[1] else m[1] end) || m[2] || ltrim(m[3], '0')
  end
  from (select regexp_match(regexp_replace(coalesce(p, ''), '\s', '', 'g'), '^(\d{2}|\d{4})([가-힣]+)(\d+)$') as m) x;
$$;

-- 4) 가져오기: raw → works_room_case (source='csv' 행만 갈아 끼움)
create or replace function public.works_room_case_import()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_raw int; n_main int; n_link int; n_hold int;
begin
  select count(*) into n_raw from works_room_map_raw;
  if n_raw = 0 then raise exception '가져올 행이 없습니다 (works_room_map_raw 비어 있음)'; end if;

  delete from works_room_case where source = 'csv';

  -- 주 사건 행 (l_num 이 비었으면 보류: 사건을 붙이지 않음)
  insert into works_room_case (channel_id, l_num, case_no, is_primary, status, room_title, basis, confidence, source, updated_at)
  select distinct on (r.channel_id)
         r.channel_id,
         case when r.l_num ~ '^\d+$' then r.l_num::bigint end,
         norm_case_no(c.l_code),
         true,
         case when r.target like '보류%' or coalesce(r.l_num, '') !~ '^\d+$' then '보류'
              when r.target like '제외%' or r.target like '%종결%' then '종결'
              else '대상' end,
         r.room_title, r.basis, r.confidence, 'csv', now()
  from works_room_map_raw r
  left join cases c on r.l_num ~ '^\d+$' and c.l_num = r.l_num::bigint
  where not exists (select 1 from works_room_case m where m.channel_id = r.channel_id and m.source = 'manual')
  order by r.channel_id, r.imported_at desc;
  get diagnostics n_main = row_count;

  -- 연결사건 행 (원심 등): 정규화한 번호로 cases 에서 l_num 을 찾은 것만, 주 사건이 확정된 방에만
  insert into works_room_case (channel_id, l_num, case_no, is_primary, status, room_title, basis, confidence, source, updated_at)
  select distinct on (m.channel_id, c.l_num)
         m.channel_id, c.l_num, norm_case_no(c.l_code), false, m.status, m.room_title, '연결사건', m.confidence, 'csv', now()
  from works_room_case m
  join works_room_map_raw r on r.channel_id = m.channel_id
  cross join lateral regexp_split_to_table(coalesce(r.linked, ''), '\s*/\s*') as part(no)
  join cases c on norm_case_no(c.l_code) = norm_case_no(part.no)
  where m.source = 'csv' and m.is_primary and m.status <> '보류'
    and part.no <> '' and c.l_num is distinct from m.l_num
  on conflict do nothing;
  get diagnostics n_link = row_count;

  select count(*) into n_hold from works_room_case where source = 'csv' and status = '보류';
  return jsonb_build_object('csv_rows', n_raw, 'rooms', n_main, 'linked_cases', n_link, 'hold_rooms', n_hold);
end $$;
revoke all on function public.works_room_case_import() from public, anon, authenticated;
revoke all on function public.norm_case_no(text) from public, anon, authenticated;

-- 대법원 원문 → 항목별 표 자동 정리. 2026-11-25 석원이 SQL Editor로 실행함
create table if not exists public.scourt_case_info (
  case_code text primary key,
  court text,
  basic jsonb,
  simgeup jsonb,
  related jsonb,
  appeal_text text,
  final_result text,
  hyungje_no text,
  judge_panel text,
  defendants jsonb,
  counsel jsonb,
  sections jsonb,
  snapshot_id bigint,
  updated_at timestamptz default now()
);
create table if not exists public.scourt_progress_rows (
  case_code text not null,
  seq int not null,
  ev_date date,
  content text,
  result text,
  result_date date,
  is_attendee boolean default false,
  snapshot_id bigint,
  primary key (case_code, seq)
);
alter table public.scourt_case_info enable row level security;
alter table public.scourt_progress_rows enable row level security;

create or replace function public.scourt_parse_snapshot(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record; t jsonb; r jsonb; cap text; hdr jsonb;
  basic jsonb := '{}'; sections jsonb := '{}'; simgeup jsonb := null; related jsonb := null;
  defendants jsonb := null; counsel jsonb := null; prog jsonb := null;
  i int; k text; v text; n int := 0; rd text; code text;
begin
  select * into s from scourt_raw_snapshots where id = p_id;
  if s.case_code is null or s.tables is null then return; end if;
  code := regexp_replace(s.case_code, '\[.*$', '');
  for t in select * from jsonb_array_elements(s.tables) loop
    cap := split_part(coalesce(t->>'caption',''), ' 그리드', 1);
    hdr := t->'rows'->0;
    if jsonb_array_length(t->'rows') <= 1 and coalesce(hdr->>0,'') = '' then continue; end if;
    if cap like '사건번호,%' then
      for r in select * from jsonb_array_elements(t->'rows') loop
        i := 0;
        while i + 1 < jsonb_array_length(r) loop
          k := nullif(trim(r->>i),''); v := trim(coalesce(r->>(i+1),''));
          if k is not null and not basic ? k then basic := basic || jsonb_build_object(k, v); end if;
          i := i + 2;
        end loop;
      end loop;
      continue;
    end if;
    sections := sections || jsonb_build_object(coalesce(nullif(cap,''), 'table'||n), t->'rows');
    n := n + 1;
    if hdr = '["법원","사건번호"]'::jsonb and simgeup is null and s.raw_text like '%심급내용%' then
      select jsonb_agg(jsonb_build_object('court', x->>0, 'case_no', x->>1)) into simgeup
        from jsonb_array_elements(t->'rows') with ordinality q(x, o) where o > 1 and coalesce(x->>1,'') <> '';
    elsif cap like '%관련사건%' or hdr::text like '%병합%' then
      related := t->'rows';
    elsif cap like '피고인및죄명%' then
      defendants := t->'rows';
    elsif cap like '당사자내용%' or cap like '소송관계인%' then
      counsel := coalesce(counsel, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('table', cap, 'rows', t->'rows'));
    elsif cap like '진행내용%' then
      prog := t->'rows';
    end if;
  end loop;

  insert into scourt_case_info(case_code, court, basic, simgeup, related, appeal_text, final_result, hyungje_no, judge_panel, defendants, counsel, sections, snapshot_id, updated_at)
  values (code, s.court, basic, simgeup, related, basic->>'상소제기내용', basic->>'종국결과', basic->>'형제번호', basic->>'재판부', defendants, counsel, sections, s.id, now())
  on conflict (case_code) do update set court=excluded.court, basic=excluded.basic,
    simgeup=coalesce(excluded.simgeup, scourt_case_info.simgeup), related=coalesce(excluded.related, scourt_case_info.related),
    appeal_text=excluded.appeal_text, final_result=excluded.final_result, hyungje_no=excluded.hyungje_no,
    judge_panel=excluded.judge_panel, defendants=coalesce(excluded.defendants, scourt_case_info.defendants),
    counsel=coalesce(excluded.counsel, scourt_case_info.counsel), sections=excluded.sections,
    snapshot_id=excluded.snapshot_id, updated_at=now();

  if prog is not null and jsonb_array_length(prog) > 1 then
    delete from scourt_progress_rows where case_code = code;
    i := 0;
    for r in select x from jsonb_array_elements(prog) with ordinality q(x, o) where o > 1 order by o loop
      if coalesce(trim(r->>0),'') !~ '^\d{4}\.\d{2}\.\d{2}$' then continue; end if;
      i := i + 1;
      rd := substring(coalesce(r->>2,'') from '(\d{4}\.\d{2}\.\d{2})');
      insert into scourt_progress_rows(case_code, seq, ev_date, content, result, result_date, is_attendee, snapshot_id)
      values (code, i, to_date(r->>0,'YYYY.MM.DD'), trim(r->>1), nullif(trim(r->>2),''),
              case when rd is not null then to_date(rd,'YYYY.MM.DD') end,
              trim(r->>1) ~ '^-' or (trim(r->>1) !~ '(기일|발송|제출|결정|명령|접수|송달|선고|판결)' and trim(r->>1) ~ '^(보호소년|보호자|보조인|검사|피고인|변호인|증인)\s'),
              s.id);
    end loop;
  end if;
end $$;

create or replace function public.scourt_snapshot_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform scourt_parse_snapshot(new.id); exception when others then raise warning 'scourt parse % failed: %', new.id, sqlerrm; end;
  return new;
end $$;
drop trigger if exists scourt_snapshot_parse on public.scourt_raw_snapshots;
create trigger scourt_snapshot_parse after insert on public.scourt_raw_snapshots for each row execute function public.scourt_snapshot_trg();

delete from scourt_raw_snapshots where case_code = 'TEST0000';
select scourt_parse_snapshot(id) from scourt_raw_snapshots order by id;

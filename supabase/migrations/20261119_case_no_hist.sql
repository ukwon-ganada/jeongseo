-- 경찰 사건번호·형제번호가 생기거나 바뀐 이력(재배당·이송). 로웨어·방 제목·수사 방 값이 바뀔 때 자동으로 쌓인다.
create table if not exists public.case_no_hist (
  id bigserial primary key,
  l_num bigint not null,
  stage text not null check (stage in ('police', 'pros')),
  org text not null default '',
  no text not null,
  source text not null,
  seen_on date,                 -- null = 이력 시작 전부터 있던 번호(날짜 모름)
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (l_num, stage, no)
);
alter table public.case_no_hist enable row level security;

create or replace function public.case_no_put(p_l bigint, p_stage text, p_org text, p_no text, p_src text, p_initial boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_l is null or coalesce(trim(p_no), '') = '' or p_no ~ '^\d{4}-0*$' then return; end if;
  insert into case_no_hist (l_num, stage, org, no, source, seen_on)
  values (p_l, p_stage, coalesce(trim(p_org), ''), trim(p_no), p_src,
          case when p_initial then null else (now() at time zone 'Asia/Seoul')::date end)
  on conflict (l_num, stage, no) do update set org = case when case_no_hist.org = '' then excluded.org else case_no_hist.org end;
end $$;

create or replace function public.case_no_title(p_title text, out org text, out no text)
language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_title, ''), '(?:([가-힣]+(?:\s+[가-힣]+지청)?)[\s_]*)?(\d{4})\s*형제\s*(\d+)');
  if m is null then return; end if;
  org := case when m[1] ~ '(청|검|공)$' then regexp_replace(m[1], '\s+', ' ', 'g') else '' end;
  no := m[2] || '형제' || m[3];
end $$;

create or replace function public.case_no_from_case(c public.cases, p_initial boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pc text := coalesce(c.raw->>'l_police_code', ''); lp text := coalesce(c.raw->>'l_prosecute', '');
begin
  if pc !~ '^\d{4}-\d+$' and c.l_code ~ '^\d{4}-\d+$' then pc := c.l_code; end if;
  if pc ~ '^\d{4}-\d+$' then perform case_no_put(c.l_num, 'police', c.raw->>'l_police_station', pc, 'lawware', p_initial); end if;
  if c.l_code ~ '^\d{4}\s*형제\s*\d+$' then
    perform case_no_put(c.l_num, 'pros', case when lp ~ '공소청|검찰|지검|지청' then lp else '' end, regexp_replace(c.l_code, '\s', '', 'g'), 'lawware', p_initial);
  end if;
end $$;

create or replace function public.case_no_trg_cases() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.l_code is distinct from old.l_code
     or new.raw->>'l_police_code' is distinct from old.raw->>'l_police_code' then
    perform case_no_from_case(new, false);
  end if;
  return new;
end $$;
drop trigger if exists case_no_hist_cases on public.cases;
create trigger case_no_hist_cases after insert or update on public.cases for each row execute function public.case_no_trg_cases();

create or replace function public.case_no_trg_room() returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.l_num is null or new.room_title is null then return new; end if;
  if tg_op = 'UPDATE' and new.room_title is not distinct from old.room_title and new.l_num is not distinct from old.l_num then return new; end if;
  select * into t from case_no_title(new.room_title);
  if t.no is not null then perform case_no_put(new.l_num, 'pros', t.org, t.no, 'title', false); end if;
  return new;
end $$;
drop trigger if exists case_no_hist_room on public.works_room_case;
create trigger case_no_hist_room after insert or update on public.works_room_case for each row execute function public.case_no_trg_room();

create or replace function public.case_no_trg_inv() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if coalesce(new.agency_no, '') = '' then return new; end if;
  if tg_op = 'UPDATE' and new.agency_no is not distinct from old.agency_no then return new; end if;
  st := case when new.agency_no ~ '형제' or coalesce(new.agency, '') ~ '공소청|검찰|지검|지청' then 'pros' else 'police' end;
  perform case_no_put(new.l_num, st, new.agency, regexp_replace(new.agency_no, '\s', '', 'g'), 'inv', false);
  return new;
end $$;
drop trigger if exists case_no_hist_inv on public.inv_case;
create trigger case_no_hist_inv after insert or update on public.inv_case for each row execute function public.case_no_trg_inv();

-- 지금 있는 번호를 날짜 모름(시작점)으로 한 번 채운다
select public.case_no_from_case(c, true) from public.cases c;
select public.case_no_put(w.l_num, 'pros', t.org, t.no, 'title', true)
  from public.works_room_case w, lateral public.case_no_title(w.room_title) t where w.l_num is not null and t.no is not null;
select public.case_no_put(i.l_num, case when i.agency_no ~ '형제' or coalesce(i.agency, '') ~ '공소청|검찰|지검|지청' then 'pros' else 'police' end,
  i.agency, regexp_replace(i.agency_no, '\s', '', 'g'), 'inv', true)
  from public.inv_case i where coalesce(i.agency_no, '') <> '';

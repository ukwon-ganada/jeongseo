-- 대법원 원문 보관(석원 PC 크롬 확장 → scourt-raw-ingest). 2026-11-25 운영 DB에 적용됨
create table if not exists public.scourt_raw_snapshots (
  id bigserial primary key,
  case_code text,
  court text,
  tab text,
  page_title text,
  content_hash text not null,
  raw_text text,
  tables jsonb,
  ext_version text,
  captured_at timestamptz not null default now(),
  unique (content_hash)
);
create index if not exists scourt_raw_snapshots_case_idx on public.scourt_raw_snapshots (case_code, captured_at desc);
alter table public.scourt_raw_snapshots enable row level security;
insert into public.lw_settings(key,value)
select 'scourt_ingest_key', encode(gen_random_bytes(24),'hex')
where not exists (select 1 from public.lw_settings where key='scourt_ingest_key');

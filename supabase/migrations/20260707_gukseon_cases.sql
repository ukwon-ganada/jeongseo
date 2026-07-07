-- ============================================================================
--  법무법인 정서 — 국선 사건 관리 앱 데이터 테이블(gukseon_cases) + RLS
--  목적:
--    · 국선 사건관리 앱(gukseon-manager.html)이 사건 1건 = 1행으로 저장/실시간동기화한다.
--    · 정서의 구조화된 cases 표(로웨 연동, 자동완성용)와 분리한다.
--    · 로그인한 직원(authenticated)만 읽기/쓰기/삭제 가능. 익명(anon) 접근은 완전 차단.
--
--  적용: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--  주의: 여러 번 실행해도 안전하도록 작성됨(idempotent).
-- ============================================================================

-- 1) 테이블 (사건 1건 = 1행, 앱 상태는 data(jsonb) 안에 통째로)
create table if not exists public.gukseon_cases (
  id         text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) RLS 켜기 — 정책이 없으면 이 순간부터 익명 접근은 전부 거부된다.
alter table public.gukseon_cases enable row level security;

-- 3) 로그인한 직원(authenticated) 정책 — 목록/저장/수정/삭제 전부 허용
drop policy if exists "staff_full_gukseon_cases" on public.gukseon_cases;
create policy "staff_full_gukseon_cases"
  on public.gukseon_cases
  for all
  to authenticated
  using (true)
  with check (true);
-- 익명(anon)에는 어떤 정책도 만들지 않는다 → 직접 접근 완전 차단.

-- 4) 실시간 동기화(Realtime) 대상에 포함 (여러 기기 즉시 반영)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gukseon_cases'
  ) then
    alter publication supabase_realtime add table public.gukseon_cases;
  end if;
end $$;

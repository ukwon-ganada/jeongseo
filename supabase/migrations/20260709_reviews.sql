-- ============================================================================
--  법무법인 정서 — 결재함(서면 확인 요청) 데이터 테이블(reviews) + RLS
--  목적:
--    · 어쏘 변호사가 "어떤 사건의 어떤 서면을 언제까지 확인해야 하는지"를 1건=1행으로 올린다.
--    · 서고은 파트너의 결재함(geoljae.js)이 이 표를 마감 임박순으로 모아 보고, 확인하면 체크한다.
--    · 국선 사건관리(gukseon_cases)와 동일한 표준 패턴(id/data/updated_at + RLS + Realtime).
--    · 로그인한 직원(authenticated)만 읽기/쓰기/삭제. 익명(anon)은 완전 차단.
--
--  적용: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--  주의: 여러 번 실행해도 안전(idempotent).
-- ============================================================================

-- 1) 테이블 (요청 1건 = 1행, 내용은 data(jsonb)에 통째로)
--    data 예: {
--      "requester":"양선화",                         -- 요청자(직원명). 추후 로그인 사용자로 대체
--      "caseId":"...", "caseNo":"2026가합5521",       -- 자동완성(cases: l_num, l_code)
--      "caseName":"대여금 청구", "nextDate":"2026-07-20",  -- 자동완성(cases: l_name, next_date)
--      "docType":"준비서면", "docTitle":"원고 제3준비서면",  -- 어떤 서면
--      "dueDate":"2026-07-12",                        -- 언제까지 확인 (기본값=nextDate)
--      "status":"pending",                            -- pending | done
--      "createdAt":"2026-07-09T09:10:00.000Z", "doneAt":null
--    }
create table if not exists public.reviews (
  id         text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) RLS 켜기 — 정책이 없으면 이 순간부터 익명 접근은 전부 거부된다.
alter table public.reviews enable row level security;

-- 3) 로그인한 직원(authenticated) 정책 — 목록/저장/수정/삭제 전부 허용
drop policy if exists "staff_full_reviews" on public.reviews;
create policy "staff_full_reviews"
  on public.reviews
  for all
  to authenticated
  using (true)
  with check (true);
-- 익명(anon)에는 어떤 정책도 만들지 않는다 → 직접 접근 완전 차단.

-- 4) 실시간 동기화(Realtime) 대상에 포함 (요청 즉시 결재함에 반영)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reviews'
  ) then
    alter publication supabase_realtime add table public.reviews;
  end if;
end $$;

-- 공개 키(anon)로 사건·계약서가 보이던 구멍 막기 (2026-11-20)
-- 원래 설계(20260704_rls_and_sign.sql): anon에는 표 정책을 만들지 않는다. 서명 페이지는 sign_fetch/sign_submit 함수로만 들어온다.
-- 운영 DB에 손으로 추가돼 있던 두 정책을 지우고, anon의 표 권한과 내부용 함수 실행 권한을 거둔다.
-- 직원 웹앱은 로그인(authenticated) 상태로 읽으므로 그대로 동작한다. 사건 화면·봇·예약 작업은 서버 키(service_role)·postgres로 돌아 영향 없음.

drop policy if exists "temp_public_read" on public.cases;
drop policy if exists "allow all for anon" on public.contracts;

-- anon은 어떤 표도 직접 만지지 않는다(RLS가 1차로 막고, 권한이 2차로 막는다)
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- 내부용(예약 작업·트리거 전용) SECURITY DEFINER 함수: 바깥에서 /rest/v1/rpc 로 부르지 못하게
revoke execute on function public.case_no_put(bigint, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.case_file_prefetch() from public, anon, authenticated;
revoke execute on function public.case_view_warm() from public, anon, authenticated;
revoke execute on function public.case_no_from_case(public.cases, boolean) from public, anon, authenticated;
revoke execute on function public.case_no_trg_cases() from public, anon, authenticated;
revoke execute on function public.case_no_trg_inv() from public, anon, authenticated;
revoke execute on function public.case_no_trg_room() from public, anon, authenticated;

-- 검색 경로 고정(보안 권고)
alter function public.lw_parse_delivery set search_path = public;
alter function public.norm_case_no set search_path = public;
alter function public.case_no_title set search_path = public;

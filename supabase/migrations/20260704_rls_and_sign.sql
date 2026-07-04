-- ============================================================================
--  법무법인 정서 — 행 보안(RLS) + 서명 링크 안전화
--  목적:
--    (1) contracts / cases 테이블에 RLS를 켜서 "익명키로 전체 조회·수정·삭제"를 차단
--        → 로그인한 직원(authenticated)만 목록·저장·삭제 가능
--    (2) 외부 의뢰인 서명 링크(?sign=토큰)는 로그인 없이 열려야 하므로,
--        테이블을 직접 열지 않고 "토큰을 서버에서 검증하는 함수"로만 그 한 건에 접근
--    (3) 서명 무결성 해시(signed_hash)를 서버(이 함수 안)에서 계산 → 위조 불가
--
--  적용: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
--        (자세한 순서는 저장소의 보안설정_가이드.md 참고)
--  주의: 한 번 더 실행해도 안전하도록 작성됨(idempotent).
-- ============================================================================

-- 서버측 SHA-256 계산에 필요 (Supabase 기본 제공)
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) RLS 켜기 — 정책이 없으면 이 순간부터 익명 접근은 전부 거부된다.
-- ----------------------------------------------------------------------------
alter table public.contracts enable row level security;
alter table public.cases     enable row level security;

-- ----------------------------------------------------------------------------
-- 2) 로그인한 직원(authenticated) 정책 — 앱의 일반 기능 전부 허용
--    · contracts: 목록/작성/수정/삭제
--    · cases:     자동완성 조회(읽기 전용)
--    (cases 데이터 적재는 백엔드 service_role 작업이 담당 → RLS 영향 없음)
-- ----------------------------------------------------------------------------
drop policy if exists "staff_full_contracts" on public.contracts;
create policy "staff_full_contracts"
  on public.contracts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "staff_read_cases" on public.cases;
create policy "staff_read_cases"
  on public.cases
  for select
  to authenticated
  using (true);

-- 익명(anon)에는 어떤 테이블 정책도 만들지 않는다 → 직접 접근 완전 차단.
-- 외부 서명 흐름은 아래 함수(RPC)로만 열어 준다.

-- ----------------------------------------------------------------------------
-- 3) 서명 링크용 함수 (SECURITY DEFINER)
--    익명 사용자는 이 함수만 호출할 수 있고, 함수는 토큰이 맞는 "그 한 건"만 다룬다.
-- ----------------------------------------------------------------------------

-- 3-A) 서명 화면에 보여줄 계약서 1건 조회 (+ 최초 열람시각 기록)
--      반환: 화면 렌더에 필요한 최소 필드만. 다른 의뢰인 정보는 절대 나가지 않음.
create or replace function public.sign_fetch(p_token text, p_ua text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.contracts%rowtype;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into r from public.contracts where sign_token = p_token limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if r.sign_expires_at is not null and r.sign_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if r.sign_status = 'signed' and r.counterparty_signature is not null then
    return jsonb_build_object('ok', false, 'reason', 'signed');
  end if;

  -- 최초 열람 시각 1회 기록 (증빙용) — 실패해도 조회는 계속
  if r.accessed_at is null then
    update public.contracts
       set accessed_at = now(),
           audit = coalesce(audit, '{}'::jsonb)
                   || jsonb_build_object('accessed_ua', left(coalesce(p_ua,''), 300))
     where sign_token = p_token and accessed_at is null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'doc_type',        r.doc_type,
    'case_num',        r.case_num,
    'case_name',       r.case_name,
    'court',           r.court,
    'client_name',     r.client_name,
    'form_data',       r.form_data,
    'sign_status',     r.sign_status,
    'sign_expires_at', r.sign_expires_at,
    'recipient_name',  r.recipient_name
  );
end;
$$;

-- 3-B) 의뢰인 서명 제출
--      · 유효한(미서명·미만료) 토큰에만 1회 기록 → 재서명·덮어쓰기 불가
--      · signed_at, signed_hash 를 서버에서 확정 → 클라이언트가 위조 불가
create or replace function public.sign_submit(
  p_token             text,
  p_signature         text,   -- 서명 이미지 dataURL (data:image/png;base64,...)
  p_form_data         jsonb,  -- 의뢰인이 입력/수정한 위임인 정보 포함 form_data
  p_signer_tel        text,
  p_signer_ssn_masked text,
  p_consent           boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.contracts%rowtype;
  v_now      timestamptz := now();
  v_snapshot jsonb;
  v_hash     text;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_signature is null or p_signature not like 'data:image/%' then
    return jsonb_build_object('ok', false, 'reason', 'nosig');
  end if;
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'reason', 'noconsent');
  end if;

  -- 유효한 대상만 잠가서 읽는다 (동시 이중 제출 방지)
  select * into r
    from public.contracts
   where sign_token = p_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if r.sign_expires_at is not null and r.sign_expires_at < v_now then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if r.sign_status = 'signed' and r.counterparty_signature is not null then
    return jsonb_build_object('ok', false, 'reason', 'signed');
  end if;

  -- 서명 시점 스냅샷을 서버에서 구성하고, 그 위에 해시를 계산 (무결성의 기준점)
  v_snapshot := jsonb_build_object(
    'doc_type',    r.doc_type,
    'case_num',    r.case_num,
    'case_name',   r.case_name,
    'court',       r.court,
    'client_name', r.client_name,
    'form_data',   coalesce(p_form_data, r.form_data),
    'signed_at',   to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  v_hash := encode(digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex');

  update public.contracts
     set counterparty_signature = p_signature,
         sign_status            = 'signed',
         form_data              = coalesce(p_form_data, form_data),
         signed_snapshot        = v_snapshot,
         signed_hash            = v_hash,
         signed_at              = v_now,
         consent_agreed         = true,
         updated_at             = v_now,
         audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
                   'signed_at',         to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'consent',           true,
                   'hash_algo',         'SHA-256',
                   'hash_computed_by',  'server',
                   'signer_tel',        p_signer_tel,
                   'signer_ssn_masked', p_signer_ssn_masked
                 )
   where sign_token = p_token;

  return jsonb_build_object('ok', true, 'signed_at', v_now, 'signed_hash', v_hash);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) 함수 실행 권한 — 기본(public) 권한을 걷어내고 필요한 역할에만 부여
--    익명 방문자(anon)와 로그인 직원(authenticated) 모두 서명 함수는 호출 가능,
--    그러나 테이블 자체에는 여전히 접근 불가.
-- ----------------------------------------------------------------------------
revoke all on function public.sign_fetch(text, text)                            from public;
revoke all on function public.sign_submit(text, text, jsonb, text, text, boolean) from public;

grant execute on function public.sign_fetch(text, text)                            to anon, authenticated;
grant execute on function public.sign_submit(text, text, jsonb, text, text, boolean) to anon, authenticated;

-- ============================================================================
--  끝. 적용 후 확인:
--   · select relrowsecurity from pg_class where relname in ('contracts','cases');
--       → 둘 다 t(true) 여야 함
--   · 로그아웃 상태에서 REST로 contracts 를 조회하면 빈 배열/거부가 되어야 정상
--   · 서명 링크(?sign=토큰)는 여전히 열리고 서명 제출이 되어야 정상
-- ============================================================================

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
  v_base     jsonb;   -- 변호사가 만든 원본 form_data (계약 본문 = 불변)
  v_signer   jsonb;   -- 서명자가 보낸 data (신뢰하지 않음, 화이트리스트만 사용)
  v_data     jsonb;   -- 원본 data + 서명자 허용필드 병합 결과
  v_form     jsonb;   -- 서버가 확정한 최종 form_data (해시·저장 대상)
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

  -- ── 무결성 핵심 ──────────────────────────────────────────────
  --  계약 본문(업무범위·수임료·계좌·특약·조항 등)은 '원본 row'(변호사 작성)에서만 취하고,
  --  서명자에게선 '본인 식별정보'만 화이트리스트로 병합한다.
  --  → 서명자가 토큰으로 수임료·업무범위 등을 바꿔 제출해도 서버가 무시하므로
  --    "양 당사자가 동일 문서에 합의"가 보장되고, 그 내용에만 해시가 찍힌다.
  v_base   := coalesce(r.form_data, '{}'::jsonb);
  v_signer := coalesce(p_form_data -> 'data', '{}'::jsonb);
  v_data   := coalesce(v_base -> 'data', '{}'::jsonb)
              || jsonb_strip_nulls(jsonb_build_object(
                   'tel',   v_signer ->> 'tel',      -- 연락처
                   'ssn',   v_signer ->> 'ssn',      -- 주민등록번호(본인확인용)
                   'addr',  v_signer ->> 'addr',     -- 주소
                   'email', v_signer ->> 'email',    -- 이메일
                   'payer', v_signer ->> 'payer'     -- 입금자명
                 ));
  v_form := jsonb_set(v_base, '{data}', v_data, true);
  -- 계산서 발행방식(현금영수증/세금계산서)만 서명자 선택 허용
  if p_form_data ? 'receipt' then
    v_form := jsonb_set(v_form, '{receipt}', p_form_data -> 'receipt', true);
  end if;

  -- 서명 시점 스냅샷을 서버에서 구성하고, 그 위에 해시를 계산 (무결성의 기준점)
  v_snapshot := jsonb_build_object(
    'doc_type',    r.doc_type,
    'case_num',    r.case_num,
    'case_name',   r.case_name,
    'court',       r.court,
    'client_name', r.client_name,
    'form_data',   v_form,
    'signed_at',   to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  v_hash := encode(digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex');

  update public.contracts
     set counterparty_signature = p_signature,
         sign_status            = 'signed',
         form_data              = v_form,   -- 서버가 확정한 내용만 저장(클라 위조 반영 안 함)
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

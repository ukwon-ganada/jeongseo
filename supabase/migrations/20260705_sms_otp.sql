-- ============================================================================
--  SMS 본인확인(OTP) — 서명 전 휴대폰 인증 (2026-07-05, 전자서명 A)
--
--  구성:
--    · sign_otp 테이블 : 토큰별 OTP 상태(코드해시·만료·시도·발송·인증) 보관
--                        RLS 켜고 정책 없음 → 익명/직원 직접 접근 불가.
--                        발송 Edge Function(service_role)과 아래 함수(SECURITY DEFINER)만 접근.
--    · sign_otp_verify(token, code) : 서명자가 받은 코드 검증 → 성공 시 verified_at 기록
--    · sign_submit : 'OTP 인증 완료' 여야만 서명 확정되도록 게이트 추가 (우회 불가)
--
--  ※ 이 파일은 SMS 준비(솔라피 가입·발신번호 등록·Edge Function 배포·클라 OTP_ENABLED=true)가
--    끝난 뒤 실행하세요. 실행 시점부터 sign_submit이 OTP를 요구합니다.
--    (준비 전이라면 실행하지 마세요 — 기존 서명 흐름은 그대로 동작)
--
--  적용: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run. (여러 번 실행해도 안전)
-- ============================================================================
create extension if not exists pgcrypto;

-- ── OTP 상태 테이블 ─────────────────────────────────────────────────────────
create table if not exists public.sign_otp (
  sign_token   text primary key,
  code_hash    text not null,            -- sha256(코드 + 토큰) hex (평문 코드는 저장 안 함)
  phone        text,                      -- 발송한 번호(마스킹본)
  expires_at   timestamptz not null,
  attempts     integer not null default 0,   -- 검증 시도 횟수(무차별 방지)
  sent_count   integer not null default 0,   -- 발송 횟수(문자폭탄 방지)
  last_sent_at timestamptz,
  verified_at  timestamptz,               -- 인증 성공 시각
  created_at   timestamptz not null default now()
);
alter table public.sign_otp enable row level security;
-- 정책을 만들지 않는다 → anon/authenticated는 직접 접근 불가.
-- 발송 Edge Function은 service_role(RLS 우회)로, 검증/서명은 SECURITY DEFINER 함수로만 접근.

-- ── 서명자 OTP 검증 (익명 호출 허용) ────────────────────────────────────────
create or replace function public.sign_otp_verify(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.sign_otp%rowtype;
begin
  if p_token is null or p_code is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into o from public.sign_otp where sign_token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'none');       -- 발송 이력 없음
  end if;
  if o.verified_at is not null then
    return jsonb_build_object('ok', true);                          -- 이미 인증됨
  end if;
  if o.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');    -- 만료(재발송 필요)
  end if;
  if o.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');     -- 시도 초과
  end if;
  if o.code_hash <> encode(digest(convert_to(regexp_replace(p_code,'\D','','g') || p_token, 'UTF8'), 'sha256'), 'hex') then
    update public.sign_otp set attempts = attempts + 1 where sign_token = p_token;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'remaining', 5 - (o.attempts + 1));
  end if;
  update public.sign_otp set verified_at = now() where sign_token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sign_otp_verify(text, text) from public;
grant execute on function public.sign_otp_verify(text, text) to anon, authenticated;

-- ── sign_submit: OTP 인증 게이트 추가 ───────────────────────────────────────
--   (앞선 무결성 버전 + "OTP 인증 완료 필수" 한 조건만 추가)
create or replace function public.sign_submit(
  p_token             text,
  p_signature         text,
  p_form_data         jsonb,
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
  v_base     jsonb;
  v_signer   jsonb;
  v_data     jsonb;
  v_form     jsonb;
  v_otp      public.sign_otp%rowtype;
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

  select * into r from public.contracts where sign_token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if r.sign_expires_at is not null and r.sign_expires_at < v_now then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if r.sign_status = 'signed' and r.counterparty_signature is not null then
    return jsonb_build_object('ok', false, 'reason', 'signed');
  end if;

  -- ★ SMS 본인확인(OTP) 통과 필수 — 인증 안 하면 서명 불가 (클라 우회 방지)
  select * into v_otp from public.sign_otp where sign_token = p_token;
  if not found or v_otp.verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'otp_required');
  end if;

  -- 무결성: 계약 본문은 원본에서, 서명자에게선 본인 식별정보 화이트리스트만 병합
  v_base   := coalesce(r.form_data, '{}'::jsonb);
  v_signer := coalesce(p_form_data -> 'data', '{}'::jsonb);
  v_data   := coalesce(v_base -> 'data', '{}'::jsonb)
              || jsonb_strip_nulls(jsonb_build_object(
                   'tel',   v_signer ->> 'tel',
                   'ssn',   v_signer ->> 'ssn',
                   'addr',  v_signer ->> 'addr',
                   'email', v_signer ->> 'email',
                   'payer', v_signer ->> 'payer'
                 ));
  v_form := jsonb_set(v_base, '{data}', v_data, true);
  if p_form_data ? 'receipt' then
    v_form := jsonb_set(v_form, '{receipt}', p_form_data -> 'receipt', true);
  end if;

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
         form_data              = v_form,
         signed_snapshot        = v_snapshot,
         signed_hash            = v_hash,
         signed_at              = v_now,
         consent_agreed         = true,
         updated_at             = v_now,
         audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
                   'signed_at',            to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'consent',              true,
                   'hash_algo',            'SHA-256',
                   'hash_computed_by',     'server',
                   'signer_tel',           p_signer_tel,
                   'signer_ssn_masked',    p_signer_ssn_masked,
                   'phone_verified',       true,
                   'phone_verified_phone', v_otp.phone,
                   'phone_verified_at',    to_char(v_otp.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                 )
   where sign_token = p_token;

  return jsonb_build_object('ok', true, 'signed_at', v_now, 'signed_hash', v_hash);
end;
$$;

revoke all on function public.sign_submit(text, text, jsonb, text, text, boolean) from public;
grant execute on function public.sign_submit(text, text, jsonb, text, text, boolean) to anon, authenticated;

-- ============================================================================
--  확인:
--   · 인증 전 서명 시도 → sign_submit 이 {ok:false, reason:'otp_required'} 반환해야 정상
--   · sign_otp_verify 로 올바른 코드 검증 후 서명하면 성공해야 정상
-- ============================================================================

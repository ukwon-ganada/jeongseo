-- ============================================================================
--  전자서명 D — 접속 IP 기록 (부인방지 강화, 2026-07-05)
--  열람(sign_fetch)·서명(sign_submit) 시점의 클라이언트 IP를 audit에 남긴다.
--  (검증확인 IP는 OTP 파일의 sign_otp_verify에 포함)
--
--  ※ 이 파일은 지금 실행해도 안전합니다(OTP 게이트 없음 = 기존 서명 흐름 유지).
--    여기 sign_submit은 '무결성 버전 + IP'이며, 이전 20260705_sign_submit_integrity.sql 을 대체합니다.
--  적용: SQL Editor에 전체 붙여넣고 Run. (여러 번 실행해도 안전)
-- ============================================================================
create extension if not exists pgcrypto;

-- 요청 헤더에서 클라이언트 IP 추출 (Supabase/프록시의 x-forwarded-for 첫 IP)
create or replace function public._client_ip() returns text
language plpgsql stable
set search_path = public, extensions
as $$
declare h jsonb; xff text;
begin
  begin
    h := current_setting('request.headers', true)::jsonb;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  xff := coalesce(h->>'x-forwarded-for', h->>'x-real-ip', h->>'cf-connecting-ip', h->>'fly-client-ip');
  if xff is null or length(trim(xff)) = 0 then return null; end if;
  return trim(split_part(xff, ',', 1));
end;
$$;

-- ── sign_fetch: 최초 열람 시 IP도 기록 ──────────────────────────────────────
create or replace function public.sign_fetch(p_token text, p_ua text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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

  if r.accessed_at is null then
    update public.contracts
       set accessed_at = now(),
           audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
                     'accessed_ua', left(coalesce(p_ua,''), 300),
                     'accessed_ip', public._client_ip()
                   )
     where sign_token = p_token and accessed_at is null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'doc_type', r.doc_type, 'case_num', r.case_num, 'case_name', r.case_name,
    'court', r.court, 'client_name', r.client_name, 'form_data', r.form_data,
    'sign_status', r.sign_status, 'sign_expires_at', r.sign_expires_at,
    'recipient_name', r.recipient_name
  );
end;
$$;

-- ── sign_submit: 무결성 버전 + 서명 IP 기록 (OTP 게이트 없음) ────────────────
create or replace function public.sign_submit(
  p_token text, p_signature text, p_form_data jsonb,
  p_signer_tel text, p_signer_ssn_masked text, p_consent boolean
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  r public.contracts%rowtype;
  v_now timestamptz := now();
  v_snapshot jsonb; v_hash text;
  v_base jsonb; v_signer jsonb; v_data jsonb; v_form jsonb;
begin
  if p_token is null or length(trim(p_token)) = 0 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if p_signature is null or p_signature not like 'data:image/%' then return jsonb_build_object('ok', false, 'reason', 'nosig'); end if;
  if p_consent is not true then return jsonb_build_object('ok', false, 'reason', 'noconsent'); end if;

  select * into r from public.contracts where sign_token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notfound'); end if;
  if r.sign_expires_at is not null and r.sign_expires_at < v_now then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if r.sign_status = 'signed' and r.counterparty_signature is not null then return jsonb_build_object('ok', false, 'reason', 'signed'); end if;

  -- 무결성: 계약 본문은 원본, 서명자에게선 본인 식별정보만 병합
  v_base := coalesce(r.form_data, '{}'::jsonb);
  v_signer := coalesce(p_form_data -> 'data', '{}'::jsonb);
  v_data := coalesce(v_base -> 'data', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'tel', v_signer ->> 'tel', 'ssn', v_signer ->> 'ssn', 'addr', v_signer ->> 'addr',
              'email', v_signer ->> 'email', 'payer', v_signer ->> 'payer'));
  v_form := jsonb_set(v_base, '{data}', v_data, true);
  if p_form_data ? 'receipt' then v_form := jsonb_set(v_form, '{receipt}', p_form_data -> 'receipt', true); end if;

  v_snapshot := jsonb_build_object(
    'doc_type', r.doc_type, 'case_num', r.case_num, 'case_name', r.case_name,
    'court', r.court, 'client_name', r.client_name, 'form_data', v_form,
    'signed_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  v_hash := encode(digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex');

  update public.contracts
     set counterparty_signature = p_signature, sign_status = 'signed', form_data = v_form,
         signed_snapshot = v_snapshot, signed_hash = v_hash, signed_at = v_now,
         consent_agreed = true, updated_at = v_now,
         audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
                   'signed_at', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'consent', true, 'hash_algo', 'SHA-256', 'hash_computed_by', 'server',
                   'signer_tel', p_signer_tel, 'signer_ssn_masked', p_signer_ssn_masked,
                   'signed_ip', public._client_ip(),
                   'consent_detail', p_form_data -> '__consent')
   where sign_token = p_token;

  return jsonb_build_object('ok', true, 'signed_at', v_now, 'signed_hash', v_hash);
end;
$$;

revoke all on function public.sign_submit(text, text, jsonb, text, text, boolean) from public;
grant execute on function public.sign_submit(text, text, jsonb, text, text, boolean) to anon, authenticated;

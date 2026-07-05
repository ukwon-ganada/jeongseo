-- ============================================================================
--  서명 무결성 보강 — sign_submit 갱신 (2026-07-05)
--  목적: 서명자가 토큰으로 수임료·업무범위·특약 등 '계약 본문'을 바꿔 제출해도
--        서버가 무시하도록 함. 계약 본문은 원본 row(변호사 작성)에서만 취하고,
--        서명자에게선 본인 식별정보(연락처·주민·주소·이메일·입금자명)와
--        계산서 발행방식만 병합한다. → "양 당사자가 동일 문서에 합의" 보장.
--
--  적용: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣고 Run.
--        (기존 함수를 CREATE OR REPLACE 로 덮어씀. 여러 번 실행해도 안전)
-- ============================================================================
create extension if not exists pgcrypto;

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
set search_path = public, extensions
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

-- 실행 권한 재확인(익명 서명자 + 로그인 직원)
revoke all on function public.sign_submit(text, text, jsonb, text, text, boolean) from public;
grant execute on function public.sign_submit(text, text, jsonb, text, text, boolean) to anon, authenticated;

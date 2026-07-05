-- ============================================================================
--  기존 계약서의 전체 주민등록번호 → 생년월일+성별(7자리)로 정리 (개인정보 최소화)
--  (2026-07-05, C 후속: 과거 저장분에 남은 주민번호 뒷자리 제거)
--
--  대상 위치:
--    · contracts.form_data       -> data -> ssn   (편집용 원본)
--    · contracts.signed_snapshot -> form_data -> data -> ssn  (서명 시점 스냅샷)
--  서명 완료본은 스냅샷의 ssn을 자른 뒤 signed_hash를 재계산하고,
--  원본 해시와 정리 시각을 audit에 남겨 추적 가능하게 한다.
--  (계약 본문·서명은 그대로. 바뀌는 건 주민번호 뒷자리뿐)
--
--  적용: Supabase 대시보드 → SQL Editor → 이 파일 전체 붙여넣고 Run.
--        여러 번 실행해도 안전(이미 7자리면 건드리지 않음).
--  ※ 실행 전, 아래 STEP 0 미리보기로 대상 건수를 먼저 확인하길 권장.
-- ============================================================================
create extension if not exists pgcrypto;

-- 주민번호/문자열을 '생년월일 6자리 + 성별 1자리'(예: 900101-1)로 자르는 도우미
-- pg_temp 스키마 → 이 세션에서만 존재하고 자동 소멸
create or replace function pg_temp._birth7(s text) returns text
language sql immutable as $$
  select case
    when s is null then null
    when length(regexp_replace(s, '\D', '', 'g')) <= 7 then s   -- 이미 7자리 이하면 그대로
    else left(regexp_replace(s, '\D', '', 'g'), 6) || '-' ||
         substr(regexp_replace(s, '\D', '', 'g'), 7, 1)
  end;
$$;

-- ── STEP 0. 미리보기: 전체 주민번호(8자리 이상)가 남아있는 건수 ──────────────
select
  count(*) filter (
    where length(regexp_replace(coalesce(form_data->'data'->>'ssn',''),'\D','','g')) > 7
  ) as "form_data에 남은 건",
  count(*) filter (
    where length(regexp_replace(coalesce(signed_snapshot->'form_data'->'data'->>'ssn',''),'\D','','g')) > 7
  ) as "signed_snapshot에 남은 건"
from public.contracts;

-- ── STEP 1. 편집용 form_data.data.ssn 정리 ──────────────────────────────────
update public.contracts
   set form_data = jsonb_set(form_data, '{data,ssn}',
                             to_jsonb(pg_temp._birth7(form_data->'data'->>'ssn')))
 where form_data->'data' ? 'ssn'
   and length(regexp_replace(coalesce(form_data->'data'->>'ssn',''),'\D','','g')) > 7;

-- ── STEP 2. 서명 완료본: 스냅샷 ssn 정리 + 해시 재계산 + 감사기록 ────────────
with red as (
  select id,
         jsonb_set(signed_snapshot, '{form_data,data,ssn}',
                   to_jsonb(pg_temp._birth7(signed_snapshot->'form_data'->'data'->>'ssn'))) as new_snap,
         signed_hash as old_hash
    from public.contracts
   where signed_snapshot is not null
     and signed_snapshot->'form_data'->'data' ? 'ssn'
     and length(regexp_replace(coalesce(signed_snapshot->'form_data'->'data'->>'ssn',''),'\D','','g')) > 7
)
update public.contracts c
   set signed_snapshot = red.new_snap,
       -- 재계산된 스냅샷 기준으로 무결성 해시 재산정(검증식과 일치 유지)
       signed_hash = encode(digest(convert_to(red.new_snap::text, 'UTF8'), 'sha256'), 'hex'),
       audit = coalesce(c.audit, '{}'::jsonb) || jsonb_build_object(
                 'ssn_redacted_at',        to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                 'hash_before_redaction',  red.old_hash,
                 'redaction_note',         'privacy: 주민번호 뒷자리 삭제(생년월일+성별만 유지)'
               )
  from red
 where c.id = red.id;

-- ── STEP 3. 검증: 이제 8자리 이상 남은 것이 없어야 함 + 해시 재현성 ─────────
select
  count(*) filter (
    where length(regexp_replace(coalesce(form_data->'data'->>'ssn',''),'\D','','g')) > 7
  ) as "form_data 남은(0이어야)",
  count(*) filter (
    where length(regexp_replace(coalesce(signed_snapshot->'form_data'->'data'->>'ssn',''),'\D','','g')) > 7
  ) as "snapshot 남은(0이어야)",
  count(*) filter (
    where signed_snapshot is not null
      and signed_hash <> encode(digest(convert_to(signed_snapshot::text,'UTF8'),'sha256'),'hex')
  ) as "해시불일치(0이어야)"
from public.contracts;

-- ============================================================================
--  끝. STEP 0과 STEP 3의 숫자를 비교해 정리가 완료됐는지 확인하세요.
-- ============================================================================

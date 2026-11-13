-- 사건정보 기본정보: 의뢰인 전화 말고 가족 등 추가 전화 (석원 2026-11-13)
-- 값은 JSON 글자: [{"n":"어머니","p":"010-…"}]  (case-view 가 정리해서 저장, 수정 기록은 case_info_log)
alter table public.case_info add column if not exists extra_phones text;

-- ============================================================================
--  서면 파일: 타임라인 제출 줄에 붙을 파일을 직원이 직접 골랐을 때 기억하는 칸
--  (자동 규칙 = 그날 마지막 파일. 틀렸을 때만 직원이 바꾸고, 그 선택이 우선)
--  적용: SQL Editor에 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================
alter table public.case_file add column if not exists lp_num  bigint;       -- 이 파일이 최종본인 로웨어 제출 기록(lw_process_events.lp_num)
alter table public.case_file add column if not exists pick_by text;         -- 고른 직원
alter table public.case_file add column if not exists pick_at timestamptz;  -- 고른 시각

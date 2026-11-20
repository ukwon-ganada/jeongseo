-- 방 대화 AI가 "이 글이 그 서류를 실제로 냈다"고 판단한 서류(항고장·재정신청서 등). 빈 문자열 = AI가 제출 아님으로 판단, null = 판단 없음(직원 입력·예전 줄)
-- 2026-11-20 석원 결정: 수사 기한의 제출 여부는 낱말이 아니라 AI의 맥락 판단으로
alter table public.room_event add column if not exists filed text;

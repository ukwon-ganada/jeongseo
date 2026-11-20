-- 사건정보 인적사항 주민번호(2026-11-17 석원 요청). case_info는 서버 함수(서비스 키)만 읽고 쓴다
alter table public.case_info add column if not exists client_rrn text;

-- 변호사 주민번호·사무원 생년월일(검찰 위임장·열람등사용)을 공개 리포 코드에서 빼서 DB로 옮김 (2026-11-20)
-- 값은 이 파일에 적지 않는다(리포가 공개). 운영 DB에서 직접 넣는다.
-- 로그인한 직원(authenticated)만 읽을 수 있고, 웹앱 lawyers.js가 로그인 뒤 빈 칸만 채운다.
create table if not exists public.firm_people (
  kind text not null check (kind in ('lawyer', 'clerk')),
  name text not null,
  private_no text not null default '',   -- lawyer: 주민번호, clerk: 생년월일(yy.mm.dd)
  sort int not null default 0,
  primary key (kind, name)
);
alter table public.firm_people enable row level security;
revoke all on public.firm_people from anon;
drop policy if exists staff_read_firm_people on public.firm_people;
create policy staff_read_firm_people on public.firm_people for select to authenticated using (true);

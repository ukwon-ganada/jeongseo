-- ============================================================================
--  법무법인 정서 — PC "정서 사건 도우미" (사건방에서 한 번 클릭 → PC에 사건 화면)
--
--  흐름:
--    웍스 사건방 ≡ 메뉴 "이 방 사건 보기"(리치 메뉴 postback, 방에 글 안 남음)
--      → 봇 콜백(works-bot-callback)이 누가·어느 방에서 눌렀는지 pc_open_request 에 기록
--      → 그 사람 PC의 도우미가 pc-helper-wait 로 기다리다 받아서 브라우저로 사건 화면을 연다
--
--  세 표 모두 서버 함수(service role)만 씀. 익명·직원 직접 접근은 막음(정책 없음).
--  works_room_case 는 임시 표: 재설계의 '방' 표가 생기면 그쪽을 보도록 바꾼다.
--
--  적용: SQL Editor에 전체 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================

-- 1) 방 ↔ 사건 (방 제목에서 자동으로 채울 예정)
--    한 방에 원심·항소심이 함께 붙고(상급심이 주 사건), 공동피고인이면 한 사건에 방이 여럿 → (channel_id, l_num) 쌍.
--    l_num = cases.l_num(로웨어 사건 고유번호). case_no 는 정규화한 형태(2026노1821: 20xx+부호+앞 0 없는 번호).
create table if not exists public.works_room_case (
  channel_id text not null,
  l_num      text not null,
  case_no    text,
  is_primary boolean not null default false,
  status     text not null default '대상' check (status in ('대상','보류','종결')),  -- 보류 = 어느 사건인지 확정 못 함
  room_title text,
  updated_at timestamptz not null default now(),
  primary key (channel_id, l_num)
);

-- 2) 도우미가 깔린 PC (토큰은 해시만 저장)
create table if not exists public.pc_helper_device (
  id            uuid primary key default gen_random_uuid(),
  works_user_id text not null,
  label         text,
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

-- 3) "이 방 사건 보기" 누른 기록 (도우미가 받아 가면 delivered_at 채움)
create table if not exists public.pc_open_request (
  id            bigserial primary key,
  works_user_id text not null,
  channel_id    text not null,
  l_num         text,
  case_no       text,
  room_status   text,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);
create index if not exists pc_open_request_wait
  on public.pc_open_request (works_user_id, created_at desc) where delivered_at is null;

alter table public.works_room_case  enable row level security;
alter table public.pc_helper_device enable row level security;
alter table public.pc_open_request  enable row level security;

-- 4) 도우미 토큰 발급 (관리자가 SQL Editor에서 실행 → 나온 토큰을 그 PC 설치 때 한 번 입력)
--    예: select public.pc_helper_issue('웍스 사용자ID', '석원 사무실 PC');
create or replace function public.pc_helper_issue(p_user text, p_label text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(24), 'hex');
begin
  insert into pc_helper_device (works_user_id, label, token_hash)
  values (p_user, p_label, encode(digest(t, 'sha256'), 'hex'));
  return t;
end $$;
revoke all on function public.pc_helper_issue(text, text) from public, anon, authenticated;

-- 5) 오래된 기록 정리용 (하루 지난 것) — 나중에 pg_cron에 걸 수 있음
create or replace function public.pc_open_request_cleanup()
returns void language sql security definer set search_path = public as $$
  delete from pc_open_request where created_at < now() - interval '1 day';
$$;
revoke all on function public.pc_open_request_cleanup() from public, anon, authenticated;

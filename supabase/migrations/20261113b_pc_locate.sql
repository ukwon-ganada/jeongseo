-- ============================================================================
--  법무법인 정서 — PC에서 [사건 보기] 하나로 그 방 사건 열기 (도우미가 방 제목 읽기)
--
--  흐름:
--    PC 웍스 사건방 메뉴 [사건 보기](uri) → 브라우저에 사건 화면(방 정보 없음)
--      → case-view 'locate' 가 pc_locate 에 한 줄 만듦
--      → 그 직원 PC 도우미가 pc-helper-wait 로 받아 웍스 창 위쪽 방 제목을 글자 인식
--      → 읽은 글을 pc-helper-wait 로 보내면 서버가 방 제목 표(works_room_case)와 맞춰 channel_id 기록
--      → case-view 가 그 방 사건을 돌려줌
--
--  서버 함수(service role)만 씀. 적용: SQL Editor에 전체 붙여넣고 Run. 여러 번 실행해도 안전.
-- ============================================================================
create table if not exists public.pc_locate (
  id            bigserial primary key,
  works_user_id text not null,
  created_at    timestamptz not null default now(),
  taken_at      timestamptz,          -- 도우미가 받아 감
  done_at       timestamptz,          -- 도우미가 결과를 보냄
  channel_id    text,                 -- 찾은 방 (못 찾으면 null)
  how           text,                 -- case-no / title / ambiguous / no-match / no-header / error
  score         real,
  header_text   text                  -- 읽은 방 제목 (확인용, 하루 뒤 지움)
);
create index if not exists pc_locate_wait on public.pc_locate (works_user_id, created_at desc) where taken_at is null;
alter table public.pc_locate enable row level security;

-- 하루 지난 기록 정리 (기존 정리 함수에 같이 넣음)
create or replace function public.pc_open_request_cleanup()
returns void language sql security definer set search_path = public as $$
  delete from pc_open_request where created_at < now() - interval '1 day';
  delete from pc_locate       where created_at < now() - interval '1 day';
$$;
revoke all on function public.pc_open_request_cleanup() from public, anon, authenticated;

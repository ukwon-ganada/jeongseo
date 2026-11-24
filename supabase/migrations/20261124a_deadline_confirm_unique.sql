-- 기한 버튼 연타(2026-11-24): 되돌리지 않은 같은 확정은 하나만 → 확인 글도 한 번만 나간다
create unique index if not exists deadline_confirm_one_live
  on public.deadline_confirm (l_code, kind, due, action) where undone_at is null;

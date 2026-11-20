-- 도우미 v2.4: 방 제목을 못 읽었을 때 그 이유(직접 읽기·찍기 각각 왜 안 됐는지)를 남긴다
alter table public.pc_locate add column if not exists why text;

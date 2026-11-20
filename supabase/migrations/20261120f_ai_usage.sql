-- AI(Anthropic) 사용량 기록 (2026-11-20): case-view·works-bot-callback 의 AI 호출마다 토큰 수 한 줄
create table if not exists public.ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  fn text not null,
  model text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read int not null default 0,
  cache_write int not null default 0
);
create index if not exists ai_usage_at on public.ai_usage (at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- 날짜·함수·모델별 합계와 대략 비용(달러, 2026-11 정가: 백만 토큰당 입력/출력/캐시 읽기)
--   opus-5-5 4/20/0.20 · opus-5·opus-4-8 5/25/0.50 · sonnet-5-5 2/10/0.10 · sonnet-5 2/10/0.20 · haiku-5-5 0.10/0.50/0.01
--   캐시 쓰기는 입력값의 1.25배
create or replace view public.ai_usage_daily with (security_invoker = true) as
with p as (
  select u.*,
    case when model like 'claude-opus-5-5%' then 4 when model like 'claude-opus%' then 5
         when model like 'claude-sonnet%' then 2 when model like 'claude-haiku-5-5%' then 0.10 else 4 end as pin,
    case when model like 'claude-opus-5-5%' then 20 when model like 'claude-opus%' then 25
         when model like 'claude-sonnet%' then 10 when model like 'claude-haiku-5-5%' then 0.50 else 20 end as pout,
    case when model like 'claude-opus-5-5%' or model like 'claude-sonnet-5-5%' then 0.05 else 0.1 end as rread
  from public.ai_usage u
)
select (at at time zone 'Asia/Seoul')::date as day, fn, model, count(*) calls,
       sum(input_tokens) input_tokens, sum(output_tokens) output_tokens,
       round(sum((input_tokens + cache_write * 1.25 + cache_read * rread) / 1e6 * pin + output_tokens / 1e6 * pout)::numeric, 3) as usd
from p group by 1, 2, 3;
revoke all on public.ai_usage_daily from anon, authenticated;

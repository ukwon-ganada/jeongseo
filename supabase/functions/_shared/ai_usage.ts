// AI(Anthropic) 사용량 기록 (2026-11-20): 얼마나 쓰는지 몰라 비용을 추정만 하던 문제 보완.
// 함수의 fetch 를 감싸서, api.anthropic.com 응답의 usage(토큰 수)를 ai_usage 표에 한 줄 남긴다.
// 응답 본문은 복사본(clone)에서 읽으므로 원래 처리에는 영향이 없고, 기록이 실패해도 무시한다.

type UsageEnv = { sbUrl: string; sbKey: string };

function background(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch(() => {})); else p.catch(() => {});
}

export function usageRow(fn: string, j: any) {
  const u = j?.usage;
  if (!u) return null;
  return {
    fn, model: String(j?.model || "").slice(0, 60),
    input_tokens: Number(u.input_tokens) || 0,
    output_tokens: Number(u.output_tokens) || 0,
    cache_read: Number(u.cache_read_input_tokens) || 0,
    cache_write: Number(u.cache_creation_input_tokens) || 0,
  };
}

export function withUsage(fetcher: typeof fetch, env: UsageEnv, fn: string): typeof fetch {
  if ((fetcher as any).__usage) return fetcher;
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetcher(input as any, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (res.ok && url.startsWith("https://api.anthropic.com/") && env.sbUrl && env.sbKey) {
      const copy = res.clone();
      background((async () => {
        const row = usageRow(fn, await copy.json());
        if (!row) return;
        const r = await fetcher(env.sbUrl + "/rest/v1/ai_usage", {
          method: "POST",
          headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(row),
        });
        await r.body?.cancel();
      })());
    }
    return res;
  }) as typeof fetch;
  (wrapped as any).__usage = true;
  return wrapped;
}

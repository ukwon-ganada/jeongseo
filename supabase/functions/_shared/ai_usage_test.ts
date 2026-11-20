import { assert, assertEquals } from "jsr:@std/assert@1";
import { usageRow, withUsage } from "./ai_usage.ts";

Deno.test("usage 줄 만들기", () => {
  assertEquals(usageRow("f", { model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 2 } }),
    { fn: "f", model: "claude-haiku-5-5", input_tokens: 10, output_tokens: 3, cache_read: 2, cache_write: 0 });
  assertEquals(usageRow("f", {}), null);
});

Deno.test("Anthropic 응답이면 ai_usage에 남기고, 원래 응답은 그대로", async () => {
  const posts: string[] = [];
  const base = (async (u: string | URL | Request, init?: RequestInit) => {
    const s = String(u);
    if (s.includes("anthropic")) return new Response(JSON.stringify({ model: "m", usage: { input_tokens: 5, output_tokens: 1 }, content: [] }));
    if (s.includes("ai_usage")) posts.push(String(init?.body));
    return new Response("[]");
  }) as typeof fetch;
  const f = withUsage(base, { sbUrl: "https://db", sbKey: "k" }, "case-view");
  const r = await f("https://api.anthropic.com/v1/messages", { method: "POST" });
  const j = await r.json();
  assertEquals(j.model, "m");
  await new Promise((s) => setTimeout(s, 20));
  assertEquals(posts.length, 1);
  assert(posts[0].includes('"fn":"case-view"') && posts[0].includes('"input_tokens":5'));
  await f("https://db/rest/v1/cases");
  await new Promise((s) => setTimeout(s, 20));
  assertEquals(posts.length, 1);
});

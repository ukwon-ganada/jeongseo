import { assert, assertEquals } from "jsr:@std/assert@1";
import { alertTarget, logOpsError, sendAlert } from "./ops_alert.ts";
import { handle } from "./handler.ts";

Deno.test("alert_to 읽기: userId·channelId만, 이상한 값은 거절", () => {
  assertEquals(alertTarget({ userId: "858e98d2-a6cc-4150-1493-03d454a86b2d" }), { userId: "858e98d2-a6cc-4150-1493-03d454a86b2d" });
  assertEquals(alertTarget('{"channelId":"abc-123456"}'), { channelId: "abc-123456" });
  assertEquals(alertTarget({ userId: "../x" }), null);
  assertEquals(alertTarget(null), null);
});

Deno.test("ops_error 기록 실패해도 던지지 않는다", async () => {
  await logOpsError({ sbUrl: "https://x", sbKey: "k" }, "f", "w", new Error("boom"), () => Promise.reject(new Error("net")));
});

Deno.test("sendAlert: 운영 봇이 사용자 1:1로 글 보내기", async () => {
  const calls: string[] = [];
  const { privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pk = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey)))) + "\n-----END PRIVATE KEY-----";
  const f = (async (u: string, init?: RequestInit) => {
    calls.push(String(u) + " " + (init?.body && String(u).includes("messages") ? String(init.body) : ""));
    if (String(u).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    return new Response("", { status: 201 });
  }) as typeof fetch;
  const r = await sendAlert({ sbUrl: "x", sbKey: "k", clientId: "c", clientSecret: "s", serviceAccount: "a", privateKey: pk }, { userId: "u-123456" }, "알림 시험", f);
  assert(r.sent);
  assert(calls.some((c) => c.includes("/bots/12905890/users/u-123456/messages") && c.includes("알림 시험")), calls.join("\n"));
});

// handler 의 rest()는 전역 fetch 를 쓰므로 잠시 바꿔 끼운다
async function withFetch(f: typeof fetch, run: () => Promise<void>) {
  const orig = globalThis.fetch; globalThis.fetch = f;
  try { await run(); } finally { globalThis.fetch = orig; }
}
const settings = (alertTo: unknown) => (async (u: string | URL | Request) => {
  const s = String(u);
  if (s.includes("cron_secret")) return new Response(JSON.stringify([{ value: "sec" }]));
  if (s.includes("alert_to")) return new Response(JSON.stringify(alertTo ? [{ value: alertTo }] : []));
  return new Response("[]");
}) as typeof fetch;

Deno.test("handler: cron 비밀값이 틀리면 alert 거절", async () => {
  await withFetch(settings(null), async () => {
    const res = await handle(new Request("https://x/", { method: "POST", headers: { "x-cron-secret": "nope" }, body: JSON.stringify({ action: "alert", text: "a" }) }), { sbUrl: "https://db", sbKey: "k", botSecret: "b" });
    assertEquals(res.status, 403);
  });
});

Deno.test("handler: alert_to 없으면 400", async () => {
  await withFetch(settings(null), async () => {
    const res = await handle(new Request("https://x/", { method: "POST", headers: { "x-cron-secret": "sec" }, body: JSON.stringify({ action: "alert", text: "a" }) }), { sbUrl: "https://db", sbKey: "k", botSecret: "b" });
    assertEquals(res.status, 400);
  });
});

// 오류 알림 (2026-11-20 석원 요청 "실패해도 아무도 모른다" 보완)
//  · logOpsError: 뒤에서 조용히 실패하던 일(파일 보관·AI 일정 뽑기·방 연결 등)을 ops_error 표에 한 줄 남긴다.
//  · sendAlert: DB의 ops_health_check()(pg_cron 15분마다)가 문제를 모아 부르면, 운영 봇이 웍스로 한 줄 알림을 보낸다.
//    받는 곳은 lw_settings.alert_to = {"userId": "..."} 또는 {"channelId": "..."}.
import { botToken } from "./room_file.ts";

type Env = {
  sbUrl: string; sbKey: string;
  clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string;
};

export const ALERT_BOT = "12905890"; // 운영 봇(사건관리 도우미)

export async function logOpsError(env: Env, fn: string, what: string, e: unknown, fetcher: typeof fetch = fetch): Promise<void> {
  const msg = String((e as Error)?.message ?? e ?? "").slice(0, 300);
  try {
    const r = await fetcher(env.sbUrl + "/rest/v1/ops_error", {
      method: "POST",
      headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ fn, what, msg }),
    });
    await r.body?.cancel();
  } catch { /* 기록 실패는 무시(본 작업을 막지 않는다) */ }
}

export function alertTarget(v: unknown): { userId?: string; channelId?: string } | null {
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { return null; } }
  if (o?.userId && /^[0-9A-Za-z-]{6,64}$/.test(String(o.userId))) return { userId: String(o.userId) };
  if (o?.channelId && /^[0-9A-Za-z-]{6,64}$/.test(String(o.channelId))) return { channelId: String(o.channelId) };
  return null;
}

export async function sendAlert(env: Env, to: { userId?: string; channelId?: string }, text: string, fetcher: typeof fetch = fetch) {
  const token = await botToken(env, fetcher);
  const path = to.userId ? "users/" + encodeURIComponent(to.userId) : "channels/" + encodeURIComponent(to.channelId!);
  const r = await fetcher(`https://www.worksapis.com/v1.0/bots/${ALERT_BOT}/${path}/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ content: { type: "text", text: text.slice(0, 1900) } }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("웍스 보내기 실패 " + r.status + " " + t.slice(0, 120));
  return { sent: true };
}

// 기한 버튼을 누르면 바로 답하기 (2026-11-24 석원: 눌러도 반응이 없으면 안 된다)
//   웍스 봇 카드는 보낸 뒤 고칠 수 없어서, 누르자마자 도우미가 짧은 글로 답한다.
//   처음 확정될 때 한 번만 답한다(다시 눌러도 같은 글이 또 나오지 않음). 누른 사람 이름은 넣지 않는다.
//   어디로 보낼지: lw_settings.dl_ack_to = "room"(그 사건방, 기본) | "user"(누른 사람 1:1) | "off"
import { botToken, type FileEnv } from "./room_file.ts";

const API = "https://www.worksapis.com/v1.0";

export type Press = { action: string; l_code: string; kind: string; due: string };

const md = (d: string) => { const [, m, dd] = d.split("-"); return `${Number(m)}.${Number(dd)}`; };

export function ackText(p: Press): string {
  return `✓ ${p.l_code} ${p.kind}(${md(p.due)} 마감) ${p.action}`;
}

export async function sendAck(env: FileEnv, to: { bot: string; channelId?: string | null; userId: string; mode: string }, text: string,
  fetcher: typeof fetch = fetch): Promise<string> {
  if (to.mode === "off") return "off";
  const path = to.mode === "user" || !to.channelId ? `users/${encodeURIComponent(to.userId)}` : `channels/${encodeURIComponent(to.channelId)}`;
  const token = await botToken(env, fetcher);
  const r = await fetcher(`${API}/bots/${to.bot}/${path}/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ content: { type: "text", text } }),
  });
  if (!r.ok) throw new Error("ack " + r.status + " " + (await r.text()).slice(0, 120));
  await r.body?.cancel();
  return path.startsWith("users") ? "user" : "room";
}

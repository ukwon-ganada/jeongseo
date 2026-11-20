// ============================================================================
//  사건방 대화 → 변호사 지시 모음 (works-bot-callback 이 부름, 사건 화면 "지시" 탭)
//
//  2026-11-20 석원 요청: 서고은·강현구·이예나·박종덕 변호사의 대화 중 지시만 모아 한 번에 본다.
//  규칙으로는 어렵고, AI가 앞 글·올라온 파일을 맥락으로 보고 "무엇을 하라는지" 정돈된 말로 적는다.
//    · 변호사 글이 올라올 때만 AI를 부른다(화면을 열 때는 부르지 않는다).
//    · 잡담·대답·질문·변호사 본인이 할 일·이름만 부른 글은 지시가 아니다(석원: "모든 대화가 다 중요한 것은 아니니").
//    · "ㄱㄱ"처럼 짧은 지시는 앞 글을 보고 풀어 적는다 → 앞 글이 필요해서 모든 사건방 글을 3일만 보관(room_msg.ctx_only).
//    · 직원이 "제출완료"처럼 끝냈다는 글을 쓰면 그 방 남은 지시와 맞춰 끝난 지시로 옮긴다.
//  누가 변호사인지는 글쓴이 웍스 userId → 이름(웍스 구성원 API, works_user_name 표에 저장)으로 본다.
// ============================================================================

import { botToken, type FileEnv } from "./room_file.ts";
import { recentContext, type ChatEnv } from "./room_chat.ts";

export type OrderEnv = ChatEnv & FileEnv;
export const DEFAULT_LAWYERS = ["서고은", "강현구", "이예나", "박종덕"];

export type OrderAction = { op: "new" | "update" | "close"; id: number | null; text: string; assignee: string; note: string };
export type OrderUpdate = { id: number; state: "남음" | "끝남"; note: string };

const KST = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 16);
const WEEK = "일월화수목금토";
const PII = /\d{6}\s*-\s*[1-4]\d{6}|0\d{1,2}\s*-\s*\d{3,4}\s*-\s*\d{4}|01\d\s*\d{3,4}\s*\d{4}/g;
const clean = (s: unknown, n: number) => String(s ?? "").replace(PII, "").replace(/\s+/g, " ").trim().slice(0, n);
// 웍스 멘션 태그 <m userNo="…">@이름</m> → @이름
export const plain = (t: string) => String(t || "").replace(/<m [^>]*>(@?[^<]*)<\/m>/g, "$1");

// 직원 글에 일을 끝냈거나 진행했다는 낌새가 있을 때만 남은 지시와 맞춰 본다
const DONE_CUE = /(완료|했습니다|하였습니다|했어요|했음|드렸|보냈|보냄|발송|제출|예약|접수|확인|받았|받음|전달|입금|송금|이체|도착|통화|연락|잡았|잡음|취소|변경)/;
export const looksDone = (t: string) => DONE_CUE.test(String(t || ""));

async function rest(env: OrderEnv, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  return fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
async function getJson(env: OrderEnv, path: string, fetcher: typeof fetch): Promise<any[]> {
  const r = await rest(env, path, {}, fetcher);
  if (!r.ok) { await r.body?.cancel(); return []; }
  return await r.json().catch(() => []);
}

// ── 글쓴이 이름 ──────────────────────────────────────────
export async function lawyerList(env: OrderEnv, fetcher: typeof fetch = fetch): Promise<string[]> {
  const s = await getJson(env, "lw_settings?select=value&key=eq.order_lawyers", fetcher);
  const v = String(s?.[0]?.value || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  return v.length ? v : DEFAULT_LAWYERS;
}

export async function userName(env: OrderEnv, userId: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!userId) return "";
  const ch = await getJson(env, `works_user_name?select=name,fetched_at&user_id=eq.${encodeURIComponent(userId)}`, fetcher);
  if (ch[0] && Date.now() - Date.parse(ch[0].fetched_at) < 30 * 864e5) return String(ch[0].name || "");
  let name = "";
  try {
    const tok = await botToken(env, fetcher, "user.read");
    const r = await fetcher(`https://www.worksapis.com/v1.0/users/${encodeURIComponent(userId)}`, { headers: { Authorization: "Bearer " + tok } });
    if (r.ok) {
      const u = await r.json();
      name = [u?.userName?.lastName, u?.userName?.firstName].filter(Boolean).join("");
    } else { console.error("user name", r.status); await r.body?.cancel(); }
  } catch (e) { console.error("user name fail", String((e as Error)?.message || e).slice(0, 120)); }
  // 웍스에서 못 받으면 사건 화면을 연 기록의 이름으로
  if (!name) {
    const v = await getJson(env, `case_view_log?select=viewer_name&works_user_id=eq.${encodeURIComponent(userId)}&viewer_name=not.is.null&order=viewed_at.desc&limit=1`, fetcher);
    name = String(v?.[0]?.viewer_name || "");
    if (!name) return ch[0]?.name || "";
  }
  const up = await rest(env, "works_user_name?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ user_id: userId, name, fetched_at: new Date().toISOString() }]),
  }, fetcher);
  await up.body?.cancel();
  return name;
}

// ── AI ─────────────────────────────────────────────────
const ORDER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["actions"],
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["op", "id", "text", "assignee", "note"],
        properties: {
          op: { type: "string", enum: ["new", "update", "close"] },
          id: { type: ["integer", "null"], description: "update·close일 때 '이 방 지시' 목록의 번호, new면 null" },
          text: { type: "string", description: "무엇을 하라는지 60자 이내. close면 빈칸" },
          assignee: { type: "string", description: "지목된 사람 이름. 분명하지 않으면 빈칸" },
          note: { type: "string", description: "close일 때 이유 20자 이내, 아니면 빈칸" },
        },
      },
    },
  },
};

export const ORDER_SYSTEM = [
  "너는 법무법인 형사 사건방에서 변호사가 쓴 글 한 건을 읽고, 직원에게 일을 시키는 '지시'만 골라 정돈된 말로 적는 도우미다.",
  "지시: 직원(또는 @로 지목된 사람)에게 무엇을 하라고 시키는 글. 반말·줄임말·오타도 많다('플리즈', '급급', '해주오', 'ㄱㄱ').",
  "'ㄱㄱ', '이걸로', '빨리 보낼것'처럼 무엇을 하라는지 빠진 짧은 글은 '앞 글'과 '최근 올라온 파일'을 보고 풀어 적는다. 예: 직원이 의견서 PDF를 올리고 '이걸로 제출할까요?' 뒤에 'ㄱㄱ' → '고소대리인의견서 최종본 제출'. 앞 글에 송치 소식이 있고 '공소청으로 빨리 ㄱㄱ' → '송치되었으니 합의서 등 서류를 공소청에 제출'.",
  "지시가 아닌 것(넣지 말 것): 대답('네네', 'ㅇㅇ', '맞네', '웅웅'), 감상·잡담('참내..', '치사하구만'), 질문, 정보만 알려 주는 글('공소장나왔다함', '이영균변호사'), 변호사 본인이 하겠다는 말('다시 보내달라고 할게요', '내가 통화중'), 이름만 부른 글('@서석원'), 붙여 넣은 상담 메모·문자, 변호사 개인 일정 연락('늦는다고 해주오'처럼 사건 진행과 상관없는 심부름).",
  "text는 60자 이내로, 해야 할 일을 '…제출', '…확인', '…예약', '…전달하기'처럼 끝맺는다. 금액·기한·제출처처럼 일에 필요한 내용은 남기고, 전화번호·주민번호는 쓰지 않는다. 짐작은 쓰지 않는다.",
  "assignee는 글에 @이름이 있거나 앞 글로 누구 일인지 분명할 때만 그 사람 이름을 쓴다. 아니면 빈칸.",
  "'이 방 지시'에 같은 일이 이미 있으면 새로 만들지 않는다. 이번 글이 그 지시를 보태거나 고치면 op=update로 그 번호의 text를 새로 쓴다(바로 이어 쓴 글 두세 개가 한 지시인 경우가 많다).",
  "이번 글이 이미 있는 지시를 취소하거나('아니 취소하고') 필요 없다고 하면 op=close, note에 이유를 쓴다.",
  "한 글에 서로 다른 지시가 둘 이상이면 각각 넣는다. 지시가 없거나 확실하지 않으면 actions를 빈 배열로 한다.",
].join("\n");

const DONE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["updates"],
  properties: {
    updates: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "state", "note"],
        properties: {
          id: { type: "integer" },
          state: { type: "string", enum: ["남음", "끝남"] },
          note: { type: "string", description: "30자 이내. 끝남이면 어떻게 끝났는지, 남음이면 어디까지 했고 무엇이 남았는지" },
        },
      },
    },
  },
};

export const DONE_SYSTEM = [
  "너는 법무법인 사건방에서 직원이 쓴 글 한 건을 읽고, 그 방에 남아 있는 변호사 지시 중 이 글로 진행되거나 끝난 것을 표시하는 도우미다.",
  "지시한 일을 했다는 글이면 state=끝남, note에 어떻게 끝났는지 짧게 쓴다. 예: '우편 제출', '카톡 보냄', '이체확인증 받음'.",
  "다른 사람이 대신 해서 더 할 필요가 없어졌으면 끝남으로 하고 그 사정을 쓴다. 예: '국선변호인이 항소장 제출'.",
  "일부만 했으면 state=남음, note에 한 것과 남은 것을 쓴다. 예: '수용번호 3905 확인 · 접견 예약 남음'.",
  "이 글과 상관없는 지시는 넣지 않는다. 확실하지 않으면 updates를 빈 배열로 한다. 전화번호·주민번호는 쓰지 않는다.",
].join("\n");

async function askJson(env: OrderEnv, system: string, user: string, schema: unknown, fetcher: typeof fetch): Promise<any> {
  if (!env.anthropicKey) throw new Error("ANTHROPIC_API_KEY 없음");
  const model = env.model || "claude-sonnet-5-5";
  const haiku = model.includes("haiku");
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json",
      ...(haiku ? {} : { "anthropic-beta": "server-side-fallback-2026-07-01" }),
    },
    body: JSON.stringify({
      model, max_tokens: 4000, system,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      ...(haiku ? {} : { fallbacks: "default" }),
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
  const data = await res.json();
  if (data?.stop_reason === "refusal") return null;
  const out = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").trim();
  return out ? JSON.parse(out) : null;
}

export function cleanActions(raw: any, known: Set<number>): OrderAction[] {
  const list = Array.isArray(raw?.actions) ? raw.actions : [];
  const out: OrderAction[] = [];
  for (const a of list) {
    const op = a?.op === "update" || a?.op === "close" ? a.op : "new";
    const id = Number.isInteger(a?.id) && known.has(a.id) ? a.id : null;
    const text = clean(a?.text, 80);
    if (op === "new" && !text) continue;
    if (op !== "new" && id == null) { if (op === "update" && text) out.push({ op: "new", id: null, text, assignee: clean(a?.assignee, 20), note: "" }); continue; }
    if (op === "update" && !text) continue;
    out.push({ op, id, text, assignee: clean(a?.assignee, 20).replace(/^@/, ""), note: clean(a?.note, 40) });
  }
  return out;
}

export function cleanUpdates(raw: any, known: Set<number>): OrderUpdate[] {
  const list = Array.isArray(raw?.updates) ? raw.updates : [];
  return list.filter((u: any) => Number.isInteger(u?.id) && known.has(u.id))
    .map((u: any) => ({ id: u.id, state: u.state === "끝남" ? "끝남" : "남음", note: clean(u?.note, 50) }) as OrderUpdate);
}

const fmtOrders = (rows: any[]) => rows.map((o) =>
  `[${o.id}] ${KST(o.msg_at)} ${o.lawyer} → ${o.assignee || "담당"}: ${o.text}${o.state === "끝남" ? " (끝남)" : o.note ? " (" + o.note + ")" : ""}`).join("\n");

// ── 방에 올라온 글 하나 처리 ───────────────────────────────
export async function handleRoomOrders(
  env: OrderEnv,
  a: { channelId: string; text: string; sentAt?: string; userId?: string },
  fetcher: typeof fetch = fetch,
): Promise<{ how: string; n: number }> {
  const text = plain(String(a.text || "")).trim();
  if (!text || !a.userId) return { how: "skip", n: 0 };
  const sentAt = a.sentAt && !isNaN(Date.parse(a.sentAt)) ? new Date(a.sentAt).toISOString() : new Date().toISOString();
  const [name, lawyers] = await Promise.all([userName(env, a.userId, fetcher), lawyerList(env, fetcher)]);
  const isLawyer = !!name && lawyers.includes(name);
  const ch = encodeURIComponent(a.channelId);

  if (!isLawyer) {
    if (!looksDone(text)) return { how: "no-cue", n: 0 };
    const since = encodeURIComponent(new Date(Date.parse(sentAt) - 30 * 864e5).toISOString());
    const open = await getJson(env, `room_order?select=id,msg_at,lawyer,assignee,text,state,note&channel_id=eq.${ch}&state=eq.${encodeURIComponent("남음")}&hidden=eq.false&msg_at=gte.${since}&msg_at=lte.${encodeURIComponent(sentAt)}&order=msg_at.asc&limit=20`, fetcher);
    if (!open.length) return { how: "no-open", n: 0 };
    const ctx = await recentContext(env, a.channelId, sentAt, a.text, fetcher).catch(() => "");
    const d = new Date(Date.parse(sentAt) + 9 * 3600e3);
    const user = `보낸 시각(한국): ${KST(sentAt)} (${WEEK[d.getUTCDay()]}요일)\n글쓴이: ${name || "직원"}\n\n남은 지시:\n${fmtOrders(open)}\n\n${ctx ? ctx + "\n\n" : ""}이번 글:\n${text.slice(0, 2000)}`;
    const ups = cleanUpdates(await askJson(env, DONE_SYSTEM, user, DONE_SCHEMA, fetcher), new Set(open.map((o) => Number(o.id))));
    for (const u of ups) {
      const body: any = { state: u.state, note: u.note, updated_at: new Date().toISOString() };
      if (u.state === "끝남") body.done_at = sentAt;
      const r = await rest(env, `room_order?id=eq.${u.id}&source=eq.ai`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) }, fetcher);
      await r.body?.cancel();
    }
    return { how: "done-check", n: ups.length };
  }

  // 변호사 글: 지시인지 보고 새로 적거나 이어 쓴다
  const m = await getJson(env, `works_room_case?select=l_num,room_title,status&channel_id=eq.${ch}&order=is_primary.desc&limit=1`, fetcher);
  const room = m[0] || null;
  const since = encodeURIComponent(new Date(Date.parse(sentAt) - 14 * 864e5).toISOString());
  const mine = await getJson(env, `room_order?select=id,msg_at,lawyer,assignee,text,state,note,orig&channel_id=eq.${ch}&hidden=eq.false&msg_at=gte.${since}&order=msg_at.asc&limit=30`, fetcher);
  const ctx = await recentContext(env, a.channelId, sentAt, a.text, fetcher).catch(() => "");
  const d = new Date(Date.parse(sentAt) + 9 * 3600e3);
  const user = `보낸 시각(한국): ${KST(sentAt)} (${WEEK[d.getUTCDay()]}요일)\n방 제목: ${room?.room_title || "(모름)"}\n글쓴 변호사: ${name}\n\n이 방 지시(최근 14일):\n${mine.length ? fmtOrders(mine) : "(없음)"}\n\n${ctx ? plain(ctx) + "\n\n" : ""}이번 글:\n${text.slice(0, 2000)}`;
  const acts = cleanActions(await askJson(env, ORDER_SYSTEM, user, ORDER_SCHEMA, fetcher), new Set(mine.map((o) => Number(o.id))));
  const orig = clean(text, 300);
  const byId = new Map(mine.map((o) => [Number(o.id), o]));
  let n = 0;
  for (const x of acts) {
    if (x.op === "new") {
      const r = await rest(env, "room_order", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          channel_id: a.channelId, l_num: room?.status === "보류" ? null : room?.l_num ?? null,
          lawyer: name, lawyer_user_id: a.userId, msg_at: sentAt, text: x.text, assignee: x.assignee, orig,
        }),
      }, fetcher);
      if (!r.ok) console.error("room_order 저장 실패", r.status, (await r.text()).slice(0, 120)); else { await r.body?.cancel(); n++; }
    } else {
      const old = byId.get(x.id!);
      const body: any = { updated_at: new Date().toISOString() };
      if (x.op === "update") {
        body.text = x.text;
        if (x.assignee) body.assignee = x.assignee;
        if (old && !String(old.orig || "").includes(orig)) body.orig = clean([old.orig, orig].filter(Boolean).join(" / "), 600);
      } else { body.state = "끝남"; body.note = x.note || "취소"; body.done_at = sentAt; }
      const r = await rest(env, `room_order?id=eq.${x.id}&source=eq.ai`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) }, fetcher);
      await r.body?.cancel(); n++;
    }
  }
  return { how: "lawyer", n };
}

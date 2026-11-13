// ============================================================================
//  사건방 대화 → 수사 단계 일정 뽑기 (works-bot-callback 이 부름)
//
//  2026-11-13 석원 결정: 수사 단계(경찰·검찰) 사건은 로웨어에 받아올 정보가 없으니
//  사건방 대화에서 고소장 제출·조사 일정·송치 같은 일을 AI가 골라 그 방 타임라인에 쌓는다.
//    · 대화 원문은 저장하지 않는다. AI가 뽑은 "일정 한 줄"만 room_event 표에 남긴다.
//    · 날짜·일정 낌새가 없는 글은 AI에 보내지도 않는다(looksLikeEvent).
//    · 같은 방·같은 종류·같은 날짜·같은 시각이면 한 번만 남긴다(겹침 방지).
//  시험 단계: ROOM_CHAT_BOTS(기본 시험봇 13580302)에 든 봇의 방만 처리.
//  필요한 시크릿: ANTHROPIC_API_KEY (draft-chamgo 와 같은 키). 모델은 ROOM_CHAT_MODEL 로 바꿀 수 있음.
// ============================================================================

export type ChatEnv = { sbUrl: string; sbKey: string; anthropicKey?: string; model?: string };
export type RoomEvent = { kind: string; date: string; time: string | null; summary: string; state: "예정" | "완료" };

export const KINDS = ["사건접수", "고소장제출", "조사", "출석요구", "송치", "처분", "기소", "기일", "서면제출", "기타"] as const;

// 날짜·시각·수사 절차 낱말이 하나라도 있어야 AI에 보낸다
const CUE = /(\d{1,2}\s*[\/.월]\s*\d{1,2}|\d{1,2}\s*일|\d{1,2}\s*시|\d{1,2}:\d{2}|오늘|내일|모레|다음\s*주|이번\s*주|[월화수목금]요일|고소|고발|접수|조사|출석|송치|불송치|기소|불기소|처분|기일|공판|제출|진술|대질|소환|구속|영장|약식)/;
export function looksLikeEvent(text: string): boolean {
  const t = String(text || "").trim();
  return t.length >= 6 && CUE.test(t);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "date", "time", "summary", "state"],
        properties: {
          kind: { type: "string", enum: [...KINDS] },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: ["string", "null"], description: "HH:MM (24시간), 모르면 null" },
          summary: { type: "string", description: "40자 이내. 사람 이름·전화번호·주민번호는 빼고 기관·절차만" },
          state: { type: "string", enum: ["예정", "완료"] },
        },
      },
    },
  },
};

const SYSTEM = [
  "너는 법무법인 형사 사건방의 대화 한 건을 읽고 사건 진행 일정만 골라내는 도우미다.",
  "골라낼 것: 사건 접수(수임), 고소장·고발장 제출, 경찰·검찰 조사(피의자·피해자·참고인·대질), 출석 요구, 송치·불송치, 기소·불기소 등 처분, 재판 기일, 의견서 등 서면 제출.",
  "골라내지 말 것: 내부 업무 지시, 상담비·수임료, 단순 안부, 일정이 정해지지 않은 계획, 이미 지난 일을 다시 말한 것 중 날짜를 알 수 없는 것.",
  "날짜는 보낸 시각(한국 시간)을 기준으로 '내일', '다음 주 화요일' 같은 말을 실제 날짜로 바꾼다. 연도가 없으면 보낸 날 이후 가장 가까운 날로 본다.",
  "이미 일어난 일이면 state=완료, 앞으로의 일이면 state=예정.",
  "summary에는 사람 이름·전화번호·주민번호·주소를 넣지 않는다. 예: '인천논현서 피의자 조사', '고소장 제출(연수서)'.",
  "골라낼 것이 없으면 events를 빈 배열로 한다. 확실하지 않으면 넣지 않는다.",
].join("\n");

const KST = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace("T", " ").slice(0, 16);
const WEEK = "일월화수목금토";

export function cleanEvents(raw: unknown): RoomEvent[] {
  const list = Array.isArray((raw as any)?.events) ? (raw as any).events : [];
  const out: RoomEvent[] = [];
  for (const e of list) {
    const date = String(e?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) continue;
    const time = /^\d{2}:\d{2}$/.test(String(e?.time || "")) ? String(e.time) : null;
    const kind = (KINDS as readonly string[]).includes(e?.kind) ? e.kind : "기타";
    // 혹시 들어온 전화번호·주민번호 모양은 지운다
    const summary = String(e?.summary || "").replace(/\d{6}-?\d{7}|01\d-?\d{3,4}-?\d{4}/g, "").trim().slice(0, 60);
    if (!summary) continue;
    out.push({ kind, date, time, summary, state: e?.state === "완료" ? "완료" : "예정" });
  }
  return out;
}

export async function extractEvents(env: ChatEnv, text: string, sentAt: string, roomTitle: string, fetcher: typeof fetch = fetch): Promise<RoomEvent[]> {
  if (!env.anthropicKey) throw new Error("ANTHROPIC_API_KEY 없음");
  const d = new Date(Date.parse(sentAt) + 9 * 3600e3);
  const user = `보낸 시각(한국): ${KST(sentAt)} (${WEEK[d.getUTCDay()]}요일)\n방 제목: ${roomTitle || "(모름)"}\n\n대화:\n${text}`;
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: env.model || "claude-opus-5-5",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      fallbacks: "default",
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
  const data = await res.json();
  if (data?.stop_reason === "refusal") return [];
  const out = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").trim();
  if (!out) return [];
  return cleanEvents(JSON.parse(out));
}

async function rest(env: ChatEnv, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  return fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

// 방에 올라온 글 하나 처리: 낌새 확인 → AI → room_event 저장. 원문은 어디에도 남기지 않는다.
export async function handleRoomText(env: ChatEnv, a: { channelId: string; text: string; sentAt?: string }, fetcher: typeof fetch = fetch): Promise<{ saved: number; how: string }> {
  if (!looksLikeEvent(a.text)) return { saved: 0, how: "no-cue" };
  const sentAt = a.sentAt && !isNaN(Date.parse(a.sentAt)) ? new Date(a.sentAt).toISOString() : new Date().toISOString();
  const m = await rest(env, `works_room_case?select=l_num,room_title,status&channel_id=eq.${encodeURIComponent(a.channelId)}&order=is_primary.desc&limit=1`, {}, fetcher);
  const room = m.ok ? (await m.json())[0] : (await m.body?.cancel(), null);
  const evs = await extractEvents(env, a.text.slice(0, 4000), sentAt, room?.room_title || "", fetcher);
  if (!evs.length) return { saved: 0, how: "none" };
  const rows = evs.map((e) => ({
    channel_id: a.channelId, l_num: room?.status === "보류" ? null : room?.l_num ?? null,
    kind: e.kind, ev_date: e.date, ev_time: e.time ?? "", summary: e.summary, state: e.state, msg_at: sentAt, source: "chat-ai",
  }));
  const ins = await rest(env, "room_event?on_conflict=channel_id,kind,ev_date,ev_time", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows),
  }, fetcher);
  if (!ins.ok) throw new Error("room_event 저장 실패 " + ins.status + " " + (await ins.text()).slice(0, 120));
  await ins.body?.cancel();
  return { saved: rows.length, how: "ai" };
}

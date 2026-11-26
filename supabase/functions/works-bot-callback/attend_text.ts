// ============================================================================
//  사건방 글로 우리 출석 기일 미리 표시하기 (석원 2026-11-26, 김우석 2026고단1492)
//   공범이 많은 사건은 기일이 여러 개고 우리 피고인은 일부에만 나간다. 전자기록에는 나오지 않고
//   재판에 간 변호사가 방에 "김우석은 4월 15일 선고만 갑니다"처럼 적는다.
//   · 날짜와 출석 낱말이 함께 있는 글만 AI에 보낸다(looksLikeAttend).
//   · AI가 이 방 앞으로의 기일마다 출석·불출석을 고르고 hearing_attend 에 source '방 글'로 남긴다.
//   · 직원이 사건 화면 [수정]에서 정한 줄은 덮어쓰지 않는다. 틀리면 직원이 [수정]에서 고친다.
// ============================================================================
export type AttendEnv = { sbUrl: string; sbKey: string; anthropicKey?: string; model?: string };
export type AttendItem = { date: string; attend: boolean; kind: string; time: string | null; place: string | null };

const DATE_CUE = /(\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}\s*일)/;
const ATTEND_CUE = /(만\s*(가|갑|간|출석|참석|나가|나갑|나옵|오)|안\s*(가|와|나가|나와|와도|가도)|불출석|불참|출석\s*(안|하지|않|없)|참석\s*(안|하지|않|없)|(가|출석|참석|나가)지\s*않|빠져도|빠집니다|면제|(출석|참석)\s*(해야|하면|합니다|예정|대상)|(만|에만)\s*(출석|참석))/;
export function looksLikeAttend(text: string): boolean {
  const t = String(text || "");
  return t.length >= 6 && t.length <= 1500 && DATE_CUE.test(t) && ATTEND_CUE.test(t);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["applies", "items"],
  properties: {
    applies: { type: "boolean", description: "이 글이 이 방 의뢰인(우리 피고인)이 어느 기일에 출석하는지·안 하는지를 말하면 true" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "attend", "kind", "time", "place"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          attend: { type: "boolean" },
          kind: { type: "string", description: "공판기일·선고기일 등. 모르면 빈 문자열" },
          time: { type: ["string", "null"], description: "HH:MM, 모르면 null" },
          place: { type: ["string", "null"], description: "법정(예: 412호법정), 모르면 null" },
        },
      },
    },
  },
};

const SYSTEM = [
  "너는 법무법인 형사 사건방의 글 한 건을 읽고, 이 방 의뢰인(우리 피고인)이 앞으로의 재판 기일 중 어디에 출석하는지 정리하는 도우미다.",
  "공범이 많은 사건은 기일이 여러 개 잡히고 피고인마다 나가는 기일이 다르다. 글이 우리 의뢰인의 출석·불출석을 말할 때만 applies=true.",
  "\"OO는 4월 15일 선고만 갑니다\"처럼 특정 기일만 간다고 하면: 그 기일 attend=true, 목록의 나머지 앞으로의 기일은 모두 attend=false.",
  "\"1월 14일은 안 가도 됩니다\"처럼 특정 기일만 빠진다고 하면: 그 기일만 attend=false. 언급 없는 기일은 넣지 않는다.",
  "글에 나온 기일이 목록에 없으면(아직 로웨어에 안 들어온 선고기일 등) 그 날짜로 넣고 kind·time·place는 글에서 알 수 있는 만큼만.",
  "다른 피고인 이야기, 일정이 확정되지 않은 추측, 이미 지난 기일, 질문만 있는 글은 applies=false, items 빈 배열.",
  "연도가 없으면 보낸 날 이후 가장 가까운 날로 본다. '선거'는 '선고'의 오타일 수 있다.",
].join("\n");

const KST = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

export function cleanItems(j: any, today: string): AttendItem[] {
  if (!j?.applies || !Array.isArray(j.items)) return [];
  const out: AttendItem[] = [];
  const seen = new Set<string>();
  for (const x of j.items) {
    const date = String(x?.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || seen.has(date) || typeof x?.attend !== "boolean") continue;
    seen.add(date);
    const time = (String(x?.time || "").match(/^\d{1,2}:\d{2}/) || [null])[0];
    out.push({ date, attend: x.attend, kind: String(x?.kind || "").slice(0, 20), time, place: x?.place ? String(x.place).slice(0, 40) : null });
  }
  return out;
}

async function rest(env: AttendEnv, path: string, fetcher: typeof fetch, init: RequestInit = {}): Promise<any> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, {
    ...init, headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error("DB " + r.status + " " + (await r.text()).slice(0, 160));
  const t = r.status === 204 ? "" : await r.text();
  return t ? JSON.parse(t) : null;
}

export async function askAttend(env: AttendEnv, text: string, sentAt: string, roomTitle: string, list: string, fetcher: typeof fetch = fetch): Promise<any> {
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
      model, max_tokens: 1500, system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      ...(haiku ? {} : { fallbacks: "default" }),
      messages: [{ role: "user", content: `보낸 시각(한국): ${KST(sentAt)}\n방 제목: ${roomTitle || "(모름)"}\n\n이 사건 앞으로의 기일 목록:\n${list || "(없음)"}\n\n글:\n${text}` }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
  const data = await res.json();
  if (data?.stop_reason === "refusal") return null;
  const out = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").trim();
  return out ? JSON.parse(out) : null;
}

export async function handleAttendText(env: AttendEnv, m: { channelId: string; text: string; sentAt?: string; userId?: string }, fetcher: typeof fetch = fetch): Promise<{ how: string; saved: number }> {
  if (!looksLikeAttend(m.text)) return { how: "no-cue", saved: 0 };
  const rooms: any[] = await rest(env, `works_room_case?select=l_num,room_title,status&channel_id=eq.${encodeURIComponent(m.channelId)}&order=is_primary.desc,updated_at.desc`, fetcher);
  const nums = [...new Set(rooms.filter((r) => Number(r.l_num) > 0 && r.status !== "보류").map((r) => Number(r.l_num)))];
  if (!nums.length) return { how: "no-case", saved: 0 };
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const evs: any[] = await rest(env, `lw_process_events?select=l_num,lp_appoint_date,lp_appoint_time,lp_contents,lp_remark&lp_set=eq.${encodeURIComponent("기일")}&lp_appoint_date=gte.${today}&l_num=in.(${nums.join(",")})&order=lp_appoint_date.asc&limit=40`, fetcher);
  const list = evs.map((e) => `- ${String(e.lp_appoint_date).slice(0, 10)} ${String(e.lp_appoint_time || "").slice(0, 5)} ${e.lp_contents || ""}${e.lp_remark ? " [" + e.lp_remark + "]" : ""}`).join("\n");
  const sentAt = m.sentAt && !isNaN(Date.parse(m.sentAt)) ? m.sentAt : new Date().toISOString();
  const items = cleanItems(await askAttend(env, m.text, sentAt, String(rooms[0]?.room_title || ""), list, fetcher), today);
  if (!items.length) return { how: "not-attend", saved: 0 };
  // 날짜로 사건 고르기(한 방에 사건이 여럿이면 그 날 기일이 있는 사건, 없으면 첫 사건)
  const lnumOf = (d: string) => Number(evs.find((e) => String(e.lp_appoint_date).slice(0, 10) === d)?.l_num || nums[0]);
  const keys = items.map((x) => lnumOf(x.date));
  const staff: any[] = await rest(env, `hearing_attend?select=l_num,hdate&source=eq.${encodeURIComponent("직원")}&l_num=in.(${[...new Set(keys)].join(",")})&hdate=gte.${today}`, fetcher);
  const locked = new Set(staff.map((s) => s.l_num + "|" + String(s.hdate).slice(0, 10)));
  const rows = items.map((x, i) => ({ x, l: keys[i] })).filter(({ x, l }) => !locked.has(l + "|" + x.date)).map(({ x, l }) => ({
    l_num: l, hdate: x.date, attend: x.attend, htime: x.time, kind: x.kind || null, place: x.place, source: "방 글",
    note: m.text.slice(0, 300), by_name: null, channel_id: m.channelId, updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return { how: "staff-set", saved: 0 };
  await rest(env, "hearing_attend?on_conflict=l_num,hdate", fetcher, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  return { how: "saved", saved: rows.length };
}

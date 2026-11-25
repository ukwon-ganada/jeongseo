// ============================================================================
//  "/일정" — 사건방에서 치면 웍스 캘린더 새 일정 입력 창을 미리 채워서 연다 (석원 2026-11-25)
//
//  · 캘린더에 바로 넣지 않는다. 채워진 입력 창 링크만 주고, 직원이 확인 뒤 [저장]을 누른다.
//    (입력 창 주소 칸: summary 제목, startDateTime·endDateTime, location 장소, description 메모 — 석원 실측)
//  · 기일은 로웨어(나의사건) 기일 중 오늘 이후 가장 가까운 것. 없으면 case_all 의 다음 기일.
//  · 제목 규칙(2026-11-25 실제 캘린더 2,115건에서 찾음):
//      [(영상)]머리글)종류_이름        예) (증인)강)공판_임윤선 · 강)변론_이윤정/신용보증기금 · 예)공판_국선 김철우
//      머리글: 방 제목 앞머리 서)·이)·박)·강) → 서고은(머리글 안 붙임)·이예나 "예)"·박종덕 "박)"·강현구 "강)"
//      종류: 공판·선고(형사) / 변론·판결선고(민사) / 조정·심문·심리 등은 "기일"만 뺀다
//      민사·가사는 "의뢰인/상대방", 국선은 "국선 이름". (증인) 같은 표시는 직원이 창에서 붙인다.
//  · 시간은 기일 시각부터 1시간, 장소는 "법원 법정" (예: 인천지방법원 316호법정)
//  · 사진·통지서(석원 2026-11-25): 방에 최근 48시간 안에 올라온 사진(나의사건 캡처 등)·PDF가 있으면
//    AI가 그중 앞으로 있을 기일(표시된 줄 우선)을 읽는다. 로웨어와 같으면 로웨어 그대로,
//    다르거나 로웨어에 없으면 사진·통지서 기준으로 채우고 메모에 로웨어 값을 적어 둔다.
//    웍스 콜백에는 "어느 글에 답장했는지"가 오지 않아(2026-11-25 로그 확인) 태그 대신 최근 파일을 본다.
// ============================================================================
import { botToken } from "./room_file.ts";

export type SchedEnv = {
  sbUrl: string; sbKey: string; anthropicKey?: string; visionModel?: string;
  clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string;
};

export const CAL_EDIT = "https://calendar.worksmobile.com/web/calendar/scheduleEdit";

export function isScheduleCmd(text: unknown): boolean {
  return typeof text === "string" && /^\s*\/\s*일정\s*$/.test(text);
}

// 방 제목 앞머리 → 담당 변호사. "강)신)!(형/피고인)…" 처럼 여러 개면 변호사 표시만 본다
const LAWYERS: Record<string, { name: string; head: string }> = {
  "서": { name: "서고은", head: "" },
  "이": { name: "이예나", head: "예)" },
  "박": { name: "박종덕", head: "박)" },
  "강": { name: "강현구", head: "강)" },
};
export const SCHED_CAL_NAME = "서고은";
export const SCHED_CAL_ID = "c_300128754_94b87c71-5b0e-45a9-a182-441d49dd49b4"; // 서고은 기본 캘린더 (cal-ids로 확인)

export function lawyersFromTitle(title: string): { name: string; head: string }[] {
  const lead = String(title || "").split("(")[0]; // 사건 구분 "(형/…)" 앞까지만
  const out: { name: string; head: string }[] = [];
  for (const m of lead.matchAll(/([가-힣])\)/g)) if (LAWYERS[m[1]] && !out.includes(LAWYERS[m[1]])) out.push(LAWYERS[m[1]]);
  return out;
}
// 둘 이상이면("서)박)…") 서고은 변호사 말고 다른 변호사 일정으로 본다 (실제 캘린더: 박종덕 캘린더 "박)공판_이강현")
export function lawyerFromTitle(title: string): { name: string; head: string } | null {
  const all = lawyersFromTitle(title);
  return all.find((l) => l.name !== "서고은") || all[0] || null;
}

// 형사 사건부호 (그 밖은 민사·가사·행정으로 보고 "의뢰인/상대방")
const CRIMINAL = new Set(["고단", "고합", "고정", "고약", "고약전", "노", "도", "초기", "초보", "초적", "초재", "감고", "감노", "감도", "로", "모", "오", "코", "재고단", "재고합", "재노", "재도"]);
export function isCriminal(caseNo: string): boolean {
  const m = String(caseNo || "").replace(/\s/g, "").match(/^\d{2,4}([가-힣]+)\d/);
  return !!m && CRIMINAL.has(m[1]);
}

// "공판기일(316호법정 14:00)" / "변론기일(302호 법정 09:50) [일방 화상장치]"
export function parseHearing(contents: string): { kind: string; room: string; time: string; video: boolean } {
  const s = String(contents || "");
  const kind = s.split("(")[0].trim();
  const inner = s.match(/\(([^)]*)\)/)?.[1] || "";
  const time = inner.match(/(\d{1,2}):(\d{2})/);
  const room = inner.replace(/\d{1,2}:\d{2}/, "").trim();
  return { kind, room, time: time ? time[1].padStart(2, "0") + ":" + time[2] : "", video: /화상|영상/.test(s) };
}

export function kindWord(kind: string, criminal: boolean): string {
  const k = kind.replace(/\s/g, "");
  if (/^판결선고/.test(k)) return "판결선고";
  if (/^선고/.test(k)) return criminal ? "선고" : "판결선고";
  return k.replace(/기일$/, "") || "기일";
}

export type Plan = {
  summary: string; date: string; time: string; location: string; description: string; lawyer: string | null; source: string;
};

export function buildPlan(o: {
  roomTitle: string; caseNo: string; client: string; another: string; court: string; gukseon: boolean;
  date: string; time: string; contents: string; source?: string;
}): Plan {
  const lw = lawyerFromTitle(o.roomTitle);
  const crim = isCriminal(o.caseNo);
  const h = parseHearing(o.contents);
  const client = String(o.client || "").split(/[,(]/)[0].trim();
  const who = crim ? (o.gukseon ? "국선 " : "") + client : [client, String(o.another || "").trim()].filter(Boolean).join("/");
  const summary = (h.video ? "(영상)" : "") + (lw?.head || "") + kindWord(h.kind, crim) + "_" + who;
  const location = [String(o.court || "").trim(), h.room].filter(Boolean).join(" ");
  return {
    summary, date: o.date, time: o.time || h.time, location,
    description: [o.caseNo, o.contents].filter(Boolean).join(" "), // 안내 문구 없이 사건번호·기일만(석원 2026-11-25)
    // 석원 2026-11-25: 누가 누르든 모두 서고은 캘린더에 넣는다(머리글은 제목에만)
    lawyer: SCHED_CAL_NAME, source: o.source || "로웨어 기일 기준",
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export function calendarUrl(p: Plan): string {
  const q = new URLSearchParams({ action: "insert", bRouterPush: "true", summary: p.summary });
  if (p.time) {
    const [h, m] = p.time.split(":").map(Number);
    q.set("startDateTime", `${p.date}T${pad(h)}:${pad(m)}:00`);
    q.set("endDateTime", `${p.date}T${pad((h + 1) % 24)}:${pad(m)}:00`);
  } else {
    q.set("startDateTime", `${p.date}T09:00:00`);
    q.set("endDateTime", `${p.date}T10:00:00`);
  }
  if (p.location) q.set("location", p.location);
  if (p.description) q.set("description", p.description);
  // 서고은 캘린더로 열기(석원 2026-11-25 시험: 세 이름을 함께 주면 캘린더 칸이 "서고은"으로 나옴. 어느 이름이 듣는지는 미확인이라 셋 다)
  for (const k of ["calendarId", "calendarUid", "calId"]) q.set(k, SCHED_CAL_ID);
  return CAL_EDIT + "?" + q.toString();
}

async function rest(env: SchedEnv, path: string, fetcher: typeof fetch): Promise<any[]> {
  const r = await fetcher(env.sbUrl + "/rest/v1/" + path, { headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey } });
  if (!r.ok) { await r.body?.cancel(); return []; }
  return await r.json();
}

const W = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(d: string): string {
  const t = new Date(d + "T00:00:00Z");
  return `${t.getUTCMonth() + 1}.${t.getUTCDate()}.(${W[t.getUTCDay()]})`;
}

// 방에서 "/일정" → 계획 세우기 (보내기는 따로)
export async function planForRoom(env: SchedEnv, channelId: string, fetcher: typeof fetch = fetch): Promise<{ plan?: Plan; why?: string }> {
  const rooms = await rest(env, "works_room_case?select=l_num,case_no,room_title,status&order=is_primary.desc,updated_at.desc&channel_id=eq." + encodeURIComponent(channelId), fetcher);
  const room = rooms.find((r) => r.status !== "보류" && r.l_num) || null;
  if (!room) return { why: "이 방에 연결된 사건이 없습니다." };
  const nums = [...new Set(rooms.filter((r) => r.l_num && r.status !== "보류").map((r) => r.l_num))];
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const ev = await rest(env, `lw_process_events?select=l_num,l_code,lp_appoint_date,lp_appoint_time,lp_contents,court&lp_set=eq.${encodeURIComponent("기일")}&lp_appoint_date=gte.${today}&l_num=in.(${nums.join(",")})&order=lp_appoint_date.asc,lp_appoint_time.asc&limit=1`, fetcher);
  const cs = await rest(env, `case_all?select=l_num,l_code,l_client,court,next_date,next_time,next_contents,raw->>l_another&l_num=in.(${nums.join(",")})`, fetcher);
  let h: { l_num: number; date: string; time: string; contents: string } | null = null;
  if (ev[0]) h = { l_num: ev[0].l_num, date: String(ev[0].lp_appoint_date).slice(0, 10), time: String(ev[0].lp_appoint_time || "").slice(0, 5), contents: ev[0].lp_contents || "" };
  else {
    const c = cs.filter((c) => c.next_date && String(c.next_date).slice(0, 10) >= today && /기일/.test(c.next_contents || "")).sort((a, b) => String(a.next_date).localeCompare(String(b.next_date)))[0];
    if (c) h = { l_num: c.l_num, date: String(c.next_date).slice(0, 10), time: String(c.next_time || "").slice(0, 5), contents: c.next_contents || "" };
  }
  // 도우미가 먼저 알린 기일(hearing_notice)이 최근 사진·통지서보다 늦게 나왔으면 그 기일을 쓴다
  let src = "로웨어 기일 기준";
  let usedRead = false;
  const since48 = new Date(Date.now() - 48 * 3600e3).toISOString();
  const [nt, im, pf] = await Promise.all([
    rest(env, `hearing_notice?select=l_num,ev_date,ev_time,contents,created_at&channel_id=eq.${encodeURIComponent(channelId)}&status=eq.sent&ev_date=gte.${today}&created_at=gte.${new Date(Date.now() - 7 * 864e5).toISOString()}&order=created_at.desc&limit=1`, fetcher),
    rest(env, `room_image?select=created_at&channel_id=eq.${encodeURIComponent(channelId)}&created_at=gte.${since48}&order=created_at.desc&limit=1`, fetcher),
    rest(env, `case_file?select=saved_at&channel_id=eq.${encodeURIComponent(channelId)}&content_type=eq.application/pdf&saved_at=gte.${since48}&order=saved_at.desc&limit=1`, fetcher),
  ]);
  const fileAt = [im[0]?.created_at, pf[0]?.saved_at].filter(Boolean).map((x) => Date.parse(x)).sort((a, b) => b - a)[0] || 0;
  const notice = nt[0] && Date.parse(nt[0].created_at) > fileAt ? nt[0] : null;
  if (notice) {
    h = { l_num: notice.l_num, date: notice.ev_date, time: String(notice.ev_time || "").slice(0, 5), contents: notice.contents || "" };
    src = "도우미 알림 기준";
  }
  // 최근 사진·통지서 읽기 (없거나 실패하면 로웨어만)
  const read = notice ? null : await readRecentNotice(env, channelId, today, fetcher).catch((e) => { console.error("notice read fail", String(e?.message || e).slice(0, 160)); return null; });
  if (read && read.date >= today && (read.time || read.kind)) {
    const same = h && h.date === read.date && (!read.time || h.time === read.time);
    if (!same) {
      const lw = h ? `로웨어: ${h.date} ${h.time} ${h.contents}` : "로웨어에 아직 없음";
      h = { l_num: h?.l_num ?? room.l_num, date: read.date, time: read.time, contents: `${read.kind || "기일"}(${[read.room, read.time].filter(Boolean).join(" ")})` };
      src = `${read.from} 기준 · ${lw}`;
      usedRead = true;
    } else src = `로웨어 기일 기준 · ${read.from}과 같음`;
  }
  if (!h) return { why: "로웨어에 앞으로 잡힌 기일이 없고, 최근 올라온 사진·통지서에서도 찾지 못했습니다." };
  const c = cs.find((x) => x.l_num === h!.l_num) || cs[0] || {};
  const caseNo = String(c.l_code || room.case_no || "");
  const gk = await rest(env, "gukseon_cases?select=data->>caseNumber&limit=3000", fetcher);
  const norm = (s: string) => String(s || "").replace(/\s/g, "");
  const gukseon = gk.some((g) => norm(g.caseNumber) === norm(caseNo));
  const plan = buildPlan({
    roomTitle: room.room_title || "", caseNo, client: c.l_client || "", another: c.l_another || "", court: (usedRead ? read?.court : "") || c.court || read?.court || "",
    gukseon, date: h.date, time: h.time, contents: h.contents, source: src,
  });
  return { plan };
}

export async function sendToRoom(env: SchedEnv, botId: string, channelId: string, content: unknown, fetcher: typeof fetch = fetch) {
  const tok = await botToken(env as any, fetcher);
  const r = await fetcher(`https://www.worksapis.com/v1.0/bots/${encodeURIComponent(botId)}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error("보내기 실패 " + r.status + " " + (await r.text()).slice(0, 120));
  await r.body?.cancel();
}

export function planMessage(p: Plan): unknown {
  const when = dayLabel(p.date) + (p.time ? " " + p.time : "");
  return {
    type: "button_template",
    contentText: `${p.summary}\n${when} · ${p.location || "장소 없음"}` + (p.lawyer ? `\n캘린더: ${p.lawyer}` : "") + (p.source.startsWith("로웨어") ? "" : `\n${p.source}`),
    actions: [{ type: "uri", label: "일정 입력 창 열기", uri: calendarUrl(p) }],
  };
}

export async function handleScheduleCmd(env: SchedEnv, botId: string, channelId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const r = await planForRoom(env, channelId, fetcher);
  const content = r.plan ? planMessage(r.plan) : { type: "text", text: "일정을 채우지 못했습니다: " + r.why };
  await sendToRoom(env, botId, channelId, content, fetcher);
  return r.plan ? "sent" : "none:" + r.why;
}

// ── 사진·통지서 읽기 ─────────────────────────────────────────────────────────
export type NoticeRead = { date: string; time: string; kind: string; room: string; court: string; from: string };

const READ_SCHEMA = {
  type: "object", additionalProperties: false, required: ["found", "date", "time", "kind", "room", "court"],
  properties: {
    found: { type: "boolean" }, date: { type: "string" }, time: { type: "string" },
    kind: { type: "string" }, room: { type: "string" }, court: { type: "string" },
  },
};
const READ_SYSTEM = `법률사무소 사건방에 올라온 사진(대법원 나의사건 화면 캡처 등)이나 법원 통지서에서 앞으로 열릴 재판 기일 하나를 읽는다.
- 오늘 이후의 기일 중, 표시(테두리·밑줄)된 줄이 있으면 그 줄, 없으면 가장 가까운 기일.
- date는 YYYY-MM-DD, time은 HH:MM(24시간). kind는 화면 글자 그대로(예: 공판기일, 선고기일, 변론기일, 판결선고기일, 조정기일).
- room은 법정(예: 316호법정), court는 법원 이름(예: 인천지방법원). 모르면 빈 글자.
- 기일이 없거나 읽을 수 없으면 found=false.`;

async function download(env: SchedEnv, url: string, auth: string, fetcher: typeof fetch): Promise<{ bytes: Uint8Array; ctype: string }> {
  const a = await fetcher(url, { headers: { Authorization: auth, ...(auth.includes(env.sbKey) ? { apikey: env.sbKey } : {}) }, redirect: "manual" });
  let res = a;
  if (a.status >= 300 && a.status < 400) {
    const loc = a.headers.get("location"); await a.body?.cancel();
    if (!loc) throw new Error("주소 없음");
    res = await fetcher(loc, { headers: { Authorization: auth } });
  }
  if (!res.ok) throw new Error("내려받기 " + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw new Error("8MB 넘음");
  return { bytes, ctype: (res.headers.get("content-type") || "").split(";")[0].trim() };
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 방에 최근(48시간) 올라온 사진 최대 2장, 없으면 PDF 1개를 AI로 읽는다
export async function readRecentNotice(env: SchedEnv, channelId: string, today: string, fetcher: typeof fetch = fetch): Promise<NoticeRead | null> {
  if (!env.anthropicKey) return null;
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const imgs = await rest(env, `room_image?select=bot_id,file_id&channel_id=eq.${encodeURIComponent(channelId)}&created_at=gte.${since}&order=created_at.desc&limit=2`, fetcher);
  const blocks: unknown[] = [];
  let from = "";
  if (imgs.length) {
    const tok = await botToken(env as any, fetcher);
    for (const im of imgs.reverse()) {
      try {
        const d = await download(env, `https://www.worksapis.com/v1.0/bots/${encodeURIComponent(im.bot_id)}/attachments/${encodeURIComponent(im.file_id)}`, "Bearer " + tok, fetcher);
        const mt = /^image\/(png|jpeg|gif|webp)$/.test(d.ctype) ? d.ctype : "image/png";
        blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: b64(d.bytes) } });
      } catch (e) { console.error("image dl", String((e as Error).message).slice(0, 80)); }
    }
    if (blocks.length) from = "사진";
  }
  if (!blocks.length) {
    const pdf = await rest(env, `case_file?select=storage_path&channel_id=eq.${encodeURIComponent(channelId)}&status=eq.${encodeURIComponent("보관")}&content_type=eq.application/pdf&saved_at=gte.${since}&order=saved_at.desc&limit=1`, fetcher);
    if (pdf[0]?.storage_path) {
      const d = await download(env, `${env.sbUrl}/storage/v1/object/case-files/${pdf[0].storage_path}`, "Bearer " + env.sbKey, fetcher);
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(d.bytes) } });
      from = "통지서";
    }
  }
  if (!blocks.length) return null;
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.visionModel || "claude-sonnet-5-5", max_tokens: 400, system: READ_SYSTEM,
      output_config: { format: { type: "json_schema", schema: READ_SCHEMA } },
      messages: [{ role: "user", content: [...blocks, { type: "text", text: `오늘은 ${today}입니다.` }] }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text().catch(() => "")).slice(0, 160));
  const data = await res.json();
  const out = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("");
  const j = JSON.parse(out || "{}");
  if (!j.found || !/^\d{4}-\d{2}-\d{2}$/.test(j.date || "")) return null;
  const tm = String(j.time || "").match(/^(\d{1,2}):(\d{2})/);
  return { date: j.date, time: tm ? tm[1].padStart(2, "0") + ":" + tm[2] : "", kind: String(j.kind || "").trim(), room: String(j.room || "").trim(), court: String(j.court || "").trim(), from };
}

// 사진이 올라오면 기록만 해 둔다(파일 내용은 보관하지 않음, "/일정" 때 웍스에서 다시 받음)
export async function noteRoomImage(env: SchedEnv, botId: string, channelId: string, fileId: string, userId: string | undefined, fetcher: typeof fetch = fetch) {
  const r = await fetcher(env.sbUrl + "/rest/v1/room_image?on_conflict=file_id", {
    method: "POST",
    headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ bot_id: botId, channel_id: channelId, file_id: fileId, works_user_id: userId ?? null }),
  });
  if (!r.ok) throw new Error("room_image " + r.status + " " + (await r.text()).slice(0, 100));
  await r.body?.cancel();
  // 7일 지난 기록은 지운다
  const old = new Date(Date.now() - 7 * 864e5).toISOString();
  await fetcher(env.sbUrl + "/rest/v1/room_image?created_at=lt." + old, {
    method: "DELETE", headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey, Prefer: "return=minimal" },
  }).then((x) => x.body?.cancel()).catch(() => {});
}

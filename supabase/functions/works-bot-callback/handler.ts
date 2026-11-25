// ============================================================================
//  works-bot-callback — 네이버웍스 봇 콜백 받기 (Supabase Edge Function, Deno)
//
//  지금 하는 일:
//    · 기한 알림 카드의 버튼 [제출함] [상소 안 함] [종결·사임](postback "dl|f|사건번호|종류|만료일")을 누르면
//      deadline_confirm 에 기록한다 → 알림 프로그램이 그 기한을 더 알리지 않는다 (규칙서 R17).
//    · 사건방 리치 메뉴 "이 방 사건 보기"(postback, data="room-case")를 받으면
//      누가(userId)·어느 방(channelId)에서 눌렀는지 pc_open_request 에 기록한다.
//      → 그 사람 PC의 "정서 사건 도우미"가 받아서 사건 화면을 연다.
//    · 사건방에 파일(file 메시지)이 올라오면 웍스에서 내려받아 비공개 저장소 case-files 에
//      보관하고 case_file 표에 기록한다 (room_file.ts).
//      → 사건 화면 진행내용 탭에서 [열기]
//    · (시험 중) 사건방 글(text)은 AI가 일정(고소장 제출·조사·송치 등)만 뽑아 room_event 에 남긴다 (room_chat.ts).
//      글 원문은 저장하지 않는다. ROOM_CHAT_BOTS 에 든 봇(기본: 시험봇)의 방만.
//    · 봇이 새 사건방에 초대되면(join) 방 제목의 사건번호로 사건을 자동 연결한다 (room_link.ts).
//      로웨어 사건이 없는 수사단계 방이면 "수사 사건"을 만들어 붙이고, 나중에 방 제목이 재판부
//      사건번호로 바뀌면 로웨어 사건과 합친다 (inv_case.ts). 제목 변경 신호는 웍스가 주지 않아서
//      하루 몇 번(pg_cron, x-cron-secret) + 그 방에서 메뉴·파일이 올 때 제목을 다시 읽는다.
//
//  보안: 웍스가 보낸 것인지 X-WORKS-Signature(봇 시크릿 HMAC-SHA256, Base64)로 확인.
//
//  필요한 시크릿:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (Supabase 기본 주입)
//    WORKS_BOT_SECRET                          (개발자 콘솔 > 정서 시험봇 > Bot Secret)
//    WORKS_BOT_SECRET_PROD                     (개발자 콘솔 > 운영 봇 > Bot Secret) — 둘 중 하나와 맞으면 통과
//    WORKS_CLIENT_ID, WORKS_CLIENT_SECRET, WORKS_SERVICE_ACCOUNT, WORKS_PRIVATE_KEY  (파일 내려받기용, room_file.ts)
//  배포:  supabase functions deploy works-bot-callback --no-verify-jwt
//  콘솔:  Bot > Callback URL = https://<프로젝트>.supabase.co/functions/v1/works-bot-callback
//         (Callback 이벤트: postback + 파일 + 텍스트(시험봇만))
// ============================================================================

import { saveRoomFile } from "./room_file.ts";
import { linkPicked, linkRoomAnyBot, relinkRoom } from "./room_link.ts";
import { handleRoomFile, handleRoomText } from "./room_chat.ts";
import { calToken, hearingNotify, works } from "./hearing_notify.ts";
import { saveEvent } from "./sched_save.ts";
import { calendarUrl, handleScheduleCmd, isScheduleCmd, noteRoomImage, planForRoom } from "./schedule_cmd.ts";
import { backfillHold, recheckAll, recheckLinked, recheckRoom, refreshRoomTitles } from "./inv_case.ts";

// 우리 봇: 운영 봇(사건관리 도우미), 시험봇(정서 시험봇)
export const BOT_IDS = ["12905890", "13580302"];

export const POSTBACK_ROOM_CASE = "room-case";

// 기한 알림 버튼 (규칙서 R17 사람 확정). 웍스 버튼 템플릿은 누르면 방에 글이 남으므로
// 글이 안 남는 postback 이 되는 캐러셀 카드를 쓴다(카드당 버튼 최대 3개).
export const DL_ACTIONS: Record<string, string> = { f: "제출함", n: "상소 안 함", c: "종결·사임" };

export function parseDeadlinePostback(data: unknown) {
  if (typeof data !== "string" || !data.startsWith("dl|")) return null;
  const [, a, code, kind, due] = data.split("|");
  const action = DL_ACTIONS[a || ""];
  if (!action || !code || !kind || !/^\d{4}-\d{2}-\d{2}$/.test(due || "")) return null;
  return { action, l_code: code.slice(0, 40), kind: kind.slice(0, 20), due };
}

export async function hmacBase64(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Env = {
  sbUrl: string; sbKey: string; botSecret: string; botSecrets?: string[];
  clientId?: string; clientSecret?: string; serviceAccount?: string; privateKey?: string;
  scheduleBots?: string[]; notifyRooms?: string[]; notifyBot?: string;
  anthropicKey?: string; chatModel?: string; chatBots?: string[]; invChatBots?: string[]; invChatModel?: string;
};

// 응답(200)을 먼저 보내고 뒤에서 계속 일하기 (Supabase Edge Runtime)
function background(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
}

async function rest(env: Env, path: string, init: RequestInit = {}) {
  return fetch(env.sbUrl + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: env.sbKey,
      Authorization: "Bearer " + env.sbKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return new Response("ok");
  // 우리 서버 함수(case-view)끼리 부르는 길: 서비스 키로만. 아직 연결 안 된 방을 그 자리에서 연결
  const internal = req.headers.get("x-internal-key");
  if (internal) {
    if (!env.sbKey || !safeEqual(internal, env.sbKey)) return new Response("forbidden", { status: 403 });
    let b: any = {};
    try { b = await req.json(); } catch { /* */ }
    // PC 도우미가 방을 못 찾았을 때(pc-helper-wait): 후보 방들의 현재 제목을 다시 읽어 저장
    if (Array.isArray(b?.titles)) {
      const chs = [...new Set(b.titles.map((x: unknown) => String(x || "")).filter(Boolean))].slice(0, 8) as string[];
      const r = await refreshRoomTitles(env, BOT_IDS, chs, fetcher).catch((e) => ({ changed: 0, error: String(e?.message || e).slice(0, 120) }));
      console.log("titles(internal)", chs.length, (r as any).changed);
      return Response.json(r);
    }
    // 휴대폰 [일정 입력] → [저장] (case-view action sched-save): 확인한 일정을 변호사 캘린더에 넣기
    if (b?.schedSave) {
      try {
        const r = await saveEvent(env as any, b.schedSave, fetcher);
        console.log("schedSave(internal)", r.ok ? "ok" : r.why);
        return Response.json(r);
      } catch (e) {
        const m = String((e as Error)?.message || e);
        console.log("schedSave(internal) error", m.slice(0, 160));
        return Response.json({ why: /scope|토큰 실패 4/i.test(m) ? "캘린더 쓰기 권한이 아직 없습니다" : "캘린더에 넣지 못했습니다" });
      }
    }
    // 사건 화면 메뉴 [일정](case-view action sched): 그 방 기일로 채운 웍스 캘린더 입력 창 주소
    if (b?.sched) {
      try {
        const r = await planForRoom(env, String(b.sched), fetcher);
        console.log("sched(internal)", r.plan ? "plan" : "none");
        return Response.json(r.plan ? { url: calendarUrl(r.plan), plan: r.plan } : { why: r.why });
      } catch (e) {
        return Response.json({ why: "일정을 만들지 못했습니다", error: String((e as Error)?.message || e).slice(0, 120) });
      }
    }
    const ch = String(b?.channelId || "");
    if (!ch) return Response.json({ error: "channelId" }, { status: 400 });
    try {
      if (b?.relink) {
        const r = await relinkRoom(env, BOT_IDS, ch, b?.lNum ? Number(b.lNum) : null, String(b?.by || ""), fetcher);
        console.log("relink(internal)", r.how);
        return Response.json(r);
      }
      const r = b?.lNum ? await linkPicked(env, BOT_IDS, ch, Number(b.lNum), fetcher) : await linkRoomAnyBot(env, BOT_IDS, ch, fetcher);
      console.log("link(internal)", r.how, r.linked);
      return Response.json(r);
    } catch (e) {
      return Response.json({ linked: 0, how: "error", error: String((e as Error)?.message || e).slice(0, 120) });
    }
  }
  // pg_cron(inv_recheck_call)이 부르는 길: 수사 사건 방 제목 다시 읽기·보류 방 바꾸기
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const sec = await rest(env, "lw_settings?select=value&key=eq.cron_secret").then((r) => r.ok ? r.json() : []).catch(() => []);
    if (!sec?.[0]?.value || !safeEqual(cron, String(sec[0].value))) return new Response("forbidden", { status: 403 });
    let b: any = {};
    try { b = await req.json(); } catch { /* */ }
    try {
      // 캘린더 ID 알아보기(읽기만): 사람 이름 → 기본 캘린더·개인 캘린더 목록 (일정 입력 창 캘린더 지정용, 2026-11-25)
      if (b?.action === "cal-ids") {
        const tok = await calToken(env as any, fetcher);
        const name = String(b?.name || "서고은");
        let uid = "", cur = "";
        for (let i = 0; i < 20 && !uid; i++) {
          const j = await works(tok, `/users?count=100${cur ? "&cursor=" + encodeURIComponent(cur) : ""}`, fetcher);
          for (const u of j.users || []) if ([u?.userName?.lastName, u?.userName?.firstName].filter(Boolean).join("") === name) uid = u.userId;
          cur = j?.responseMetaData?.nextCursor || "";
          if (!cur) break;
        }
        if (!uid) return Response.json({ error: "no user" });
        const one = async (p: string) => { try { return await works(tok, p, fetcher); } catch (e) { return { error: String((e as Error)?.message || e).slice(0, 160) }; } };
        return Response.json({ uid, basic: await one(`/users/${uid}/calendar`), personals: await one(`/users/${uid}/calendar-personals`) });
      }
      if (b?.action === "hearing-notify") {
        const r = await hearingNotify(env, {
          mode: b?.mode === "missing" ? "missing" : "new", graceHours: typeof b?.graceHours === "number" ? b.graceHours : undefined,
          lookbackDays: typeof b?.lookbackDays === "number" ? b.lookbackDays : undefined, limit: typeof b?.limit === "number" ? b.limit : undefined,
          dryRun: !!b?.dryRun, force: !!b?.force && typeof b?.lpNum === "number", hours: typeof b?.hours === "number" ? b.hours : undefined, lpNum: typeof b?.lpNum === "number" ? b.lpNum : undefined,
          notifyRooms: Array.isArray(b?.rooms) ? b.rooms.map(String) : env.notifyRooms, notifyBot: String(b?.bot || env.notifyBot || "13580302"),
        }, fetcher);
        console.log("hearing-notify", r.candidates, r.sent, r.inCalendar, r.noRoom, r.skipped);
        return Response.json(r);
      }
      if (b?.action === "inv-backfill") return Response.json(await backfillHold(env, BOT_IDS, b?.dryRun !== false, fetcher));
      if (b?.action === "linked-recheck") return Response.json(await recheckLinked(env, BOT_IDS, fetcher, typeof b?.part === "number" ? b.part : undefined));
      const r = await recheckAll(env, BOT_IDS, fetcher);
      console.log("inv-recheck", r.checked, r.merged, r.waiting);
      // 로웨어 사건에 연결된 방도 1/4씩 제목 다시 읽기 (새 재판번호 → 주 사건으로)
      const l = await recheckLinked(env, BOT_IDS, fetcher).catch((e) => ({ error: String((e as Error)?.message || e).slice(0, 120) }));
      console.log("linked-recheck", JSON.stringify(l).slice(0, 300));
      return Response.json({ ...r, linked: l });
    } catch (e) {
      return Response.json({ error: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
    }
  }
  const raw = await req.text();
  const sig = req.headers.get("x-works-signature") || "";
  // 시험봇·운영 봇 시크릿 중 하나라도 맞으면 웍스가 보낸 것
  const secrets = [env.botSecret, ...(env.botSecrets || [])].filter(Boolean);
  let okSig = false;
  for (const sec of secrets) if (safeEqual(sig, await hmacBase64(raw, sec))) okSig = true;
  if (!okSig) return new Response("bad signature", { status: 401 });
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const data = ev?.data ?? ev?.content?.postback;
  const userId = ev?.source?.userId;
  const channelId = ev?.source?.channelId;
  // 시험 단계: 웍스가 보내는 모양 확인용 (내용·이름은 남기지 않음)
  console.log("event", ev?.type, Object.keys(ev || {}).join(","), "content:", ev?.content?.type || "", Object.keys(ev?.content || {}).join(","), typeof data === "string" ? data.slice(0, 30) : "", channelId ? "has-channel" : "no-channel");

  if (ev?.type === "postback" && data === POSTBACK_ROOM_CASE && userId && channelId) {
    // 한 방에 사건이 여럿이면 주 사건(상급심)을 연다
    const m = await rest(env, "works_room_case?select=l_num,case_no,status&order=is_primary.desc,updated_at.desc&limit=1&channel_id=eq." +
      encodeURIComponent(channelId));
    const rows = m.ok ? await m.json() : (await m.body?.cancel(), []);
    // 보류(어느 사건인지 확정 못 함)면 사건을 붙이지 않는다: 잘못 붙이느니 안 붙인다
    const st = rows[0]?.status ?? null;
    const hold = st === "보류";
    const caseNo = hold ? null : rows[0]?.case_no ?? null;
    const lNum = hold ? null : rows[0]?.l_num ?? null;
    const ins = await rest(env, "pc_open_request", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ works_user_id: userId, channel_id: channelId, l_num: lNum, case_no: caseNo, room_status: st }),
    });
    if (!ins.ok) console.error("insert failed", ins.status, await ins.text());
    else await ins.body?.cancel();
  }
  const dl = ev?.type === "postback" ? parseDeadlinePostback(data) : null;
  if (dl && userId) {
    // 같은 사람이 같은 기한에 같은 버튼을 또 누르면 한 번만 남긴다
    const q = `deadline_confirm?select=id&undone_at=is.null&l_code=eq.${encodeURIComponent(dl.l_code)}` +
      `&kind=eq.${encodeURIComponent(dl.kind)}&due=eq.${dl.due}&action=eq.${encodeURIComponent(dl.action)}&limit=1`;
    const ex = await rest(env, q).then((r) => r.ok ? r.json() : []).catch(() => []);
    if (!ex?.length) {
      const ins = await rest(env, "deadline_confirm", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...dl, works_user_id: userId, channel_id: channelId || null }),
      });
      if (!ins.ok) console.error("deadline_confirm insert failed", ins.status, await ins.text());
      else { await ins.body?.cancel(); console.log("deadline_confirm", dl.action); }
    }
  }
  // 사건방에 올라온 파일 → 내려받아 보관 (오래 걸릴 수 있어 응답 뒤에)
  const content = ev?.content;
  if (ev?.type === "message" && content?.type === "file" && content?.fileId && channelId) {
    const botId = req.headers.get("x-works-botid") || String(ev?.botId || "");
    if (!botId) console.error("file: no bot id");
    else {
      const invOnly = (env.invChatBots || ["12905890"]).includes(botId);
      const readChat = invOnly || (env.chatBots || ["13580302"]).includes(botId);
      background(saveRoomFile(env, { botId, fileId: String(content.fileId), channelId, userId, fileName: content.fileName || undefined }, fetcher)
        .then(async (r) => {
          console.log("file", r);
          if (r !== "saved" || !readChat) return;
          const q = await fetcher(`${env.sbUrl}/rest/v1/case_file?select=file_name&file_id=eq.${encodeURIComponent(String(content.fileId))}`, { headers: { apikey: env.sbKey, Authorization: "Bearer " + env.sbKey } });
          const name = q.ok ? String((await q.json())[0]?.file_name || "") : (await q.body?.cancel(), "");
          const c = await handleRoomFile({ sbUrl: env.sbUrl, sbKey: env.sbKey, anthropicKey: env.anthropicKey, model: invOnly ? (env.invChatModel || "claude-sonnet-5-5") : env.chatModel },
            { channelId, fileName: name, sentAt: ev?.issuedTime || ev?.createdTime, invOnly, userId }, fetcher);
          console.log("file-notice", c.how, c.saved);
        })
        .catch((e) => console.error("file fail", String(e?.message || e).slice(0, 200))));
    }
  }

  // "/일정" → 로웨어 다음 기일로 채운 웍스 캘린더 입력 창 버튼 (schedule_cmd.ts). 지금은 scheduleBots(기본: 시험봇) 방만
  const schedCmd = ev?.type === "message" && content?.type === "text" && isScheduleCmd(content?.text) && !!channelId;
  if (schedCmd) {
    const botId = req.headers.get("x-works-botid") || String(ev?.botId || "");
    if ((env.scheduleBots || ["13580302"]).includes(botId)) {
      background(handleScheduleCmd(env, botId, channelId, fetcher)
        .then((r) => console.log("schedule", r.slice(0, 60)))
        .catch((e) => console.error("schedule fail", String(e?.message || e).slice(0, 200))));
    }
  }

  // 사진이 올라오면 "/일정"이 읽을 수 있게 기록만 (scheduleBots 방만)
  if (ev?.type === "message" && content?.type === "image" && content?.fileId && channelId) {
    const botId = req.headers.get("x-works-botid") || String(ev?.botId || "");
    if ((env.scheduleBots || ["13580302"]).includes(botId)) {
      background(noteRoomImage(env, botId, channelId, String(content.fileId), userId, fetcher)
        .catch((e) => console.error("image note fail", String(e?.message || e).slice(0, 160))));
    }
  }

  // 사건방 글 → AI가 일정만 뽑아 room_event 에 (수사 사건방 글은 room_msg 에 30일 보관). 시험 봇(chatBots)은 모든 방, 운영 봇(invChatBots)은 수사 사건 방(자체 사건)만 Sonnet으로
  if (!schedCmd && ev?.type === "message" && content?.type === "text" && content?.text && channelId) {
    const botId = req.headers.get("x-works-botid") || String(ev?.botId || "");
    const invOnly = (env.invChatBots || ["12905890"]).includes(botId);
    if (invOnly || (env.chatBots || ["13580302"]).includes(botId)) {
      background(handleRoomText({ sbUrl: env.sbUrl, sbKey: env.sbKey, anthropicKey: env.anthropicKey, model: invOnly ? (env.invChatModel || "claude-sonnet-5-5") : env.chatModel },
        { channelId, text: String(content.text), sentAt: ev?.issuedTime || ev?.createdTime, invOnly, userId }, fetcher)
        .then((r) => console.log("chat", r.how, r.saved))
        .catch((e) => console.error("chat fail", String(e?.message || e).slice(0, 200))));
    }
  }

  // 도우미가 있는 방은 무조건 사건 하나(석원 2026-11-16): 초대·메시지·파일·메뉴 등 그 방에서 어떤 신호든 오면,
  // 아직 등록 안 된 방이면 바로 사건과 잇는다(로웨어에 없으면 자체 사건). 신호를 보낸 봇으로 먼저 제목을 읽는다.
  if (channelId && (ev?.type === "join" || ev?.type === "joined" || ev?.type === "message" || ev?.type === "postback")) {
    const botId = req.headers.get("x-works-botid") || String(ev?.botId || "");
    const bots = [...new Set([botId, ...BOT_IDS].filter(Boolean))];
    background(linkRoomAnyBot(env, bots, channelId, fetcher)
      .then((r) => { if (r.how !== "already") console.log("link", ev?.type, r.how, r.linked); })
      .catch((e) => console.error("link fail", String(e?.message || e).slice(0, 200))));
  }

  // 수사 사건 방에서 메뉴·파일이 오면 방 제목을 다시 읽어, 재판부 사건번호로 바뀌었으면 합친다
  if (channelId && (ev?.type === "postback" || (ev?.type === "message" && content?.type === "file"))) {
    background(recheckRoom(env, BOT_IDS, channelId, fetcher)
      .then((r) => { if (r.length) console.log("inv-room", r.map((x) => x.how).join(",")); })
      .catch((e) => console.error("inv-room fail", String(e?.message || e).slice(0, 200))));
  }

  // 웍스는 빨리 200을 받아야 다시 보내지 않음
  return new Response("ok");
}

// 법무법인 정서 - 로웨어 '하루 변경분' 수집기 v1 (2026-11-12)
//
// 하는 일 (로웨어에서는 읽기만 한다)
//   1) 로웨어 첫 화면 '새 기일추가·변경 / 새 송달·서면' 목록(law_appoint_process_update_json)을
//      날짜 구간으로 한 번에 받아 lw_process_events 에 쌓는다. 바뀐 기록은 lw_process_event_changes 에 옛값을 남긴다.
//   2) 송달 비고의 'YYYY.MM.DD 도달'을 delivered_date 로 뽑는다 (lw_ingest_events 함수에서).
//   3) 사건 상세(law_view_json)를 허용 목록 칸만 lw_case_detail 에 저장한다.
//      오늘 바뀐 사건 먼저, 남는 시간에 오래된 사건부터 조금씩 돈다.
//   4) 사건 목록 표(cases)에 없는 진행 사건이면 새 줄로 넣는다(있는 줄은 그대로).
//
// 호출: POST { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", detailLimit?: number, startOffset?: number }
//   헤더 x-cron-secret 이 lw_settings.cron_secret 과 같아야 한다 (pg_cron 이 붙여 보냄).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const LAW_ID = Deno.env.get("LAW_ID") ?? "";
const LAW_PW = Deno.env.get("LAW_PW") ?? "";
const BASE = "https://jeongseolaw.lawware.kr";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIME_BUDGET_MS = 110_000;

// 사건 상세에서 받아 두는 칸. 주민번호·주소·연락처·이메일·수임료·청구 칸은 일부러 뺐다.
const DETAIL_KEYS = [
  "l_num", "l_code", "l_name", "l_kind", "l_state", "l_state2", "l_state3", "l_level", "l_step", "l_ref",
  "l_accept_date", "l_allocate_date", "l_judgment_date", "l_judgment_kind", "l_winning", "l_winning_result",
  "l_close_date", "l_trial", "l_trial_date", "l_court", "l_justice_dept", "l_lawcourt", "l_lawcourt_date",
  "l_judge", "l_prosecute", "l_prosecutor", "l_police_station", "l_police_detective",
  "l_c1code", "l_c1court", "l_c1gubun", "l_c2code", "l_c2court", "l_c2gubun", "l_c3code", "l_c3court", "l_c3gubun",
  "l_c4code", "l_c4court", "l_c4gubun", "l_c5code", "l_c5court", "l_c5gubun", "l_c6code", "l_c6court", "l_c6gubun",
  "l_code_chain", "l_client", "l_client_charge", "l_client_postion", "l_another", "l_another_charge",
  "l_another_postion", "l_another_lawoffice", "l_another_lawyer",
  "l_prison_info", "l_detention_info", "l_lockup_info", "l_transfer_date", "l_received_date",
  "l_charge_lawyer", "l_perform_lawyer", "l_accept_lawyer", "l_charge_staff", "x_attend_lawyer", "l_update_key",
];

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function mergeCookies(store: Record<string, string>, res: Response) {
  let list: string[] = [];
  try { list = res.headers.getSetCookie(); } catch (_e) {
    const raw = res.headers.get("set-cookie");
    if (raw) list = raw.split(/,(?=[^ ;]+=)/);
  }
  for (const c of list) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) store[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}
const cookieHeader = (s: Record<string, string>) => Object.keys(s).map((k) => k + "=" + s[k]).join("; ");

async function login() {
  const store: Record<string, string> = {};
  mergeCookies(store, await fetch(BASE + "/index.html", { headers: { "User-Agent": UA }, redirect: "manual" }));
  const res = await fetch(BASE + "/include/auth.php?mode=login&captchaKey=&security=&uname=", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded", "User-Agent": UA,
      "Referer": BASE + "/index.html", "Cookie": cookieHeader(store),
    },
    body: "uid=" + encodeURIComponent(LAW_ID) + "&upw=" + encodeURIComponent(LAW_PW),
    redirect: "manual",
  });
  mergeCookies(store, res);
  if (!store.u_id) throw new Error("로웨어 로그인 실패 status=" + res.status);
  return store;
}

async function getJson(store: Record<string, string>, path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "User-Agent": UA, "X-Requested-With": "XMLHttpRequest",
      "Referer": BASE + "/main.html", "Cookie": cookieHeader(store),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) throw new Error("JSON 아님: " + text.slice(0, 80));
  return JSON.parse(text);
}

function kstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

// 한 번에 최대 5000줄. 하루에 그보다 많으면 startOffset 으로 이어 받는다(옛 내역 한꺼번에 받을 때)
async function fetchFeed(store: Record<string, string>, from: string, to: string, start = 0) {
  const all: any[] = [];
  let total = 0;
  for (let offset = start; offset < start + 5000; offset += 100) {
    const req = {
      cmd: "get", limit: 100, offset, schSet: "", schWorkScope: "",
      schDate: from, schDate2: to, schDateFix: "1", schByUpdate: "schByUpdate",
      schLawyer: "", schStaff: "",
    };
    const data = await getJson(store, "/lawsuit/law_appoint_process_update_json.php?request=" +
      encodeURIComponent(JSON.stringify(req)));
    const recs = data.records ?? [];
    all.push(...recs);
    total = Number(data.total ?? 0);
    if (recs.length < 100 || start + all.length >= total) break;
  }
  // 화면용 HTML 칸은 버리고 필요한 칸만 남긴다
  const rows = all.map((r) => ({
    lp_num: r.lp_num, l_num: r.l_num ?? r.lp_l_num, l_code: r.l_code, lp_set: r.lp_set,
    lp_work_type: r.lp_work_type, lp_appoint_date: r.lp_appoint_date, lp_appoint_time: r.lp_appoint_time,
    lp_contents: r.lp_contents, lp_remark: r.lp_remark, lp_docu_appoint_limit: r.lp_docu_appoint_limit,
    lp_docu_submit_date: r.lp_docu_submit_date, lp_attach_file: r.lp_attach_file,
    lp_regdatetime: r.lp_regdatetime, lp_append_wdate: r.lp_append_wdate, lp_append_udate: r.lp_append_udate,
    l_client_postion: r.l_client_postion, l_court: r.l_court,
  }));
  return { rows, total };
}

// 상세(lw_case_detail.info) → 사건 목록 표(cases) 한 줄. 사무실 PC가 넣는 줄과 같은 칸 이름.
export function caseRowFromDetail(d: { l_num: number; info: Record<string, any> }) {
  const i = d.info || {};
  const s = (v: unknown) => (v == null ? null : String(v));
  return {
    l_num: d.l_num, l_code: s(i.l_code), l_name: s(i.l_name), l_kind: s(i.l_kind), l_client: s(i.l_client),
    client_position: s(i.l_client_postion), court: s(i.l_court), charge_lawyer: s(i.l_charge_lawyer),
    perform_lawyer: s(i.l_perform_lawyer), charge_staff: s(i.l_charge_staff), state: s(i.l_state),
    accept_date: /^\d{4}-\d{2}-\d{2}/.test(String(i.l_accept_date ?? "")) ? String(i.l_accept_date).slice(0, 10) : null,
    raw: i, updated_at: new Date().toISOString(),
  };
}

function parseLog(log: string) {
  let defendants: string[] | null = null;
  const related = new Map<string, any>();
  for (const line of log.split("\n")) {
    const d = line.match(/^@@DEFENDANTS:(.*)$/);
    if (d) defendants = d[1].split(/[,|]/).map((s) => s.trim()).filter(Boolean);
    const r = line.match(/^@@RELATED:(.*)$/);
    if (r) {
      const [court, code, extra, kind] = r[1].split("|");
      if (code) related.set(court + "|" + code, { court, code, extra: extra || null, kind: kind || null });
    }
  }
  return { defendants, related: [...related.values()] };
}

async function fetchDetail(store: Record<string, string>, l_num: number, l_code: string) {
  const data = await getJson(store, "/lawsuit/law_view_json.php", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "schKey=" + encodeURIComponent(l_code ?? "") + "&schVal=" + encodeURIComponent(String(l_num)),
  });
  const rec = data.l_num !== undefined ? data : (data.records?.[0] ?? {});
  const info: Record<string, unknown> = {};
  for (const k of DETAIL_KEYS) {
    const v = rec[k];
    if (v !== undefined && v !== null && v !== "" && v !== "0000-00-00") info[k] = v;
  }
  const log = String(rec.l_scourt_appoint_log ?? "");
  const { defendants, related } = parseLog(log);
  return {
    l_num, l_code: rec.l_code ?? l_code, info,
    scourt_appoint_log: log || null, defendants, related,
    fetched_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  const { data: sec } = await db.from("lw_settings").select("value").eq("key", "cron_secret").single();
  if (!sec?.value || req.headers.get("x-cron-secret") !== sec.value) return json({ error: "forbidden" }, 403);

  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const from = body.from ?? kstDate(-1);
  const to = body.to ?? kstDate(0);
  const detailLimit = Math.min(Number(body.detailLimit ?? 40), 200);
  const startOffset = Math.max(0, Math.floor(Number(body.startOffset ?? 0)) || 0);

  const { data: run } = await db.from("lw_feed_runs").insert({ date_from: from, date_to: to }).select("id").single();
  let total = 0;
  const result = { fetched: 0, new_count: 0, changed_count: 0, detail_count: 0, error: null as string | null };

  try {
    const store = await login();

    // 1·2) 하루 변경분 + 송달 도달일
    const feed = await fetchFeed(store, from, to, startOffset);
    const rows = feed.rows;
    total = feed.total;
    result.fetched = rows.length;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await db.rpc("lw_ingest_events", { rows: rows.slice(i, i + 200) });
      if (error) throw new Error("저장 실패: " + error.message);
      result.new_count += data.new;
      result.changed_count += data.changed;
    }

    // 3) 사건 상세: 이번에 바뀐 사건 먼저, 그다음 오래 안 받은 사건
    const touched = new Map<number, string>();
    for (const r of rows) if (r.l_num) touched.set(Number(r.l_num), r.l_code);
    const targets: [number, string][] = [...touched.entries()];
    if (targets.length < detailLimit) {
      const { data: seen } = await db.from("lw_case_detail").select("l_num, fetched_at");
      const seenAt = new Map((seen ?? []).map((s: any) => [Number(s.l_num), s.fetched_at]));
      const { data: cases } = await db.from("cases").select("l_num, l_code");
      const rest = (cases ?? [])
        .filter((c: any) => !touched.has(Number(c.l_num)))
        .sort((a: any, b: any) => String(seenAt.get(Number(a.l_num)) ?? "").localeCompare(String(seenAt.get(Number(b.l_num)) ?? "")));
      for (const c of rest) {
        if (targets.length >= detailLimit) break;
        targets.push([Number(c.l_num), c.l_code]);
      }
    }
    const details = [];
    for (const [l_num, l_code] of targets.slice(0, Math.max(detailLimit, touched.size))) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      try { details.push(await fetchDetail(store, l_num, l_code)); } catch (_e) { /* 한 건 실패는 다음 회차에 */ }
    }
    if (details.length) {
      const { error } = await db.from("lw_case_detail").upsert(details, { onConflict: "l_num" });
      if (error) throw new Error("상세 저장 실패: " + error.message);
    }
    result.detail_count = details.length;

    // 4) 사건 목록 표(cases)에 없는 진행 사건 채우기 (석원 2026-11-13)
    //    cases 는 사무실 PC 도우미가 채우는데 진행 사건 일부(형사 위주)가 빠져 사건방 연결이 안 됐다.
    //    이미 있는 줄은 절대 건드리지 않는다(ignore-duplicates). 상세에 허용된 칸만 쓴다.
    const fill = details.filter((d) => d.info?.l_state === "진행" && d.info?.l_code).map(caseRowFromDetail);
    if (fill.length) {
      const { error } = await db.from("cases").upsert(fill, { onConflict: "l_num", ignoreDuplicates: true });
      if (error) console.log("cases 채우기 실패", error.message);
    }
  } catch (e) {
    result.error = String(e);
  }

  if (run?.id) await db.from("lw_feed_runs").update({ ...result, finished_at: new Date().toISOString() }).eq("id", run.id);
  return json({ from, to, startOffset, total, ...result, ms: Date.now() - t0 }, result.error ? 500 : 200);
});

// 실행: deno test supabase/functions/case-view/file_ai_test.ts
import { attachByAI, attachFinalFiles, handle } from "./handler.ts";
import { MANUAL, applyMatches, buildPrompt, candidateLines, fileSig, lineKey, pendingFiles } from "./file_ai.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const env = { sbUrl: "https://x.supabase.co", sbKey: "k", anthropicKey: "a" };
const ev = () => [
  { d: "2026-11-17", k: "ours", g: "hearing", t: "선고기일 · 319호 법정" },
  { d: "2026-11-18", k: "ours", g: "ours", t: "판결등본", lp: 76064 },
  { d: "2026-11-18", k: "ours", g: "ours", t: "열람및복사신청", lp: 75771, minor: 1 },
  { d: "2026-11-18", k: "ours", g: "ours", t: "인천연수서 서면 우편 제출", src: "chat", rid: 844 },
  { d: "2026-11-30", k: "due", g: "hearing", t: "다음 기일" },
];
const files = [
  { id: 89, n: "이향원_판결문_2026노952.pdf", d: "2026-11-18", tm: "16:23", at: Date.parse("2026-11-18T07:23:00Z"), pdf: 1, lp: null },
  { id: 49, n: "변호인선임신고서_정상우.pdf", d: "2026-11-18", tm: "09:32", at: Date.parse("2026-11-18T00:32:00Z"), pdf: 1, lp: null },
  { id: 27, n: "이향원_편지_261117.pdf", d: "2026-11-17", tm: "10:00", at: Date.parse("2026-11-17T01:00:00Z"), pdf: 1, lp: null },
  { id: 5, n: "위임계약서.pdf", d: "2026-11-01", tm: "10:00", at: 1, pdf: 1, lp: null },
];

Deno.test("AI 질문: 예정·사소한 줄은 빼고, 대화도 함께", () => {
  const lines = candidateLines(ev(), /열람|복사/);
  assert(lines.length === 3, "줄 수 " + lines.length);
  const p = buildPrompt("사건", lines, files.slice(0, 2), [{ at: Date.parse("2026-11-18T00:35:00Z"), text: "선임신고서 우편제출하겠습니다" }]);
  assert(p.user.includes("선임신고서 우편제출하겠습니다"), "대화 없음");
  assert(!p.user.includes("열람"), "사소한 줄 들어감");
  assert(p.lineIds.size === 3 && p.fileIds.size === 2, "번호");
});

Deno.test("AI가 고른 줄에 붙이고, 판단은 기억해서 다시 묻지 않음", async () => {
  let asked = 0, saved: any[] = [];
  const fetcher = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/case_file_match?select")) return Response.json(saved);
    if (u.includes("/case_file_match?on_conflict")) { saved = JSON.parse(init.body); return new Response(null, { status: 201 }); }
    if (u.includes("/room_msg")) return Response.json([{ sent_at: "2026-11-18T00:35:00Z", text: "선임신고서 우편제출하겠습니다" }]);
    if (u.includes("anthropic.com")) {
      asked++;
      const body = JSON.parse(init.body);
      assert(body.model === "claude-haiku-5-5", "모델");
      const msg = body.messages[0].content as string;
      assert(asked > 1 || msg.includes("위임계약서"), "계약서도 AI가 판단(2026-11-20)");
      // L1 선고, L2 판결등본, L3 우편 제출 / F1 판결문, F2 선임신고서, F3 편지
      const picks = [{ file: "F1", line: "L1", why: "판결문" }, { file: "F2", line: "L3", why: "선임신고서 우편 제출" }, { file: "F3", line: null, why: "편지" }, { file: "F4", line: null, why: "선임 줄 없음" }];
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ picks }) }], stop_reason: "end_turn" });
    }
    throw new Error("예상 못한 요청 " + u);
  }) as typeof fetch;
  const e1 = ev();
  assert(await attachByAI(env, e1, files, ["ch"], "사건", fetcher), "실패");
  assert(e1[0].f?.id === 89 && e1[3].f?.id === 49 && !e1[1].f && !e1[2].f, JSON.stringify(e1.map((e) => e.f)));
  assert(saved.length === 4 && saved.find((r) => r.file_id === 27).line_key === null, "안 붙은 것도 기록");
  const e2 = ev();
  await attachByAI(env, e2, files, ["ch"], "사건", fetcher);
  assert(asked === 1, "다시 물음 " + asked);
  assert(e2[0].f?.id === 89 && e2[3].f?.id === 49, "기억된 판단");
  // 새 줄이 생기면 그 무렵 파일은 다시 묻는다
  const e3 = [...ev(), { d: "2026-11-19", k: "ours", g: "ours", t: "의견서", lp: 80000 }];
  await attachByAI(env, e3, files, ["ch"], "사건", fetcher);
  assert(asked === 2, "새 줄인데 안 물음");
});

Deno.test("한 줄에 두 파일이면 늦게 올라온 것, 직원이 뺀 줄은 손대지 않음", () => {
  const e = [{ d: "2026-11-18", k: "ours", g: "ours", t: "의견서", lp: 1 }, { d: "2026-11-18", k: "ours", g: "ours", t: "탄원서", lp: 2, none: 1 }];
  const fs = [{ id: 1, n: "의견서_초안.pdf", d: "2026-11-18", at: 1, pdf: 1, lp: null }, { id: 2, n: "의견서_최종.pdf", d: "2026-11-18", at: 2, pdf: 1, lp: null },
    { id: 3, n: "탄원서.pdf", d: "2026-11-18", at: 3, pdf: 1, lp: null }];
  const lines = candidateLines(e, /열람/);
  const c = new Map<number, any>([[1, { file_id: 1, line_key: "lp:1", sig: "" }], [2, { file_id: 2, line_key: "lp:1", sig: "" }], [3, { file_id: 3, line_key: "lp:2", sig: "" }]]);
  applyMatches(e, fs, c, lines);
  assert((e[0] as any).f?.id === 2, "마지막 서면");
  assert(!(e[1] as any).f, "뺀 줄");
  assert(lineKey(e[0]) === "lp:1" && fileSig(fs[0], lines).length > 0, "키");
});

Deno.test("AI를 못 쓰면 false(예전 규칙으로)", async () => {
  const fetcher = (async (url: any) => {
    if (String(url).includes("case_file_match")) return new Response("relation does not exist", { status: 404 });
    return Response.json([]);
  }) as typeof fetch;
  let ok = true;
  try { ok = await attachByAI(env, ev(), files, [], "사건", fetcher); } catch { ok = false; }
  assert(!ok, "표 없으면 실패로");
  assert(!(await attachByAI({ ...env, anthropicKey: undefined }, ev(), files, [], "사건")), "열쇠 없으면 false");
});

Deno.test("파일 다시 맞추기는 예약 작업 열쇠가 있어야", async () => {
  const fetcher = (async (url: any) => {
    const u = String(url);
    if (u.includes("lw_settings")) return Response.json([{ value: "s3cret" }]);
    if (u.includes("case_file?select=channel_id")) return Response.json([]);
    return Response.json([]);
  }) as typeof fetch;
  const call = (h: Record<string, string>) => handle(new Request("http://x/", { method: "POST", headers: h, body: JSON.stringify({ action: "file_backfill" }) }), env as any, fetcher);
  assert((await call({})).status === 403, "열쇠 없이 됨");
  const r = await call({ "x-cron-secret": "s3cret" });
  assert(r.status === 200 && (await r.json()).rooms === 0, "열쇠 있으면 실행");
});

Deno.test("한글 파일은 초안: AI 후보에서 빼고 참고로만 보여 줌, 예전 규칙도 PDF만 붙임 (2026-11-19 석원)", async () => {
  const fs = [
    { id: 61, n: "항소이유서_이향원.hwp", d: "2026-11-10", tm: "10:00", at: Date.parse("2026-11-10T01:00:00Z"), pdf: 0, lp: null },
    { id: 62, n: "항소이유서_이향원.pdf", d: "2026-11-11", tm: "15:00", at: Date.parse("2026-11-11T06:00:00Z"), pdf: 1, lp: null },
    { id: 63, n: "참고자료1_진단서.pdf", d: "2026-11-11", tm: "15:01", at: Date.parse("2026-11-11T06:01:00Z"), pdf: 1, lp: null },
  ];
  const e = () => [{ d: "2026-11-11", k: "ours", g: "ours", t: "변호인 법무법인 정서 항소이유서 제출", lp: 900 }];
  let body = "";
  const fetcher = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("case_file_match") && (!init || !init.method || init.method === "GET")) return Response.json([]);
    if (u.includes("case_file_match")) return new Response(null, { status: 201 });
    if (u.includes("room_msg")) return Response.json([{ sent_at: "2026-11-11T06:05:00Z", text: "ㄱㄱ" }]);
    if (u.includes("api.anthropic.com")) {
      body = JSON.parse(init.body).messages[0].content;
      const id = (name: string) => (body.match(new RegExp("(F\\d+) [^\\n]*" + name)) || [])[1];
      const picks = [{ file: id("항소이유서_이향원.pdf"), line: "L1", why: "항소이유서 본문" }, { file: id("진단서"), line: null, why: "첨부" }];
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ picks }) }], stop_reason: "end_turn" });
    }
    throw new Error("예상 못한 요청 " + u);
  }) as typeof fetch;
  const e1 = e();
  assert(await attachByAI(env, e1, fs, ["ch"], "사건", fetcher), "실패");
  const files = body.split("올라온 파일:")[1].split("\n\n")[0];
  assert(!files.includes(".hwp") && files.includes("항소이유서_이향원.pdf"), files);
  assert(body.includes("같은 무렵 한글 파일") && body.includes("항소이유서_이향원.hwp") && body.includes("ㄱㄱ"), body);
  assert((e1[0] as any).f?.id === 62, JSON.stringify(e1));
  // 예전 이름 규칙(AI 못 쓸 때)도 한글 파일은 붙이지 않는다
  const e2 = e();
  attachFinalFiles(e2, [fs[0]]);
  assert(!(e2[0] as any).f, "hwp가 붙음");
  const e3 = e();
  attachFinalFiles(e3, fs);
  assert((e3[0] as any).f?.id === 62, JSON.stringify(e3));
});

Deno.test("파일마다 답을 받는 모양: 파일 번호가 칸 이름, 줄은 정해진 번호 중에서 (이강효 재정신청서 2026-11-19)", async () => {
  const fs = [{ id: 136, n: "이강효_재정신청서_261119.pdf", d: "2026-11-19", tm: "16:08", at: Date.parse("2026-11-19T07:08:00Z"), pdf: 1, lp: null }];
  const e = [{ d: "2026-11-19", k: "ours", g: "ours", t: "재정신청서 제출 15:10 · 인천지방공소청", src: "chat", rid: 900 }];
  let schema: any = null;
  const fetcher = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("case_file_match") && (!init || !init.method || init.method === "GET")) return Response.json([]);
    if (u.includes("case_file_match")) return new Response(null, { status: 201 });
    if (u.includes("room_msg")) return Response.json([]);
    if (u.includes("api.anthropic.com")) {
      schema = JSON.parse(init.body).output_config.format.schema;
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ F1: { line: "L1", why: "재정신청서 최종본" } }) }], stop_reason: "end_turn" });
    }
    throw new Error("예상 못한 요청 " + u);
  }) as typeof fetch;
  assert(await attachByAI(env, e, fs, ["ch"], "사건", fetcher), "실패");
  assert(JSON.stringify(schema.required) === '["F1"]' && schema.properties.F1.properties.line.enum.includes("L1"), JSON.stringify(schema));
  assert((e[0] as any).f?.id === 136, JSON.stringify(e));
});

Deno.test("화면을 연 사람은 AI를 기다리지 않는다: 뒤에서 묻고 저장, 다음 열 때 붙음", async () => {
  let saved: any[] = [], asked = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const fetcher = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/case_file_match?select")) return Response.json(saved);
    if (u.includes("/case_file_match?on_conflict")) { saved = JSON.parse(init.body); return new Response(null, { status: 201 }); }
    if (u.includes("/room_msg")) return Response.json([]);
    if (u.includes("anthropic.com")) {
      asked++; await gate;
      const picks = [{ file: "F1", line: "L1", why: "판결문" }, { file: "F2", line: null, why: "" }, { file: "F3", line: null, why: "" }, { file: "F4", line: null, why: "" }];
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ picks }) }], stop_reason: "end_turn" });
    }
    throw new Error("예상 못한 요청 " + u);
  }) as typeof fetch;
  const jobs: Promise<unknown>[] = [];
  const e1 = ev();
  assert(await attachByAI(env, e1, files, ["ch"], "사건", fetcher, (p) => jobs.push(p)), "실패");
  assert(!e1[0].f, "AI 답 전에는 안 붙음");
  assert(jobs.length === 1 && saved.length === 0, "뒤에서 할 일 하나, 아직 저장 전");
  release(); await Promise.all(jobs);
  assert(asked === 1 && saved.length === 4, "뒤에서 물어 저장");
  const e2 = ev();
  await attachByAI(env, e2, files, ["ch"], "사건", fetcher, (p) => jobs.push(p));
  assert(e2[0].f?.id === 89 && asked === 1 && jobs.length === 1, "다음 열 때 붙고 다시 안 물음");
});

Deno.test("받은 중요 문서(2026-11-20 석원): 공소장 줄, 처분 통지 줄도 후보, 오래된 판결문도 찾음", () => {
  const lines = candidateLines([
    { d: "2026-03-02", k: "done", g: "notice", t: "공소장 부본 도달" },
    { d: "2026-11-18", k: "room", g: "chat", src: "chat", rid: 7, t: "고소·고발사건 결정결과 통지 수령" },
    { d: "2026-11-18", k: "room", g: "chat", src: "chat", rid: 8, t: "의뢰인과 통화" },
    { d: "2025-06-10", k: "ours", g: "hearing", t: "선고기일" },
  ], /열람/);
  assert(lines.length === 3 && !lines.some((e) => e.rid === 8), JSON.stringify(lines));
  const old = { id: 1, n: "문승현_2025노1790_판결문.pdf", d: "2026-11-18", tm: "10:00", at: 1, pdf: 1 };
  const p = buildPrompt("사건", lines, [old], []);
  assert(p.user.includes("2025-06-10") && p.user.includes("받은 문서"), p.user);
});

Deno.test("계약서도 AI가: 사건 선임 줄을 고르면 계약서 자리(cf)에 붙음 (2026-11-20 석원)", () => {
  const e: any[] = [{ d: "2026-11-01", k: "ours", g: "accept", t: "사건 선임" }, { d: "2026-11-02", k: "ours", g: "ours", t: "의견서", lp: 3 }];
  const lines = candidateLines(e, /열람/);
  assert(lines.some((x) => x.g === "accept"), "선임 줄이 후보에 없음");
  const fs = [{ id: 5, n: "(형사)송무위임계약서_홍길동.pdf", d: "2026-11-01", at: 1, pdf: 1, lp: null }];
  applyMatches(e, fs, new Map([[5, { file_id: 5, line_key: lineKey(e[0]), sig: "" }]]), lines);
  assert(e[0].cf?.id === 5 && !e[0].f, JSON.stringify(e[0]));
  assert(buildPrompt("사건", lines, fs, []).user.includes("[사건 선임]"), "선임 줄 이름");
});

Deno.test("예정인 우리 제출 줄(방 대화)은 후보, 기한·앞으로의 기일은 아님 / 사건번호를 프롬프트에", () => {
  const lines = candidateLines([
    { d: "2026-11-20", k: "due", g: "ours", t: "선임계 제출(○○경찰서)", src: "chat", rid: 1 },
    { d: "2026-11-30", k: "due", g: "hearing", t: "다음 기일" },
    { d: "2026-11-25", k: "due", g: "limit", t: "항소이유서 마감", src: "chat", rid: 2 },
  ], /열람/);
  assert(lines.length === 1 && lines[0].rid === 1, "예정 제출 줄만: " + JSON.stringify(lines));
  const { user } = buildPrompt("2025노1234 홍길동외1", lines, [{ id: 9, d: "2026-11-20", n: "홍길동_선임계.pdf", at: Date.parse("2026-11-20T00:45:00Z") }], []);
  assert(user.includes("사건: 2025노1234") && user.includes("선임계 제출"), user);
});

Deno.test("다시 묻는 파일이 예전 판단으로 붙어 있어도 '이미 붙음'으로 보이지 않음", () => {
  const lines = [
    { d: "2026-11-19", k: "done", g: "notice", t: "공소장 부본 도달", f: { id: 7, n: "홍길동_공소장.pdf", ai: 1 } },
    { d: "2026-11-19", k: "ours", g: "ours", t: "의견서 제출", f: { id: 8, n: "홍길동_의견서.pdf", pick: 0 } },
  ];
  const { user } = buildPrompt("2026고단1 홍길동", lines, [{ id: 7, d: "2026-11-19", n: "홍길동_공소장.pdf", at: Date.parse("2026-11-19T01:00:00Z") }], []);
  assert(!user.includes("이미 붙음: 홍길동_공소장"), user);
  assert(user.includes("이미 붙음: 홍길동_의견서"), "다른 파일은 그대로: " + user);
});

Deno.test("직원이 고른 판단(manual)은 다시 묻지 않고, 같은 줄에선 AI 판단보다 먼저 / 후보 줄엔 lk", () => {
  const ev = [
    { d: "2026-11-17", k: "done", g: "hearing", t: "송치·불송치", src: "chat", rid: 5 },
    { d: "2026-11-18", k: "ours", g: "ours", t: "의견서 제출", lp: 9 },
  ];
  const lines = candidateLines(ev, /열람/);
  const files = [
    { id: 1, n: "홍길동_결정결과 통지서.pdf", d: "2026-11-19", at: Date.parse("2026-11-19T01:00:00Z"), pdf: 1 },
    { id: 2, n: "홍길동_통지서 사본.pdf", d: "2026-11-20", at: Date.parse("2026-11-20T01:00:00Z"), pdf: 1 },
  ];
  const cache = new Map<number, any>([
    [1, { file_id: 1, line_key: "r:5", sig: MANUAL }],
    [2, { file_id: 2, line_key: "r:5", sig: fileSig(files[1], lines) }],
  ]);
  applyMatches(ev, files, cache, lines);
  assert((ev[0] as any).f?.id === 1, "직원이 고른 파일이 먼저: " + JSON.stringify(ev[0]));
  assert((ev[0] as any).lk === "r:5" && (ev[1] as any).lk === undefined, "lk는 lp 아닌 줄에만");
  const pend = pendingFiles(files.map((f) => ({ ...f, n: f.n })), lines, cache, () => false);
  assert(!pend.some((f: any) => f.id === 1), "manual은 다시 안 물음");
});

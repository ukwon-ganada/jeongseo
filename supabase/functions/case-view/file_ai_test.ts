// 실행: deno test supabase/functions/case-view/file_ai_test.ts
import { attachByAI, handle } from "./handler.ts";
import { applyMatches, buildPrompt, candidateLines, fileSig, lineKey } from "./file_ai.ts";
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
      assert(!msg.includes("계약서"), "계약서는 AI에 안 보냄");
      // L1 선고, L2 판결등본, L3 우편 제출 / F1 판결문, F2 선임신고서, F3 편지
      const picks = [{ file: "F1", line: "L1", why: "판결문" }, { file: "F2", line: "L3", why: "선임신고서 우편 제출" }, { file: "F3", line: null, why: "편지" }];
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ picks }) }], stop_reason: "end_turn" });
    }
    throw new Error("예상 못한 요청 " + u);
  }) as typeof fetch;
  const e1 = ev();
  assert(await attachByAI(env, e1, files, ["ch"], "사건", fetcher), "실패");
  assert(e1[0].f?.id === 89 && e1[3].f?.id === 49 && !e1[1].f && !e1[2].f, JSON.stringify(e1.map((e) => e.f)));
  assert(saved.length === 3 && saved.find((r) => r.file_id === 27).line_key === null, "안 붙은 것도 기록");
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

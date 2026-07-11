// ============================================================================
//  draft-yeongi — 기일연기/변경신청서 "사유" 문단 자동 작성 (Supabase Edge Function, Deno)
//
//  하는 일:
//    직원이 입력한 간단 메모 + 사건 맥락을 받아, 법무법인 정서의 실제 서면 문체로
//    "연기/변경 사유" 문단을 작성해 돌려준다. (서면 전체가 아니라 사유 문단만)
//    → 프론트(yeongi.js)가 이 문장을 서면 사유란에 채우고, HWPX 다운로드는 프론트가 한다.
//
//  원칙(시스템 프롬프트에 강제):
//    · 사용자가 준 사실만 사용. 없는 사실·법조문·판례·사건번호를 창작하지 않는다.
//    · 정서 관용구(위 사건에 대하여~ / 부득이하게 / 귀 재판부에서 혜량하여 주시어 ~
//      허가하여 주시기를 요청드립니다) 를 유지한다.
//    · A4 1장에 들어가도록 1개 문단, 군더더기 없이 간결하게.
//    · 최종 서면은 변호사가 검토·수정 후 제출한다(초안 제공).
//
//  필요한 Supabase 시크릿(대시보드 또는 CLI):
//    ANTHROPIC_API_KEY   (Anthropic API 키 — 브라우저에 노출 안 됨, 여기서만 사용)
//    (선택) YEONGI_MODEL  기본값 claude-opus-4-8
//
//  배포:  supabase functions deploy draft-yeongi --no-verify-jwt
//         (프론트는 apikey 헤더로 호출. otp-send 와 동일 패턴)
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("YEONGI_MODEL") || "claude-opus-4-8";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ── 정서 문체 규칙 (시스템 프롬프트) ─────────────────────────────────────────
const SYSTEM = `당신은 대한민국 법무법인 '정서'의 서면 작성을 돕는 조수입니다.
법원에 제출하는 '기일연기신청서 / 기일변경신청서'의 **사유 문단 한 개**만 작성합니다.
서면 전체(제목·당사자·서명 등)는 만들지 말고, 사유 문단 본문만 출력합니다.

[반드시 지킬 규칙]
1. 사용자가 제공한 사실만 사용한다. 제공되지 않은 날짜·사건번호·법원명·법조문·판례를 절대 지어내지 않는다. 정보가 부족하면 그 부분은 자연스럽게 일반화하되 없는 사실을 만들지 않는다.
2. 정서의 고정 문형을 지킨다.
   - 형사(피고인의 변호인): "위 사건에 대하여 [일시]으로 [공판/변론/선고]기일이 지정되어 있으나, …(사유)… 부득이하게 [공판]기일을 [연기/변경]신청하오니, 귀 재판부에서 혜량하여 주시어 이 사건 [공판]기일 연기신청을 허가하여 주시기를 요청드립니다."
   - 민사(원고/피고의 소송대리인): 도입은 서면 상단이 담당하므로, 사유 본문만 간결히. "…(사유)… 부득이 기일변경신청서를 제출하오니, 귀 재판부에서 혜량하여 주시어 이 사건 변론기일을 연기하여 주시기를 희망합니다." 형태.
3. '부득이하게/부득이', '혜량하여 주시어' 등 정서 특유의 격식체를 사용한다. 대화체·구어체 금지.
4. A4 1장에 들어가도록 **한 문단**, 군더더기 없이 간결하게. 불필요한 배경설명·감정표현·사과문 금지.
5. 출력은 사유 문단 텍스트만. 제목·머리말·따옴표·마크다운·설명을 붙이지 않는다.

[정서 실제 서면 사유 예시]
(형사·기일중복) "위 사건에 대하여 2024. 03. 22. 10:00경으로 공판기일이 지정되어 있으나, 피고인의 변호인은 같은 날 인천지방법원 2023고단7028 사건의 공판기일이 2024. 03. 22. 10:20로 지정되어 있어 위 기일에 참석이 어려워 부득이하게 공판기일 연기 신청하오니 귀 재판부께서 혜량하여 주시어 공판기일을 연기하여 주시기 바랍니다."
(형사·기록검토) "위 사건에 대하여 2024. 11. 13. 10:40경으로 공판기일이 지정되어 있으나 피고인의 변호인은 2024. 10. 31. 선임하여 이 사건의 검찰기록 등사신청을 하였으나 등사일이 2024. 12. 6.로 지정되어 위 공판기일 전까지 기록검토와 변론준비에 어려움이 있어 공판기일을 변경신청하오니 귀 재판부에서 혜량하여주시어 연기신청을 허가하여 주시기를 요청드립니다."
(민사·기일중복) "피고의 소송대리인은 같은 날 기존에 지정되어 있던 광주지방법원 순천지원 2025고합86 사건의 공판기일이 2026. 3. 17. 14:10으로 지정되어 있어 위 변론기일 참석이 어려워 부득이 기일변경신청서를 제출하오니, 귀 재판부에서 혜량해주시어 이 사건 변론기일을 연기하여 주시기를 희망합니다."`;

function buildUserPrompt(p: Record<string, unknown>): string {
  const g = (k: string) => (p[k] == null ? "" : String(p[k]).trim());
  const caseType = g("caseType") || "형사";
  const lines: string[] = [];
  lines.push(`사건 구분: ${caseType}`);
  if (g("role")) lines.push(`우리 측(의뢰인): ${g("role")}`);
  if (g("hearingKind")) lines.push(`기일 종류: ${g("hearingKind")}`);
  if (g("hearingDt")) lines.push(`지정된 기일: ${g("hearingDt")}`);
  if (g("caseNo")) lines.push(`사건번호: ${g("caseNo")}`);
  if (g("caseName")) lines.push(`사건명: ${g("caseName")}`);
  if (g("action")) lines.push(`동작: ${g("action")}신청`);
  lines.push("");
  lines.push("연기/변경이 필요한 사정(직원 메모, 이 내용을 정서 문체로 다듬어 주세요):");
  lines.push(g("memo") || "(사유 메모 없음 — 제공된 맥락만으로 자연스러운 사유 한 문단 작성)");
  lines.push("");
  lines.push("위 사실만으로 사유 문단 한 개를 정서 문체로 작성하세요. 없는 사실은 만들지 마세요.");
  return lines.join("\n");
}

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  const text = parts.filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text || "").join("").trim();
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, reason: "no_api_key" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }

  try {
    const reason = await callClaude(SYSTEM, buildUserPrompt(body));
    if (!reason) return json({ ok: false, reason: "empty" }, 502);
    return json({ ok: true, reason });
  } catch (e) {
    return json({ ok: false, reason: "upstream", detail: String(e).slice(0, 300) }, 502);
  }
});

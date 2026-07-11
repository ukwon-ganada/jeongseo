// ============================================================================
//  draft-chamgo — 형사 '참고자료' 서면 본문 자동 작성 (Supabase Edge Function, Deno)
//
//  하는 일:
//    직원이 입력한 제출서류 목록 + 피고인 사정(메모)을 받아, 법무법인 정서 문체로
//    참고자료 '본문'을 작성해 돌려준다. (서면 전체가 아니라 본문만)
//    → 프론트(chamgo.js)가 이 문장을 참고자료 본문란에 채우고, HWPX 다운로드는 프론트가 한다.
//
//  길이 옵션:
//    · 간단 : 한 문단(표준 선처 요청)
//    · 길게 : 여러 문단(제출서류가 보여주는 정황·사정 서술 + 마무리 앙망 문형)
//
//  필요한 Supabase 시크릿:
//    ANTHROPIC_API_KEY   (Anthropic API 키 — 브라우저에 노출 안 됨, 여기서만 사용)
//    (선택) YEONGI_MODEL  기본값 claude-opus-4-8
//
//  배포:  supabase functions deploy draft-chamgo --no-verify-jwt
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

// ── 참고자료 문체 규칙 (시스템 프롬프트) ─────────────────────────────────────
const SYSTEM = `당신은 대한민국 법무법인 '정서'의 서면 작성을 돕는 조수입니다.
형사 사건에서 피고인/피의자를 위해 법원(또는 검찰)에 제출하는 '참고자료' 서면의 **본문**만 작성합니다.
제목·당사자·서명 등 서면의 다른 부분은 만들지 말고, 본문 텍스트만 출력합니다.

[반드시 지킬 규칙]
1. 제공된 사실(제출서류 목록·피고인 사정 메모)만 사용한다. 없는 사실·경력·수치를 절대 지어내지 않는다. 정보가 부족하면 일반화하되 창작하지 않는다.
2. 정서 특유의 격식체를 사용한다('참작하시어', '선처', '간곡히', '앙망합니다' 등). 대화체·구어체 금지.
3. 출력은 본문 텍스트만. 제목·머리말·따옴표·마크다운·설명·목록기호를 붙이지 않는다.
4. 길이 옵션을 지킨다.
   - '간단': **한 문단**. 형식: "{피고인/피의자} {이름}의 변호인은 위 사건과 관련하여 {제출서류들}을 참고자료로 제출하는 바, 이를 참작하시어 {피고인/피의자}에게 최대한의 선처를 베풀어 주실 것을 간곡히 요청합니다."
   - '길게': **여러 문단(2~4개)**. 각 문단은 빈 줄(줄바꿈 2회)로 구분한다. 제출서류가 보여주는 정황(가족의 지지, 갱생 노력, 피해회복·합의 등, 메모에 있는 사실만)을 서술하고, 마지막 문단은 "부디 존경하는 재판장님께서는 … 선처(기회)를 … 간곡히 앙망합니다." 형태로 마무리한다.

[정서 실제 참고자료 예시]
(간단) "피고인 이창훈의 변호인은 위 사건과 관련하여 피고인의 밀알복지재단 후원증서, 사단법인 글로벌쉐어의 후원증명서를 참고자료로 제출하는 바, 이를 참작하시어 피고인에게 최대한의 선처를 베풀어 주실 것을 간곡히 요청합니다."
(간단2) "피의자 최성환의 변호인은 위 사건과 관련하여 피해자 이지현의 합의서 및 처벌불원서를 참고자료로 제출하는 바, 이를 참작하시어 피의자에게 최대한의 선처를 베풀어 주실 것을 간곡히 요청합니다."
(길게·본문) "피고인의 누나는 피고인을 돕기 위해 한국마약퇴치운동본부에서 주관하는 교육을 이수하였고, 피고인의 부모님과 매형, 직장 대표 등 주변인들은 한결같이 피고인의 선처를 탄원하고 있습니다. 이는 피고인의 사회적 유대관계가 두터워 가족과 사회의 지지 속에서 충분히 갱생할 수 있음을 보여줍니다."
(길게·마무리) "부디 존경하는 재판장님께서는 본 자료들을 깊이 검토하시어, 피고인이 가족의 품으로 돌아가 다시 한번 성실한 사회의 일원으로 살아갈 기회를 허락하여 주시기를 간곡히 앙망합니다."`;

function buildUserPrompt(p: Record<string, unknown>): string {
  const g = (k: string) => (p[k] == null ? "" : String(p[k]).trim());
  const jiwi = g("jiwi") || "피고인";
  const length = g("length") || "간단";
  const docs = Array.isArray(p["docs"]) ? (p["docs"] as unknown[]).map((x) => String(x).trim()).filter(Boolean) : [];
  const c: string[] = [];
  c.push(`지위: ${jiwi}`);
  if (g("name")) c.push(`${jiwi} 이름: ${g("name")}`);
  if (g("caseName")) c.push(`사건: ${g("caseName")}`);
  c.push(`본문 길이: ${length === "길게" ? "길게(여러 문단)" : "간단(한 문단)"}`);
  c.push("");
  c.push("제출서류(참고자료 목록):");
  c.push(docs.length ? docs.map((d) => `- ${d}`).join("\n") : "(제출서류 목록 없음)");
  c.push("");
  c.push("피고인 사정(직원 메모, 정서 문체로 다듬어 주세요):");
  c.push(g("memo") || "(추가 사정 없음 — 제출서류만으로 표준 선처 문구)");
  c.push("");
  if (length === "길게") {
    c.push("위 사실만으로 참고자료 본문을 여러 문단(2~4개, 문단 사이 빈 줄)으로 작성하세요. 제출서류가 보여주는 정황과 피고인 사정을 서술하고, 마지막 문단은 재판장님께 선처를 앙망하는 문형으로 마무리하세요. 없는 사실은 만들지 마세요. 본문 텍스트만 출력.");
  } else {
    c.push('위 사실만으로 참고자료 본문을 한 문단으로 작성하세요. "{지위} {이름}의 변호인은 위 사건과 관련하여 {제출서류들}을 참고자료로 제출하는 바, 이를 참작하시어 {지위}에게 최대한의 선처를 베풀어 주실 것을 간곡히 요청합니다." 형식. 본문 텍스트만 출력.');
  }
  return c.join("\n");
}

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  return parts.filter((b: { type?: string }) => b?.type === "text").map((b: { text?: string }) => b.text || "").join("").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, reason: "no_api_key" }, 500);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }
  try {
    const reason = await callClaude(SYSTEM, buildUserPrompt(body));
    if (!reason) return json({ ok: false, reason: "empty" }, 502);
    return json({ ok: true, reason });
  } catch (e) {
    return json({ ok: false, reason: "upstream", detail: String(e).slice(0, 300) }, 502);
  }
});

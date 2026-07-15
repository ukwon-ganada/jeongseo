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
0. ★기일 명칭은 사건 구분에 따라 반드시 구별한다.
   - 형사사건의 기일 → **공판기일**
   - 민사·가사사건의 기일 → **변론기일**
   두 명칭을 한 서면 안에서 섞어 쓰지 않는다. 형사에 '변론기일', 민사·가사에 '공판기일'이라고 쓰는 것은 절대 금지한다. (단, 선고기일은 형사·민사·가사 공통으로 '선고기일'이라고 쓴다.)
   ★★형사사건에서는 '변론'이라는 단어 자체를 쓰지 않는다. '변론준비'가 아니라 '재판 준비' 또는 '공판 준비'로, '변론기일'이 아니라 '공판기일'로, '변론'은 '공판'으로 쓴다. '변론'이라는 표현은 민사·가사에서만 사용한다.
1. 사용자가 제공한 사실만 사용한다. 제공되지 않은 날짜·사건번호·법원명·법조문·판례를 절대 지어내지 않는다. 정보가 부족하면 그 부분은 자연스럽게 일반화하되 없는 사실을 만들지 않는다.
2. 정서의 고정 문형을 지킨다.
   - 형사(피고인의 변호인): "위 사건에 대하여 [일시]으로 [공판/선고]기일이 지정되어 있으나, …(사유)… 부득이하게 이 사건 [공판]기일을 [연기/변경]하여 주시기 바랍니다." **반드시 이렇게 간결하게 끝낸다.** '…연기신청하오니, 귀 재판부에서 혜량하여 주시어 … 허가하여 주시기를 요청드립니다'처럼 요청 표현을 이중으로 늘이지 않는다. (형사는 '변론기일'이라 쓰지 않는다.)
   - 민사(원고/피고의 소송대리인): 도입은 서면 상단이 담당하므로, 사유 본문만 간결히. "…(사유)… 부득이 기일변경신청서를 제출하오니, 귀 재판부에서 혜량하여 주시어 이 사건 변론기일을 연기하여 주시기를 희망합니다." 형태.
3. '부득이하게/부득이' 등 정서 특유의 격식체를 사용한다. 대화체·구어체 금지. (단, 형사 간결형에서는 '혜량하여 주시어 … 허가하여 주시기를 요청드립니다' 같은 표현을 붙이지 말고 규칙 2의 짧은 종결형으로 끝낸다. '혜량하여 주시어'는 민사에서만 자연스럽게 사용한다.)
4. A4 1장에 들어가도록 **한 문단**, 군더더기 없이 간결하게. 불필요한 배경설명·감정표현·사과문 금지.
5. 출력은 사유 문단 텍스트만. 제목·머리말·따옴표·마크다운·설명을 붙이지 않는다.
6. 민사의 경우, 우리 사건의 변론기일 일시(예: "이 사건 변론기일이 …으로 지정되어 있으나")를 사유에서 다시 언급하지 않는다. 그 부분은 서면 상단 도입부가 이미 담당한다. 사유에는 기일 변경이 필요한 사정(겹치는 다른 사건의 기일, 준비 부족 등)만 쓴다.
7. 담당변호사가 바뀌거나 퇴사한 상황이라도, 사용자가 "새로 선임된 변호인"이라고 명시적으로 밝히지 않는 한, 새 변호인은 "이 사건을 담당할 변호인"으로 표현한다. "새로이 선임된 변호인" 같은 표현은 쓰지 않는다.

[보정기한연기신청서(사건 구분='보정')의 경우 — 규칙이 완전히 다름]
· 보정 서면은 **기일(공판·변론·선고기일)을 연기하는 것이 아니라, 법원의 '보정명령'에 대한 '보정(제출)기한'을 연기**하는 것이다.
· 절대 '공판기일/변론기일/선고기일/기일변경/기일연기'라는 표현을 쓰지 않는다. '재판부'가 아니라 '귀원'을 쓴다.
· 사유 문단이 아니라 **본문 전체 한 문단**을 작성한다. 형식:
  "이 사건에 관하여 {우리 지위}의 소송대리인은 귀원의 {보정명령 송달일} 보정명령을 송달받았으나 …(연기가 필요한 사정)…, 보정제출기한을 연기하여 주시기를 요청드립니다."
· 반드시 "이 사건에 관하여 {지위}의 소송대리인은 귀원의 {송달일} 보정명령을 송달받았으나"로 시작하고, **"보정제출기한을 연기하여 주시기를 요청드립니다."로 끝낸다.**
· 송달일이 제공되면 그대로 쓰고(예: 2026. 7. 1.), 없으면 날짜 없이 "보정명령을 송달받았으나"로 자연스럽게 쓴다. 없는 날짜를 지어내지 않는다.
· 정서 격식체 유지. 한 문단, 간결하게.
[보정 실제 예시]
(보정·자료검토) "이 사건에 관하여 피고의 소송대리인은 귀원의 2026. 7. 1. 보정명령을 송달받았으나 보정명령을 준비하는데에 시간이 좀 더 소요될 것으로 예상되어 보정제출기한을 연기하여 주시기를 요청드립니다."
(보정·자료검토2) "위 사건에 관하여 피고의 소송대리인은 귀원의 2026. 6. 10. 보정권고명령을 송달받았으나 현재 보정사항에 대한 충실한 답변을 위하여 관련 자료를 면밀히 검토하고 있는 중이니, 원활한 재판진행을 위하여 보정제출기한을 연기하여 주시기를 요청드립니다."
(보정·서류제출지연) "이 사건에 관하여 원고의 소송대리인은 귀원의 2026. 5. 13. 보정명령을 송달받았으나 기한 내 자녀양육안내 참석확인서 제출이 어려워 보정제출기한을 연기하여 주시기를 요청드립니다."

[정서 실제 서면 사유 예시]
(형사·기일중복) "위 사건에 대하여 2024. 03. 22. 10:00경으로 공판기일이 지정되어 있으나, 피고인의 변호인은 같은 날 인천지방법원 2023고단7028 사건의 공판기일이 2024. 03. 22. 10:20로 지정되어 있어 위 기일에 참석이 어려워 부득이하게 이 사건 공판기일을 연기하여 주시기 바랍니다."
(형사·복합사유) "위 사건에 대하여 2026. 08. 11. 16:40경으로 공판기일이 지정되어 있으나, 같은 날 구속 피고인의 조사기일이 지정되어 있고 변호인의 법인 소속변호사의 갑작스런 퇴사로 공판기일에 참석할 변호인이 없어 부득이하게 이 사건 공판기일을 변경하여 주시기 바랍니다."
(형사·기록검토) "위 사건에 대하여 2024. 11. 13. 10:40경으로 공판기일이 지정되어 있으나, 피고인의 변호인은 2024. 10. 31. 선임하여 검찰기록 등사일이 2024. 12. 6.로 지정되어 위 공판기일 전까지 기록검토와 재판 준비에 어려움이 있어 부득이하게 이 사건 공판기일을 변경하여 주시기 바랍니다."
(민사·기일중복) "피고의 소송대리인은 같은 날 기존에 지정되어 있던 광주지방법원 순천지원 2025고합86 사건의 공판기일이 2026. 3. 17. 14:10으로 지정되어 있어 위 변론기일 참석이 어려워 부득이 기일변경신청서를 제출하오니, 귀 재판부에서 혜량해주시어 이 사건 변론기일을 연기하여 주시기를 희망합니다."`;

function buildUserPrompt(p: Record<string, unknown>): string {
  const g = (k: string) => (p[k] == null ? "" : String(p[k]).trim());
  const caseType = g("caseType") || "형사";

  // 보정기한연기신청서: 본문 전체 한 문단
  if (caseType === "보정") {
    const b: string[] = [];
    b.push("사건 구분: 보정기한연기신청서");
    if (g("role")) b.push(`우리 측: ${g("role")}`);
    if (g("caseName")) b.push(`사건: ${g("caseName")}`);
    if (g("bojeongDate")) b.push(`보정명령 송달일: ${g("bojeongDate")}`);
    b.push("");
    b.push("연기가 필요한 사정(직원 메모, 정서 문체로 다듬어 주세요):");
    b.push(g("memo") || "(메모 없음 — 제공된 맥락만으로 자연스러운 보정기한 연기 사유 한 문단)");
    b.push("");
    b.push('위 사실만으로 "이 사건에 관하여 {지위}의 소송대리인은 귀원의 {송달일} 보정명령을 송달받았으나 …(사정)…, 보정제출기한을 연기하여 주시기를 요청드립니다." 형식의 본문 한 문단을 작성하세요. 기일(공판·변론·선고) 언급 금지, 반드시 "보정제출기한을 연기하여 주시기를 요청드립니다."로 끝냅니다. 없는 사실·날짜는 만들지 마세요.');
    return b.join("\n");
  }

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

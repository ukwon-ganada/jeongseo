// ============================================================================
//  sms-ocr — 은행 입금 문자 스크린샷에서 입금 내역 읽기 (Supabase Edge Function, Deno)
//
//  하는 일:
//    국선 사건 관리 '입금 문자 붙여넣기'에서 올린 스크린샷(여러 장)을 받아
//    입금 건마다 { 금액, 사건번호, 날짜, 잔액 }을 뽑아 돌려준다.
//    → 매칭·합산·저장은 전부 프론트(gsmgr.js)가 한다. 여기서는 읽기만.
//
//  왜 잔액까지 읽나:
//    거래마다 잔액이 유일하므로 (1) 화면이 겹쳐 찍힌 중복을 걸러내고
//    (2) '직전 잔액 + 입금액 = 현재 잔액' 연쇄로 빠뜨린 문자를 찾아낼 수 있다.
//    금액을 잘못 읽으면 연쇄가 깨지므로 오독 탐지에도 그대로 쓰인다.
//
//  필요한 Supabase 시크릿:
//    ANTHROPIC_API_KEY   (Anthropic API 키 — 브라우저에 노출 안 됨, 여기서만 사용)
//    (선택) SMS_OCR_MODEL  기본값 claude-opus-5
//
//  배포:  supabase functions deploy sms-ocr --no-verify-jwt
// ============================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("SMS_OCR_MODEL") || "claude-opus-5";

const MAX_IMAGES = 12;                 // 한 번에 받을 스크린샷 수
const MAX_BYTES = 24 * 1024 * 1024;    // 요청 본문 상한(API 제한 32MB보다 낮게)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = `당신은 대한민국 은행 입금 알림 문자(SMS/MMS) 스크린샷을 읽는 판독기입니다.

읽어야 할 것: 스크린샷에 보이는 **입금 알림 한 건 한 건**.
전형적인 문자 형태:
  [Web발신]
  하나,08/27 13:58
  748******40207
  입금531,850원
  2026고단1012
  잔액9,536,103원

각 건에서 뽑을 값:
· amount  — '입금' 뒤의 금액(원 단위 정수, 쉼표 제거)
· code    — 적요 자리의 사건번호(예: 2026고단1012, 2025고정1268). 공백 없이 그대로.
· date    — 문자에 찍힌 날짜 MM/DD (연도는 쓰지 말 것)
· balance — '잔액' 뒤의 금액(원 단위 정수, 쉼표 제거). 안 보이면 null.

[반드시 지킬 규칙]
1. **보이는 숫자를 그대로 읽는다.** 추측·보정·반올림하지 않는다. 자릿수를 특히 조심한다.
2. 숫자가 흐리거나 잘려서 확신할 수 없으면 그 건을 아예 빼라. 틀린 값보다 빠진 값이 낫다.
3. **사건번호가 없는 입금은 제외한다.** (국선보수 입금이 아님)
4. 출금·결제·잔액조회 등 '입금'이 아닌 알림은 제외한다.
5. 스크린샷끼리 같은 문자가 겹쳐 찍혔으면 **보이는 대로 전부** 넣어라. 중복 제거는 앱이 잔액으로 처리한다.
6. 화면 위아래가 반투명하게 겹쳐 보이는(스크롤 잔상) 흐린 글자는, 숫자를 확실히 읽을 수 있을 때만 넣어라.
7. 설명·요약·인사말을 쓰지 말고 도구 호출로만 답한다.`;

const TOOL = {
  name: "report_deposits",
  description: "스크린샷에서 읽은 입금 내역을 보고한다.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        description: "입금 건 목록. 스크린샷에 보이는 순서대로.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            amount: { type: "integer", description: "입금액(원)" },
            code: { type: "string", description: "사건번호(예: 2026고단1012)" },
            date: { type: "string", description: "문자에 찍힌 날짜 MM/DD" },
            balance: { type: ["integer", "null"], description: "잔액(원). 안 보이면 null" },
          },
          required: ["amount", "code", "date", "balance"],
        },
      },
    },
    required: ["items"],
  },
};

type Img = { media_type: string; data: string };

async function callClaude(images: Img[], withFallback: boolean): Promise<Response> {
  const content: unknown[] = images.map((im) => ({
    type: "image",
    source: { type: "base64", media_type: im.media_type, data: im.data },
  }));
  content.push({
    type: "text",
    text: `위 스크린샷 ${images.length}장에서 입금 건을 모두 읽어 report_deposits 도구로 보고하세요.`,
  });
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "report_deposits" },
    messages: [{ role: "user", content }],
  };
  const headers: Record<string, string> = {
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  // 안전 분류기가 요청을 거절할 때 서버가 알아서 다른 모델로 넘긴다(은행 문자에는 거의 안 걸리지만 무료 보험).
  if (withFallback) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }
  return await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

function extractItems(data: Record<string, unknown>): unknown[] {
  const parts = Array.isArray(data?.content) ? (data.content as Record<string, unknown>[]) : [];
  for (const b of parts) {
    if (b?.type === "tool_use" && b?.name === "report_deposits") {
      const input = b.input as Record<string, unknown> | undefined;
      if (input && Array.isArray(input.items)) return input.items as unknown[];
    }
  }
  return [];
}

// 모델이 돌려준 값을 한 번 더 조인다 — 앱은 돈을 다루므로 형식이 어긋난 건 버린다.
function clean(items: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const amount = Number(it?.amount);
    const code = String(it?.code ?? "").replace(/\s+/g, "");
    const date = String(it?.date ?? "").trim();
    if (!Number.isInteger(amount) || amount <= 0) continue;
    if (!/^20\d{2}(고단|고정|고합|노|초기|재고단|재고정)\d+$/.test(code)) continue;
    if (!/^\d{1,2}\/\d{1,2}$/.test(date)) continue;
    const balRaw = it?.balance;
    const balance = (balRaw === null || balRaw === undefined) ? null : Number(balRaw);
    out.push({ amount, code, date, balance: Number.isInteger(balance) ? balance : null });
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, reason: "no_api_key" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad_json" }, 400); }

  const rawImages = Array.isArray(body.images) ? body.images : [];
  if (!rawImages.length) return json({ ok: false, reason: "no_images" }, 400);
  if (rawImages.length > MAX_IMAGES) return json({ ok: false, reason: "too_many", max: MAX_IMAGES }, 400);

  const images: Img[] = [];
  let bytes = 0;
  for (const r of rawImages) {
    const o = r as Record<string, unknown>;
    const media_type = String(o?.media_type || "image/jpeg");
    let data = String(o?.data || "");
    const comma = data.indexOf(",");
    if (data.startsWith("data:") && comma > 0) data = data.slice(comma + 1);  // data: URL 로 와도 받아준다
    if (!data) continue;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(media_type)) return json({ ok: false, reason: "bad_media_type" }, 400);
    bytes += data.length;
    if (bytes > MAX_BYTES) return json({ ok: false, reason: "too_large" }, 413);
    images.push({ media_type, data });
  }
  if (!images.length) return json({ ok: false, reason: "no_images" }, 400);

  try {
    let res = await callClaude(images, true);
    // 서버측 폴백 베타가 이 계정에서 안 열려 있으면 400이 난다 → 그 옵션만 빼고 한 번 더.
    if (res.status === 400) {
      const t = await res.text().catch(() => "");
      if (/beta|fallback/i.test(t)) res = await callClaude(images, false);
      else return json({ ok: false, reason: "upstream", detail: t.slice(0, 300) }, 502);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return json({ ok: false, reason: "upstream", detail: `${res.status}: ${t.slice(0, 300)}` }, 502);
    }
    const data = await res.json();
    if (data?.stop_reason === "refusal") return json({ ok: false, reason: "refusal" }, 502);
    const items = clean(extractItems(data));
    return json({ ok: true, items: items, count: items.length });
  } catch (e) {
    return json({ ok: false, reason: "upstream", detail: String(e).slice(0, 300) }, 502);
  }
});

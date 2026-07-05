// ============================================================================
//  otp-send — 서명 전 휴대폰 인증번호(SMS) 발송 (Supabase Edge Function, Deno)
//
//  하는 일:
//    1) 서명 토큰으로 계약을 찾고(미서명·미만료 확인) 등록된 연락처를 얻는다
//    2) 6자리 코드를 만들어 해시로 sign_otp에 저장(평문 코드는 저장 안 함)
//    3) 솔라피(Solapi)로 그 번호에 인증문자를 보낸다
//    4) 남용 방지: 60초 재발송 제한 + 발송 5회 제한
//
//  필요한 Supabase 시크릿(대시보드 또는 CLI로 설정):
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (Supabase가 기본 주입)
//    SOLAPI_KEY, SOLAPI_SECRET                (솔라피 API 키/시크릿)
//    SMS_SENDER                               (사전등록한 발신번호, 숫자만 예:0328687171)
//
//  배포:  supabase functions deploy otp-send --no-verify-jwt
//         (서명자는 로그인하지 않은 익명이라 JWT 검증 끔 — apikey 헤더로 호출)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOLAPI_KEY = Deno.env.get("SOLAPI_KEY")!;
const SOLAPI_SECRET = Deno.env.get("SOLAPI_SECRET")!;
const SMS_SENDER = (Deno.env.get("SMS_SENDER") || "").replace(/\D/g, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256Hex(msg: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length < 7) return "***";
  return d.slice(0, 3) + "-****-" + d.slice(-4);
}

// 솔라피(Solapi/CoolSMS) 단건 발송
async function sendSolapi(to: string, text: string): Promise<void> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const signature = await hmacSha256Hex(date + salt, SOLAPI_SECRET);
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      "Authorization": `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { to, from: SMS_SENDER, text } }),
  });
  if (!res.ok) {
    throw new Error("solapi " + res.status + " " + (await res.text()));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token) return json({ ok: false, reason: "invalid" });

    const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

    // 1) 계약 확인
    const { data: c } = await sb.from("contracts")
      .select("sign_token,sign_expires_at,sign_status,counterparty_signature,recipient_phone")
      .eq("sign_token", token).limit(1).maybeSingle();
    if (!c) return json({ ok: false, reason: "notfound" });
    if (c.sign_expires_at && new Date(c.sign_expires_at) < new Date()) return json({ ok: false, reason: "expired" });
    if (c.sign_status === "signed" && c.counterparty_signature) return json({ ok: false, reason: "signed" });

    const phone = String(c.recipient_phone || "").replace(/\D/g, "");
    if (phone.length < 10) return json({ ok: false, reason: "nophone" });

    // 2) 남용 방지
    const { data: prev } = await sb.from("sign_otp").select("*").eq("sign_token", token).maybeSingle();
    const now = Date.now();
    if (prev) {
      if (prev.last_sent_at && now - new Date(prev.last_sent_at).getTime() < 60_000)
        return json({ ok: false, reason: "toosoon" });
      if ((prev.sent_count || 0) >= 5) return json({ ok: false, reason: "toomany" });
    }

    // 3) 코드 생성·저장(해시)
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const codeHash = await sha256Hex(code + token);
    const { error: upErr } = await sb.from("sign_otp").upsert({
      sign_token: token,
      code_hash: codeHash,
      phone: maskPhone(phone),
      expires_at: new Date(now + 5 * 60_000).toISOString(),
      attempts: 0,
      sent_count: (prev?.sent_count || 0) + 1,
      last_sent_at: new Date(now).toISOString(),
      verified_at: null,
    });
    if (upErr) return json({ ok: false, reason: "db", msg: upErr.message });

    // 4) 문자 발송
    await sendSolapi(phone, `[법무법인 정서] 전자서명 본인확인 인증번호 [${code}] (5분 이내 입력)`);

    return json({ ok: true, to: maskPhone(phone) });
  } catch (e) {
    return json({ ok: false, reason: "error", msg: String(e) });
  }
});

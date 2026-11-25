// 석원 PC 크롬 확장이 대법원(ssgo) 사건 창에서 읽은 원문을 받아 저장한다.
// 대법원에는 아무 요청도 하지 않는다. 확장이 보낸 것만 저장. verify_jwt=false, x-ingest-key 헤더로 확인.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
let cachedKey: string | null = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!cachedKey) {
    const { data } = await sb.from("lw_settings").select("value").eq("key", "scourt_ingest_key").maybeSingle();
    cachedKey = data?.value ?? null;
  }
  const key = req.headers.get("x-ingest-key");
  if (!cachedKey || key !== cachedKey) return json({ ok: false, error: "unauthorized" }, 401);

  let p: any;
  try { p = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const raw_text = String(p.raw_text ?? "").slice(0, 500000);
  if (!raw_text) return json({ ok: false, error: "empty" }, 400);
  const tables = Array.isArray(p.tables) ? p.tables.slice(0, 50) : null;
  const case_code = p.case_code ? String(p.case_code).slice(0, 40) : null;
  const content_hash = await sha256((case_code ?? "") + "\n" + (p.tab ?? "") + "\n" + raw_text);

  const { error } = await sb.from("scourt_raw_snapshots").upsert({
    case_code,
    court: p.court ? String(p.court).slice(0, 60) : null,
    tab: p.tab ? String(p.tab).slice(0, 40) : null,
    page_title: p.page_title ? String(p.page_title).slice(0, 200) : null,
    content_hash,
    raw_text,
    tables,
    ext_version: p.ext_version ? String(p.ext_version).slice(0, 20) : null,
  }, { onConflict: "content_hash", ignoreDuplicates: true });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
});

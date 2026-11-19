import { assertEquals } from "jsr:@std/assert@1";
import { handle } from "./handler.ts";

// 2026-11-19 석원: 단계 카드만 고쳤는데 인적사항이 지워짐 (저장된 사건정보가 없던 사건)
Deno.test("단계만 저장해도 로웨어 처음 값(인적사항)은 지켜진다", async () => {
  let saved: any = null;
  const c = { l_num: 5, l_code: "2025고단1", l_name: "사기", charge_lawyer: "서고은", court: "인천지방법원", raw: { l_client: "홍길동", l_client_hp: "010-1111-2222" } };
  const fetcher = (async (u: any, init?: any) => {
    const url = String(u), ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes("worksapis.com")) return ok({ userId: "u1", userName: { lastName: "서", firstName: "석원" }, email: "a@b" });
    if (url.includes("/case_all?")) return ok([c]);
    if (url.includes("/case_info?on_conflict") && init?.method === "POST") { saved = JSON.parse(init.body); return ok([]); }
    return ok([]);
  }) as typeof fetch;
  const req = new Request("https://x/", { method: "POST", headers: { "x-works-token": "t".repeat(30), "content-type": "application/json" },
    body: JSON.stringify({ action: "save_info", lNum: 5, stages: { police: { org: "파주경찰서", person: "임대우" } }, cur: "police" }) });
  const r = await handle(req, { sbUrl: "https://sb", sbKey: "k" } as any, fetcher);
  assertEquals(r.status, 200);
  assertEquals(saved.client_name, "홍길동");
  assertEquals(saved.client_phone, "010-1111-2222");
  assertEquals(saved.lawyer, "서고은");
  assertEquals(saved.case_name, "사기");
});

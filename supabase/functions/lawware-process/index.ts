// 법무법인 정서 - 로웨어 사건진행내역 중계소 v1
//
// court-lookup 과 같은 로그인 경로를 쓰되, 재판부·선고일이 아니라
// '사건진행내역' 전체(law_view_process_json.php)를 그대로 돌려준다.
//
// 왜 필요한가
//   cases.last_process 는 최신 1건만 담아서, 불변기한의 기산점(소송기록접수통지 송달 등)이
//   뒤 진행내역에 덮여 사라진다. 기산점은 지나가면 복구가 안 되므로 이력으로 쌓아야 한다.
//
// 왜 엣지 함수인가
//   로웨어 아이디·비밀번호를 로컬 PC나 코드로 내리지 않기 위해서다.
//   자격정보는 Supabase 시크릿(LAW_ID/LAW_PW)에만 있고, 여기서만 쓰인다.
//
// 요청:  POST { items: [{ schKey: "2026노2208", schVal: "2702" }, ...] }   (최대 100건)
//        POST { schKey, schVal }                                          (1건 호환)
// 응답:  { results: [{ schKey, schVal, records: [...] } | { schKey, schVal, error }] }
//
// 로그인은 요청당 1회만 한다. 100건을 보내면 로그인 1번 + 조회 100번이다.

const LAW_ID = Deno.env.get("LAW_ID") ?? "";
const LAW_PW = Deno.env.get("LAW_PW") ?? "";
const BASE = "https://jeongseolaw.lawware.kr";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_ITEMS = 100;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

function mergeCookies(store: Record<string, string>, res: Response) {
  let list: string[] = [];
  try {
    list = res.headers.getSetCookie();
  } catch (_e) {
    const raw = res.headers.get("set-cookie");
    if (raw) list = raw.split(/,(?=[^ ;]+=)/);
  }
  for (const c of list) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (name) store[name] = val;
    }
  }
}

function cookieHeader(store: Record<string, string>) {
  return Object.keys(store).map((k) => k + "=" + store[k]).join("; ");
}

async function login(): Promise<Record<string, string>> {
  const store: Record<string, string> = {};
  const seed = await fetch(BASE + "/index.html", {
    method: "GET",
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  mergeCookies(store, seed);

  const res = await fetch(
    BASE + "/include/auth.php?mode=login&captchaKey=&security=&uname=",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        "Referer": BASE + "/index.html",
        "Cookie": cookieHeader(store),
      },
      body: "uid=" + encodeURIComponent(LAW_ID) + "&upw=" + encodeURIComponent(LAW_PW),
      redirect: "manual",
    },
  );
  mergeCookies(store, res);
  if (!store.u_id) {
    throw new Error("로그인 실패 (u_id 쿠키 없음) status=" + res.status);
  }
  return store;
}

async function fetchProcess(
  store: Record<string, string>,
  schKey: string,
  schVal: string,
) {
  const request = JSON.stringify({
    limit: 500,
    offset: 0,
    schKey: String(schKey ?? ""),
    schVal: String(schVal),
    fileExpand: "check",
  });
  const url = BASE + "/lawsuit/law_view_process_json.php?request=" +
    encodeURIComponent(request);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": BASE + "/lawsuit/law_view.html",
      "Cookie": cookieHeader(store),
    },
  });
  const text = await res.text();
  if (!text.trimStart().startsWith("{")) {
    throw new Error("JSON 아님 (세션 문제 의심): " + text.slice(0, 80));
  }
  const data = JSON.parse(text);
  return data.records ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, "content-type": "application/json" },
    });

  try {
    const body = await req.json();
    const items = Array.isArray(body.items)
      ? body.items
      : (body.schVal ? [{ schKey: body.schKey, schVal: body.schVal }] : []);

    if (!items.length) return json({ error: "items 또는 schKey/schVal 필요" }, 400);
    if (items.length > MAX_ITEMS) {
      return json({ error: `한 번에 최대 ${MAX_ITEMS}건까지` }, 400);
    }

    const store = await login();      // 요청당 1회

    const results = [];
    for (const it of items) {
      try {
        results.push({
          schKey: it.schKey,
          schVal: it.schVal,
          records: await fetchProcess(store, it.schKey, it.schVal),
        });
      } catch (e) {
        results.push({ schKey: it.schKey, schVal: it.schVal, error: String(e) });
      }
    }
    return json({ results, count: results.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

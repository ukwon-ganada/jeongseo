// 법무법인 정서 - 재판부·선고일 조회 중계소 v5
const LAW_ID = Deno.env.get("LAW_ID") ?? "";
const LAW_PW = Deno.env.get("LAW_PW") ?? "";
const BASE = "https://jeongseolaw.lawware.kr";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

function mergeCookies(store, res) {
  let list = [];
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

function cookieHeader(store) {
  return Object.keys(store).map((k) => k + "=" + store[k]).join("; ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, "content-type": "application/json" },
    });

  try {
    const body = await req.json();
    const schKey = body.schKey;
    const schVal = body.schVal;
    if (!schKey || !schVal) return json({ error: "schKey/schVal 필요" }, 400);

    const store = {};

    const seedRes = await fetch(BASE + "/index.html", {
      method: "GET",
      headers: { "User-Agent": UA },
      redirect: "manual",
    });
    mergeCookies(store, seedRes);

    const loginBody = "uid=" + encodeURIComponent(LAW_ID) + "&upw=" + encodeURIComponent(LAW_PW);
    const loginRes = await fetch(
      BASE + "/include/auth.php?mode=login&captchaKey=&security=&uname=",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
          "Referer": BASE + "/index.html",
          "Cookie": cookieHeader(store),
        },
        body: loginBody,
        redirect: "manual",
      },
    );
    const loginText = await loginRes.text();
    mergeCookies(store, loginRes);

    if (!store.u_id) {
      return json({
        error: "로그인 실패 (u_id 쿠키 없음)",
        진단_로그인상태코드: loginRes.status,
        진단_로그인후쿠키: Object.keys(store).join(","),
        진단_로그인응답앞부분: loginText.slice(0, 150),
      }, 200);
    }

    const viewRes = await fetch(BASE + "/lawsuit/law_view_json.php", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
        "Referer": BASE + "/lawsuit/law_view.html",
        "Cookie": cookieHeader(store),
      },
      body: "schKey=" + encodeURIComponent(String(schKey)) + "&schVal=" + encodeURIComponent(String(schVal)),
    });

    const rawText = await viewRes.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return json({
        error: "상세 응답 파싱 실패",
        진단_상세상태코드: viewRes.status,
        진단_로웨어응답앞부분: rawText.slice(0, 200),
      }, 200);
    }

    let rec = data;
    if (data && data.l_justice_dept === undefined) {
      if (Array.isArray(data.records)) rec = data.records[0];
      else if (Array.isArray(data)) rec = data[0];
    }

    const rawDept = (rec && rec.l_justice_dept) ? String(rec.l_justice_dept) : "";
    const dept = rawDept.split(/[(（]/)[0].trim();
    const judgmentDate = (rec && rec.l_judgment_date) ? String(rec.l_judgment_date) : "";

    return json({ court_dept: dept, court_dept_raw: rawDept, judgment_date: judgmentDate });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

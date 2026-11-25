// 대법원(ssgo) 사건 창에 이미 그려진 화면 글자만 읽는다.
// 클릭·입력·대법원으로의 요청은 하지 않는다.
(() => {
  const CASE_RE = /\b(\d{4}[가-힣]{1,4}\d{1,7})\b/;
  let lastSent = "";
  let timer = null;

  function tableRows(t) {
    return [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim()));
  }

  function snapshot() {
    const body = document.body;
    if (!body) return;
    const text = body.innerText || "";
    if (text.replace(/\s/g, "").length < 200) return; // 아직 화면이 덜 그려짐
    const m = text.match(CASE_RE);
    if (!m) return;
    const key = location.href + "|" + text;
    if (key === lastSent) return;
    lastSent = key;

    const title = (window.top === window ? document.title : "") || document.title || "";
    let tab = null;
    if (/진행내용/.test(title)) tab = "진행내용";
    else if (/일반내용/.test(title)) tab = "일반내용";

    const tables = [...document.querySelectorAll("table")]
      .map((t) => {
        const cap = (t.caption && t.caption.innerText) || t.getAttribute("summary") || "";
        return { caption: cap.trim().slice(0, 200), rows: tableRows(t) };
      })
      .filter((t) => t.rows.length);

    const courtM = text.match(/기본내용\s*\(([^)]+)\)/);
    chrome.runtime.sendMessage({
      type: "scourt-snapshot",
      data: {
        case_code: m[1],
        court: courtM ? courtM[1] : null,
        tab,
        page_title: title,
        raw_text: text,
        tables,
      },
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(snapshot, 2500); // 화면이 2.5초 동안 그대로면 읽음
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();

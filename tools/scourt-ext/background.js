importScripts("config.js");
const VERSION = chrome.runtime.getManifest().version;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "scourt-snapshot") return;
  fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-key": INGEST_KEY },
    body: JSON.stringify({ ...msg.data, ext_version: VERSION }),
  })
    .then((r) => r.json().then((j) => ({ status: r.status, j })))
    .then(({ status, j }) => {
      chrome.storage.local.set({ last: { at: new Date().toISOString(), case: msg.data.case_code, tab: msg.data.tab, status, ok: j.ok, error: j.error || null } });
      sendResponse({ ok: j.ok });
    })
    .catch((e) => {
      chrome.storage.local.set({ last: { at: new Date().toISOString(), case: msg.data.case_code, error: String(e) } });
      sendResponse({ ok: false });
    });
  return true;
});

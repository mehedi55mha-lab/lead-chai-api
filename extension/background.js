chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["apiUrl", "apiKey", "maxLeads", "delayMs", "mode"], (cfg) => {
    const patch = {};
    if (!cfg.apiKey) patch.apiKey = "lc_live_change_this_key";
    if (!cfg.maxLeads) patch.maxLeads = 40;
    if (!cfg.delayMs) patch.delayMs = 900;
    if (!cfg.mode) patch.mode = "quick";
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "LC_ENRICH") {
    enrich(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true;
  }

  if (msg.type === "LC_DOWNLOAD") {
    const csv = msg.csv || "";
    const filename = msg.filename || "lead-chai.csv";
    chrome.downloads.download({
      url: "data:text/csv;charset=utf-8," + encodeURIComponent(csv),
      filename,
      saveAs: true,
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "LC_OPEN_MAPS") {
    chrome.tabs.create({ url: "https://www.google.com/maps" });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function enrich({ apiUrl, apiKey, website, businessName, mode }) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  if (!base) {
    return { ok: false, error: "Set your API URL in Settings first." };
  }
  if (!website) {
    return { ok: false, error: "No website on this lead." };
  }

  const res = await fetch(base + "/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      website,
      business_name: businessName || "",
      mode: mode || "quick",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail || data.message || res.statusText || "API error";
    return { ok: false, error: typeof detail === "string" ? detail : JSON.stringify(detail), status: res.status };
  }
  return { ok: true, data };
}

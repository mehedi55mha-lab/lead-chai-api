function isMapsUrl(url) {
  try {
    const u = new URL(url || "");
    return u.hostname.includes("google.") && u.pathname.includes("/maps");
  } catch {
    return false;
  }
}

function setStatus(text, kind) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status " + (kind || "");
}

async function loadSettings() {
  const cfg = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
  document.getElementById("apiUrl").value = cfg.apiUrl || "";
  document.getElementById("apiKey").value = cfg.apiKey || "lc_live_change_this_key";
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiUrl: document.getElementById("apiUrl").value.trim(),
    apiKey: document.getElementById("apiKey").value.trim(),
  });
  setStatus("Settings saved.", "ok");
});

document.getElementById("primary").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && isMapsUrl(tab.url)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "LC_SHOW" });
    } catch {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "LC_SHOW" });
    }
    window.close();
    return;
  }
  chrome.runtime.sendMessage({ type: "LC_OPEN_MAPS" });
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab && isMapsUrl(tab.url)) {
    setStatus("Google Maps tab detected. Panel ready.", "ok");
    document.getElementById("primary").textContent = "Show Lead Chai panel";
  } else {
    setStatus("Ei tab Maps na. Maps khule search dao, then scan koro.", "warn");
    document.getElementById("primary").textContent = "Open Google Maps";
  }
});

loadSettings();

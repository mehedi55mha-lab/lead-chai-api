(() => {
  if (window.__LEAD_CHAI_LOADED__) {
    window.dispatchEvent(new CustomEvent("lead-chai-show"));
    return;
  }
  window.__LEAD_CHAI_LOADED__ = true;

  const state = {
    leads: [],
    running: false,
    abort: false,
    minimized: false,
    tab: "leads",
    message: "Google Maps-e search dao, then Scan leads.",
    progress: 0,
    settings: {
      apiUrl: "",
      apiKey: "lc_live_change_this_key",
      maxLeads: 40,
      delayMs: 900,
      mode: "quick",
    },
  };

  let root;
  let shadow;
  let ui = {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function txt(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  function qsa(sel, parent) {
    return [...(parent || document).querySelectorAll(sel)];
  }

  function currentQuery() {
    const input = document.querySelector("#searchboxinput, input[aria-label*='Search'], input[name='q']");
    return input ? input.value.trim() : "";
  }

  function cleanWebsite(url) {
    if (!url) return "";
    try {
      const u = new URL(url, location.href);
      if (u.searchParams.get("q") && u.hostname.includes("google.")) {
        return cleanWebsite(u.searchParams.get("q"));
      }
      if (u.hostname.includes("google.") || u.hostname.includes("gstatic.com")) return "";
      return u.protocol + "//" + u.hostname + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
    } catch {
      return url;
    }
  }

  function leadId(lead) {
    return (lead.name || "") + "|" + (lead.mapsUrl || lead.href || "");
  }

  function upsertLead(partial) {
    const id = leadId(partial);
    if (!id.replace("|", "")) return null;
    const idx = state.leads.findIndex((l) => {
      if (partial.id && l.id === partial.id) return true;
      if (l.id === id) return true;
      if (l.name && partial.name && l.name === partial.name) {
        if (!l.mapsUrl || !partial.mapsUrl) return true;
        return l.mapsUrl === partial.mapsUrl || l.href === partial.href;
      }
      return false;
    });
    if (idx >= 0) {
      state.leads[idx] = { ...state.leads[idx], ...partial, id: state.leads[idx].id };
      return state.leads[idx];
    }
    const lead = {
      id,
      name: "",
      phone: "",
      website: "",
      email: "",
      allEmails: "",
      address: "",
      category: "",
      rating: "",
      reviews: "",
      facebook: "",
      instagram: "",
      linkedin: "",
      twitter: "",
      youtube: "",
      mapsUrl: "",
      href: "",
      status: "Listed",
      ...partial,
    };
    state.leads.push(lead);
    return lead;
  }

  function getFeed() {
    return (
      document.querySelector('div[role="feed"]') ||
      document.querySelector('div[aria-label*="Results for"]') ||
      document.querySelector('div[aria-label*="results"]') ||
      document.querySelector(".m6QErb.DxyBCb")
    );
  }

  function getCards() {
    const feed = getFeed();
    const scope = feed || document;
    const nodes = [
      ...scope.querySelectorAll('div[role="article"]'),
      ...scope.querySelectorAll("div.Nv2PK"),
    ];
    const seen = new Set();
    const cards = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      if (node.closest("#lead-chai-root")) continue;
      seen.add(node);
      cards.push(node);
    }
    return cards;
  }

  function parseCard(card) {
    const link = card.querySelector("a.hfpxzc") || card.querySelector('a[href*="/maps/place/"]');
    const name =
      txt(card.querySelector(".qBF1Pd, .fontHeadlineSmall, div[role='heading']")) ||
      (link && link.getAttribute("aria-label")) ||
      "";
    const rating = txt(card.querySelector(".MW4etd"));
    const reviews = txt(card.querySelector(".UY7F9")).replace(/[()]/g, "");
    const lines = [...new Set(qsa(".W4Efsd", card).map(txt).filter(Boolean))];
    let category = "";
    let address = "";
    if (lines[0]) {
      const parts = lines[0].split("·").map((s) => s.trim()).filter(Boolean);
      category = parts[0] || "";
      address = parts[1] || lines[1] || "";
    }
    return {
      name,
      rating,
      reviews,
      category,
      address,
      mapsUrl: link ? link.href : "",
      href: link ? link.getAttribute("href") || "" : "",
      status: "Listed",
    };
  }

  function extractPlaceDetails() {
    const name = txt(document.querySelector("h1.DUwQKd, h1.fontHeadlineLarge, h1"));
    let website = "";
    const web = document.querySelector('a[data-item-id="authority"]');
    if (web) website = cleanWebsite(web.href);
    if (!website) {
      const labeled = qsa("a[aria-label]").find((a) =>
        /website|ওয়েবসাইট|sitio web|site web/i.test(a.getAttribute("aria-label") || "")
      );
      if (labeled) website = cleanWebsite(labeled.href);
    }

    let phone = "";
    const phoneEl = document.querySelector('[data-item-id^="phone:tel:"]');
    if (phoneEl) phone = (phoneEl.getAttribute("data-item-id") || "").replace(/^phone:tel:/, "");
    if (!phone) {
      const tel = document.querySelector('a[href^="tel:"]');
      if (tel) phone = decodeURIComponent((tel.getAttribute("href") || "").replace(/^tel:/i, ""));
    }

    let address = "";
    const addr = document.querySelector('button[data-item-id="address"]');
    if (addr) {
      address = txt(addr) || (addr.getAttribute("aria-label") || "").replace(/^Address:\s*/i, "");
    }

    const category = txt(document.querySelector("button.DkEaL, .DkEaL"));
    const rating = txt(document.querySelector('div.F7nice span[aria-hidden="true"]'));
    let reviews = "";
    const reviewEl = document.querySelector("div.F7nice span[aria-label]");
    if (reviewEl) reviews = (reviewEl.getAttribute("aria-label") || "").replace(/[^\d]/g, "");

    return {
      name,
      website,
      phone,
      address,
      category,
      rating,
      reviews,
      mapsUrl: location.href.split("?")[0],
    };
  }

  async function waitFor(fn, timeout, interval) {
    const start = Date.now();
    timeout = timeout || 4500;
    interval = interval || 150;
    while (Date.now() - start < timeout) {
      if (state.abort) return null;
      const value = fn();
      if (value) return value;
      await sleep(interval);
    }
    return null;
  }

  async function scrollFeed() {
    const feed = getFeed();
    if (!feed) return false;
    const before = getCards().length;
    feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
    await sleep(900);
    const end = /reached the end|end of the list|তালিকার শেষ/i.test(feed.innerText || "");
    return getCards().length > before && !end;
  }

  function findCardByLead(lead) {
    const cards = getCards();
    return cards.find((card) => {
      const parsed = parseCard(card);
      if (lead.href && parsed.href && parsed.href === lead.href) return true;
      if (lead.name && parsed.name === lead.name) return true;
      return false;
    });
  }

  async function openLead(lead) {
    const card = findCardByLead(lead);
    const link = card && (card.querySelector("a.hfpxzc") || card.querySelector('a[href*="/maps/place/"]'));
    if (!link) return false;
    link.click();
    const heading = await waitFor(() => {
      const el = document.querySelector("h1.DUwQKd, h1.fontHeadlineLarge, h1");
      if (!el) return null;
      const name = txt(el);
      if (!lead.name) return el;
      if (name && (name === lead.name || lead.name.startsWith(name) || name.startsWith(lead.name.slice(0, 10)))) {
        return el;
      }
      return null;
    }, 4200);
    await sleep(280);
    return Boolean(heading);
  }

  async function goBackToList() {
    const btn =
      document.querySelector('button[aria-label="Back"]') ||
      document.querySelector('button[aria-label="পেছনে"]') ||
      document.querySelector('button[aria-label="Back to results"]') ||
      document.querySelector('button[jsaction*="pane.back"]') ||
      document.querySelector('button[aria-label="Zurück"]') ||
      document.querySelector('button[aria-label="Retour"]');
    if (btn) {
      btn.click();
      await waitFor(() => getFeed() || getCards().length, 4000);
      await sleep(250);
      return;
    }
    history.back();
    await sleep(700);
  }

  async function loadSettings() {
    const cfg = await chrome.storage.sync.get(["apiUrl", "apiKey", "maxLeads", "delayMs", "mode"]);
    state.settings = {
      apiUrl: cfg.apiUrl || "",
      apiKey: cfg.apiKey || "lc_live_change_this_key",
      maxLeads: Number(cfg.maxLeads || 40),
      delayMs: Number(cfg.delayMs || 900),
      mode: cfg.mode || "quick",
    };
  }

  async function saveSettingsFromUi() {
    state.settings = {
      apiUrl: ui.apiUrl.value.trim(),
      apiKey: ui.apiKey.value.trim(),
      maxLeads: Number(ui.maxLeads.value || 40),
      delayMs: Number(ui.delayMs.value || 900),
      mode: ui.mode.value || "quick",
    };
    await chrome.storage.sync.set(state.settings);
    state.message = "Settings saved.";
    render();
  }

  async function scanLeads() {
    if (state.running) return;
    await loadSettings();
    state.running = true;
    state.abort = false;
    state.message = "Scanning Google Maps results…";
    render();

    const max = Math.max(1, Math.min(120, state.settings.maxLeads || 40));
    let idleScrolls = 0;

    while (!state.abort && state.leads.length < max) {
      const cards = getCards();
      if (!cards.length && !getFeed()) {
        const details = extractPlaceDetails();
        if (details.name) upsertLead({ ...details, status: details.phone || details.website ? "Details" : "Listed" });
        state.message = details.name
          ? "Ei page e list nai — current place ta add kora holo. Search results khule Scan dao."
          : "Konota result card paini. Age Maps-e ekta search dao.";
        break;
      }

      let added = 0;
      for (const card of cards) {
        if (state.leads.length >= max) break;
        const parsed = parseCard(card);
        if (!parsed.name) continue;
        const before = state.leads.length;
        upsertLead(parsed);
        if (state.leads.length > before) added += 1;
      }

      render();
      if (state.leads.length >= max) break;

      const grew = await scrollFeed();
      if (!grew && added === 0) {
        idleScrolls += 1;
        if (idleScrolls >= 3) break;
      } else {
        idleScrolls = 0;
      }
    }

    state.message = state.abort
      ? "Scan stopped."
      : "List ready. Now tap Get details for phone & website.";
    state.running = false;
    state.progress = 100;
    render();
  }

  async function getDetails() {
    if (state.running) return;
    if (!state.leads.length) {
      state.message = "Age Scan leads dao.";
      render();
      return;
    }
    state.running = true;
    state.abort = false;
    const delay = Math.max(400, state.settings.delayMs || 900);
    const total = state.leads.length;

    for (let i = 0; i < state.leads.length; i += 1) {
      if (state.abort) break;
      const lead = state.leads[i];
      state.message = "Opening " + (lead.name || "place") + " (" + (i + 1) + "/" + total + ")";
      state.progress = Math.round(((i + 1) / total) * 100);
      render();

      const opened = await openLead(lead);
      if (opened) {
        const details = extractPlaceDetails();
        upsertLead({
          ...lead,
          ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)),
          status: details.phone || details.website ? "Details" : lead.status,
        });
      }
      render();
      await sleep(delay);
      await goBackToList();
    }

    state.running = false;
    state.message = state.abort ? "Stopped." : "Details done. Find emails if API URL set.";
    render();
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (res) => resolve(res || { ok: false, error: "No response" }));
    });
  }

  async function enrichEmails() {
    if (state.running) return;
    await loadSettings();
    if (!state.settings.apiUrl) {
      state.tab = "settings";
      state.message = "Settings-e Vercel API URL boshao.";
      render();
      return;
    }
    const targets = state.leads.filter((l) => l.website && !l.email);
    if (!targets.length) {
      state.message = "Website wala lead nai, ba already email ache. Age Get details dao.";
      render();
      return;
    }

    state.running = true;
    state.abort = false;
    for (let i = 0; i < targets.length; i += 1) {
      if (state.abort) break;
      const lead = targets[i];
      state.message = "Finding email for " + lead.name + " (" + (i + 1) + "/" + targets.length + ")";
      state.progress = Math.round(((i + 1) / targets.length) * 100);
      render();

      const res = await sendMessage({
        type: "LC_ENRICH",
        apiUrl: state.settings.apiUrl,
        apiKey: state.settings.apiKey,
        website: lead.website,
        businessName: lead.name,
        mode: state.settings.mode,
      });

      if (res && res.ok && res.data) {
        upsertLead({
          ...lead,
          email: res.data.email || "",
          allEmails: res.data.all_emails || "",
          facebook: res.data.facebook || lead.facebook,
          instagram: res.data.instagram || lead.instagram,
          linkedin: res.data.linkedin || lead.linkedin,
          twitter: res.data.twitter || lead.twitter,
          youtube: res.data.youtube || lead.youtube,
          status: res.data.email ? "Email found" : res.data.status || "No email",
        });
      } else {
        upsertLead({
          ...lead,
          status: "API: " + ((res && res.error) || "failed"),
        });
      }
      render();
    }

    state.running = false;
    state.message = state.abort ? "Stopped." : "Email enrich sesh.";
    render();
  }

  function csvEscape(value) {
    const s = String(value == null ? "" : value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    if (!state.leads.length) {
      state.message = "Export korar moto lead nai.";
      render();
      return;
    }
    const headers = [
      "Name", "Phone", "Website", "Email", "All Emails", "Address", "Category",
      "Rating", "Reviews", "Facebook", "Instagram", "LinkedIn", "Twitter", "YouTube",
      "Maps URL", "Status",
    ];
    const rows = state.leads.map((l) => [
      l.name, l.phone, l.website, l.email, l.allEmails, l.address, l.category,
      l.rating, l.reviews, l.facebook, l.instagram, l.linkedin, l.twitter, l.youtube,
      l.mapsUrl, l.status,
    ].map(csvEscape).join(","));
    const csv = headers.join(",") + "\n" + rows.join("\n");
    const q = currentQuery().replace(/[^\w]+/g, "-").slice(0, 40) || "leads";
    chrome.runtime.sendMessage({
      type: "LC_DOWNLOAD",
      csv,
      filename: "lead-chai-" + q + ".csv",
    });
    state.message = "CSV download start hoise.";
    render();
  }

  function stats() {
    const total = state.leads.length;
    const phone = state.leads.filter((l) => l.phone).length;
    const web = state.leads.filter((l) => l.website).length;
    const email = state.leads.filter((l) => l.email).length;
    return { total, phone, web, email };
  }

  function render() {
    if (!ui.panel) return;
    ui.panel.classList.toggle("hide", state.minimized);
    ui.fab.classList.toggle("show", state.minimized);
    ui.settings.classList.toggle("show", state.tab === "settings");
    ui.list.style.display = state.tab === "leads" ? "block" : "none";
    ui.scan.disabled = state.running;
    ui.details.disabled = state.running;
    ui.enrich.disabled = state.running;
    ui.stop.style.display = state.running ? "inline-block" : "none";
    ui.msg.textContent = state.message;
    ui.bar.style.width = (state.progress || 0) + "%";
    const s = stats();
    ui.statTotal.textContent = s.total;
    ui.statPhone.textContent = s.phone;
    ui.statWeb.textContent = s.web;
    ui.statEmail.textContent = s.email;
    ui.sub.textContent = currentQuery() || "Maps lead finder";

    if (state.tab === "leads") {
      if (!state.leads.length) {
        ui.list.innerHTML = '<div class="empty">Ekta niche search koro — jemon “ac repair in Dhaka”. Then Scan leads.</div>';
      } else {
        ui.list.innerHTML = state.leads.map((l) => {
          const badgeClass = l.email ? "ok" : l.phone || l.website ? "" : "no";
          return (
            '<article class="lead">' +
            "<h4>" + escapeHtml(l.name || "Unknown") + "</h4>" +
            '<div class="meta">' +
            (l.category || l.rating ? escapeHtml([l.category, l.rating && (l.rating + "★"), l.reviews && (l.reviews + " reviews")].filter(Boolean).join(" · ")) + "<br>" : "") +
            (l.address ? escapeHtml(l.address) + "<br>" : "") +
            (l.phone ? escapeHtml(l.phone) + " · " : "") +
            (l.website ? '<a href="' + escapeHtml(l.website) + '" target="_blank">website</a> · ' : "") +
            (l.email ? escapeHtml(l.email) : "no email") +
            "</div>" +
            '<span class="badge ' + badgeClass + '">' + escapeHtml(l.status || "") + "</span>" +
            "</article>"
          );
        }).join("");
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function panelHtml() {
    const icon = chrome.runtime.getURL("icons/icon48.png");
    return (
      '<button class="fab" id="lc-fab"><img src="' + icon + '" alt="" /> Lead Chai</button>' +
      '<aside class="panel" id="lc-panel">' +
      '<div class="head">' +
      '<img src="' + icon + '" alt="" />' +
      '<div class="grow"><div class="title">Lead Chai</div><div class="sub" id="lc-sub">Maps lead finder</div></div>' +
      '<button class="iconbtn" id="lc-settings" title="Settings">⚙</button>' +
      '<button class="iconbtn" id="lc-min" title="Minimize">—</button>' +
      "</div>" +
      '<div class="toolbar">' +
      '<button class="btn" id="lc-scan">Scan leads</button>' +
      '<button class="btn alt" id="lc-details">Get details</button>' +
      '<button class="btn alt" id="lc-enrich">Find emails</button>' +
      '<button class="btn alt" id="lc-export">Export CSV</button>' +
      "</div>" +
      '<div class="stats">' +
      '<div class="stat"><b id="lc-total">0</b><span>Leads</span></div>' +
      '<div class="stat"><b id="lc-phone">0</b><span>Phone</span></div>' +
      '<div class="stat"><b id="lc-web">0</b><span>Website</span></div>' +
      '<div class="stat"><b id="lc-email">0</b><span>Email</span></div>' +
      "</div>" +
      '<div class="progress"><div id="lc-bar"></div></div>' +
      '<div class="msg" id="lc-msg"></div>' +
      '<button class="btn alt" id="lc-stop" style="display:none;margin:8px 12px 0;width:calc(100% - 24px)">Stop</button>' +
      '<div class="list" id="lc-list"></div>' +
      '<div class="settings" id="lc-set">' +
      "<label>API URL (Vercel)</label><input id='lc-api-url' placeholder='https://your-app.vercel.app' />" +
      "<label>API key</label><input id='lc-api-key' />" +
      "<label>Max leads</label><input id='lc-max' type='number' min='5' max='120' />" +
      "<label>Delay between places (ms)</label><input id='lc-delay' type='number' min='400' max='3000' />" +
      "<label>Email mode</label><select id='lc-mode'><option value='quick'>quick (Vercel-friendly)</option><option value='deep'>deep</option></select>" +
      '<button class="btn" id="lc-save" style="margin-top:12px;width:100%">Save settings</button>' +
      "</div></aside>"
    );
  }

  function bind() {
    ui = {
      fab: shadow.getElementById("lc-fab"),
      panel: shadow.getElementById("lc-panel"),
      sub: shadow.getElementById("lc-sub"),
      scan: shadow.getElementById("lc-scan"),
      details: shadow.getElementById("lc-details"),
      enrich: shadow.getElementById("lc-enrich"),
      exportBtn: shadow.getElementById("lc-export"),
      stop: shadow.getElementById("lc-stop"),
      msg: shadow.getElementById("lc-msg"),
      bar: shadow.getElementById("lc-bar"),
      list: shadow.getElementById("lc-list"),
      settings: shadow.getElementById("lc-set"),
      apiUrl: shadow.getElementById("lc-api-url"),
      apiKey: shadow.getElementById("lc-api-key"),
      maxLeads: shadow.getElementById("lc-max"),
      delayMs: shadow.getElementById("lc-delay"),
      mode: shadow.getElementById("lc-mode"),
      statTotal: shadow.getElementById("lc-total"),
      statPhone: shadow.getElementById("lc-phone"),
      statWeb: shadow.getElementById("lc-web"),
      statEmail: shadow.getElementById("lc-email"),
    };

    ui.fab.addEventListener("click", () => { state.minimized = false; render(); });
    shadow.getElementById("lc-min").addEventListener("click", () => { state.minimized = true; render(); });
    shadow.getElementById("lc-settings").addEventListener("click", () => {
      state.tab = state.tab === "settings" ? "leads" : "settings";
      render();
    });
    ui.scan.addEventListener("click", scanLeads);
    ui.details.addEventListener("click", getDetails);
    ui.enrich.addEventListener("click", enrichEmails);
    ui.exportBtn.addEventListener("click", exportCsv);
    ui.stop.addEventListener("click", () => { state.abort = true; state.message = "Stopping…"; render(); });
    shadow.getElementById("lc-save").addEventListener("click", saveSettingsFromUi);
  }

  async function mount() {
    root = document.getElementById("lead-chai-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "lead-chai-root";
      document.documentElement.appendChild(root);
    }
    shadow = root.shadowRoot || root.attachShadow({ mode: "open" });
    shadow.innerHTML = "";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("panel.css");
    shadow.appendChild(link);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML = panelHtml();
    shadow.appendChild(wrap);
    bind();
    await loadSettings();
    ui.apiUrl.value = state.settings.apiUrl;
    ui.apiKey.value = state.settings.apiKey;
    ui.maxLeads.value = state.settings.maxLeads;
    ui.delayMs.value = state.settings.delayMs;
    ui.mode.value = state.settings.mode;
    render();

    const keep = new MutationObserver(() => {
      if (!document.documentElement.contains(root)) {
        document.documentElement.appendChild(root);
      }
    });
    keep.observe(document.documentElement, { childList: true });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "LC_SHOW") {
      state.minimized = false;
      render();
    }
    if (msg.type === "LC_TOGGLE") {
      state.minimized = !state.minimized;
      render();
    }
  });

  window.addEventListener("lead-chai-show", () => {
    state.minimized = false;
    render();
  });

  mount();
})();

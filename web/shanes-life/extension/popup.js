// Toolbar popup (Shanes Life 19, 1b): the trust card, a search box over "Everything else", the
// current tab's own matches with a real Fill/Face ID button each, and the three footer actions
// (Open the Vault / Forget this Chrome / Settings). Same real background-message plane as the
// in-page chip -- this file never talks to the network directly (see background.js's own header
// for why: one privileged network context, not several).

const siteLine = document.getElementById("site-line");
const trustCardEl = document.getElementById("trust-card");
const siteList = document.getElementById("site-list");
const otherList = document.getElementById("other-list");
const searchInput = document.getElementById("search-input");

let currentTab = null;
let currentHostname = "";
let allOthers = []; // every login NOT already shown in "For this site"

function row({ label, username, alwaysAsk, actionLabel, onAction, disabled = false }) {
  const div = document.createElement("div");
  div.className = "row";

  const text = document.createElement("div");
  text.className = "row-text";
  const labelEl = document.createElement("div");
  labelEl.className = "row-label";
  labelEl.append(document.createTextNode(label));
  if (alwaysAsk) {
    const lock = document.createElement("span");
    lock.className = "lock";
    lock.textContent = "🔒";
    lock.title = "Always asks";
    labelEl.append(lock);
  }
  const userEl = document.createElement("div");
  userEl.className = "row-user";
  userEl.textContent = username || "";
  text.append(labelEl, userEl);
  div.append(text);

  if (actionLabel) {
    const btn = document.createElement("button");
    btn.className = `btn${actionLabel === "Face ID" ? " ghost" : ""}`;
    btn.textContent = actionLabel;
    btn.disabled = disabled;
    if (onAction) btn.addEventListener("click", onAction);
    div.append(btn);
  }
  return div;
}

async function renderSiteList() {
  if (!currentTab?.url || !/^https?:/.test(currentTab.url)) {
    siteLine.textContent = "Nothing to autofill on this page.";
    siteList.replaceChildren();
    otherList.replaceChildren();
    return;
  }
  currentHostname = new URL(currentTab.url).hostname;
  siteLine.textContent = currentHostname;

  const response = await chrome.runtime.sendMessage({ type: "SL_FIND_MATCHES", hostname: currentHostname });
  if (!response?.ok) {
    const messages = {
      "not-configured": "Set the App URL in Settings first.",
      "signed-out": "Sign in to Shane's Life in your browser first.",
      "network-error": "Couldn't reach the app.",
      "server-error": "The app returned an error.",
    };
    siteList.replaceChildren(rowMessage(messages[response?.reason] || "Not available."));
    return;
  }

  renderTrustCard(response.trust);

  if (response.matches.length === 0) {
    siteList.replaceChildren(rowMessage(`No vault logins matched ${currentHostname}.`));
  } else {
    siteList.replaceChildren(
      ...response.matches.map((entry) => {
        const canOneClick = Boolean(response.trust) && !entry.alwaysAsk;
        return row({
          label: entry.label,
          username: entry.username,
          alwaysAsk: entry.alwaysAsk,
          actionLabel: canOneClick ? "Fill" : "Face ID",
          onAction: () => fillFromPopup(entry, canOneClick),
        });
      }),
    );
  }

  const matchedIds = new Set(response.matches.map((m) => m.id));
  const allResponse = await chrome.runtime.sendMessage({ type: "SL_LIST_LOGINS" });
  allOthers = allResponse?.ok ? allResponse.entries.filter((e) => !matchedIds.has(e.id)) : [];
  renderOtherList();
}

function rowMessage(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  return div;
}

function renderOtherList() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? allOthers.filter(
        (e) => e.label.toLowerCase().includes(q) || (e.site || "").toLowerCase().includes(q) || (e.username || "").toLowerCase().includes(q),
      )
    : allOthers;
  if (filtered.length === 0) {
    otherList.replaceChildren(rowMessage(q ? "No matches." : "Nothing else in the vault."));
    return;
  }
  // Design (1b): "Everything else fills the username only ... usernames are listable and
  // copyable without any prompt, exactly as in the app" -- so this list's one real action is
  // Copy, never a password reveal (that still needs a real site match to fill into).
  otherList.replaceChildren(
    ...filtered.map((entry) =>
      row({
        label: entry.label,
        username: entry.username,
        alwaysAsk: false,
        actionLabel: entry.username ? "Copy" : null,
        onAction: async (e) => {
          try {
            await navigator.clipboard.writeText(entry.username);
            e.target.textContent = "Copied";
            setTimeout(() => (e.target.textContent = "Copy"), 1200);
          } catch {
            e.target.textContent = "Couldn't copy";
          }
        },
      }),
    ),
  );
}

function renderTrustCard(trust) {
  if (!trust) {
    trustCardEl.replaceChildren();
    return;
  }
  const daysLeft = Math.max(0, Math.ceil((new Date(trust.expiresAt).getTime() - Date.now()) / 86_400_000));
  // Real percentage against the extension's own SAVED preference, not the token's original
  // mint length (which isn't carried in the stored trust object) -- a close, honest estimate
  // rather than a fabricated exact one; see background.js's SL_TRUST_STATUS.
  chrome.runtime.sendMessage({ type: "SL_TRUST_STATUS" }).then((status) => {
    const totalDays = status?.trustDays || 30;
    const pct = Math.max(0, Math.min(100, Math.round((daysLeft / totalDays) * 100)));
    const card = document.createElement("div");
    card.className = "trust-card";
    card.innerHTML = `
      <div class="trust-row"><span class="trust-title">This Chrome is trusted</span><span class="muted">${daysLeft} day${daysLeft === 1 ? "" : "s"} left</span></div>
      <div class="trust-track"><div class="trust-fill" style="width:${pct}%"></div></div>
    `;
    trustCardEl.replaceChildren(card);
  });
}

async function fillFromPopup(entry, canOneClick) {
  if (canOneClick) {
    const result = await chrome.runtime.sendMessage({ type: "SL_TRY_FILL", entryId: entry.id, hostname: currentHostname });
    if (result?.ok) {
      await chrome.tabs.sendMessage(currentTab.id, {
        type: "SL_FILL",
        ok: true,
        value: result.value,
        username: result.username,
      }).catch(() => {});
      window.close();
      return;
    }
    // Fell through (trust expired/revoked, or an always-ask entry) -- same real Face ID path.
  }
  const reveal = await chrome.runtime.sendMessage({ type: "SL_REQUEST_REVEAL", entryId: entry.id, tabId: currentTab.id });
  if (reveal?.ok) window.close(); // the reveal popup and the content script's own chip take it from here
}

document.getElementById("open-vault").addEventListener("click", async () => {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  if (appUrl) chrome.tabs.create({ url: `${appUrl}/#vault` });
});

document.getElementById("forget-device").addEventListener("click", async (e) => {
  e.target.disabled = true;
  e.target.textContent = "Forgetting…";
  await chrome.runtime.sendMessage({ type: "SL_FORGET_DEVICE" });
  e.target.textContent = "Forgotten";
  renderSiteList();
});

searchInput.addEventListener("input", renderOtherList);

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  await renderSiteList();
}

main();

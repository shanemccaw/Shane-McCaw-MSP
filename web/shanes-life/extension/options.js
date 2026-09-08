const input = document.getElementById("appUrl");
const appUrlStatus = document.getElementById("app-url-status");
const status = document.getElementById("status");
const trustStatusEl = document.getElementById("trust-status");
const daysPicker = document.getElementById("days-picker");
const forgetBtn = document.getElementById("forget-device");
const askCountEl = document.getElementById("ask-count");
const askListEl = document.getElementById("ask-list");

async function loadAppUrl() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  input.value = appUrl || "http://localhost:5000";
  if (appUrl) {
    const granted = await chrome.permissions.contains({ origins: [new URL(appUrl).origin + "/*"] });
    appUrlStatus.textContent = granted ? "permission granted" : "permission missing";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  let url;
  try {
    url = new URL(input.value.trim());
  } catch {
    status.textContent = "That's not a real URL.";
    return;
  }
  const origin = url.origin;
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) {
    status.textContent = "Permission was not granted — autofill can't reach the app without it.";
    return;
  }
  await chrome.storage.local.set({ appUrl: origin });
  await chrome.runtime.sendMessage({ type: "SL_APP_URL_SAVED" });
  status.textContent = `Saved. Autofill will look for logins at ${origin}.`;
  loadAppUrl();
  loadAlwaysAsk();
});

// -- This Chrome (Git #3276) -------------------------------------------------------------

/** Real trust status + the 7/30/90 day preference (design 1d) -- `days` is saved going
 *  forward (the next time a browser gets trusted, not retroactive on an already-minted
 *  token: a token's own `expires_at` is fixed the moment it's minted). */
async function loadTrustCard() {
  const { trust, trustDays } = (await chrome.runtime.sendMessage({ type: "SL_TRUST_STATUS" })) || {};
  trustStatusEl.textContent = trust
    ? `${trust.label} · trusted till ${new Date(trust.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}`
    : "not trusted yet";
  for (const btn of daysPicker.querySelectorAll("button")) {
    btn.classList.toggle("active", Number(btn.dataset.days) === (trustDays || 30));
  }
}

daysPicker.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-days]");
  if (!btn) return;
  await chrome.runtime.sendMessage({ type: "SL_SET_TRUST_DAYS", days: Number(btn.dataset.days) });
  loadTrustCard();
});

forgetBtn.addEventListener("click", async () => {
  forgetBtn.disabled = true;
  forgetBtn.textContent = "Forgetting…";
  await chrome.runtime.sendMessage({ type: "SL_FORGET_DEVICE" });
  forgetBtn.disabled = false;
  forgetBtn.textContent = "Forget this Chrome";
  loadTrustCard();
});

// -- Always ask, even when trusted (Git #3276) --------------------------------------------

function askRow(entry) {
  const div = document.createElement("div");
  div.className = "ask-row";
  const lock = document.createElement("span");
  lock.className = "lock";
  lock.textContent = "🔒";
  const text = document.createElement("span");
  text.style.flex = "1";
  text.textContent = entry.label + " ";
  const site = document.createElement("span");
  site.className = "site";
  site.textContent = entry.site || "";
  text.append(site);
  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "link";
  stopBtn.textContent = "Stop asking";
  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    const result = await chrome.runtime.sendMessage({ type: "SL_SET_ALWAYS_ASK", entryId: entry.id, alwaysAsk: false });
    if (result?.ok) loadAlwaysAsk();
    else stopBtn.disabled = false;
  });
  div.append(lock, text, stopBtn);
  return div;
}

async function loadAlwaysAsk() {
  const response = await chrome.runtime.sendMessage({ type: "SL_LIST_LOGINS" });
  if (!response?.ok) {
    askCountEl.textContent = "";
    askListEl.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "ask-empty";
    empty.textContent =
      response?.reason === "signed-out" ? "Sign in to Shane's Life in your browser first." : "Set the App URL above first.";
    askListEl.append(empty);
    return;
  }
  const alwaysAsk = response.entries.filter((e) => e.alwaysAsk);
  askCountEl.textContent = `${alwaysAsk.length} login${alwaysAsk.length === 1 ? "" : "s"}`;
  if (alwaysAsk.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ask-empty";
    empty.textContent = "Nothing set to always ask.";
    askListEl.replaceChildren(empty);
    return;
  }
  askListEl.replaceChildren(...alwaysAsk.map(askRow));
}

loadAppUrl();
loadTrustCard();
loadAlwaysAsk();

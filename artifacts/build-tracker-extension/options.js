const apiBaseUrlEl = document.getElementById("apiBaseUrl");
const ingestTokenEl = document.getElementById("ingestToken");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

async function load() {
  const { apiBaseUrl, ingestToken } = await chrome.storage.local.get(["apiBaseUrl", "ingestToken"]);
  if (apiBaseUrl) apiBaseUrlEl.value = apiBaseUrl;
  if (ingestToken) ingestTokenEl.value = ingestToken;
}

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.className = tone ?? "";
}

saveBtn.addEventListener("click", async () => {
  const apiBaseUrl = apiBaseUrlEl.value.trim().replace(/\/$/, "");
  const ingestToken = ingestTokenEl.value.trim();

  if (!apiBaseUrl || !ingestToken) {
    setStatus("Both fields are required.", "err");
    return;
  }

  let origin;
  try {
    origin = new URL(apiBaseUrl).origin;
  } catch {
    setStatus("That doesn't look like a valid URL.", "err");
    return;
  }

  // MV3: a service worker's fetch is only exempt from cross-origin
  // restrictions for origins the extension actually holds permission for.
  // Requested here, scoped to exactly this one origin — not every site the
  // "<all_urls>" optional permission in the manifest could technically cover.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    setStatus("Permission wasn't granted — the extension can't reach that domain without it.", "err");
    return;
  }

  await chrome.storage.local.set({ apiBaseUrl, ingestToken });
  setStatus("Saved. Open a Claude chat to test it.", "ok");
});

load();

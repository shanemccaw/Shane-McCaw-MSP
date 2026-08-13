const apiBaseUrlEl = document.getElementById("apiBaseUrl");
const ingestTokenEl = document.getElementById("ingestToken");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

const builderModelEl = document.getElementById("builderModel");
const builderEffortEl = document.getElementById("builderEffort");
const builderCwdEl = document.getElementById("builderCwd");
const builderStatusEl = document.getElementById("builderStatus");
const saveBuilderBtn = document.getElementById("saveBuilder");

const epicChatProjectUrlEl = document.getElementById("epicChatProjectUrl");
const epicChatTokenEl = document.getElementById("epicChatToken");
const epicChatStatusEl = document.getElementById("epicChatStatus");
const saveEpicChatBtn = document.getElementById("saveEpicChat");

async function load() {
  const {
    apiBaseUrl, ingestToken, builderModel, builderEffort, builderCwd,
    epicChatProjectUrl, epicChatToken,
  } = await chrome.storage.local.get([
    "apiBaseUrl", "ingestToken", "builderModel", "builderEffort", "builderCwd",
    "epicChatProjectUrl", "epicChatToken",
  ]);
  if (apiBaseUrl) apiBaseUrlEl.value = apiBaseUrl;
  if (ingestToken) ingestTokenEl.value = ingestToken;
  if (builderModel) builderModelEl.value = builderModel;
  if (builderEffort) builderEffortEl.value = builderEffort;
  if (builderCwd) builderCwdEl.value = builderCwd;
  if (epicChatProjectUrl) epicChatProjectUrlEl.value = epicChatProjectUrl;
  if (epicChatToken) epicChatTokenEl.value = epicChatToken;
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

  // Store the bare origin, not whatever was actually typed — background.js
  // appends the endpoint paths itself (/api/admin/build-tracker/...), so a
  // pasted-in full endpoint URL (e.g. copied straight from the ingest route's
  // own doc comment) would otherwise get a second path glued onto it and
  // 404/land on the wrong page. Reflect the cleaned-up value back into the
  // field so it's obvious this happened, not silent.
  apiBaseUrlEl.value = origin;

  // MV3: a service worker's fetch is only exempt from cross-origin
  // restrictions for origins the extension actually holds permission for.
  // Requested here, scoped to exactly this one origin — not every site the
  // "<all_urls>" optional permission in the manifest could technically cover.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    setStatus("Permission wasn't granted — the extension can't reach that domain without it.", "err");
    return;
  }

  await chrome.storage.local.set({ apiBaseUrl: origin, ingestToken });
  setStatus(`Saved as ${origin}. Open a Claude chat to test it.`, "ok");
});

saveBuilderBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    builderModel: builderModelEl.value.trim(),
    builderEffort: builderEffortEl.value.trim(),
    builderCwd: builderCwdEl.value.trim(),
  });
  builderStatusEl.textContent = "Saved.";
  builderStatusEl.className = "ok";
});

saveEpicChatBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    epicChatProjectUrl: epicChatProjectUrlEl.value.trim(),
    epicChatToken: epicChatTokenEl.value.trim(),
  });
  epicChatStatusEl.textContent = "Saved.";
  epicChatStatusEl.className = "ok";
});

load();

async function render() {
  const { apiBaseUrl, ingestToken, lastSyncAt, lastTitle, lastConversationId, lastError } =
    await chrome.storage.local.get([
      "apiBaseUrl",
      "ingestToken",
      "lastSyncAt",
      "lastTitle",
      "lastConversationId",
      "lastError",
    ]);

  const body = document.getElementById("body");

  if (!apiBaseUrl || !ingestToken) {
    body.innerHTML = `<div class="row err">Not configured yet — open settings below.</div>`;
    return;
  }

  if (lastError) {
    body.innerHTML = `<div class="row err">Last sync failed: ${escapeHtml(lastError)}</div>`;
    return;
  }

  if (lastSyncAt) {
    const when = new Date(lastSyncAt).toLocaleTimeString();
    body.innerHTML = `
      <div class="row ok">Last synced ${when}</div>
      <div class="row">${escapeHtml(lastTitle ?? lastConversationId ?? "")}</div>
    `;
  } else {
    body.innerHTML = `<div class="row">Configured — waiting for a Claude chat to sync.</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();

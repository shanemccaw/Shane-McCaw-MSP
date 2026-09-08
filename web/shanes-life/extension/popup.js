const content = document.getElementById("content");

function row(text) {
  const div = document.createElement("div");
  div.className = "row muted";
  div.textContent = text;
  return div;
}

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    content.replaceChildren(row("Nothing to autofill on this page."));
    return;
  }
  const hostname = new URL(tab.url).hostname;
  const response = await chrome.runtime.sendMessage({ type: "SL_FIND_MATCHES", hostname });

  if (!response?.ok) {
    const messages = {
      "not-configured": "Set the App URL in Settings first.",
      "signed-out": "Sign in to Shane's Life in your browser first.",
      "network-error": "Couldn't reach the app.",
      "server-error": "The app returned an error.",
    };
    content.replaceChildren(row(messages[response?.reason] || "Not available."));
    return;
  }
  if (response.matches.length === 0) {
    content.replaceChildren(row(`No vault logins matched ${hostname}.`));
    return;
  }

  content.replaceChildren();
  for (const entry of response.matches) {
    const div = document.createElement("div");
    div.className = "row";
    const btn = document.createElement("button");
    btn.textContent = entry.username ? `${entry.label} (${entry.username})` : entry.label;
    btn.addEventListener("click", async () => {
      btn.textContent = "Opening Face ID…";
      btn.disabled = true;
      const reveal = await chrome.runtime.sendMessage({
        type: "SL_REQUEST_REVEAL",
        entryId: entry.id,
        tabId: tab.id,
      });
      if (!reveal?.ok) {
        btn.textContent = "Couldn't start — check Settings.";
        return;
      }
      window.close(); // the reveal popup and the content script's own chip take it from here
    });
    div.append(btn);
    content.append(div);
  }
}

main();

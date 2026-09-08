const input = document.getElementById("appUrl");
const status = document.getElementById("status");

async function load() {
  const { appUrl } = await chrome.storage.local.get("appUrl");
  input.value = appUrl || "http://localhost:5000";
  if (appUrl) {
    const granted = await chrome.permissions.contains({ origins: [new URL(appUrl).origin + "/*"] });
    status.textContent = granted
      ? `Configured: ${new URL(appUrl).origin} (permission granted).`
      : `Configured: ${new URL(appUrl).origin}, but permission was not granted — click Save again.`;
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
});

load();

/**
 * Lightweight analytics helper.
 * Fires window.gtag (Google Analytics) if the tag is loaded,
 * and always sends a fire-and-forget beacon to the API so
 * events are captured even without GA configured.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(
  name: string,
  properties: Record<string, string | number | boolean> = {},
) {
  if (typeof window.gtag === "function") {
    window.gtag("event", name, properties);
  }

  const payload = JSON.stringify({ name, properties });
  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon("/api/quiz/analytics-event", new Blob([payload], { type: "application/json" }));
  } else {
    fetch("/api/quiz/analytics-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

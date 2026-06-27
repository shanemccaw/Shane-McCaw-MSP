/**
 * First-party site analytics tracker.
 *
 * Active in production automatically. In development, opt in by setting
 * VITE_ANALYTICS_ENABLED=true in your .env.local file.
 *
 * Sessions are keyed by a UUID in sessionStorage (expires with the tab).
 * Page views are tracked on every Wouter route change.
 * All link/button/[role=button] clicks are tracked via delegation:
 *   - outbound_click — links leaving the domain
 *   - cta_click      — elements with data-track="cta" or matching CTA text
 *   - nav_click      — elements with data-track="nav"
 *   - click          — all other internal links/buttons
 * Exit events are flushed via sendBeacon on pagehide/visibilitychange.
 *
 * `trackEvent` (quiz upsell helper) is preserved for backward compatibility.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// ─── Env gate ─────────────────────────────────────────────────────────────────
function isEnabled(): boolean {
  return import.meta.env.PROD || import.meta.env.VITE_ANALYTICS_ENABLED === "true";
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getOrCreateSession(): string {
  const key = "__smc_sid";
  let sid = sessionStorage.getItem(key);
  if (!sid) { sid = uuid(); sessionStorage.setItem(key, sid); }
  return sid;
}

function detectDevice(): string {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return "mobile";
  if (/Tablet|iPad/i.test(ua)) return "tablet";
  return "desktop";
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Other";
}

function getUtmParams(): Record<string, string> {
  const sp = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = sp.get(k); if (v) out[k] = v;
  }
  return out;
}

function beacon(path: string, body: unknown): void {
  const payload = JSON.stringify(body);
  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(path, new Blob([payload], { type: "application/json" }));
  } else {
    fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let _sessionId = "";
let _currentPage = "";
let _pageviewId: number | null = null;
let _pageEnterTime = 0;
let _maxScroll = 0;
let _sessionStarted = false;
let _scrollListenerAttached = false;
let _clickListenerAttached = false;
let _pagehideListenerAttached = false;
let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// ─── Session ──────────────────────────────────────────────────────────────────
async function ensureSession(page: string): Promise<void> {
  if (_sessionStarted) return;
  _sessionStarted = true;
  const utmParams = getUtmParams();
  await fetch("/api/analytics/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: _sessionId,
      entryPage: page,
      referrer: document.referrer || undefined,
      utmSource: utmParams["utm_source"],
      utmMedium: utmParams["utm_medium"],
      utmCampaign: utmParams["utm_campaign"],
      utmContent: utmParams["utm_content"],
      utmTerm: utmParams["utm_term"],
      deviceType: detectDevice(),
      browser: detectBrowser(),
    }),
  }).catch(() => {});
}

// ─── Scroll tracking ──────────────────────────────────────────────────────────
function attachScrollListener(): void {
  if (_scrollListenerAttached) return;
  _scrollListenerAttached = true;
  window.addEventListener("scroll", () => {
    const el = document.documentElement;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const pct = Math.round((el.scrollTop / scrollable) * 100);
    if (pct > _maxScroll) _maxScroll = pct;
  }, { passive: true });
}

// ─── Heartbeat — keeps last_seen_at fresh for "live visitors" counter ─────────
// Pings /api/analytics/session every 60 s while the tab is visible.
// This ensures users who stay on one page >5 min still appear in "live now".
function startHeartbeat(): void {
  if (_heartbeatInterval) return;
  _heartbeatInterval = setInterval(() => {
    if (document.visibilityState !== "visible" || !_sessionId) return;
    beacon("/api/analytics/session", { sessionId: _sessionId });
  }, 60_000);
}

// ─── Exit / flush ─────────────────────────────────────────────────────────────
function flushCurrentPageview(): void {
  if (!_pageviewId || !_sessionId) return;
  const durationSeconds = Math.round((Date.now() - _pageEnterTime) / 1000);
  beacon("/api/analytics/batch", [
    {
      type: "pageview",
      payload: {
        sessionId: _sessionId, page: _currentPage,
        durationSeconds, maxScrollPct: _maxScroll,
        pageviewId: _pageviewId, exit: true,
      },
    },
  ]);
  _pageviewId = null;
}

function attachPagehideListener(): void {
  if (_pagehideListenerAttached) return;
  _pagehideListenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushCurrentPageview();
  });
  window.addEventListener("pagehide", flushCurrentPageview);
}

// ─── Click delegation ─────────────────────────────────────────────────────────
// Tracks all links, buttons, and role=button elements:
//   outbound_click — leaving the domain
//   cta_click      — data-track="cta" or matching common CTA text
//   nav_click      — data-track="nav"
//   click          — all other internal interactions
function attachClickListener(): void {
  if (_clickListenerAttached) return;
  _clickListenerAttached = true;
  document.addEventListener("click", (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('a, button, [role="button"]');
    if (!target || !_sessionId) return;
    const label = target.textContent?.trim().slice(0, 200) ?? "";
    const href = target instanceof HTMLAnchorElement ? target.href : "";
    const trackAttr = target.dataset["track"] ?? target.closest("[data-track]")?.getAttribute("data-track") ?? "";
    const isExternal = Boolean(href) && !href.startsWith(window.location.origin) && !href.startsWith("/");

    let eventType: "click" | "nav_click" | "cta_click" | "outbound_click" = "click";
    if (isExternal) {
      eventType = "outbound_click";
    } else if (trackAttr === "cta" || /book|schedule|get started|contact|quiz|download|consultation|explore/i.test(label)) {
      eventType = "cta_click";
    } else if (trackAttr === "nav") {
      eventType = "nav_click";
    }

    beacon("/api/analytics/event", {
      sessionId: _sessionId, page: _currentPage,
      eventType,
      elementLabel: label || undefined,
      elementHref: href.slice(0, 500) || undefined,
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function initTracker(): void {
  if (!isEnabled()) return;
  _sessionId = getOrCreateSession();
  attachScrollListener();
  attachClickListener();
  attachPagehideListener();
  startHeartbeat();
}

/**
 * Link the current analytics session to a known lead email.
 * Call this after the user submits a form with their email address.
 * Once linked, future high-value page visits will automatically score
 * the lead's intent and surface them in the hot leads list.
 */
export async function identifyLead(email: string): Promise<void> {
  if (!isEnabled() || !_sessionId || !email) return;
  try {
    await fetch("/api/analytics/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: _sessionId, email }),
    });
  } catch { /* non-fatal */ }
}

export async function trackPageview(page: string): Promise<void> {
  if (!isEnabled() || !_sessionId) return;

  flushCurrentPageview();
  _currentPage = page;
  _pageEnterTime = Date.now();
  _maxScroll = 0;

  await ensureSession(page);

  try {
    const res = await fetch("/api/analytics/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: _sessionId, page, title: document.title }),
    });
    if (res.ok) {
      const json = await res.json() as { pageviewId?: number };
      _pageviewId = json.pageviewId ?? null;
    }
  } catch { /* non-fatal */ }
}

// ─── Quiz upsell helper (backward compat) ─────────────────────────────────────
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
      body: payload, keepalive: true,
    }).catch(() => {});
  }
}

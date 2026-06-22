/**
 * First-party site analytics tracker.
 *
 * - Sessions are keyed by a UUID stored in sessionStorage (expires with tab).
 * - Page views are tracked on every Wouter route change.
 * - CTA and outbound clicks are tracked via delegation on the document.
 * - Exit events are flushed via sendBeacon on pagehide/visibilitychange.
 *
 * `trackEvent` (quiz upsell helper) is preserved for backward compatibility.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
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
  const onScroll = () => {
    const el = document.documentElement;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const pct = Math.round((el.scrollTop / scrollable) * 100);
    if (pct > _maxScroll) _maxScroll = pct;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
}

// ─── Exit / flush ─────────────────────────────────────────────────────────────
function flushCurrentPageview(): void {
  if (!_pageviewId || !_sessionId) return;
  const durationSeconds = Math.round((Date.now() - _pageEnterTime) / 1000);
  beacon("/api/analytics/batch", [
    {
      type: "pageview",
      payload: {
        sessionId: _sessionId,
        page: _currentPage,
        durationSeconds,
        maxScrollPct: _maxScroll,
        pageviewId: _pageviewId,
        exit: true,
      },
    },
  ]);
  _pageviewId = null;
}

function attachPagehideListener(): void {
  if (_pagehideListenerAttached) return;
  _pagehideListenerAttached = true;
  const flush = () => { if (document.visibilityState === "hidden") flushCurrentPageview(); };
  document.addEventListener("visibilitychange", flush);
  window.addEventListener("pagehide", flushCurrentPageview);
}

// ─── Click delegation ─────────────────────────────────────────────────────────
function attachClickListener(): void {
  if (_clickListenerAttached) return;
  _clickListenerAttached = true;
  document.addEventListener("click", (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest("a, button");
    if (!target || !_sessionId) return;
    const tag = target.tagName.toLowerCase();
    const label = target.textContent?.trim() ?? "";
    const href = tag === "a" ? (target as HTMLAnchorElement).href : "";
    const isExternal = href && !href.startsWith(window.location.origin) && !href.startsWith("/");
    const isCTA = target.getAttribute("data-track-cta") !== null ||
      target.closest("[data-track-cta]") !== null ||
      /book|schedule|get started|contact|quiz|download/i.test(label);

    if (isExternal) {
      beacon("/api/analytics/event", {
        sessionId: _sessionId, page: _currentPage,
        eventType: "outbound_click",
        elementLabel: label.slice(0, 200),
        elementHref: href.slice(0, 500),
      });
    } else if (isCTA && label) {
      beacon("/api/analytics/event", {
        sessionId: _sessionId, page: _currentPage,
        eventType: "cta_click",
        elementLabel: label.slice(0, 200),
        elementHref: href.slice(0, 500) || undefined,
      });
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function initTracker(): void {
  _sessionId = getOrCreateSession();
  attachScrollListener();
  attachClickListener();
  attachPagehideListener();
}

export async function trackPageview(page: string): Promise<void> {
  if (!_sessionId) return;

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
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

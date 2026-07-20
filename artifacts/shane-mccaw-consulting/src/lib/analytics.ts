/**
 * First-party site analytics tracker — rebuilt fresh against the current backend
 * event schema (website-rebuild-reference-v2.md §4). The old implementation fired
 * eventType strings ("assessment_started", "checkout_started", ...) that were never
 * in the backend's validated enum and were silently dropped; this version only ever
 * sends eventType values the backend actually accepts, and routes free-form named
 * conversion events through the real /api/quiz/analytics-event endpoint instead.
 *
 * Active in production automatically. In development, opt in by setting
 * VITE_ANALYTICS_ENABLED=true in your .env.local file.
 *
 * Pattern kept from the old tracker (by design, not by copy): session-scoped,
 * sendBeacon()-based delivery, event delegation over per-element listeners.
 * What changed: the session id now lives in a durable cookie (persists across
 * return visits) instead of sessionStorage (expired on tab close) — this is what
 * lets quiz-only, no-account visitors be recognized on a later visit.
 *
 * Every event lands in analytics_site_events / analytics_pageviews / analytics_sessions
 * on the backend, logged through logger.child({ channel: "growth.website-analytics" }).
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

// ─── Durable cookie session id ─────────────────────────────────────────────────
// Persists across return visits (unlike the old sessionStorage id, which expired
// on tab close) — the anonymous-recognition mechanism for Quiz-only, no-account
// visitors (website-rebuild-reference-v2.md §3). Same imperfect-but-useful pattern
// as ad retargeting: one id per browser, until the cookie is cleared.
const SESSION_COOKIE = "smc_sid";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 730; // ~2 years

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function getOrCreateSessionId(): string {
  let sid = readCookie(SESSION_COOKIE);
  if (!sid) sid = uuid();
  // Refresh the expiry on every visit so an active visitor's cookie never lapses.
  writeCookie(SESSION_COOKIE, sid, SESSION_COOKIE_MAX_AGE_SECONDS);
  return sid;
}

// ─── Device / browser / UTM ────────────────────────────────────────────────────
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
    const v = sp.get(k);
    if (v) out[k] = v;
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

type SiteEventType =
  | "click" | "nav_click" | "cta_click" | "outbound_click" | "form_submit" | "scroll_milestone"
  | "rage_click" | "dead_click" | "idle_timeout";

function sendSiteEvent(eventType: SiteEventType, opts?: { elementLabel?: string; elementHref?: string; metadata?: Record<string, unknown> }): void {
  if (!isEnabled() || !_sessionId) return;
  beacon("/api/analytics/event", {
    sessionId: _sessionId,
    page: _currentPage,
    eventType,
    elementLabel: opts?.elementLabel,
    elementHref: opts?.elementHref,
    metadata: opts?.metadata,
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
let _sessionId = "";
let _currentPage = "";
let _pageviewId: number | null = null;
let _pageEnterTime = 0;
let _maxScroll = 0;
let _scrollMilestonesFired = new Set<number>();
let _firstInteractionAt: number | null = null;
let _lastInteractionAt: number | null = null;
let _sessionStarted = false;
let _listenersAttached = false;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;
let _idleFired = false;
let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _recentClicks: { x: number; y: number; t: number }[] = [];
let _rageFiredAt = 0;

const IDLE_TIMEOUT_MS = 30_000;
const RAGE_CLICK_WINDOW_MS = 700;
const RAGE_CLICK_RADIUS_PX = 30;
const RAGE_CLICK_THRESHOLD = 3;
const RAGE_CLICK_COOLDOWN_MS = 2_000;

const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, [role="button"], [tabindex], [contenteditable]';

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

// ─── Interaction tracking (feeds idle detection + first/last interaction state) ──
function markInteraction(): void {
  const now = Date.now();
  if (_firstInteractionAt === null) _firstInteractionAt = now;
  _lastInteractionAt = now;
  _idleFired = false;
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    if (_idleFired || document.visibilityState !== "visible") return;
    _idleFired = true;
    sendSiteEvent("idle_timeout", {
      metadata: {
        idleMs: IDLE_TIMEOUT_MS,
        msSinceFirstInteraction: _firstInteractionAt ? now - _firstInteractionAt : null,
      },
    });
  }, IDLE_TIMEOUT_MS);
}

// ─── Scroll tracking — max depth + 25/50/75/100% milestones (raw capture, feeds Stage 4 heatmaps) ──
function attachScrollListener(): void {
  window.addEventListener("scroll", () => {
    const el = document.documentElement;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const pct = Math.round((el.scrollTop / scrollable) * 100);
    if (pct > _maxScroll) _maxScroll = pct;
    for (const milestone of [25, 50, 75, 100]) {
      if (pct >= milestone && !_scrollMilestonesFired.has(milestone)) {
        _scrollMilestonesFired.add(milestone);
        sendSiteEvent("scroll_milestone", { metadata: { pct: milestone, scrollY: Math.round(el.scrollTop) } });
      }
    }
    markInteraction();
  }, { passive: true });
}

// ─── Heartbeat — keeps last_seen_at fresh for the "live visitors" counter ──────
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushCurrentPageview();
  });
  window.addEventListener("pagehide", flushCurrentPageview);
}

// ─── Click delegation ─────────────────────────────────────────────────────────
// outbound_click / cta_click / nav_click / click for real navigation & CTA interactions,
// plus rage_click / dead_click raw capture (mouse position included for Stage 4 heatmaps).
function attachClickListener(): void {
  document.addEventListener("click", (e: MouseEvent) => {
    if (!_sessionId) return;
    markInteraction();

    const point = { x: Math.round(e.pageX), y: Math.round(e.pageY), t: Date.now() };
    _recentClicks = _recentClicks.filter((c) => point.t - c.t < RAGE_CLICK_WINDOW_MS);
    _recentClicks.push(point);
    const burst = _recentClicks.filter((c) => Math.hypot(c.x - point.x, c.y - point.y) <= RAGE_CLICK_RADIUS_PX);
    if (burst.length >= RAGE_CLICK_THRESHOLD && point.t - _rageFiredAt > RAGE_CLICK_COOLDOWN_MS) {
      _rageFiredAt = point.t;
      sendSiteEvent("rage_click", { metadata: { x: point.x, y: point.y, clickCount: burst.length } });
    }

    const target = (e.target as HTMLElement).closest<HTMLElement>('a, button, [role="button"]');
    if (!target) {
      // No natural interactive ancestor within a, button, [role=button] — candidate dead click.
      const interactiveAncestor = (e.target as HTMLElement).closest(INTERACTIVE_SELECTOR);
      if (!interactiveAncestor) {
        sendSiteEvent("dead_click", { metadata: { x: point.x, y: point.y, tag: (e.target as HTMLElement).tagName.toLowerCase() } });
      }
      return;
    }

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

    sendSiteEvent(eventType, {
      elementLabel: label || undefined,
      elementHref: href.slice(0, 500) || undefined,
      metadata: { x: point.x, y: point.y },
    });
  });

  document.addEventListener("keydown", markInteraction);
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function initTracker(): void {
  if (!isEnabled() || _listenersAttached) return;
  _listenersAttached = true;
  _sessionId = getOrCreateSessionId();
  attachScrollListener();
  attachClickListener();
  attachPagehideListener();
  startHeartbeat();
  markInteraction();
}

/**
 * Link the current analytics session to a known lead email.
 * Call this after the user submits a form with their email address.
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
  if (!isEnabled()) return;
  if (!_sessionId) _sessionId = getOrCreateSessionId();

  flushCurrentPageview();
  _currentPage = page;
  _pageEnterTime = Date.now();
  _maxScroll = 0;
  _scrollMilestonesFired = new Set();
  _firstInteractionAt = null;
  _lastInteractionAt = null;

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

// ─── Named conversion events ──────────────────────────────────────────────────
// Routed through /api/quiz/analytics-event — a real, already-working, free-form
// {name, properties} sink (quiz_analytics_events table), not the enum-locked
// /api/analytics/event. This is the fix for the old tracker's confirmed bug:
// it fired eventType strings ("assessment_started", etc.) that were never in the
// backend's validated enum and were silently rejected every time.
function sendNamedEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (typeof window.gtag === "function") window.gtag("event", name, properties);
  beacon("/api/quiz/analytics-event", { name, properties });
}

export function trackAssessmentStarted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("assessment_started", params ?? {});
}

export function trackAssessmentCompleted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("assessment_completed", params ?? {});
}

export function trackCheckoutStarted(productType: string, params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("checkout_started", { product_type: productType, ...(params ?? {}) });
}

export function trackCheckoutCompleted(productType: string, params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("checkout_completed", { product_type: productType, ...(params ?? {}) });
}

export function trackMspSignupStarted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("msp_signup_started", params ?? {});
}

export function trackMspSignupCompleted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("msp_signup_completed", params ?? {});
}

/** Generic named event helper (quiz upsell clicks, resource downloads, etc). */
export function trackEvent(name: string, properties: Record<string, string | number | boolean> = {}): void {
  sendNamedEvent(name, properties);
}

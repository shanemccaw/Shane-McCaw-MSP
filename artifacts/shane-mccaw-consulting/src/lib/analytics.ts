/**
 * GA4 (gtag) + Microsoft Clarity forwarding layer. The homegrown first-party tracker
 * (session cookies, sendBeacon delivery to analytics_site_events/pageviews/sessions,
 * click/scroll/form-field instrumentation) was retired in favor of GA4 + Clarity
 * (issue #123) — Clarity's own script covers heatmaps/session replay with zero app
 * code, and GA4 covers traffic/sessions/attribution/conversions.
 *
 * The exported function names/signatures here are kept stable on purpose: 8+
 * components call trackEvent/trackAssessmentStarted/etc. directly, and this file
 * exists so none of those call sites had to change across #115 (added gtag
 * forwarding) or #123 (removed the homegrown backend calls these functions used
 * to also make).
 *
 * Active in production automatically. In development, opt in by setting
 * VITE_ANALYTICS_ENABLED=true in your .env.local file.
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
// The anonymous-recognition mechanism for Quiz-only, no-account visitors
// (website-rebuild-reference-v2.md §3) — unrelated to the retired site-analytics
// backend, this is consumed directly by the personalization layer
// (PersonalizationProvider, usePersonalizationData) to resolve a visitor back to
// their quiz history across return visits.
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

/**
 * The durable smc_sid cookie session id — exposed for the personalization layer
 * (usePersonalizationState) to resolve a quiz-only, no-account visitor back to
 * their quiz history (website-rebuild-reference-v2.md §3).
 */
export function getAnalyticsSessionId(): string {
  return getOrCreateSessionId();
}

/**
 * Link the current analytics session to a known lead email — the personalization
 * layer's (public-personalization.ts) sole write path from an anonymous smc_sid
 * cookie session to an identified visitor. Call this after the user submits a
 * form with their email address.
 */
export async function identifyLead(email: string): Promise<void> {
  const sessionId = getOrCreateSessionId();
  if (!email) return;
  try {
    await fetch("/api/public/personalization/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, email }),
    });
  } catch { /* non-fatal */ }
}

// ─── GA4 client_id lookup ──────────────────────────────────────────────────────
// The GA4-assigned visitor id, used to attribute a staged lead (#116) back to
// its GA4 session once it lands in Zoho. `gtag('get', ...)` is callback-based
// and can hang indefinitely if an ad-blocker has silenced gtag.js, so this
// races the callback against a short timeout and resolves null on either "no
// gtag" (VITE_GA4_MEASUREMENT_ID not configured yet, #137) or a timeout —
// never throws, and never blocks whatever form is calling it.
const GA4_CLIENT_ID_TIMEOUT_MS = 1000;

export function getGa4ClientId(): Promise<string | null> {
  const measurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
  if (typeof window.gtag !== "function" || !measurementId) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), GA4_CLIENT_ID_TIMEOUT_MS);
    try {
      window.gtag!("get", measurementId, "client_id", (clientId: unknown) => {
        clearTimeout(timer);
        settle(typeof clientId === "string" && clientId ? clientId : null);
      });
    } catch {
      clearTimeout(timer);
      settle(null);
    }
  });
}

function beacon(path: string, body: unknown): void {
  const payload = JSON.stringify(body);
  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(path, new Blob([payload], { type: "application/json" }));
  } else {
    fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  }
}

// ─── Pageviews ──────────────────────────────────────────────────────────────────
// Forwards SPA route changes to GA4 as page_view events — gtag's own initial
// config() call only covers the first load, so this is what keeps in-app
// navigation (wouter client-side routing) visible in GA4.
export function trackPageview(page: string): void {
  if (!isEnabled() || typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", { page_path: page, page_title: document.title });
}

// ─── Named conversion events ──────────────────────────────────────────────────
// Routed through /api/quiz/analytics-event — a real, unrelated, already-working
// free-form {name, properties} sink (quiz_analytics_events table, routes/quiz.ts),
// not the retired site-analytics backend. Out of #123's retirement scope.
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

/** Generic named event helper (quiz upsell clicks, resource downloads, etc). */
export function trackEvent(name: string, properties: Record<string, string | number | boolean> = {}): void {
  sendNamedEvent(name, properties);
}

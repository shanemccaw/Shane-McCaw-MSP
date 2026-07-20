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

/**
 * The same durable smc_sid cookie session id the tracker uses — exposed for the
 * personalization layer (usePersonalizationState) to resolve a quiz-only, no-account
 * visitor back to their quiz history (website-rebuild-reference-v2.md §3). Deliberately
 * the same read-or-create logic as the tracker, not a second id scheme.
 */
export function getAnalyticsSessionId(): string {
  return getOrCreateSessionId();
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

// ─── Funnel inference — Landing → Pricing → CTA → Form → Submit → Conversion ───
// (website-rebuild-reference-v2.md §4). Funnel is derived from the route the visitor
// is currently on; /checkout, /contact, etc. carry no funnel of their own, so the last
// known funnel is remembered in sessionStorage and recalled once the visitor leaves the
// originating page — same "durable enough for this session" tradeoff as the rest of the
// tracker, no new persistence mechanism introduced.
const FUNNEL_STORAGE_KEY = "smc_funnel";
const FUNNEL_ROUTES: { prefix: string; funnel: string; stage: "landing" | "pricing" }[] = [
  { prefix: "/monitoring", funnel: "monitoring", stage: "pricing" },
  { prefix: "/products", funnel: "products", stage: "pricing" },
  { prefix: "/retainers", funnel: "retainer", stage: "pricing" },
  { prefix: "/msp", funnel: "msp", stage: "pricing" },
  { prefix: "/assessments", funnel: "assessment", stage: "landing" },
  { prefix: "/assessment", funnel: "assessment", stage: "landing" },
  { prefix: "/quiz", funnel: "quiz", stage: "landing" },
];

function rememberFunnel(funnel: string): void {
  try { sessionStorage.setItem(FUNNEL_STORAGE_KEY, funnel); } catch { /* unavailable */ }
}

function recallFunnel(): string | null {
  try { return sessionStorage.getItem(FUNNEL_STORAGE_KEY); } catch { return null; }
}

function pathOf(page: string): string {
  return page.split("?")[0] ?? page;
}

function inferFunnelFromPage(page: string): { funnel: string; stage: "landing" | "pricing" } | null {
  const path = pathOf(page);
  if (path === "/" || path === "") return { funnel: "home", stage: "landing" };
  const match = FUNNEL_ROUTES.find((r) => path.startsWith(r.prefix));
  return match ? { funnel: match.funnel, stage: match.stage } : null;
}

/** Current or last-known funnel — used for stages (cta/form/submit/conversion) reached off the originating page (e.g. the shared /checkout route). */
function currentFunnel(): string | null {
  return inferFunnelFromPage(_currentPage)?.funnel ?? recallFunnel();
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
  | "rage_click" | "dead_click" | "idle_timeout"
  | "form_viewed" | "form_started" | "form_abandoned"
  | "field_focus" | "field_blur" | "field_error" | "field_autofill_detected"
  | "cta_visible" | "cta_hover"
  | "plan_compare_interaction"
  | "funnel_stage";

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

// Form field-level + CTA visibility/hover tracking state (website-rebuild-reference-v2.md §4).
// WeakSets/WeakMaps so per-element "already fired" state never needs manual reset — old
// pages' DOM nodes are simply discarded on navigation and garbage-collected along with it.
let _visIO: IntersectionObserver | null = null;
const _visibleFired = new WeakSet<Element>();
// _pendingForms is a real (non-Weak) Set — it must stay iterable so flushAbandonedForms
// can fire form_abandoned even after SPA navigation has already detached the old page's
// <form> elements from the document (a querySelectorAll("form") re-scan would miss them).
const _formStartedEver = new WeakSet<HTMLFormElement>();
const _pendingForms = new Set<HTMLFormElement>();
let _hoverTarget: HTMLElement | null = null;
let _hoverTimer: ReturnType<typeof setTimeout> | null = null;
const HOVER_INTENT_MS = 400;

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

// ─── CTA classification — shared by click delegation, visibility, and hover ────
// Single source of truth for "is this a CTA" so cta_click / cta_visible / cta_hover
// always agree on the same element set (website-rebuild-reference-v2.md §4).
function getTrackAttr(el: HTMLElement): string {
  return el.dataset["track"] ?? el.closest("[data-track]")?.getAttribute("data-track") ?? "";
}

function isCtaLabel(label: string): boolean {
  return /book|schedule|get started|contact|quiz|download|consultation|explore/i.test(label);
}

function isCtaElement(el: HTMLElement): boolean {
  if (!el.matches('a, button, [role="button"]')) return false;
  return getTrackAttr(el) === "cta" || isCtaLabel(el.textContent?.trim() ?? "");
}

// ─── Form / field helpers ───────────────────────────────────────────────────────
function isFieldElement(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function fieldLabel(field: HTMLElement): string {
  return (
    field.getAttribute("aria-label") ||
    field.getAttribute("name") ||
    field.id ||
    field.getAttribute("placeholder") ||
    "(unnamed field)"
  );
}

function formLabel(form: HTMLFormElement): string {
  return form.getAttribute("aria-label") || form.getAttribute("name") || form.id || "(unnamed form)";
}

// ─── Visibility tracking — form_viewed + cta_visible (raw capture, feeds Stage 4 heatmaps) ──
// One shared IntersectionObserver, recreated per pageview (trackPageview) so stale
// entries from the previous page's DOM are released rather than held forever; a
// persistent MutationObserver keeps registering elements that mount after the initial
// scan (e.g. package cards rendered once a catalog fetch resolves).
function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const el = entry.target;
    if (_visibleFired.has(el)) continue;
    _visibleFired.add(el);
    _visIO?.unobserve(el);
    if (el instanceof HTMLFormElement) {
      sendSiteEvent("form_viewed", { elementLabel: formLabel(el) });
    } else if (el instanceof HTMLElement) {
      const href = el instanceof HTMLAnchorElement ? el.href : "";
      sendSiteEvent("cta_visible", {
        elementLabel: el.textContent?.trim().slice(0, 200) || undefined,
        elementHref: href.slice(0, 500) || undefined,
      });
    }
  }
}

function scanAndObserve(root: Element): void {
  if (!_visIO) return;
  const check = (el: Element): void => {
    if (el instanceof HTMLFormElement) _visIO?.observe(el);
    else if (el instanceof HTMLElement && isCtaElement(el)) _visIO?.observe(el);
  };
  check(root);
  root.querySelectorAll<HTMLElement>('form, a, button, [role="button"]').forEach(check);
}

let _domWatcherAttached = false;
function attachDomWatcher(): void {
  if (_domWatcherAttached) return;
  _domWatcherAttached = true;
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node instanceof Element) scanAndObserve(node);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

// ─── CTA hover intent — pure delegation via mouseover/mouseout (both bubble, unlike
// mouseenter/mouseleave), matching the rest of the tracker's document-level pattern ──
function attachCtaHoverListener(): void {
  document.addEventListener("mouseover", (e: MouseEvent) => {
    const el = (e.target as HTMLElement)?.closest<HTMLElement>('a, button, [role="button"]');
    if (!el || !isCtaElement(el) || el === _hoverTarget) return;
    _hoverTarget = el;
    if (_hoverTimer) clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(() => {
      if (_hoverTarget !== el) return;
      const href = el instanceof HTMLAnchorElement ? el.href : "";
      sendSiteEvent("cta_hover", {
        elementLabel: el.textContent?.trim().slice(0, 200) || undefined,
        elementHref: href.slice(0, 500) || undefined,
      });
    }, HOVER_INTENT_MS);
  });
  document.addEventListener("mouseout", (e: MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    const el = (e.target as HTMLElement)?.closest<HTMLElement>('a, button, [role="button"]');
    if (el && el === _hoverTarget && (!related || !el.contains(related))) {
      _hoverTarget = null;
      if (_hoverTimer) clearTimeout(_hoverTimer);
    }
  });
}

// ─── Form field-level delegation — viewed/started/abandoned/focus/blur/error/autofill ──
// focusin/focusout (unlike focus/blur) bubble, so this stays document-level delegation
// like the rest of the tracker rather than attaching per-field listeners.
function attachFormFieldListeners(): void {
  document.addEventListener("focusin", (e: FocusEvent) => {
    const field = e.target;
    if (!isFieldElement(field)) return;
    sendSiteEvent("field_focus", { elementLabel: fieldLabel(field) });

    const form = field.closest("form");
    if (form && !_formStartedEver.has(form)) {
      _formStartedEver.add(form);
      _pendingForms.add(form);
      sendSiteEvent("form_started", { elementLabel: formLabel(form) });
      const funnel = currentFunnel();
      if (funnel) sendSiteEvent("funnel_stage", { metadata: { funnel, stage: "form" } });
    }
  });

  document.addEventListener("focusout", (e: FocusEvent) => {
    const field = e.target;
    if (!isFieldElement(field)) return;
    sendSiteEvent("field_blur", { elementLabel: fieldLabel(field) });
    if (field.getAttribute("aria-invalid") === "true") {
      sendSiteEvent("field_error", { elementLabel: fieldLabel(field), metadata: { reason: "aria-invalid" } });
    }
  });

  // Native HTML5 constraint-validation — the 'invalid' event does not bubble, so it
  // must be caught in the capture phase to stay delegated at the document level.
  document.addEventListener(
    "invalid",
    (e: Event) => {
      const field = e.target;
      if (!isFieldElement(field)) return;
      sendSiteEvent("field_error", { elementLabel: fieldLabel(field), metadata: { reason: "html5_validation" } });
    },
    true,
  );

  // Autofill detection via the CSS-animation trick (index.css): browsers apply
  // :-webkit-autofill synchronously on autofill, which we key off an animationstart
  // event carrying our marker animation name.
  document.addEventListener("animationstart", (e: AnimationEvent) => {
    if (e.animationName !== "smcAutofillDetect") return;
    const field = e.target;
    if (!isFieldElement(field)) return;
    sendSiteEvent("field_autofill_detected", { elementLabel: fieldLabel(field) });
  });

  document.addEventListener(
    "submit",
    (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      _pendingForms.delete(form);
      sendSiteEvent("form_submit", { elementLabel: formLabel(form) });
      const funnel = currentFunnel();
      if (funnel) sendSiteEvent("funnel_stage", { metadata: { funnel, stage: "submit" } });
    },
    true,
  );
}

// Any form the visitor started filling out but never submitted, as of the moment the
// page is left (pagehide / tab hidden / navigating to a new page) — form_abandoned.
// Iterates _pendingForms directly rather than re-querying the DOM: on SPA navigation the
// old page's <form> elements are already detached by the time this runs, so a
// querySelectorAll("form") re-scan would silently miss them.
function flushAbandonedForms(): void {
  _pendingForms.forEach((form) => {
    sendSiteEvent("form_abandoned", { elementLabel: formLabel(form) });
    _pendingForms.delete(form);
  });
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
  flushAbandonedForms();
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
    const trackAttr = getTrackAttr(target);
    const isExternal = Boolean(href) && !href.startsWith(window.location.origin) && !href.startsWith("/");

    let eventType: "click" | "nav_click" | "cta_click" | "outbound_click" = "click";
    if (isExternal) {
      eventType = "outbound_click";
    } else if (trackAttr === "cta" || isCtaLabel(label)) {
      eventType = "cta_click";
    } else if (trackAttr === "nav") {
      eventType = "nav_click";
    }

    sendSiteEvent(eventType, {
      elementLabel: label || undefined,
      elementHref: href.slice(0, 500) || undefined,
      metadata: { x: point.x, y: point.y },
    });

    if (eventType === "cta_click") {
      const funnel = currentFunnel();
      if (funnel) sendSiteEvent("funnel_stage", { metadata: { funnel, stage: "cta" } });
    }
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
  attachFormFieldListeners();
  attachCtaHoverListener();
  attachDomWatcher();
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

  // Funnel drop-off (website-rebuild-reference-v2.md §4): remember the funnel this page
  // belongs to (for stages reached later on shared routes like /checkout) and, if this
  // page IS a funnel's landing/pricing page, fire that stage immediately.
  const inferred = inferFunnelFromPage(page);
  if (inferred) {
    rememberFunnel(inferred.funnel);
    sendSiteEvent("funnel_stage", { metadata: { funnel: inferred.funnel, stage: inferred.stage } });
  }

  // Recreate the shared visibility observer per pageview so entries held for the
  // previous page's (now-detached) elements are released, then scan the new page's
  // DOM once it's had a frame to paint. attachDomWatcher's MutationObserver (attached
  // once, in initTracker) picks up anything that mounts later (e.g. async catalog data).
  _visIO?.disconnect();
  _visIO = new IntersectionObserver(onIntersect, { threshold: 0.5 });
  requestAnimationFrame(() => scanAndObserve(document.body));

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

// Funnel drop-off's terminal stage — recallFunnel() covers checkout/onboarding
// completions that happen on a shared route (e.g. /checkout) rather than the
// funnel's own page (website-rebuild-reference-v2.md §4).
function fireConversionFunnelStage(productType: string): void {
  const funnel = currentFunnel();
  if (funnel) sendSiteEvent("funnel_stage", { metadata: { funnel, stage: "conversion", productType } });
}

export function trackAssessmentStarted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("assessment_started", params ?? {});
}

export function trackAssessmentCompleted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("assessment_completed", params ?? {});
  fireConversionFunnelStage("assessment");
}

export function trackCheckoutStarted(productType: string, params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("checkout_started", { product_type: productType, ...(params ?? {}) });
}

export function trackCheckoutCompleted(productType: string, params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("checkout_completed", { product_type: productType, ...(params ?? {}) });
  fireConversionFunnelStage(productType);
}

export function trackMspSignupStarted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("msp_signup_started", params ?? {});
}

export function trackMspSignupCompleted(params?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  sendNamedEvent("msp_signup_completed", params ?? {});
  fireConversionFunnelStage("msp_signup");
}

/** Generic named event helper (quiz upsell clicks, resource downloads, etc). */
export function trackEvent(name: string, properties: Record<string, string | number | boolean> = {}): void {
  sendNamedEvent(name, properties);
}

/**
 * Pricing / purchase-intent granularity beyond a plain CTA click (website-rebuild-reference-v2.md
 * §4) — e.g. selecting a tier to compare (Msp.tsx's selectTier) or changing the seat count that
 * re-matches a different monitoring package (Monitoring.tsx). `kind` distinguishes selection from
 * a lighter-weight comparison browse; both land on the same eventType so admin querying doesn't
 * need to know the site's exact interaction taxonomy ahead of time.
 */
export function trackPricingInteraction(
  kind: "plan_select" | "plan_compare",
  details: { label?: string; metadata?: Record<string, unknown> } = {},
): void {
  if (!isEnabled()) return;
  sendSiteEvent("plan_compare_interaction", { elementLabel: details.label, metadata: { kind, ...(details.metadata ?? {}) } });
}

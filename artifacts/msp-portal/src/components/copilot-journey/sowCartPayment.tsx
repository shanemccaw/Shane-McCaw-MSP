/**
 * sowCartPayment.tsx — Git #602 (Epic #597 stage 4): the real embedded Stripe
 * Payment Element for the live SOW cart, mounted inline in
 * `StatementOfWorkBody.tsx`'s own signature block.
 *
 * PORTED, NOT REBUILT
 * --------------------
 * This is the marketing site's already-built and themed Payment Element
 * (`shane-mccaw-consulting`'s `AssessmentFlow.tsx` / `PaymentStep`, #482) —
 * same stripe.js loader (no `@stripe/*` npm package needed), the same Stripe
 * Appearance-API allowlist, the same `redirect:"if_required"` confirm so the
 * buyer never leaves this page for a bank redirect unless one is genuinely
 * required. What changed crossing over: the colour tokens are this journey's
 * own `BRAND`/`INK` (`journeyTokens.ts`) instead of the marketing site's
 * literal hex palette, and the three endpoints it talks to are the real
 * SOW-cart ones (#599/#600) instead of the marketing flow's single-product
 * ones:
 *
 *   POST /api/portal/assessment/sow/checkout-session                    (#599)
 *   POST /api/portal/assessment/sow/checkout-session/payment-intent     (#600)
 *   POST /api/portal/assessment/sow/checkout-session/payment-confirmed  (#600)
 *
 * No redirect, no page navigation — the Element mounts in this same document
 * view and the buyer never leaves it, matching Shane's original ask (#597).
 *
 * Deliberately narrower than the marketing flow it is ported from: no rescan
 * add-on branch (that recurring add-on has no equivalent on a SOW cart — the
 * cart's own `addonSelections` already cover Tenant Monitoring / the Architect
 * Retainer) and no post-payment account creation (a portal customer paying for
 * a SOW is already a signed-in account). What happens to the signed contract
 * after payment succeeds — an agreement record of some kind — is #603's own
 * deferred scope; this module's job ends at a server-confirmed charge.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND, INK, TABULAR, hexAlpha } from "./journeyTokens.ts";
import { money } from "./journeyPricing.ts";

type FetchWithAuth = (
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

/* ------------------------------------------------------------------ *
 * Wire shapes — the exact contract `portal-assessment.ts`'s three
 * endpoints return (read from the real route source, not assumed).
 * ------------------------------------------------------------------ */

/** Git #613's per-phase billing snapshot, as `checkout-session` returns it (Git #630). */
export interface SowPhaseBreakdownEntry {
  readonly serviceId: number;
  readonly title: string;
  readonly priceCents: number;
  readonly stage: string | null;
  readonly durationWeeks: number | null;
}

/**
 * Git #659 — the Pay by Phase card's pre-signature preview entry: real phase
 * title/price/duration `StatementOfWorkBody.tsx` already has on `scope`
 * before signing, ordered to match the server's real billing order
 * (`orderPhasesForBillingPreview`). Deliberately narrower than
 * `SowPhaseBreakdownEntry` — no `serviceId`/`stage`, which this preview has
 * no use for and which would invite treating it as the authoritative snapshot
 * (that stays `SowCheckoutSessionResult.phaseBreakdown`, resolved once at
 * signing).
 */
export interface SowPhaseBillingPreviewEntry {
  readonly title: string;
  readonly priceUsd: number;
  readonly weeksQuoted: number | null;
}

/**
 * Git #659 — the same "no real duration quoted still gets a 1-week estimate"
 * rule `StatementOfWorkBody.tsx`'s own Gantt layout (`buildGanttLayout`)
 * applies, so a phase's absence of a quoted duration doesn't collapse its
 * neighbours' estimated dates to the same day.
 */
function weeksOrMin(weeks: number | null): number {
  return typeof weeks === "number" && weeks > 0 ? weeks : 1;
}

/**
 * Git #659 — phase 1 charges the day of signing; each phase after it charges
 * an estimate built from the cumulative real quoted duration of every phase
 * ahead of it in the real billing order — the same weeks this document's own
 * Delivery Timeline states, not a second, invented schedule. Labelled
 * "estimated" everywhere this is shown: it is a projection from quoted
 * durations, not a locked invoicing date.
 */
function estimatedChargeDate(index: number, weeksAhead: readonly (number | null)[]): Date {
  const weeksFromToday = weeksAhead.slice(0, index).reduce<number>((sum, w) => sum + weeksOrMin(w), 0);
  const d = new Date();
  d.setDate(d.getDate() + weeksFromToday * 7);
  return d;
}

function formatChargeDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export interface SowCheckoutSessionRequest {
  readonly selectedPhaseServiceIds: readonly number[];
  readonly addonSelections: readonly { readonly addonId: string; readonly tierId: string }[];
  /** JourneySignaturePanel's drawn-PNG + typed-name capture — this request IS the "sign()" moment (Git #603). */
  readonly signatureData: string;
  readonly signerName: string;
  /** Git #630 — which plan this signature locks in; the server defaults "full" if omitted. */
  readonly paymentPlan: "full" | "phased";
}

export interface SowCheckoutSessionResult {
  readonly sessionId: string;
  readonly paymentPlan: "full" | "phased";
  readonly totalCents: number;
  readonly originalTotalCents: number;
  readonly discount: { readonly couponCode: string; readonly savingsCents: number; readonly discountPct: number | null } | null;
  readonly phaseCount: number;
  readonly addonCount: number;
  /** Git #613's billing-order phase snapshot — `[]` on a "full" signature. */
  readonly phaseBreakdown: readonly SowPhaseBreakdownEntry[];
  /** The 30%-style deposit this signature locks in — `null` on a "full" signature. */
  readonly depositCents: number | null;
  readonly depositPct: number | null;
}

interface SowCheckoutSessionResponse {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly paymentPlan: "full" | "phased";
  readonly totalCents: number;
  readonly originalTotalCents: number;
  readonly discount: { readonly couponCode: string; readonly savingsCents: number; readonly discountPct: number | null } | null;
  readonly phaseBreakdown: readonly SowPhaseBreakdownEntry[];
  readonly depositCents: number | null;
  readonly depositPct: number | null;
  readonly phases: readonly { readonly serviceId: number; readonly serviceName: string; readonly priceCents: number }[];
  readonly addons: readonly {
    readonly addonId: string;
    readonly addonTitle: string;
    readonly tierId: string;
    readonly tierLabel: string;
    readonly upfrontCents: number;
    readonly monthlyCents: number;
  }[];
}

/** `{error}` on every failure response this route set returns — read once, for a message worth showing. */
async function readErrorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? String(res.status);
}

function checkoutSessionErrorMessage(code: string): string {
  switch (code) {
    case "no_priced_scope":
      return "There is no priced remediation scope for this tenant right now.";
    case "phased_plan_unavailable":
      return "Pay by Phase is not available right now. Please choose Pay in Full, or contact us.";
    case "session_expired":
    case "session_not_ready":
      return "This session has expired. Please try signing again.";
    // These two are already full, real sentences from the route (the same
    // wording JourneySignaturePanel's own gating makes unreachable in normal
    // use) — shown verbatim rather than flattened to the generic default.
    case "A drawn signature is required":
    case "Your full legal name is required to sign":
      return code;
    default:
      return "We could not start your checkout. Please try again.";
  }
}

/** Git #599 — snapshots the agreed scope server-side and returns the priced session to pay against. */
export async function createSowCheckoutSession(
  fetchWithAuth: FetchWithAuth,
  body: SowCheckoutSessionRequest,
): Promise<SowCheckoutSessionResult> {
  const res = await fetchWithAuth("/api/portal/assessment/sow/checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(checkoutSessionErrorMessage(await readErrorCode(res)));
  const data = (await res.json()) as SowCheckoutSessionResponse;
  return {
    sessionId: data.sessionId,
    paymentPlan: data.paymentPlan,
    totalCents: data.totalCents,
    originalTotalCents: data.originalTotalCents,
    discount: data.discount,
    phaseBreakdown: data.phaseBreakdown,
    depositCents: data.depositCents,
    depositPct: data.depositPct,
    phaseCount: data.phases.length,
    addonCount: data.addons.length,
  };
}

export type SowPaymentPlan = "full" | "phased";

const PLAN_CARD_BORDER_OFF = "rgba(51,65,85,.9)";
const PLAN_CARD_BORDER_ON = hexAlpha(BRAND.teal, 0.55);
const PLAN_CARD_BG_OFF = "rgba(15,23,42,.4)";
const PLAN_CARD_BG_ON = hexAlpha(BRAND.teal, 0.08);
const PLAN_RING_OFF = "rgba(71,85,105,.9)";

function SowPaymentPlanCard({
  title,
  subtitle,
  body,
  selected,
  disabled,
  onSelect,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  /** Git #659 — the urgency badge (Pay in Full) or real phase itemization (Pay by Phase). */
  readonly children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      style={{
        appearance: "none",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        border: `1px solid ${selected ? PLAN_CARD_BORDER_ON : PLAN_CARD_BORDER_OFF}`,
        borderRadius: 10,
        background: selected ? PLAN_CARD_BG_ON : PLAN_CARD_BG_OFF,
        padding: "14px 16px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !selected ? 0.5 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "border-color 180ms, background 180ms",
      }}
    >
      <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: INK.headingDark }}>{title}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: INK.bodyDark }}>{subtitle}</span>
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 17,
            height: 17,
            borderRadius: "50%",
            border: `1px solid ${selected ? BRAND.teal : PLAN_RING_OFF}`,
            flex: "none",
            marginTop: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "border-color 180ms",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: selected ? BRAND.teal : "transparent",
              transition: "background 180ms",
            }}
          />
        </span>
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDark }}>{body}</span>
      {children}
    </button>
  );
}

/**
 * Git #659 — the real urgency indicator Pay in Full was missing entirely.
 * Only rendered when `discountPct` is a real, live number from
 * `GET .../sow/pay-in-full-offer` (`StatementOfWorkBody.tsx`'s
 * `SowLiveInputs.payInFullDiscountPct`) — no badge at all when that coupon
 * is inactive, rather than a discount claim nothing backs.
 */
function PayInFullUrgencyBadge({ discountPct }: { readonly discountPct: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        alignSelf: "flex-start",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".04em",
        color: "#020617",
        background: BRAND.teal,
        borderRadius: 999,
        padding: "3px 9px",
      }}
    >
      {`${discountPct}% off — act now`}
    </span>
  );
}

/**
 * Git #659 — the real Pay by Phase itemization: every included phase, in
 * real billing order, with its real price and an estimated charge date built
 * from its own quoted duration. Replaces the plan card's generic "a deposit
 * and your first phase are charged today" body text with the actual phases
 * it is describing.
 */
function SowPhasePreviewList({ phases }: { readonly phases: readonly SowPhaseBillingPreviewEntry[] }) {
  if (phases.length === 0) return null;
  const weeksAhead = phases.map((p) => p.weeksQuoted);
  return (
    // `<span>`s all the way down, not `<div>`s — this list renders inside
    // `SowPaymentPlanCard`'s `<button>`, whose content model this file's own
    // other buttons (the phase/addon toggles above) already keep to phrasing
    // content only.
    <span style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
      {phases.map((p, i) => (
        <span
          key={`${p.title}-${i}`}
          style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 600, color: INK.bodyDarkStrong, minWidth: 0 }}>
            {`Phase ${i + 1} — ${p.title}`}
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "none" }}>
            <span style={{ fontSize: 10.5, fontWeight: 500, color: INK.micro }}>
              {i === 0 ? "today" : `est. ${formatChargeDate(estimatedChargeDate(i, weeksAhead))}`}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: INK.headingDark, ...TABULAR }}>
              {money(p.priceUsd)}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Git #630 — the real Pay in Full / Pay by Phase selector the live SOW cart
 * never had (#613 built the deposit + phased-invoicing backend; nothing on
 * this screen let a customer choose it). Rendered ABOVE the signature pad
 * because the choice is carried in the very request that signs — Git #603's
 * checkout-session creation IS the sign() moment, so there is no later step
 * to change it in.
 *
 * Git #659 update: the phase-deposit fraction is still not printed here —
 * it is a `coupons` row Shane can edit at any time and is not knowable until
 * the signing request actually resolves one (`createSowCheckoutSession`'s
 * response), so stating it here would risk quoting a figure this signature
 * will not actually be charged; the real deposit figure still only appears
 * on `SowCartPaymentPanel` below, the instant it exists. The pay-in-full
 * PERCENTAGE and the Pay by Phase itemization, however, ARE both real and
 * knowable before signing (`payInFullDiscountPct`, `phasePreview` below) —
 * see `PayInFullUrgencyBadge`/`SowPhasePreviewList`.
 */
export function SowPaymentPlanChoice({
  plan,
  onChange,
  disabled,
  phasePreview,
  payInFullDiscountPct,
}: {
  readonly plan: SowPaymentPlan;
  readonly onChange: (plan: SowPaymentPlan) => void;
  readonly disabled: boolean;
  /** Git #659 — the real phases this signature would put on a Pay by Phase schedule. */
  readonly phasePreview: readonly SowPhaseBillingPreviewEntry[];
  /** Git #659 — the live pay-in-full coupon's real percentage, or `null` when it is not currently active. */
  readonly payInFullDiscountPct: number | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          color: INK.micro,
        }}
      >
        How you would like to pay
      </span>
      <div
        role="radiogroup"
        aria-label="How you would like to pay"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}
      >
        <SowPaymentPlanCard
          title="Pay in Full"
          subtitle="One charge today"
          body="Your full contract, charged in one payment when you sign. Any active pay-in-full discount is applied automatically — you'll see the exact amount before you're charged."
          selected={plan === "full"}
          disabled={disabled}
          onSelect={() => onChange("full")}
        >
          {payInFullDiscountPct !== null ? <PayInFullUrgencyBadge discountPct={payInFullDiscountPct} /> : null}
        </SowPaymentPlanCard>
        <SowPaymentPlanCard
          title="Pay by Phase"
          subtitle="Deposit + Phase 1 today"
          body="A deposit and your first phase are charged today. Each remaining phase is invoiced as it begins, and your deposit is credited back on the final phase. You'll see the exact deposit before you're charged."
          selected={plan === "phased"}
          disabled={disabled}
          onSelect={() => onChange("phased")}
        >
          {plan === "phased" ? <SowPhasePreviewList phases={phasePreview} /> : null}
        </SowPaymentPlanCard>
      </div>
    </div>
  );
}

interface SowPaymentIntentResponse {
  readonly clientSecret: string;
  readonly publishableKey: string;
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly alreadyPaid: boolean;
}

function paymentIntentErrorMessage(code: string): string {
  switch (code) {
    case "payment_unavailable":
      return "Card payment is temporarily unavailable. Please contact us and we'll take it from here.";
    case "session_expired":
    case "not_your_session":
    case "price_unresolved":
      return "This checkout session is no longer valid. Please try signing again.";
    default:
      return "We could not prepare the payment. Please try again shortly.";
  }
}

/** Git #600 — creates (or recovers, via its own idempotency key) the PaymentIntent this Element confirms against. */
async function createSowPaymentIntent(
  fetchWithAuth: FetchWithAuth,
  sessionId: string,
): Promise<SowPaymentIntentResponse> {
  const res = await fetchWithAuth("/api/portal/assessment/sow/checkout-session/payment-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(paymentIntentErrorMessage(await readErrorCode(res)));
  return (await res.json()) as SowPaymentIntentResponse;
}

interface SowPaymentConfirmedResponse {
  readonly ok: true;
  readonly amountCents: number;
  readonly email: string;
}

/** Git #600 — the browser's success claim is not evidence; this re-reads the intent from Stripe server-side before the session is marked paid. */
async function confirmSowPaymentOnServer(
  fetchWithAuth: FetchWithAuth,
  sessionId: string,
  paymentIntentId: string,
): Promise<SowPaymentConfirmedResponse> {
  const res = await fetchWithAuth("/api/portal/assessment/sow/checkout-session/payment-confirmed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, paymentIntentId }),
  });
  if (!res.ok) {
    const code = await readErrorCode(res);
    throw new Error(
      code === "payment_not_succeeded"
        ? "Your bank has not confirmed the payment yet. Please wait a moment and try again."
        : "We took the payment but could not record it. Please contact us before paying again.",
    );
  }
  return (await res.json()) as SowPaymentConfirmedResponse;
}

/* ------------------------------------------------------------------ *
 * stripe.js — ported verbatim from the marketing flow's own loader.
 * Loaded from Stripe's own domain, not bundled — required by Stripe,
 * and the reason no `@stripe/*` npm package is needed for the Element.
 * ------------------------------------------------------------------ */

interface StripeElement {
  mount: (target: HTMLElement) => void;
  destroy: () => void;
}
interface StripeElements {
  create: (type: "payment", options?: Record<string, unknown>) => StripeElement;
}
interface StripeInstance {
  elements: (options: Record<string, unknown>) => StripeElements;
  confirmPayment: (options: {
    elements: StripeElements;
    redirect: "if_required";
    confirmParams?: Record<string, unknown>;
  }) => Promise<{
    error?: { message?: string };
    paymentIntent?: { id: string; status: string };
  }>;
}
declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance;
  }
}

const STRIPE_JS_SRC = "https://js.stripe.com/v3/";

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${STRIPE_JS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("stripe.js failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = STRIPE_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("stripe.js failed to load"));
    document.head.appendChild(script);
  });
}

/* ------------------------------------------------------------------ *
 * Theming — #482's pattern (every property below is on Stripe's
 * documented Appearance allowlist; an unsupported one throws at mount
 * and takes the whole form down), retargeted onto this journey's own
 * `BRAND`/`INK` tokens instead of the marketing site's literal hex.
 * ------------------------------------------------------------------ */

const FIELD_BG = "rgba(2,6,23,.6)";
const FIELD_BG_FOCUS = "rgba(2,6,23,.85)";
const FIELD_BORDER = "rgba(51,65,85,.9)";
const FIELD_BORDER_HOVER = "rgba(71,85,105,.95)";
const FIELD_RADIUS = 10;
const FIELD_PADDING = "13px 15px";
const FIELD_FONT_SIZE = 15;
const DANGER = "#fca5a5";
const ACCENT = BRAND.blue;
const ACCENT_SOFT = hexAlpha(BRAND.blue, 0.14);
const ACCENT_EDGE = hexAlpha(BRAND.blue, 0.32);
const FOCUS_RING = `0 0 0 3px ${hexAlpha(BRAND.blue, 0.22)}`;
const TAB_TRANSITION = "background-color .18s ease,border-color .18s ease,box-shadow .18s ease,color .18s ease";

// Named outright rather than `fontFamily:"inherit"` — the Element renders in a
// cross-origin iframe with nothing to inherit from, which is what rendered the
// marketing flow's own payment step in serif before #482 fixed it. `fonts`
// below loads the same Google Fonts stylesheet the rest of this portal already
// pulls in, into the iframe, so this is the one place that has to say so twice.
const STRIPE_FONT_STACK = "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif";
const STRIPE_FONTS = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
] as const;

const STRIPE_APPEARANCE = {
  theme: "night",
  labels: "above",
  variables: {
    fontFamily: STRIPE_FONT_STACK,
    fontSizeBase: `${FIELD_FONT_SIZE}px`,
    fontSizeSm: "13px",
    fontSizeXs: "12px",
    fontSize2Xs: "11px",
    fontLineHeight: "1.5",
    fontWeightNormal: "500",
    fontWeightMedium: "600",
    fontWeightBold: "700",
    fontSmooth: "always",
    spacingUnit: "4px",
    borderRadius: `${FIELD_RADIUS}px`,
    gridRowSpacing: "18px",
    gridColumnSpacing: "14px",
    tabSpacing: "10px",
    labelSpacing: "7px",
    colorPrimary: ACCENT,
    colorBackground: FIELD_BG,
    colorText: INK.headingDark,
    colorTextSecondary: INK.micro,
    colorTextPlaceholder: INK.micro,
    colorDanger: DANGER,
    colorSuccess: "#34d399",
    colorWarning: "#fbbf24",
    accessibleColorOnColorPrimary: "#ffffff",
    labelColorText: INK.micro,
    labelFontSize: "11px",
    labelFontWeight: "600",
    inputColorBorder: FIELD_BORDER,
    inputFocusColorBorder: ACCENT,
    inputBoxShadow: "none",
    inputFocusBoxShadow: FOCUS_RING,
    focusBoxShadow: FOCUS_RING,
    focusOutline: "none",
    iconColor: INK.micro,
    iconHoverColor: INK.bodyDarkStrong,
    iconChevronDownColor: INK.micro,
    iconChevronDownHoverColor: INK.bodyDarkStrong,
    iconCheckmarkColor: "#ffffff",
    tabIconColor: INK.micro,
    tabIconHoverColor: INK.bodyDarkStrong,
    tabIconSelectedColor: "#93c5fd",
    tabIconMoreColor: INK.micro,
    tabIconMoreHoverColor: INK.bodyDarkStrong,
  },
  rules: {
    ".Tab": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: "12px",
      boxShadow: "none",
      color: INK.micro,
      padding: "12px 14px",
      transition: TAB_TRANSITION,
    },
    ".Tab:hover": {
      backgroundColor: "rgba(15,23,42,.75)",
      borderColor: FIELD_BORDER_HOVER,
      boxShadow: "none",
      color: INK.bodyDarkStrong,
    },
    ".Tab:focus": {
      borderColor: ACCENT,
      boxShadow: FOCUS_RING,
      outline: "none",
    },
    ".Tab--selected": {
      backgroundColor: ACCENT_SOFT,
      borderColor: ACCENT,
      boxShadow: `0 0 0 1px ${ACCENT_EDGE},0 8px 20px -12px ${hexAlpha(BRAND.blue, 0.85)}`,
      color: "#e2e8f0",
    },
    ".TabIcon": { transition: "fill .18s ease,color .18s ease" },
    ".TabLabel": { fontSize: "13px", fontWeight: "600", letterSpacing: ".01em" },
    ".Label": {
      color: INK.micro,
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: ".12em",
      textTransform: "uppercase",
    },
    ".Label--invalid": { color: DANGER },
    ".Input": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: `${FIELD_RADIUS}px`,
      boxShadow: "none",
      color: INK.headingDark,
      fontSize: `${FIELD_FONT_SIZE}px`,
      padding: FIELD_PADDING,
      transition: "background-color .16s ease,border-color .16s ease,box-shadow .16s ease",
    },
    ".Input:hover": { borderColor: FIELD_BORDER_HOVER },
    ".Input:focus": {
      backgroundColor: FIELD_BG_FOCUS,
      borderColor: ACCENT,
      boxShadow: FOCUS_RING,
      outline: "none",
    },
    ".Input--invalid": {
      borderColor: DANGER,
      boxShadow: "0 0 0 3px rgba(248,113,113,.16)",
      color: "#fecaca",
    },
    ".Input::placeholder": { color: INK.micro },
    ".Error": { color: DANGER, fontSize: "12.5px", marginTop: "7px" },
    ".Block": {
      backgroundColor: "rgba(2,6,23,.5)",
      border: `1px solid ${INK.hairlineDark}`,
      borderRadius: "14px",
      boxShadow: "none",
    },
    ".BlockDivider": { backgroundColor: INK.hairlineDark },
    ".AccordionItem": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: "12px",
      boxShadow: "none",
      color: INK.bodyDarkStrong,
      padding: "14px 16px",
    },
    ".AccordionItem--selected": {
      backgroundColor: ACCENT_SOFT,
      borderColor: ACCENT,
      color: INK.headingDark,
    },
    ".PickerItem": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: `${FIELD_RADIUS}px`,
      boxShadow: "none",
      color: INK.bodyDarkStrong,
    },
    ".PickerItem--selected": {
      backgroundColor: ACCENT_SOFT,
      borderColor: ACCENT,
      color: INK.headingDark,
    },
    ".CheckboxInput": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: "5px",
      boxShadow: "none",
      transition: "background-color .16s ease,border-color .16s ease",
    },
    ".CheckboxInput--checked": { backgroundColor: ACCENT, borderColor: ACCENT },
    ".CheckboxLabel": { color: INK.bodyDarkStrong, fontSize: "13px", lineHeight: "1.5" },
    ".RadioIconOuter": { stroke: FIELD_BORDER, transition: "stroke .16s ease" },
    ".RadioIconOuter--checked": { stroke: ACCENT },
    ".RadioIconInner": { fill: ACCENT },
    ".Menu": { padding: "6px" },
    ".MenuAction": {
      backgroundColor: "transparent",
      borderRadius: "8px",
      color: INK.bodyDarkStrong,
      fontSize: "13.5px",
      padding: "9px 11px",
      transition: "background-color .14s ease,color .14s ease",
    },
    ".MenuAction:hover": { backgroundColor: ACCENT_SOFT, color: INK.headingDark },
    ".Dropdown": {
      border: `1px solid ${INK.hairlineDark}`,
      borderRadius: "12px",
      boxShadow: "0 18px 40px -20px rgba(2,6,23,.95)",
    },
    ".DropdownItem": {
      backgroundColor: "transparent",
      borderRadius: "8px",
      color: INK.bodyDarkStrong,
      fontSize: "14px",
      padding: "9px 11px",
    },
    ".DropdownItem--highlight": { backgroundColor: ACCENT_SOFT, color: INK.headingDark },
  },
} as const;

const STRIPE_PAYMENT_ELEMENT_OPTIONS = { layout: { type: "tabs" } } as const;

const PAY_PANEL: React.CSSProperties = {
  border: `1px solid ${INK.hairlineDark}`,
  borderRadius: 12,
  background: "rgba(2,6,23,.5)",
  overflow: "hidden",
};
const PAY_PANEL_HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "14px 18px 12px",
  borderBottom: `1px solid ${INK.hairlineDark}`,
};
const PAY_PANEL_FOOT: React.CSSProperties = {
  padding: "14px 18px 16px",
  borderTop: `1px solid ${INK.hairlineDark}`,
};
const SECURE_BADGE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".04em",
  color: INK.micro,
};

function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={INK.micro}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect x="4" y="10.5" width="16" height="11" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

/** Holds the panel's shape while Stripe's iframe boots — decoration only, the real loading state is the text beneath it. */
function PaymentSkeleton() {
  const bar = (height: number, radius: number, width: string): React.CSSProperties => ({
    height,
    width,
    borderRadius: radius,
    background: "rgba(15,23,42,.75)",
    border: `1px solid ${INK.hairlineDark}`,
    boxSizing: "border-box",
  });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div aria-hidden="true" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={bar(42, 12, "100%")} />
        <div style={bar(42, 12, "100%")} />
        <div style={bar(42, 12, "100%")} />
      </div>
      <div aria-hidden="true" style={{ display: "grid", gap: 16 }}>
        <div style={bar(44, FIELD_RADIUS, "100%")} />
        <div style={bar(44, FIELD_RADIUS, "100%")} />
      </div>
      <p style={{ fontSize: 12, color: INK.deemphasised, margin: "14px 0 0" }}>Loading secure card fields…</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The panel — mounted inline in the SOW's own signature block once
 * `createSowCheckoutSession` has returned a real session to pay
 * against. No redirect, no route change; success is reported back to
 * the caller via `onPaid` so it can flip the block to its paid state.
 * ------------------------------------------------------------------ */

export function SowCartPaymentPanel({
  fetchWithAuth,
  sessionId,
  totalCents,
  discount,
  phaseCount,
  addonCount,
  paymentPlan,
  phaseBreakdown,
  depositCents,
  depositPct,
  onPaid,
}: {
  readonly fetchWithAuth: FetchWithAuth;
  readonly sessionId: string;
  /** The full contract value. On a "phased" signature this is NOT what charges today — see `depositCents`/`chargeCents`. */
  readonly totalCents: number;
  /** The live PAY-TODAY coupon's discount, already folded into `totalCents` — shown so the saving isn't silent. "full" plan only. */
  readonly discount: { readonly savingsCents: number; readonly discountPct: number | null } | null;
  readonly phaseCount: number;
  readonly addonCount: number;
  /** Git #630 — which plan this session's signature locked in. */
  readonly paymentPlan: SowPaymentPlan;
  /** Git #613's billing-order phase snapshot — `[]` on "full". */
  readonly phaseBreakdown: readonly SowPhaseBreakdownEntry[];
  readonly depositCents: number | null;
  readonly depositPct: number | null;
  readonly onPaid: (amountCents: number) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  /**
   * What today's PaymentIntent actually charges — `resolveSowOrder`'s own
   * `chargeCents` on the server (Git #613): the full `totalCents` on "full",
   * but deposit + Phase 1 (or Phase 1 minus the deposit, single-phase) on
   * "phased". Never recomputed here — a second arithmetic path on money is a
   * second chance to quote a figure Stripe will not honour — so this starts
   * `null` on a phased plan and is filled in from the payment-intent
   * response the moment it resolves, rather than assumed from `totalCents`.
   */
  const [chargeCents, setChargeCents] = useState<number | null>(paymentPlan === "phased" ? null : totalCents);

  const confirmOnServer = useCallback(
    async (paymentIntentId: string) => {
      setConfirming(true);
      setPayError(null);
      try {
        const data = await confirmSowPaymentOnServer(fetchWithAuth, sessionId, paymentIntentId);
        onPaid(data.amountCents);
      } catch (err) {
        setPayError(err instanceof Error ? err.message : "We could not record the payment.");
      } finally {
        setConfirming(false);
      }
    },
    [fetchWithAuth, sessionId, onPaid],
  );

  // Create the intent, boot stripe.js, mount the Payment Element.
  useEffect(() => {
    let cancelled = false;
    let element: StripeElement | null = null;

    (async () => {
      try {
        const data = await createSowPaymentIntent(fetchWithAuth, sessionId);
        if (cancelled) return;
        setIntentId(data.paymentIntentId);
        setChargeCents(data.amountCents);

        // Recovered an intent that already succeeded (paid, then reloaded
        // before the confirm callback landed) — finish rather than asking for
        // a second card.
        if (data.alreadyPaid) {
          await confirmOnServer(data.paymentIntentId);
          return;
        }

        await loadStripeJs();
        if (cancelled || !window.Stripe || !mountRef.current) return;

        const stripe = window.Stripe(data.publishableKey);
        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret: data.clientSecret,
          appearance: STRIPE_APPEARANCE,
          fonts: STRIPE_FONTS,
        });
        elementsRef.current = elements;
        element = elements.create("payment", STRIPE_PAYMENT_ELEMENT_OPTIONS);
        element.mount(mountRef.current);
        setReady(true);
      } catch (err) {
        if (!cancelled) setInitError(err instanceof Error ? err.message : "Could not load the payment form.");
      }
    })();

    return () => {
      cancelled = true;
      try {
        element?.destroy();
      } catch {
        /* already torn down */
      }
    };
  }, [sessionId, fetchWithAuth, confirmOnServer]);

  async function pay() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setPaying(true);
    setPayError(null);
    try {
      // redirect: "if_required" keeps the buyer on this page for every payment
      // method that does not genuinely need a bank redirect.
      const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
      if (result.error) {
        setPayError(result.error.message ?? "Your payment could not be completed.");
        return;
      }
      const id = result.paymentIntent?.id ?? intentId;
      if (!id || result.paymentIntent?.status !== "succeeded") {
        setPayError("Your payment is still processing. We'll email you as soon as it clears.");
        return;
      }
      await confirmOnServer(id);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Something went wrong taking the payment.");
    } finally {
      setPaying(false);
    }
  }

  const phase1 = phaseBreakdown[0] ?? null;
  const laterPhases = phaseBreakdown.slice(1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: INK.bodyDark }}>
        {`${phaseCount} phase${phaseCount === 1 ? "" : "s"}${addonCount > 0 ? `, ${addonCount} add-on${addonCount === 1 ? "" : "s"}` : ""} · `}
        {chargeCents === null ? "confirming today's amount…" : `${money(chargeCents / 100)} due today`}
        {discount ? (
          <span style={{ color: BRAND.teal, fontWeight: 600 }}>
            {` · ${money(discount.savingsCents / 100)} pay-in-full discount applied`}
          </span>
        ) : null}
      </p>

      {paymentPlan === "phased" && depositCents !== null && phase1 ? (
        <div
          style={{
            border: `1px dashed ${INK.hairlineDark}`,
            borderRadius: 10,
            background: "rgba(15,23,42,.3)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: BRAND.teal,
            }}
          >
            {`Your phase breakdown${depositPct !== null ? ` — ${depositPct}% deposit` : ""}`}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {phaseBreakdown.map((p, i) => (
              <span key={p.serviceId} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: INK.bodyDarkStrong }}>
                  {`Phase ${i + 1} — ${p.title}`}
                </span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
                  {/* Git #659 — real, estimated from this phase's own quoted duration
                      (`durationWeeks`), never a second invented schedule. */}
                  <span style={{ fontSize: 11, fontWeight: 500, color: INK.micro }}>
                    {i === 0
                      ? "today"
                      : `est. ${formatChargeDate(
                          estimatedChargeDate(
                            i,
                            phaseBreakdown.map((q) => q.durationWeeks),
                          ),
                        )}`}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK.headingDark }}>{money(p.priceCents / 100)}</span>
                </span>
              </span>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
            {laterPhases.length > 0
              ? `${money(depositCents / 100)} deposit + Phase 1 (${phase1.title}) charge today. Each remaining phase is invoiced as it begins, and your deposit is credited on the final phase — you never pay more than the ${money(totalCents / 100)} contract total.`
              : `Phase 1 (${phase1.title}) is your only phase, so your ${money(depositCents / 100)} deposit is credited against it immediately${chargeCents !== null ? ` — ${money(chargeCents / 100)} due today` : ""}. You never pay more than the ${money(totalCents / 100)} contract total.`}
          </p>
        </div>
      ) : null}

      {initError ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: DANGER }}>{initError}</div>
      ) : (
        <div style={PAY_PANEL}>
          <div style={PAY_PANEL_HEAD}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: INK.micro }}>
              Pay with
            </span>
            <span style={SECURE_BADGE}>
              <LockIcon />
              Secured by Stripe
            </span>
          </div>

          <div style={{ padding: "16px 18px 4px" }}>
            {/* The mount point is never unmounted or moved by `ready` — the
                skeleton overlays it instead, so Stripe's iframe is not torn
                down underneath itself. */}
            <div style={{ position: "relative", minHeight: 216 }}>
              <div ref={mountRef} />
              {!ready && <PaymentSkeleton />}
            </div>
          </div>

          <div style={PAY_PANEL_FOOT}>
            {payError && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: DANGER, margin: "0 0 12px" }}>{payError}</p>}
            <button
              type="button"
              onClick={pay}
              disabled={!ready || paying || confirming || chargeCents === null}
              style={{
                width: "100%",
                height: 38,
                border: 0,
                borderRadius: 6,
                background: BRAND.blue,
                color: BRAND.white,
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 600,
                cursor: !ready || paying || confirming || chargeCents === null ? "not-allowed" : "pointer",
                opacity: !ready || paying || confirming || chargeCents === null ? 0.6 : 1,
                transition: "opacity 160ms",
              }}
            >
              {confirming
                ? "Confirming…"
                : paying
                  ? "Processing…"
                  : chargeCents === null
                    ? "Preparing your total…"
                    : `Pay ${money(chargeCents / 100)} securely`}
            </button>
          </div>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: INK.deemphasised }}>
        Card details go straight to Stripe from your browser and never touch our servers. You stay on this page the whole way through.
      </p>
    </div>
  );
}

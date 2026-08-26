import { useEffect, useRef, useState } from "react";
import { Button } from "@/pages/home/dsComponents";
import { logger } from "@/lib/logger";

/**
 * Reusable inline Stripe Payment Element (#1306) — the real, working pattern
 * extracted verbatim from AssessmentFlow.tsx's PaymentStep (#435/#482), where
 * it takes the live $5,000 Copilot Readiness Assessment payment.
 *
 * This component owns everything between "the server has minted a
 * PaymentIntent" and "the buyer's card charge succeeded": booting stripe.js
 * from Stripe's own domain, mounting the themed Payment Element, and running
 * `confirmPayment` with `redirect: "if_required"` so the buyer never leaves
 * the page. Everything either side of that is the caller's job — creating the
 * intent, recording the confirmation server-side, and deciding what the order
 * summary around this panel looks like. That is why the props are generic
 * (clientSecret / publishableKey / onSuccess / onError) rather than anything
 * about what is being sold.
 *
 * `onSuccess(paymentIntentId)` may be async: the caller typically confirms the
 * payment against its own server inside it. If it throws, the thrown message
 * is shown in the panel's own error slot and the buyer can retry — exactly the
 * contract PaymentStep's confirm-on-server path has always had.
 */

const log = logger.child({ channel: "billing" });

// ── stripe.js (#435) ──────────────────────────────────────────────────────────
// Loaded from Stripe's own domain rather than bundled — required by Stripe and
// the reason no @stripe/* npm package is needed for the Payment Element.

export interface StripeElement {
  mount: (target: HTMLElement) => void;
  destroy: () => void;
}
export interface StripeElements {
  create: (type: "payment", options?: Record<string, unknown>) => StripeElement;
}
export interface StripeInstance {
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

export function loadStripeJs(): Promise<void> {
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

// ── Field styling constants ───────────────────────────────────────────────────

// #482: the Payment Element is a cross-origin iframe — no stylesheet on this
// page can reach inside it, so the only way it can match our own fields is to
// be handed the same numbers through Stripe's appearance API. These constants
// are the single source for both sides, so the two cannot drift apart. They
// are exported for exactly that reason: a page that renders its own fields
// next to this panel (AssessmentFlow does) styles them from here.
export const FIELD_BG = "rgba(2,6,23,.6)";
export const FIELD_BG_FOCUS = "rgba(2,6,23,.85)";
export const FIELD_BORDER = "rgba(51,65,85,.9)";
export const FIELD_BORDER_HOVER = "rgba(71,85,105,.95)";
export const FIELD_RADIUS = 10;
export const FIELD_PADDING = "13px 15px";
export const FIELD_FONT_SIZE = 15;
export const HAIRLINE = "rgba(30,41,59,.9)";
export const ACCENT = "#3B82F6";
export const ACCENT_SOFT = "rgba(37,99,235,.14)";
export const ACCENT_EDGE = "rgba(37,99,235,.32)";
export const ACCENT_BLUE_SOFT = "#5B8DEF";
export const ACCENT_VIOLET = "#9B7CFF";
// The site's primary accent sweep (Home.tsx's hero gradient), reused as the
// panel's top edge so the payment step reads as part of the same page.
export const ACCENT_GRADIENT = `linear-gradient(96deg,${ACCENT_BLUE_SOFT} 0%,${ACCENT_VIOLET} 100%)`;
export const TEXT_STRONG = "#f1f5f9";
export const TEXT_BODY = "#cbd5e1";
export const TEXT_MUTED = "#64748b";
export const TEXT_FAINT = "#475569";
export const DANGER = "#fca5a5";

// ── Stripe Payment Element theming (#482) ─────────────────────────────────────
// Every selector and every property below is drawn from Stripe's documented
// appearance allowlist — an unsupported one is not ignored, it throws at mount
// and takes the whole payment form down with it, so nothing here is guessed.
// Deliberately absent: gradients (`backgroundImage` is not on the allowlist at
// any selector), which is why the blue→violet accent lives on the panel we own
// around the iframe rather than inside it.

export const FOCUS_RING = "0 0 0 3px rgba(59,130,246,.22)";
export const TAB_TRANSITION = "background-color .18s ease,border-color .18s ease,box-shadow .18s ease,color .18s ease";

// The Element renders in a cross-origin iframe, so `fontFamily: "inherit"` —
// what this config used to pass — has nothing to inherit from and resolves to
// the iframe document's default serif. That is why the payment step rendered in
// Times while the rest of the site is Inter. The family has to be named
// outright, and the webfont has to be loaded *into* the iframe by Stripe, which
// is what the `fonts` option below does (same Google Fonts stylesheet index.html
// already loads for the page itself, so it is served from cache).
export const STRIPE_FONT_STACK = "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif";
export const STRIPE_FONTS = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
] as const;

export const STRIPE_APPEARANCE = {
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
    colorText: TEXT_STRONG,
    colorTextSecondary: TEXT_MUTED,
    // Deliberately the muted tone rather than the fainter footnote one — this is
    // a form the buyer has to read while typing a card number into it.
    colorTextPlaceholder: TEXT_MUTED,
    colorDanger: DANGER,
    colorSuccess: "#34d399",
    colorWarning: "#fbbf24",
    accessibleColorOnColorPrimary: "#ffffff",
    labelColorText: TEXT_MUTED,
    labelFontSize: "11px",
    labelFontWeight: "600",
    inputColorBorder: FIELD_BORDER,
    inputFocusColorBorder: ACCENT,
    inputBoxShadow: "none",
    inputFocusBoxShadow: FOCUS_RING,
    focusBoxShadow: FOCUS_RING,
    focusOutline: "none",
    iconColor: TEXT_MUTED,
    iconHoverColor: TEXT_BODY,
    iconChevronDownColor: TEXT_MUTED,
    iconChevronDownHoverColor: TEXT_BODY,
    iconCheckmarkColor: "#ffffff",
    tabIconColor: TEXT_MUTED,
    tabIconHoverColor: TEXT_BODY,
    tabIconSelectedColor: "#93c5fd",
    tabIconMoreColor: TEXT_MUTED,
    tabIconMoreHoverColor: TEXT_BODY,
  },
  rules: {
    // Payment-method tabs, in the step rail's own chip language (AssessmentFlow
    // lines ~746): translucent slate at rest, blue ring over a blue wash when
    // selected.
    ".Tab": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: "12px",
      boxShadow: "none",
      color: TEXT_MUTED,
      padding: "12px 14px",
      transition: TAB_TRANSITION,
    },
    ".Tab:hover": {
      backgroundColor: "rgba(15,23,42,.75)",
      borderColor: FIELD_BORDER_HOVER,
      boxShadow: "none",
      color: TEXT_BODY,
    },
    ".Tab:focus": {
      borderColor: ACCENT,
      boxShadow: FOCUS_RING,
      outline: "none",
    },
    ".Tab--selected": {
      backgroundColor: ACCENT_SOFT,
      borderColor: ACCENT,
      boxShadow: `0 0 0 1px ${ACCENT_EDGE},0 8px 20px -12px rgba(59,130,246,.85)`,
      color: "#e2e8f0",
    },
    ".TabIcon": { transition: "fill .18s ease,color .18s ease" },
    ".TabLabel": { fontSize: "13px", fontWeight: "600", letterSpacing: ".01em" },

    // Field labels — the same uppercase micro-label every other field in this
    // flow uses (labelStyle in AssessmentFlow), which is most of what stops the
    // iframe reading as a bolted-on third-party widget.
    ".Label": {
      color: TEXT_MUTED,
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: ".12em",
      textTransform: "uppercase",
    },
    ".Label--invalid": { color: DANGER },

    // Inputs — numerically identical to fieldStyle(), plus the focus ring our
    // own fields never had.
    ".Input": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: `${FIELD_RADIUS}px`,
      boxShadow: "none",
      color: TEXT_STRONG,
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
    ".Input::placeholder": { color: TEXT_MUTED },
    ".Error": { color: DANGER, fontSize: "12.5px", marginTop: "7px" },

    // Surfaces the Element only renders for some payment methods — themed up
    // front so an unfamiliar method never falls back to stock Stripe chrome.
    ".Block": {
      backgroundColor: "rgba(2,6,23,.5)",
      border: `1px solid ${HAIRLINE}`,
      borderRadius: "14px",
      boxShadow: "none",
    },
    ".BlockDivider": { backgroundColor: HAIRLINE },
    ".AccordionItem": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: "12px",
      boxShadow: "none",
      color: TEXT_BODY,
      padding: "14px 16px",
    },
    ".AccordionItem--selected": {
      backgroundColor: ACCENT_SOFT,
      borderColor: ACCENT,
      color: TEXT_STRONG,
    },
    ".PickerItem": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: `${FIELD_RADIUS}px`,
      boxShadow: "none",
      color: TEXT_BODY,
    },
    ".PickerItem--selected": {
      backgroundColor: ACCENT_SOFT,
      borderColor: ACCENT,
      color: TEXT_STRONG,
    },
    ".CheckboxInput": {
      backgroundColor: FIELD_BG,
      border: `1px solid ${FIELD_BORDER}`,
      borderRadius: "5px",
      boxShadow: "none",
      transition: "background-color .16s ease,border-color .16s ease",
    },
    ".CheckboxInput--checked": { backgroundColor: ACCENT, borderColor: ACCENT },
    ".CheckboxLabel": { color: "#94a3b8", fontSize: "13px", lineHeight: "1.5" },
    ".RadioIconOuter": { stroke: FIELD_BORDER, transition: "stroke .16s ease" },
    ".RadioIconOuter--checked": { stroke: ACCENT },
    ".RadioIconInner": { fill: ACCENT },
    ".Menu": { padding: "6px" },
    ".MenuAction": {
      backgroundColor: "transparent",
      borderRadius: "8px",
      color: TEXT_BODY,
      fontSize: "13.5px",
      padding: "9px 11px",
      transition: "background-color .14s ease,color .14s ease",
    },
    ".MenuAction:hover": { backgroundColor: ACCENT_SOFT, color: TEXT_STRONG },
    ".Dropdown": {
      border: `1px solid ${HAIRLINE}`,
      borderRadius: "12px",
      boxShadow: "0 18px 40px -20px rgba(2,6,23,.95)",
    },
    ".DropdownItem": {
      backgroundColor: "transparent",
      borderRadius: "8px",
      color: TEXT_BODY,
      fontSize: "14px",
      padding: "9px 11px",
    },
    ".DropdownItem--highlight": { backgroundColor: ACCENT_SOFT, color: TEXT_STRONG },
  },
} as const;

// Tabs, stated rather than inherited: the layout Stripe defaults to today is
// the one this theming was designed against, and a dashboard-side default
// change should not silently restyle the step.
export const STRIPE_PAYMENT_ELEMENT_OPTIONS = { layout: { type: "tabs" } } as const;

// ── Panel chrome ──────────────────────────────────────────────────────────────

export const PAY_PANEL: React.CSSProperties = {
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 16,
  background: "rgba(2,6,23,.5)",
  maxWidth: 480,
  overflow: "hidden",
};
export const PAY_PANEL_ACCENT: React.CSSProperties = {
  height: 2,
  backgroundImage: ACCENT_GRADIENT,
};
export const PAY_PANEL_HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 20px 14px",
  borderBottom: `1px solid ${HAIRLINE}`,
};
export const PAY_PANEL_FOOT: React.CSSProperties = {
  padding: "16px 20px 18px",
  borderTop: `1px solid ${HAIRLINE}`,
};

export const SECURE_BADGE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".04em",
  color: TEXT_MUTED,
};

const PANEL_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: TEXT_MUTED,
  marginBottom: 0,
};

export function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={TEXT_MUTED}
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

/**
 * Holds the panel's shape while Stripe's iframe boots (#482).
 *
 * It stands in for the tab row and the field rows the Element is about to
 * render, so the card does not resize under the buyer the moment it mounts.
 * It is decoration only — the real loading state is announced in text beneath
 * it, because a shape that resembles a card form is not a claim that one has
 * loaded.
 */
export function PaymentSkeleton() {
  const bar = (height: number, radius: number, width: string): React.CSSProperties => ({
    height,
    width,
    borderRadius: radius,
    background: "rgba(15,23,42,.75)",
    border: `1px solid ${HAIRLINE}`,
    boxSizing: "border-box",
  });
  const field = (
    <div>
      <div style={{ ...bar(8, 4, "78px"), border: "none", background: HAIRLINE, marginBottom: 11 }} />
      <div style={bar(46, FIELD_RADIUS, "100%")} />
    </div>
  );
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div aria-hidden="true" style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <div style={bar(46, 12, "100%")} />
        <div style={bar(46, 12, "100%")} />
        <div style={bar(46, 12, "100%")} />
      </div>
      <div aria-hidden="true" style={{ display: "grid", gap: 18 }}>
        {field}
        {field}
      </div>
      <p style={{ fontSize: 12.5, color: TEXT_FAINT, margin: "16px 0 0" }}>Loading secure card fields…</p>
    </div>
  );
}

// ── The component ─────────────────────────────────────────────────────────────

export interface StripePaymentElementProps {
  /** The PaymentIntent's client secret, minted by the caller's own server. */
  clientSecret: string;
  publishableKey: string;
  /**
   * Fired once the charge has genuinely succeeded. May be async — a thrown
   * error is shown in the panel's error slot and the buyer can press Pay again.
   */
  onSuccess: (paymentIntentId: string) => void | Promise<void>;
  /** Fired with the same message every buyer-visible error shows. */
  onError?: (message: string) => void;
}

export function StripePaymentElement({ clientSecret, publishableKey, onSuccess, onError }: StripePaymentElementProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  // The callbacks ride in refs so the mount effect keys on the secret alone:
  // a caller passing an inline closure must not tear the iframe down and
  // remount it on every render.
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const fail = (setter: (m: string) => void, message: string) => {
    setter(message);
    onErrorRef.current?.(message);
  };

  // Boot stripe.js and mount the Payment Element.
  useEffect(() => {
    let cancelled = false;
    let element: StripeElement | null = null;

    (async () => {
      try {
        await loadStripeJs();
        if (cancelled || !window.Stripe || !mountRef.current) return;

        const stripe = window.Stripe(publishableKey);
        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret,
          appearance: STRIPE_APPEARANCE,
          fonts: STRIPE_FONTS,
        });
        elementsRef.current = elements;
        element = elements.create("payment", STRIPE_PAYMENT_ELEMENT_OPTIONS);
        element.mount(mountRef.current);
        setReady(true);
        log.info({}, "payment element mounted");
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Could not load the payment form.";
          log.error({ err: message }, "payment element failed to mount");
          fail(setInitError, message);
        }
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
  }, [clientSecret, publishableKey]);

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
        const message = result.error.message ?? "Your payment could not be completed.";
        log.warn({ message }, "confirmPayment declined");
        fail(setPayError, message);
        return;
      }
      if (!result.paymentIntent?.id || result.paymentIntent.status !== "succeeded") {
        log.warn({ status: result.paymentIntent?.status ?? null }, "confirmPayment returned without success");
        fail(setPayError, "Your payment is still processing. We'll email you as soon as it clears.");
        return;
      }
      log.info({ paymentIntentId: result.paymentIntent.id }, "payment succeeded");
      await onSuccessRef.current(result.paymentIntent.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong taking the payment.";
      log.error({ err: message }, "post-payment handling failed");
      fail(setPayError, message);
    } finally {
      setPaying(false);
    }
  }

  if (initError) {
    return <div style={{ fontSize: 13.5, lineHeight: 1.55, color: DANGER, maxWidth: 480 }}>{initError}</div>;
  }

  return (
    // #482: the Element is given a panel of its own rather than being dropped
    // bare onto the page — card language the caller's order summary can match,
    // so the two read as one payment surface.
    <div style={PAY_PANEL}>
      <div style={PAY_PANEL_ACCENT} />
      <div style={PAY_PANEL_HEAD}>
        <span style={PANEL_LABEL}>Pay with</span>
        <span style={SECURE_BADGE}>
          <LockIcon />
          Secured by Stripe
        </span>
      </div>

      <div style={{ padding: "18px 20px 4px" }}>
        {/* The mount point is never unmounted or moved by `ready` — the
            skeleton overlays it instead, so Stripe's iframe is not torn
            down underneath itself. */}
        <div style={{ position: "relative", minHeight: 232 }}>
          <div ref={mountRef} />
          {!ready && <PaymentSkeleton />}
        </div>
      </div>

      <div style={PAY_PANEL_FOOT}>
        {payError && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: DANGER, margin: "0 0 12px" }}>{payError}</p>}
        {/* No price on the button — #430: it is shown once, by the caller. */}
        <Button size="lg" onClick={pay} disabled={!ready || paying} style={{ width: "100%" }}>
          {paying ? "Processing…" : "Pay securely"}
        </Button>
      </div>
    </div>
  );
}

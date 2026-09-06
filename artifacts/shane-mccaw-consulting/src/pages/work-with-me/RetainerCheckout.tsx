import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Lock } from "lucide-react";

/**
 * The real embedded Stripe checkout for one Architect Retainer tier, mounted
 * inline inside the expanded accordion row on Work With Me (#2955). It ports the
 * never-redirects Payment Element pattern from the assessment flow
 * (home/AssessmentFlow.tsx PaymentStep) to the retainer-scoped subscription
 * route: create a default_incomplete Subscription server-side, confirm its first
 * invoice's PaymentIntent in-page with stripe.js, and NEVER leave the site.
 *
 * The card is collected by Stripe's Payment Element (a cross-origin iframe), not
 * by the plain inputs the design prototype drew — those were an illustration of
 * where the card goes; this is the real thing, themed to match the design's own
 * field styling so it reads as part of the page.
 *
 * Right-column states track the design exactly: idle (email + Payment Element +
 * pay) → processing ("Confirming with Stripe…") → done (teal "Retainer started").
 */

// ── stripe.js, loaded from Stripe's own domain (required; no @stripe/* bundle) ─
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
  }) => Promise<{ error?: { message?: string }; paymentIntent?: { id: string; status: string } }>;
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

// The Payment Element renders in a cross-origin iframe, so it can only be styled
// through Stripe's appearance API — these numbers mirror the design's own field
// styling (dark-slate fields, #0078D4 accent, 9px radius) so the two match.
const STRIPE_FONTS = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
] as const;

const STRIPE_APPEARANCE = {
  theme: "night",
  labels: "above",
  variables: {
    fontFamily: "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif",
    fontSizeBase: "14px",
    borderRadius: "9px",
    colorPrimary: "#0078D4",
    // Stripe's appearance variables reject alpha here (HEX/rgb()/hsl() only) — an
    // rgba() value is invalid and Stripe drops the whole appearance object, which
    // (combined with the confirm-time bug fixed below) is what broke checkout. This
    // opaque slate is the closest match to the former translucent rgba(2,6,23,.55)
    // surface composited over the card's dark gradient.
    colorBackground: "#0b1120",
    colorText: "#f1f5f9",
    colorTextSecondary: "#94a3b8",
    colorTextPlaceholder: "#64748b",
    colorDanger: "#fca5a5",
    spacingUnit: "4px",
  },
  rules: {
    ".Label": { color: "#cbd5e1", fontSize: "13px", fontWeight: "500" },
    ".Input": {
      backgroundColor: "rgba(2,6,23,0.55)",
      border: "1px solid rgba(148,163,184,0.28)",
      borderRadius: "9px",
      color: "#f1f5f9",
      padding: "11px 12px",
    },
    ".Input:focus": {
      borderColor: "#0078D4",
      boxShadow: "0 0 0 3px rgba(0,120,212,0.25)",
    },
    ".Input--invalid": { borderColor: "#fca5a5" },
    ".Tab": {
      backgroundColor: "rgba(2,6,23,0.55)",
      border: "1px solid rgba(148,163,184,0.28)",
      borderRadius: "9px",
      color: "#94a3b8",
    },
    ".Tab--selected": {
      backgroundColor: "rgba(0,120,212,0.14)",
      borderColor: "#0078D4",
      color: "#f1f5f9",
    },
  },
} as const;

const STRIPE_PAYMENT_ELEMENT_OPTIONS = { layout: { type: "tabs" } } as const;

// Hard ceiling on how long the buyer waits on "Confirming with Stripe…" before we
// give up and show an error. confirmPayment() normally resolves in a second or two;
// if a Stripe integration hiccup ever leaves it unresolved, this stops the spinner
// from running forever with no feedback (see pay() below).
const CONFIRM_TIMEOUT_MS = 20_000;

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 9,
  border: "1px solid rgba(148,163,184,.28)",
  background: "rgba(2,6,23,.55)",
  color: "#f1f5f9",
  fontFamily: "inherit",
  fontSize: 14,
  outline: "none",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One opaque order key per tier, surviving a reload so a retry recovers the
 *  same subscription rather than minting a second one (mirrors the assessment
 *  flow's sessionStorage session id). */
function orderKeyFor(slug: string): string {
  const key = `smc_retainer_order_${slug}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
  } catch {
    /* private browsing — fall through to a fresh, in-memory key */
  }
  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    sessionStorage.setItem(key, fresh);
  } catch {
    /* private browsing */
  }
  return fresh;
}

function clearOrderKey(slug: string): void {
  try {
    sessionStorage.removeItem(`smc_retainer_order_${slug}`);
  } catch {
    /* private browsing */
  }
}

export interface RetainerTier {
  slug: string;
  name: string;
  priceText: string;
  hoursText: string;
  payLabel: string;
}

const CHECK_ITEMS = [
  "Live 1:1 working sessions with Shane",
  "Written findings after each session",
  "Architecture and roadmap review",
  "Async questions between sessions",
  "Time logged in a shared record you can open any time",
];

export function RetainerCheckout({ tier }: { tier: RetainerTier }) {
  // Only two states live here: the payment form stays mounted until the
  // subscription is active, then it is replaced by the "Retainer started" panel.
  // The interim "Confirming with Stripe…" state is deliberately owned by the form
  // (rendered as an overlay) rather than swapped in here — swapping it in used to
  // unmount the Payment Element mid-confirm, which made confirmPayment throw
  // "could not retrieve data from the specified Element" and hang the spinner.
  const [done, setDone] = useState(false);

  return (
    <div
      style={{
        margin: "0 0 28px",
        border: "1px solid rgba(0,120,212,.35)",
        borderRadius: 16,
        background: "linear-gradient(160deg,rgba(10,37,64,.55),rgba(2,6,23,.6) 70%)",
        padding: "clamp(20px,4vw,32px)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
        gap: "clamp(24px,4vw,44px)",
      }}
    >
      {/* LEFT — what you're starting */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#00B4D8" }}>
          You're starting
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#f8fafc", margin: "12px 0 6px", letterSpacing: "-.01em" }}>
          {tier.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.03em", color: "#f8fafc" }}>{tier.priceText}</span>
          <span style={{ fontSize: 14, color: "#94a3b8" }}>
            per month · {tier.hoursText} hours of Shane's time
          </span>
        </div>
        <ul style={{ listStyle: "none", margin: "22px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {CHECK_ITEMS.map((item) => (
            <li key={item} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5, color: "#cbd5e1" }}>
              <Check className="w-4 h-4" strokeWidth={2.5} style={{ color: "#00B4D8", flexShrink: 0, marginTop: 2 }} />
              {item}
            </li>
          ))}
        </ul>
        <p style={{ margin: "20px 0 0", fontSize: 13, lineHeight: 1.55, color: "#94a3b8" }}>
          Hours reset each month. Cancel with 30 days' notice. Not available to NASA contractors, subcontractors or partners.
        </p>
      </div>

      {/* RIGHT — the real embedded checkout */}
      <div>
        {!done ? (
          <RetainerPaymentForm tier={tier} onPaid={() => setDone(true)} />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 12,
              minHeight: 260,
              border: "1px solid rgba(0,180,216,.3)",
              background: "rgba(0,180,216,.06)",
              borderRadius: 14,
              padding: 24,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: "#00B4D8" }}>
              Retainer started
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>{tier.name} is active.</div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#cbd5e1" }}>
              A receipt is on its way to your inbox. Shane will reach out directly to schedule the first session and take the first set
              of questions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The idle-state right column: Work email + Stripe Payment Element + pay button.
 * Creates the subscription on mount, mounts the Element once an email is known,
 * confirms in-page on pay, and reports up when processing starts and when the
 * subscription is active.
 */
function RetainerPaymentForm({
  tier,
  onPaid,
}: {
  tier: RetainerTier;
  onPaid: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const bootedRef = useRef(false);

  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  // True while confirmPayment is in flight. Drives the "Confirming with Stripe…"
  // overlay WITHOUT unmounting the Payment Element — the Element must stay mounted
  // for confirmPayment to read it.
  const [paying, setPaying] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());

  const confirmOnServer = useCallback(
    async (subId: string) => {
      const res = await fetch("/api/public/retainers/payment-confirmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subId, orderKey: orderKeyFor(tier.slug) }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error === "subscription_not_active"
            ? "Your bank has not confirmed the payment yet. Please wait a moment and try again."
            : "We took the payment but could not record it. Please contact Shane before paying again.",
        );
      }
      clearOrderKey(tier.slug);
      onPaid();
    },
    [tier.slug, onPaid],
  );

  // Create the subscription + boot stripe.js + mount the Payment Element. Runs
  // once the buyer has entered a valid email and pressed "Continue" (the email
  // is needed to create the Stripe customer the subscription hangs off).
  const boot = useCallback(async () => {
    if (bootedRef.current || !emailValid) return;
    bootedRef.current = true;
    setEmailLocked(true);
    setBooting(true);
    setInitError(null);
    try {
      const res = await fetch("/api/public/retainers/payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: tier.slug, email: email.trim().toLowerCase(), orderKey: orderKeyFor(tier.slug) }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        bootedRef.current = false;
        setEmailLocked(false);
        setInitError(
          err.error === "payment_unavailable"
            ? "Card payment is temporarily unavailable. Please contact Shane and he'll take it from here."
            : err.error === "email_invalid"
              ? "That email doesn't look right. Please check it and try again."
              : "We could not prepare the payment. Please try again shortly.",
        );
        return;
      }
      const data = (await res.json()) as {
        clientSecret: string | null;
        publishableKey: string;
        subscriptionId: string;
        alreadyActive: boolean;
      };
      setSubscriptionId(data.subscriptionId);

      // Recovered an already-active subscription (paid, then reloaded before the
      // confirm callback landed) — finish rather than asking for a second card.
      if (data.alreadyActive || !data.clientSecret) {
        await confirmOnServer(data.subscriptionId);
        return;
      }

      await loadStripeJs();
      if (!window.Stripe || !mountRef.current) return;
      const stripe = window.Stripe(data.publishableKey);
      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret: data.clientSecret,
        appearance: STRIPE_APPEARANCE,
        fonts: STRIPE_FONTS,
      });
      elementsRef.current = elements;
      const element = elements.create("payment", STRIPE_PAYMENT_ELEMENT_OPTIONS);
      element.mount(mountRef.current);
      setReady(true);
    } catch (err) {
      bootedRef.current = false;
      setEmailLocked(false);
      setInitError(err instanceof Error ? err.message : "Could not load the payment form.");
    } finally {
      setBooting(false);
    }
  }, [emailValid, email, tier.slug, confirmOnServer]);

  async function pay() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements || !subscriptionId || paying) return;
    setPaying(true);
    setPayError(null);

    // Safety net: if confirmPayment() never settles (a Stripe integration hiccup can
    // leave it unresolved), surface an error after CONFIRM_TIMEOUT_MS instead of
    // spinning forever. `timedOut` makes a late result a no-op once we've given up.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      setPaying(false);
      setPayError("This is taking longer than expected. Please try again, or contact Shane if it keeps happening.");
    }, CONFIRM_TIMEOUT_MS);

    try {
      const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
      clearTimeout(timeout);
      if (timedOut) return;
      if (result.error) {
        setPaying(false);
        setPayError(result.error.message ?? "Your payment could not be completed.");
        return;
      }
      if (result.paymentIntent?.status !== "succeeded") {
        setPaying(false);
        setPayError("Your payment is still processing. We'll email you as soon as it clears.");
        return;
      }
      // Success: keep the overlay up (no setPaying(false)) — confirmOnServer flips
      // the parent to the "Retainer started" panel, which unmounts this form.
      await confirmOnServer(subscriptionId);
    } catch (err) {
      clearTimeout(timeout);
      if (timedOut) return;
      setPaying(false);
      setPayError(err instanceof Error ? err.message : "Something went wrong taking the payment.");
    }
  }

  useEffect(() => {
    return () => {
      // The Element is torn down with the component when the row collapses.
      elementsRef.current = null;
      stripeRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 500, color: "#cbd5e1" }}>
        Work email
        <input
          type="email"
          value={email}
          disabled={emailLocked}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && emailValid && !emailLocked) void boot();
          }}
          placeholder="you@yourcompany.com"
          style={{ ...INPUT_STYLE, opacity: emailLocked ? 0.7 : 1 }}
        />
      </label>

      {/* Before the card form is booted, one button turns the email into the
          subscription + Payment Element. After, the mounted Element shows here. */}
      {!emailLocked ? (
        <button
          type="button"
          onClick={() => void boot()}
          disabled={!emailValid || booting}
          style={{
            minHeight: 50,
            width: "100%",
            fontSize: 15,
            fontWeight: 600,
            borderRadius: 10,
            background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
            border: "none",
            color: "#fff",
            cursor: emailValid && !booting ? "pointer" : "not-allowed",
            opacity: emailValid && !booting ? 1 : 0.6,
          }}
        >
          {booting ? "Preparing…" : "Continue to payment"}
        </button>
      ) : (
        <>
          <div style={{ position: "relative", minHeight: 220 }}>
            <div ref={mountRef} />
            {!ready && !initError && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 220, gap: 10, color: "#94a3b8" }}>
                <Loader2 className="w-6 h-6" style={{ color: "#0078D4", animation: "smcSpin 1s linear infinite" }} />
                <span style={{ fontSize: 14 }}>Loading secure payment…</span>
              </div>
            )}
          </div>
          {payError && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fca5a5", margin: 0 }}>{payError}</p>}
          <button
            type="button"
            onClick={() => void pay()}
            disabled={!ready || paying}
            style={{
              minHeight: 50,
              width: "100%",
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 10,
              background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
              border: "none",
              color: "#fff",
              cursor: ready && !paying ? "pointer" : "not-allowed",
              opacity: ready && !paying ? 1 : 0.6,
            }}
          >
            {tier.payLabel}
          </button>
        </>
      )}

      {initError && <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#fca5a5", margin: 0 }}>{initError}</p>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, lineHeight: 1.5, color: "#94a3b8" }}>
        <Lock className="w-3 h-3" style={{ flexShrink: 0 }} />
        Secured by Stripe. The same checkout as the Copilot Readiness Assessment. Billed monthly until you cancel.
      </div>

      {/* "Confirming with Stripe…" — an overlay, not a swapped-in view, so the
          Payment Element stays mounted underneath while confirmPayment runs. */}
      {paying && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            textAlign: "center",
            background: "rgba(2,6,23,.78)",
            borderRadius: 12,
          }}
        >
          <Loader2 className="w-7 h-7" style={{ color: "#0078D4", animation: "smcSpin 1s linear infinite" }} />
          <div style={{ fontSize: 15, color: "#e2e8f0" }}>Confirming with Stripe…</div>
        </div>
      )}
    </div>
  );
}

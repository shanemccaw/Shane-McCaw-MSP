import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ShieldCheck,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Mail,
  Radar,
  Building2,
} from "lucide-react";

/**
 * Consent Success — the single consolidated "consent granted + confirm" step.
 *
 * The Microsoft admin-consent callback (api-server routes/consent.ts) redirects
 * here after the tenant's Global Admin clicks Accept. THAT redirect and the
 * cross-origin session-survival mechanism (checkout_session_id in sessionStorage
 * + checkout_guest_<id> in localStorage, both written by the public checkout and
 * shared because /portal and /checkout are the same origin) are fragile,
 * confirmed-working infrastructure — this page reads that state but never changes
 * how it survives the redirect.
 *
 * Previously this page was a thin interstitial: it acknowledged consent and
 * bounced the buyer BACK to the public checkout's separate "Confirm" step to
 * finalize. That was two pages for one handoff moment. This page now IS the
 * single step: for a direct-website free order it finalizes inline (same guest
 * contract + /portal/checkout/free endpoints the public checkout calls — no
 * backend change), then hands off to the emailed account-setup link. Paid orders
 * still route to the public checkout for the Stripe redirect (that step can't be
 * collapsed away).
 *
 * isDirectBusiness: a checkout session (the `session` param) always belongs to
 * the isDirectBusiness MSP — checkout_sessions has no mspId, and consent.ts's
 * cross-MSP guard rejects any tenant already owned by a different MSP before we
 * ever reach this page. So `session` present ⟺ a direct Shane McCaw Consulting
 * purchase with NO reseller MSP involved; `session` absent ⟺ the MSP invite-link
 * flow, where a reseller genuinely WAS notified. That distinction drives the
 * notification language below (the previously-unconditional "Your MSP has been
 * notified" was false for every direct-business buyer).
 */

// ── CAPTCHA gate (Cloudflare Turnstile; dev-bypass when unconfigured) ───────────
// Mirrors the consulting-app checkout and AssessmentPaymentPlan so this finalize
// sends a real token when VITE_TURNSTILE_SITE_KEY is set (server verifies it) and
// a bypass token in dev where the server's verifyCaptchaToken also bypasses.
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}
function CaptchaGate({ onVerify }: { onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey) {
      onVerify("DEV_BYPASS_TOKEN");
      return;
    }
    if (!window.turnstile) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    let widgetId: string | undefined;
    const renderWidget = () => {
      if (window.turnstile && containerRef.current) {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
        });
      } else {
        setTimeout(renderWidget, 100);
      }
    };
    renderWidget();
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}

interface CheckoutSessionInfo {
  productSlug: string;
  status: string;
  seats: number;
}

/** The subset of the public /api/services catalog entry this page needs. */
interface CatalogService {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  basePrice: string | null;
  priceCents: number | null;
  isFreeOffering: boolean | null;
  /**
   * Per-type pricing (monitoring tiers, recurring add-ons). A monitoring tier's
   * ENTIRE price lives here (pricePerUserMonth × seats) with price/basePrice/
   * priceCents all NULL — serviceIsFree below must read it or every monitoring
   * tier is judged free and inline-finalized without Stripe (the second live
   * Stripe-bypass bug, hit by a real Enhanced Monitoring purchase).
   */
  typeAttributes: Record<string, unknown> | null;
}

/** guestInfo cached by the public checkout at guest-info submit — same origin. */
interface GuestInfoCache {
  name: string;
  email: string;
  termsAccepted: boolean;
}

const GUEST_INFO_CACHE_PREFIX = "checkout_guest_";
const SESSION_STORAGE_KEY = "checkout_session_id";

function loadGuestInfoCache(sessionId: string): GuestInfoCache | null {
  try {
    const raw = localStorage.getItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as GuestInfoCache;
  } catch {
    return null;
  }
}

function clearCheckoutCaches(sessionId: string): void {
  try {
    localStorage.removeItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
  } catch {
    /* localStorage may be unavailable */
  }
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* sessionStorage may be unavailable */
  }
}

const PRODUCT_NAMES: Record<string, string> = {
  "m365-jumpstart": "Microsoft 365 Jumpstart",
  "copilot-readiness": "Copilot AI Readiness Assessment",
  "sharepoint-intranet": "SharePoint Intranet Build",
  "governance-health": "Governance Health Check",
  "power-automate": "Power Platform Automation",
  "tenant-migration": "Microsoft 365 Tenant Migration",
};

function fallbackProductName(slug: string): string {
  return PRODUCT_NAMES[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * True when the catalog entry carries no positive price anywhere (free offering).
 *
 * Mirrors the server's isServiceFree (api-server lib/catalog-pricing.ts): every
 * pricing representation must be checked — the flat columns AND the
 * type_attributes pricing model. Monitoring tiers carry their entire price in
 * typeAttributes.pricePerUserMonth (+ optional flatMonthlySurcharge) with all
 * flat columns NULL; recurring add-ons use typeAttributes.flatMonthlyPrice.
 * Reading only the flat columns judged a paid Enhanced Monitoring tier "free"
 * and inline-finalized the order here without Stripe. The server-side
 * free-checkout guard independently rejects paid services, but this gate is
 * what routes a paid order to the public checkout's Stripe step instead of the
 * inline free finalize.
 */
function serviceIsFree(svc: CatalogService): boolean {
  const ta = (svc.typeAttributes ?? {}) as {
    pricePerUserMonth?: string | number | null;
    flatMonthlySurcharge?: string | number | null;
    flatMonthlyPrice?: string | number | null;
  };
  const positive = (v: string | number | null | undefined): boolean => {
    if (v == null || v === "") return false;
    const n = parseFloat(String(v));
    return !isNaN(n) && n > 0;
  };
  const hasPositivePrice =
    (svc.priceCents ?? 0) > 0 ||
    positive(svc.price) ||
    positive(svc.basePrice) ||
    positive(ta.pricePerUserMonth) ||
    positive(ta.flatMonthlySurcharge) ||
    positive(ta.flatMonthlyPrice);
  return svc.isFreeOffering === true || !hasPositivePrice;
}

export default function ConsentSuccessPage() {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const tenant = params.get("tenant");
  const sessionId = params.get("session");

  // `session` present ⟺ direct Shane McCaw Consulting purchase (no reseller MSP).
  const isDirectBusiness = !!sessionId;

  const [sessionInfo, setSessionInfo] = useState<CheckoutSessionInfo | null>(null);
  const [service, setService] = useState<CatalogService | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfoCache | null>(null);
  const [loading, setLoading] = useState(!!sessionId);

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [sentSetupEmail, setSentSetupEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the real purchase behind this consent: the checkout session (for the
  // slug + seats) and the catalog entry (for the numeric service id + free/paid).
  // Also recover the buyer's cached guest info so a free order can finalize here.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const sessRes = await fetch(
          `/api/public/checkout-session/${encodeURIComponent(sessionId)}`,
        );
        const sess = sessRes.ok ? ((await sessRes.json()) as CheckoutSessionInfo) : null;
        if (cancelled) return;
        setSessionInfo(sess);

        if (sess) {
          const svcRes = await fetch("/api/services");
          if (svcRes.ok) {
            const all = (await svcRes.json()) as CatalogService[];
            const match = all.find((s) => s.slug === sess.productSlug) ?? null;
            if (!cancelled) setService(match);
          }
        }

        const cached = loadGuestInfoCache(sessionId);
        if (!cancelled && cached) setGuestInfo(cached);
      } catch {
        /* fall back to the handoff button below */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const isFree = service ? serviceIsFree(service) : null;
  const productName = service?.name ?? (sessionInfo ? fallbackProductName(sessionInfo.productSlug) : null);
  const seats = sessionInfo?.seats ?? 1;

  // Inline finalize is possible only for a direct-business FREE order where we
  // recovered the buyer's info AND their earlier terms acceptance. Anything else
  // (paid = Stripe, wiped guest cache, unresolved catalog) falls back to the
  // public checkout, which has its own server-side session recovery.
  const termsAccepted = guestInfo?.termsAccepted === true;
  const canFinalizeInline =
    isDirectBusiness && isFree === true && !!service && !!guestInfo && termsAccepted;

  async function handleFinalize() {
    if (!service || !guestInfo || !captchaToken || !termsAccepted) return;
    setFinalizing(true);
    setError(null);
    try {
      // 1. Sign the guest contract (same guest endpoint the public checkout uses).
      const contractRes = await fetch("/api/portal/onboarding/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          guestEmail: guestInfo.email,
          signerName: guestInfo.name,
          seats,
          captchaToken,
        }),
      });
      if (!contractRes.ok) {
        const err = (await contractRes.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "We couldn't finalize your order. Please try again.");
        return;
      }
      const { contractIds } = (await contractRes.json()) as { contractIds: number[] };
      const contractId = contractIds?.[0];
      if (!contractId) {
        setError("We couldn't finalize your order. Please try again.");
        return;
      }

      // 2. Finalize the $0 order — provisions the account and emails the
      //    account-setup link (email-gated by design; we never expose the token).
      const freeRes = await fetch("/api/portal/checkout/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          contractIds: [contractId],
          guestEmail: guestInfo.email,
          captchaToken,
        }),
      });
      if (!freeRes.ok) {
        const err = (await freeRes.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "We couldn't complete your registration. Please try again.");
        return;
      }
      const done = (await freeRes.json()) as { ok: boolean; sentSetupEmail?: boolean };
      setSentSetupEmail(done.sentSetupEmail === true);
      if (sessionId) clearCheckoutCaches(sessionId);
      setFinalized(true);
    } catch {
      setError("A network error occurred. Please check your connection and try again.");
    } finally {
      setFinalizing(false);
    }
  }

  // Paid orders (and any free-order fallback) hand back to the public checkout,
  // which resolves the server-side session and completes the Confirm/Stripe step.
  function handleContinueToCheckout() {
    if (!sessionInfo) {
      window.location.href = "/portal/";
      return;
    }
    const seatsParam = sessionInfo.seats > 1 ? `&seats=${sessionInfo.seats}` : "";
    window.location.href = `${window.location.origin}/checkout/${encodeURIComponent(
      sessionInfo.productSlug,
    )}?session=${encodeURIComponent(sessionId ?? "")}${seatsParam}`;
  }

  // ── Finalized: order placed, account provisioning underway ───────────────────
  if (finalized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              You're all set{guestInfo?.name ? `, ${guestInfo.name.split(/\s+/)[0]}` : ""}!
            </h1>
            <p className="text-muted-foreground">
              Consent is granted{productName ? <> and <strong className="text-foreground">{productName}</strong> is confirmed</> : ""}. Your
              Microsoft 365 assessment scan has started against your tenant.
            </p>
          </div>

          {sentSetupEmail ? (
            <div className="rounded-lg border bg-card p-4 flex items-start gap-3 text-left">
              <Mail className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Check your email to finish
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We've emailed your account-setup link
                  {guestInfo?.email ? <> to <strong className="text-foreground">{guestInfo.email}</strong></> : ""}.
                  Click it to set your password — you're one step away from seeing your scan results.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-4 flex items-start gap-3 text-left">
              <Radar className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Your workspace is ready</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Sign in to the portal to watch your assessment complete and review your results.
                </p>
              </div>
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              window.location.href = "/portal/";
            }}
          >
            Go to portal
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Consolidated acknowledge + confirm ───────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
            <ShieldCheck className="h-8 w-8 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Consent Granted</h1>
          <p className="text-muted-foreground">
            Your organisation has been successfully connected to the platform.
          </p>
          {tenant && (
            <p className="text-xs font-mono text-muted-foreground/60 bg-muted px-3 py-1.5 rounded-md inline-block">
              Tenant: {tenant}
            </p>
          )}
        </div>

        {/* What just happened */}
        <Alert>
          <AlertDescription className="text-sm leading-relaxed">
            Your Microsoft 365 Global Administrator clicked <strong>Accept</strong> on the Microsoft
            permissions screen. The platform can now access your organisation's data according to the
            granted permissions.
          </AlertDescription>
        </Alert>

        {/* What happens next — branched on isDirectBusiness (see file header) */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">What happens next</h2>
          {isDirectBusiness ? (
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
              <li>Shane McCaw Consulting has your consent on file — no third party is involved.</li>
              <li>Your Microsoft 365 assessment scan has started against your tenant.</li>
              <li>
                {canFinalizeInline
                  ? "Confirm below to create your account and get your results."
                  : "Continue below to finish and set up your account."}
              </li>
            </ol>
          ) : (
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
              <li>Your MSP has been notified that consent was granted.</li>
              <li>Your organisation's Microsoft 365 data will begin syncing shortly.</li>
              <li>You can now sign in to the portal to view your dashboard and reports.</li>
            </ol>
          )}
        </div>

        {/* Loading the purchase behind this consent */}
        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your order…
          </div>
        )}

        {/* Order summary (direct-business, once resolved) */}
        {!loading && isDirectBusiness && productName && (
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">{productName}</p>
                {service?.tagline && (
                  <p className="text-sm text-muted-foreground mt-0.5">{service.tagline}</p>
                )}
              </div>
              {isFree === true && (
                <span className="text-sm font-semibold text-green-500 shrink-0">Free</span>
              )}
            </div>
            {guestInfo && (
              <div className="border-t pt-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">For:</span> {guestInfo.name} ·{" "}
                {guestInfo.email}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Primary action */}
        {!loading &&
          (canFinalizeInline ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <span>
                  You agreed to the Terms of Service and Privacy Policy earlier. Confirming will
                  register your account and start your onboarding — no payment required.
                </span>
              </div>
              <CaptchaGate onVerify={setCaptchaToken} />
              <Button
                className="w-full"
                onClick={handleFinalize}
                disabled={finalizing || !captchaToken}
              >
                {finalizing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up your account…
                  </>
                ) : (
                  <>
                    Confirm &amp; get started
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          ) : isDirectBusiness ? (
            // Paid order, or a free order whose cached info didn't survive —
            // hand back to the public checkout to complete the Confirm/Stripe step.
            <Button className="w-full" onClick={handleContinueToCheckout}>
              Continue to checkout{productName ? ` for ${productName}` : ""}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            // Reseller / invite-link flow — no purchase to finalize.
            <Button
              className="w-full"
              onClick={() => {
                window.location.href = "/portal/";
              }}
            >
              Go to portal
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ))}

        {/* Footer — contact language branched to the real relationship */}
        <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          {isDirectBusiness ? (
            <>
              <Building2 className="h-3.5 w-3.5" />
              Questions? Contact Shane McCaw Consulting.
            </>
          ) : (
            <>If you have any questions, please contact your MSP directly.</>
          )}
        </p>
      </div>
    </div>
  );
}

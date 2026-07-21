import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation, useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  AlertCircle,
  Clock,
  Users,
  XCircle,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { Button } from "@/components/ui/button";
import { CaptchaGate } from "@/components/CaptchaGate";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useCatalog, type MonitoringTier, type RetainerTier, type MspTier, type ConfigPackTier, type AssessmentOffer } from "@/hooks/useCatalog";
import { trackCheckoutStarted, trackCheckoutCompleted } from "@/lib/analytics";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

type AnyTier = MonitoringTier | RetainerTier | MspTier | ConfigPackTier | AssessmentOffer;

function tierToService(t: AnyTier) {
  const isFree = "isFree" in t ? t.isFree : false;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    price: "price" in t ? (t.price ?? ("basePrice" in t ? t.basePrice : null)) : null,
    billingType: "billingType" in t ? t.billingType : ("isFree" in t ? "one_time" as const : "one_time" as const),
    fulfillmentTypeKey: t.fulfillmentTypeKey,
    serviceType: "serviceType" in t ? t.serviceType : "assessment",
    typeAttributes: "typeAttributes" in t ? t.typeAttributes : null,
    isFree,
  };
}

type Step =
  | "loading"
  | "not-found"
  | "unavailable"
  | "catalog-error"
  | "guest-info"
  | "consent"
  | "payment"
  | "confirmed";

const WIZARD_STEPS: Step[] = ["guest-info", "consent", "payment", "confirmed"];
const STEP_LABELS: Record<string, string> = {
  "guest-info": "Your info",
  consent: "M365 access",
  payment: "Confirm",
  confirmed: "Confirmed",
};

function stepIndex(s: Step): number {
  return WIZARD_STEPS.indexOf(s);
}

const guestInfoSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  email: z.string().email("Please enter a valid email address"),
  // Terms acceptance is gated HERE — before the consent step is reachable — so a
  // visitor cannot initiate the Microsoft 365 admin-consent redirect (real tenant
  // access) without first agreeing to the Terms of Service (which incorporates the
  // DPA by reference) and Privacy Policy that govern how that tenant data is processed.
  termsAccepted: z.boolean().refine((v) => v === true, {
    message: "You must agree to the Terms of Service and Privacy Policy to continue",
  }),
});
type GuestInfo = z.infer<typeof guestInfoSchema>;

// ── Server-side session helpers ───────────────────────────────────────────────
// Only the UUID sessionId is stored client-side; PII lives on the server.
// This ensures the session survives the Microsoft admin-consent cross-origin redirect.

const SESSION_STORAGE_KEY = "checkout_session_id";

function loadSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    // sessionStorage may be unavailable
  }
}

function clearSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

async function createCheckoutSession(opts: {
  productSlug: string;
  fullName: string;
  email: string;
  seats: number;
}): Promise<string> {
  const res = await fetch("/api/public/checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to create checkout session");
  }
  const { sessionId } = (await res.json()) as { sessionId: string };
  return sessionId;
}

interface CheckoutSessionInfo {
  productSlug: string;
  status: string;
  seats: number;
}

async function fetchCheckoutSession(
  sessionId: string,
): Promise<CheckoutSessionInfo | null> {
  try {
    const res = await fetch(`/api/public/checkout-session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return (await res.json()) as CheckoutSessionInfo;
  } catch {
    return null;
  }
}

// ── localStorage guestInfo cache ──────────────────────────────────────────────
// Name and email are cached in localStorage (keyed by sessionId) so they survive
// cross-origin redirects (e.g. Microsoft admin-consent). The server never exposes
// PII on the public checkout-session endpoint — only productSlug + status.

const GUEST_INFO_CACHE_PREFIX = "checkout_guest_";

function saveGuestInfoCache(sessionId: string, info: GuestInfo): void {
  try {
    localStorage.setItem(
      `${GUEST_INFO_CACHE_PREFIX}${sessionId}`,
      JSON.stringify(info),
    );
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

function loadGuestInfoCache(sessionId: string): GuestInfo | null {
  try {
    const raw = localStorage.getItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as GuestInfo;
  } catch {
    return null;
  }
}

function clearGuestInfoCache(sessionId: string): void {
  try {
    localStorage.removeItem(`${GUEST_INFO_CACHE_PREFIX}${sessionId}`);
  } catch {}
}

function fmtPrice(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });
}

function StepIndicator({ current }: { current: Step }) {
  const ci = stepIndex(current);
  if (ci < 0) return null;
  return (
    <div className="flex items-center gap-2 mb-8 flex-wrap">
      {WIZARD_STEPS.map((s, idx) => {
        const done = idx < ci;
        const active = idx === ci;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 text-sm font-medium ${
                active
                  ? "text-text-primary"
                  : done
                    ? "text-accent-blue"
                    : "text-text-secondary"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
                  active
                    ? "text-white"
                    : done
                      ? "bg-accent-blue text-white"
                      : "bg-white/[0.08] text-text-tertiary"
                }`}
                style={active ? GRADIENT_BG : undefined}
              >
                {done ? <CheckCircle2 className="size-3.5" /> : idx + 1}
              </span>
              <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
            </div>
            {idx < WIZARD_STEPS.length - 1 && (
              <span className="text-text-tertiary">›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Checkout() {
  const { slug } = useParams<{ slug: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const checkoutStatus = params.get("checkout_status") as "success" | "canceled" | null;
  // `session` param is set by ConsentSuccessPage when redirecting back to checkout
  const sessionParam = params.get("session");
  const seats = Math.max(1, parseInt(params.get("seats") ?? "1", 10) || 1);

  // Catalog data (all purchasable service types)
  const { monitoringTiers, retainerTiers, mspTiers, configPackTiers, assessmentOffers, loading: catalogLoading, error: catalogError } = useCatalog();

  const [step, setStep] = useState<Step>("loading");
  const [service, setService] = useState<ReturnType<typeof tierToService> | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Seat count recovered from the server-side session when returning via the consent redirect.
  // The URL param is stripped by navigate() so we hold the authoritative value in state.
  const [recoveredSeats, setRecoveredSeats] = useState<number | null>(null);
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentCanceled, setPaymentCanceled] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const { toast } = useToast();
  const contractIdRef = useRef<number | null>(null);

  // Fire analytics on mount
  useEffect(() => { trackCheckoutStarted("service_catalog"); }, []);

  // Once catalog loads, resolve the service and handle Stripe/consent return params
  useEffect(() => {
    if (catalogLoading) return;

    if (catalogError) {
      setStep("catalog-error");
      return;
    }

    if (!slug) {
      setStep("not-found");
      return;
    }

    const allTiers: AnyTier[] = [...monitoringTiers, ...retainerTiers, ...mspTiers, ...configPackTiers, ...assessmentOffers];
    const found = allTiers.find((t) => t.slug === slug);

    if (!found) {
      setStep("not-found");
      return;
    }

    const svc = tierToService(found);
    setService(svc);

    if (!svc.fulfillmentTypeKey) {
      setStep("unavailable");
      return;
    }

    // Handle Stripe return (success/canceled) — reload guest info from the server session
    if (checkoutStatus === "success" || checkoutStatus === "canceled") {
      const storedSessionId = loadSessionId();
      if (storedSessionId) {
        setSessionId(storedSessionId);
        fetchCheckoutSession(storedSessionId).then((info) => {
          if (info) {
            // We don't have PII from the server (by design), but guestInfo display
            // on the confirmed/payment page reads from local state set earlier.
            // Re-hydration is best-effort; the confirmed screen doesn't require it.
          }
        }).catch(() => {});
      }
      if (checkoutStatus === "success") {
        trackCheckoutCompleted(svc.billingType ?? "service", { service_id: String(svc.id) });
        setStep("confirmed");
        navigate(`/checkout/${encodeURIComponent(slug)}`, { replace: true });
      } else {
        setConsentGranted(true);
        setPaymentCanceled(true);
        setStep("payment");
        navigate(`/checkout/${encodeURIComponent(slug)}`, { replace: true });
      }
      return;
    }

    // Handle return from consent success page — ?session=<uuid> means consent was granted.
    // sessionStorage may have been wiped during the cross-origin redirect, so we recover
    // the sessionId from the URL param and restore guestInfo from the localStorage cache
    // (written at guest-info submit time by saveGuestInfoCache). Seats are recovered from
    // the server-side session (stored at session creation) since the URL param is stripped
    // by navigate() below.
    if (sessionParam) {
      const storedSessionId = loadSessionId() ?? sessionParam;
      saveSessionId(storedSessionId);
      setSessionId(storedSessionId);
      setConsentGranted(true);

      // Restore guestInfo from the localStorage cache written when the session was created.
      // If the cache was also wiped (private browsing or aggressive browser policy),
      // handlePay will guard against a missing guestInfo and display an error.
      const cachedInfo = loadGuestInfoCache(storedSessionId);
      if (cachedInfo) {
        setGuestInfo(cachedInfo);
        // Terms were accepted at the guest-info step before consent. The cache (which
        // survives the cross-origin consent redirect) carries that acceptance forward so
        // the payment step reflects it without re-prompting. If the cache was wiped, this
        // stays false and the payment step falls back to an interactive terms checkbox.
        setTermsAccepted(cachedInfo.termsAccepted === true);
      }

      // Recover seat count from the server-side session. The URL ?seats= param is read
      // here but will be stripped by navigate() below, so we persist it in state.
      // Seed with the URL value first so the price shows immediately, then confirm with server.
      const urlSeats = Math.max(1, parseInt(params.get("seats") ?? "1", 10) || 1);
      if (urlSeats > 1) setRecoveredSeats(urlSeats);
      fetchCheckoutSession(storedSessionId).then((info) => {
        if (info && info.seats > 1) setRecoveredSeats(info.seats);
      }).catch(() => {});

      setStep("payment");
      navigate(`/checkout/${encodeURIComponent(slug)}`, { replace: true });
      return;
    }

    // Normal fresh flow
    setStep("guest-info");
  // checkoutStatus and sessionParam deliberately excluded so we only evaluate once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, catalogError, slug, monitoringTiers, retainerTiers, mspTiers, configPackTiers, assessmentOffers]);

  // Fetch (or refetch) the admin-consent URL whenever the sessionId changes.
  // This ensures the URL carries the correct `state` parameter even when
  // sessionId is set after the initial catalog load (i.e. after guest-info submit).
  useEffect(() => {
    if (catalogLoading || !service?.fulfillmentTypeKey) return;
    const sid = sessionId ?? loadSessionId();
    const qs = sid ? `?sessionId=${encodeURIComponent(sid)}` : "";
    fetch(`/api/public/consent-url${qs}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null }>) : { url: null }))
      .then((d) => setConsentUrl(d.url))
      .catch(() => setConsentUrl(null));
  // Re-run whenever sessionId changes so the URL includes the correct `state`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, service?.fulfillmentTypeKey, sessionId]);

  const form = useForm<GuestInfo>({
    resolver: zodResolver(guestInfoSchema),
    defaultValues: { name: "", email: "", termsAccepted: false },
  });

  // Use the recovered seat count when returning from consent (URL stripped by navigate).
  // Falls back to URL param value on the fresh/direct path.
  const effectiveSeats = recoveredSeats ?? seats;

  async function handleGuestInfo(data: GuestInfo) {
    if (!slug) return;
    try {
      const newSessionId = await createCheckoutSession({
        productSlug: slug,
        fullName: data.name,
        email: data.email,
        seats: effectiveSeats,
      });
      saveSessionId(newSessionId);
      // Cache guestInfo (including the terms-accepted flag) in localStorage so it survives
      // the cross-origin consent redirect. The server-side session holds the canonical copy;
      // this is a client-side convenience cache.
      saveGuestInfoCache(newSessionId, data);
      setSessionId(newSessionId);
      setGuestInfo(data);
      // Zod validation already guaranteed data.termsAccepted === true to reach here.
      setTermsAccepted(true);
      setStep("consent");
    } catch {
      toast({
        title: "Something went wrong",
        description: "Could not save your information. Please check your connection and try again.",
        variant: "destructive",
      });
    }
  }

  async function handlePay() {
    if (!service || !guestInfo || !termsAccepted) return;

    setLaunching(true);
    setPaymentError(null);
    setSessionExpired(false);
    setPaymentCanceled(false);

    try {
      let contractId = contractIdRef.current;

      const requiresSignature = service.serviceType === "project" || service.serviceType === "retainer";

      if (!contractId) {
        const contractRes = await fetch("/api/portal/onboarding/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceIds: [service.id],
            guestEmail: guestInfo.email,
            signerName: guestInfo.name,
            seats: effectiveSeats,
            captchaToken,
            ...(requiresSignature ? { signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" } : {}),
          }),
        });

        if (!contractRes.ok) {
          const err = (await contractRes.json().catch(() => ({}))) as { error?: string };
          setPaymentError(err.error ?? "Unable to start checkout. Please try again.");
          return;
        }

        const { contractIds } = (await contractRes.json()) as { contractIds: number[] };
        contractId = contractIds[0] ?? null;
        contractIdRef.current = contractId;
      }

      if (!contractId) {
        setPaymentError("Failed to create contract. Please try again.");
        return;
      }

      // Build Stripe return URLs
      const origin = window.location.origin;
      const base = `/checkout/${encodeURIComponent(service.slug ?? "")}`;
      const successUrl = `${origin}${base}?checkout_status=success`;
      const cancelUrl = `${origin}${base}?checkout_status=canceled`;

      const sessionRes = await fetch("/api/portal/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          contractIds: [contractId],
          guestEmail: guestInfo.email,
          successUrl,
          cancelUrl,
          seats: effectiveSeats,
          captchaToken,
        }),
      });

      if (!sessionRes.ok) {
        const err = (await sessionRes.json().catch(() => ({}))) as { error?: string };
        const msg = err.error ?? "Unable to start payment. Please try again.";
        if (msg.toLowerCase().includes("expired")) {
          setSessionExpired(true);
          contractIdRef.current = null;
        } else {
          setPaymentError(msg);
        }
        return;
      }

      const { url } = (await sessionRes.json()) as { url: string };
      if (url) {
        window.location.href = url;
      }
    } catch {
      setPaymentError("Network error. Check your connection and try again.");
    } finally {
      setLaunching(false);
    }
  }

  async function handleFreeCheckout() {
    if (!service || !guestInfo || !termsAccepted) return;

    setLaunching(true);
    setPaymentError(null);

    try {
      let contractId = contractIdRef.current;

      if (!contractId) {
        const contractRes = await fetch("/api/portal/onboarding/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceIds: [service.id],
            guestEmail: guestInfo.email,
            signerName: guestInfo.name,
            seats: effectiveSeats,
            captchaToken,
          }),
        });

        if (!contractRes.ok) {
          const err = (await contractRes.json().catch(() => ({}))) as { error?: string };
          setPaymentError(err.error ?? "Unable to start checkout. Please try again.");
          return;
        }

        const { contractIds } = (await contractRes.json()) as { contractIds: number[] };
        contractId = contractIds[0] ?? null;
        contractIdRef.current = contractId;
      }

      if (!contractId) {
        setPaymentError("Failed to create contract. Please try again.");
        return;
      }

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
        setPaymentError(err.error ?? "Unable to complete registration. Please try again.");
        return;
      }

      trackCheckoutCompleted("free_service", { service_id: String(service.id) });
      setStep("confirmed");
    } catch {
      setPaymentError("Network error. Check your connection and try again.");
    } finally {
      setLaunching(false);
    }
  }

  const priceDisplay = (() => {
    if (!service) return null;
    if (service.isFree) return "Free";
    const ta = (service.typeAttributes ?? {}) as { pricePerUserMonth?: string | null };
    if (service.billingType === "recurring_monthly" && ta.pricePerUserMonth) {
      const perSeat = Number(ta.pricePerUserMonth);
      return `${fmtPrice(Math.round(perSeat * effectiveSeats * 100))}/mo`;
    }
    if (service.billingType === "recurring_monthly") {
      return `${fmtPrice(Number(service.price ?? 0) * 100)}/mo`;
    }
    return fmtPrice(Number(service.price ?? 0) * 100);
  })();

  const isWizardStep = WIZARD_STEPS.includes(step);

  return (
    <Layout>
      <SEOMeta
        title="Checkout | Shane McCaw Consulting"
        description="Securely purchase a Microsoft 365 consulting service from Shane McCaw."
      />

      <div className="min-h-screen pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          {/* Loading */}
          {step === "loading" && (
            <div className="flex justify-center py-24">
              <Loader2 className="size-8 animate-spin text-accent-blue" />
            </div>
          )}

          {/* Catalog error */}
          {step === "catalog-error" && (
            <GlassPanel className="p-10 text-center space-y-4">
              <AlertCircle className="mx-auto size-12 text-red-400" />
              <h2 className="font-display text-xl font-bold text-text-primary">Unable to load service catalogue</h2>
              <p className="text-text-secondary">
                There was a problem fetching service information. Please refresh and try again.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
              >
                Refresh
              </button>
            </GlassPanel>
          )}

          {/* Not found */}
          {step === "not-found" && (
            <GlassPanel className="p-10 text-center space-y-4">
              <AlertCircle className="mx-auto size-12 text-text-tertiary" />
              <h2 className="font-display text-xl font-bold text-text-primary">Service not found</h2>
              <p className="text-text-secondary">
                We couldn't find a service matching{" "}
                <strong className="text-text-primary">{slug ?? "the requested service"}</strong>. It may have been removed or
                the link may be incorrect.
              </p>
              <Link
                href="/products"
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
              >
                View all services
              </Link>
            </GlassPanel>
          )}

          {/* Not yet available */}
          {step === "unavailable" && service && (
            <GlassPanel className="p-10 text-center space-y-4">
              <Clock className="mx-auto size-12 text-accent-blue" />
              <h2 className="font-display text-xl font-bold text-text-primary">{service.name}</h2>
              <p className="text-text-secondary">
                This service isn't yet available for online purchase. Please contact Shane directly
                to discuss your requirements and get started.
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  style={GRADIENT_BG}
                >
                  Contact Shane
                </Link>
                <Link
                  href="/book"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
                >
                  Book a discovery call
                </Link>
              </div>
            </GlassPanel>
          )}

          {/* Wizard */}
          {isWizardStep && (
            <>
              <StepIndicator current={step} />

              <GlassPanel className="p-8">
                {/* Step 1: Guest info */}
                {step === "guest-info" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-text-primary">Your information</h2>
                      <p className="text-text-secondary mt-1">Enter your details to get started.</p>
                    </div>

                    {service && (
                      <div className="rounded-xl bg-charcoal-1 border border-white/[0.06] p-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-0.5">
                            Selected service
                          </p>
                          <p className="font-semibold text-text-primary">{service.name}</p>
                        </div>
                        {priceDisplay && (
                          <p className="font-numeric text-text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
                        )}
                      </div>
                    )}

                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleGuestInfo)} className="space-y-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full name</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Jane Smith"
                                  autoComplete="name"
                                  className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Work email</FormLabel>
                              <FormControl>
                                <Input
                                  type="email"
                                  placeholder="you@yourcompany.com"
                                  autoComplete="email"
                                  className="bg-white/[0.04] border-white/[0.12] text-text-primary placeholder:text-text-secondary focus-visible:ring-accent-blue/60 focus-visible:border-accent-blue/60"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {/* Terms / clickwrap gate — required BEFORE the M365 admin-consent step.
                            Agreeing here is what unlocks the consent step; a visitor cannot grant
                            real tenant access without first accepting the Terms of Service (which
                            incorporates the DPA by reference) and Privacy Policy. */}
                        <FormField
                          control={form.control}
                          name="termsAccepted"
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-start gap-3">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value}
                                    onCheckedChange={(v) => field.onChange(v === true)}
                                    className="mt-0.5 border-white/20 data-[state=checked]:bg-accent-blue data-[state=checked]:border-accent-blue"
                                  />
                                </FormControl>
                                <FormLabel className="text-sm font-normal text-text-secondary leading-snug cursor-pointer">
                                  I agree to the{" "}
                                  <Link href="/legal/terms" className="underline text-accent-blue">
                                    Terms of Service
                                  </Link>{" "}
                                  and{" "}
                                  <Link href="/legal/privacy" className="underline text-accent-blue">
                                    Privacy Policy
                                  </Link>
                                  . Agreement is required before granting Microsoft 365 admin access.
                                </FormLabel>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="submit"
                          className="w-full text-white"
                          style={GRADIENT_BG}
                          disabled={form.formState.isSubmitting}
                        >
                          {form.formState.isSubmitting ? (
                            <><Loader2 className="mr-2 size-4 animate-spin" /> Saving…</>
                          ) : (
                            <>Continue <ArrowRight className="ml-2 size-4" /></>
                          )}
                        </Button>
                      </form>
                    </Form>
                  </div>
                )}

                {/* Step 2: M365 admin consent */}
                {step === "consent" && (
                  <div className="space-y-6">
                    <button
                      onClick={() => setStep("guest-info")}
                      className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <ArrowLeft className="size-3.5" /> Back
                    </button>

                    <div>
                      <h2 className="font-display text-2xl font-semibold text-text-primary">
                        Microsoft 365 admin consent
                      </h2>
                      <p className="text-text-secondary mt-1">
                        Shane's monitoring and automation tools need read access to your Microsoft
                        365 tenant. This is granted once by your M365 administrator.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/[0.06] bg-charcoal-1 p-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <Users className="size-5 text-accent-blue shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-text-primary text-sm">Who does this step</p>
                          <p className="text-sm text-text-secondary">
                            Your Microsoft 365 Global Administrator or a Privileged Role
                            Administrator.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="size-5 text-accent-blue shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-text-primary text-sm">
                            What access is granted
                          </p>
                          <p className="text-sm text-text-secondary">
                            Read-only access to tenant configuration, user data, and service health.
                            No changes are made without your explicit approval.
                          </p>
                        </div>
                      </div>
                    </div>

                    {consentUrl ? (
                      <a
                        href={consentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg border border-accent-blue text-accent-blue font-semibold text-sm hover:bg-accent-blue/10 transition-colors"
                      >
                        Grant admin consent in Microsoft{" "}
                        <ExternalLink className="size-4" />
                      </a>
                    ) : (
                      <div className="rounded-xl bg-charcoal-1 border border-white/[0.06] p-4 text-sm text-text-secondary">
                        Loading consent link…
                      </div>
                    )}

                    <div className="rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-4 flex items-start gap-3">
                      <Clock className="size-5 text-accent-blue shrink-0 mt-0.5" />
                      <p className="text-sm text-text-primary">
                        Waiting for your Microsoft 365 administrator to complete consent — this
                        page will continue automatically.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step 3: Payment */}
                {step === "payment" && service && (
                  <div className="space-y-6">
                    {!paymentCanceled && (
                      <button
                        onClick={() => {
                          setPaymentError(null);
                          setSessionExpired(false);
                          setStep("consent");
                        }}
                        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <ArrowLeft className="size-3.5" /> Back
                      </button>
                    )}

                    <div>
                      <h2 className="font-display text-2xl font-semibold text-text-primary">
                        {service.isFree ? "Review & confirm" : "Review & pay"}
                      </h2>
                      <p className="text-text-secondary mt-1">
                        {service.isFree ? "Confirm your free request details below." : "Confirm your order details below."}
                      </p>
                    </div>

                    {/* Order summary */}
                    <div className="rounded-xl border border-white/[0.06] bg-charcoal-1 p-5 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-text-primary">{service.name}</p>
                          {service.description && (
                            <p className="text-sm text-text-secondary mt-0.5">
                              {service.description}
                            </p>
                          )}
                        </div>
                        {priceDisplay && (
                          <p className="font-numeric text-text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
                        )}
                      </div>
                      {guestInfo && (
                        <div className="border-t border-white/[0.06] pt-3 text-sm text-text-secondary">
                          <span className="font-medium text-text-primary">Purchasing as:</span>{" "}
                          {guestInfo.name} · {guestInfo.email}
                        </div>
                      )}
                    </div>

                    {/* Payment canceled notice */}
                    {paymentCanceled && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
                        <XCircle className="size-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-300 text-sm">
                            Payment was not completed
                          </p>
                          <p className="text-sm text-amber-200/80 mt-0.5">
                            You left the Stripe payment page before completing your purchase. Your
                            information has been saved — click "Proceed to payment" to try again.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Session expired */}
                    {sessionExpired && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
                        <Clock className="size-5 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-300 text-sm">Session expired</p>
                          <p className="text-sm text-amber-200/80 mt-0.5">
                            Your checkout session timed out. Click "Proceed to payment" to start a
                            fresh session — your information has been saved.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Payment error */}
                    {paymentError && !sessionExpired && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                        <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-red-400 text-sm">Payment error</p>
                          <p className="text-sm text-red-300/80 mt-0.5">{paymentError}</p>
                        </div>
                      </div>
                    )}

                    {/* Terms / clickwrap — accepted earlier at the info step (before M365 consent).
                        Normally we just confirm that prior acceptance. If the acceptance state
                        didn't survive (e.g. localStorage wiped during the cross-origin redirect),
                        fall back to an interactive checkbox so the user is never hard-blocked.
                        Either way the pay button stays gated on termsAccepted below. */}
                    {termsAccepted ? (
                      <div className="flex items-start gap-3 rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-4">
                        <CheckCircle2 className="size-5 text-accent-blue shrink-0 mt-0.5" />
                        <p className="text-sm text-text-secondary leading-snug">
                          You've agreed to the{" "}
                          <Link href="/legal/terms" className="underline text-accent-blue">
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link href="/legal/privacy" className="underline text-accent-blue">
                            Privacy Policy
                          </Link>
                          . {service.isFree
                            ? 'Clicking "Confirm and Get Started" will register your free account and start onboarding.'
                            : 'Clicking "Proceed to payment" will redirect you to Stripe to complete the purchase.'}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="terms-check"
                          checked={termsAccepted}
                          onCheckedChange={(v) => setTermsAccepted(!!v)}
                          className="border-white/20 data-[state=checked]:bg-accent-blue data-[state=checked]:border-accent-blue"
                        />
                        <label
                          htmlFor="terms-check"
                          className="text-sm text-text-secondary leading-snug cursor-pointer"
                        >
                          I agree to the{" "}
                          <Link href="/legal/terms" className="underline text-accent-blue">
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link href="/legal/privacy" className="underline text-accent-blue">
                            Privacy Policy
                          </Link>
                          . {service.isFree ? (
                            'I understand that clicking "Confirm and Get Started" will register my free account and start onboarding.'
                          ) : (
                            'I understand that clicking "Proceed to payment" will redirect me to Stripe to complete the purchase.'
                          )}
                        </label>
                      </div>
                    )}

                    <div className="flex items-start gap-2 text-sm text-text-secondary">
                      <ShieldCheck className="size-4 text-accent-blue shrink-0 mt-0.5" />
                      <span>
                        {service.isFree ? (
                          "Your M365 configuration snapshot will begin immediately. No credit card required."
                        ) : (
                          "Payments are processed securely by Stripe. Your card details are never stored on our servers."
                        )}
                      </span>
                    </div>

                    <div className="my-6">
                      <CaptchaGate onVerify={setCaptchaToken} />
                    </div>

                    <Button
                      onClick={service.isFree ? handleFreeCheckout : handlePay}
                      disabled={launching || !termsAccepted || !captchaToken}
                      className="w-full text-white"
                      style={GRADIENT_BG}
                      size="lg"
                    >
                      {launching ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />{" "}
                          {service.isFree ? "Setting up snapshot…" : "Preparing secure checkout…"}
                        </>
                      ) : service.isFree ? (
                        <>
                          Confirm and Get Started <ArrowRight className="ml-2 size-4" />
                        </>
                      ) : (
                        <>
                          Proceed to payment <ExternalLink className="ml-2 size-4" />
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Step 4: Confirmed */}
                {step === "confirmed" && (
                  <div className="flex flex-col items-center gap-4 py-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center mb-2">
                      <CheckCircle2 className="size-8 text-accent-blue" />
                    </div>
                    <h2 className="font-display text-2xl font-semibold text-text-primary">
                      Order <GradientText>confirmed</GradientText>!
                    </h2>
                    {guestInfo?.email ? (
                      <p className="text-text-secondary max-w-sm">
                        Thank you for your purchase. You'll receive an email at{" "}
                        <strong className="text-text-primary">{guestInfo.email}</strong> with account setup instructions within
                        one business day.
                      </p>
                    ) : (
                      <p className="text-text-secondary max-w-sm">
                        Thank you for your purchase. You'll receive setup instructions by email
                        within one business day.
                      </p>
                    )}
                    <p className="text-sm text-text-secondary max-w-sm">
                      Shane will personally reach out to schedule your onboarding call and begin
                      your engagement.
                    </p>
                    <Link
                      href="/"
                      className="mt-2 inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-white/[0.12] text-text-primary text-sm font-semibold hover:bg-white/[0.06] transition-colors"
                      onClick={() => {
                        const sid = sessionId ?? loadSessionId();
                        if (sid) clearGuestInfoCache(sid);
                        clearSessionId();
                      }}
                    >
                      Return home
                    </Link>
                  </div>
                )}
              </GlassPanel>

              <p className="text-center text-xs text-text-secondary mt-6">
                Payments are securely processed by Stripe. Your email and payment information are
                never stored on our servers.
              </p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

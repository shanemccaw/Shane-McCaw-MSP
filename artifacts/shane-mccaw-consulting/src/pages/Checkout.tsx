import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation, Link } from "wouter";
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
import { Button } from "@/components/ui/button";
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
import { useCatalog, type MonitoringTier, type RetainerTier, type MspTier } from "@/hooks/useCatalog";
import { trackCheckoutStarted, trackCheckoutCompleted } from "@/lib/analytics";

type AnyTier = MonitoringTier | RetainerTier | MspTier;

function tierToService(t: AnyTier) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    price: t.price,
    billingType: t.billingType,
    fulfillmentTypeKey: t.fulfillmentTypeKey,
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
  payment: "Payment",
  confirmed: "Confirmed",
};

function stepIndex(s: Step): number {
  return WIZARD_STEPS.indexOf(s);
}

const guestInfoSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  email: z.string().email("Please enter a valid email address"),
});
type GuestInfo = z.infer<typeof guestInfoSchema>;

const STORAGE_KEY = "checkout_guest_info";

function saveGuestInfo(slug: string, info: GuestInfo) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ slug, ...info }));
  } catch {
    // sessionStorage may be unavailable
  }
}

function loadGuestInfo(slug: string): GuestInfo | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { slug: string; name: string; email: string };
    if (parsed.slug !== slug) return null;
    return { name: parsed.name, email: parsed.email };
  } catch {
    return null;
  }
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
                  ? "text-[#0A2540]"
                  : done
                    ? "text-[#0078D4]"
                    : "text-muted-foreground"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${
                  active
                    ? "bg-[#0A2540] text-white"
                    : done
                      ? "bg-[#0078D4] text-white"
                      : "bg-border text-muted-foreground"
                }`}
              >
                {done ? <CheckCircle2 className="size-3.5" /> : idx + 1}
              </span>
              <span className="hidden sm:inline">{STEP_LABELS[s]}</span>
            </div>
            {idx < WIZARD_STEPS.length - 1 && (
              <span className="text-border">›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Checkout() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const slug = params.get("product");
  const checkoutStatus = params.get("checkout_status") as "success" | "canceled" | null;

  // Catalog data (all three service types)
  const { monitoringTiers, retainerTiers, mspTiers, loading: catalogLoading, error: catalogError } = useCatalog();

  const [step, setStep] = useState<Step>("loading");
  const [service, setService] = useState<ReturnType<typeof tierToService> | null>(null);
  const [guestInfo, setGuestInfo] = useState<GuestInfo | null>(null);
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [consentDeclined, setConsentDeclined] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentCanceled, setPaymentCanceled] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const { toast } = useToast();
  const contractIdRef = useRef<number | null>(null);
  const consentFetched = useRef(false);

  // Fire analytics on mount
  useEffect(() => { trackCheckoutStarted("service_catalog"); }, []);

  // Once catalog loads, resolve the service and handle Stripe return params
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

    const allTiers: AnyTier[] = [...monitoringTiers, ...retainerTiers, ...mspTiers];
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

    // Handle Stripe return
    if (checkoutStatus === "success") {
      const saved = loadGuestInfo(slug);
      if (saved) setGuestInfo(saved);
      trackCheckoutCompleted(svc.billingType ?? "service", { service_id: String(svc.id) });
      setStep("confirmed");
      navigate(`/checkout?product=${encodeURIComponent(slug)}`, { replace: true });
      return;
    }

    if (checkoutStatus === "canceled") {
      const saved = loadGuestInfo(slug);
      if (saved) {
        setGuestInfo(saved);
        setConsentGranted(true);
      }
      setPaymentCanceled(true);
      setStep("payment");
      navigate(`/checkout?product=${encodeURIComponent(slug)}`, { replace: true });
      return;
    }

    // Normal fresh flow — fetch consent URL once
    setStep("guest-info");
  // checkoutStatus deliberately excluded so we only evaluate it once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLoading, catalogError, slug, monitoringTiers, retainerTiers, mspTiers]);

  // Fetch consent URL lazily (after catalog is resolved)
  useEffect(() => {
    if (consentFetched.current || catalogLoading || !service?.fulfillmentTypeKey) return;
    consentFetched.current = true;
    fetch("/api/public/consent-url")
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null }>) : { url: null }))
      .then((d) => setConsentUrl(d.url))
      .catch(() => setConsentUrl(null));
  }, [catalogLoading, service]);

  const form = useForm<GuestInfo>({
    resolver: zodResolver(guestInfoSchema),
    defaultValues: { name: "", email: "" },
  });

  function handleGuestInfo(data: GuestInfo) {
    setGuestInfo(data);
    if (slug) saveGuestInfo(slug, data);
    setStep("consent");
  }

  function handleConsentContinue() {
    if (!consentGranted) {
      toast({
        title: "Please confirm admin consent",
        description:
          "Check the box confirming you have granted admin consent before continuing.",
        variant: "destructive",
      });
      return;
    }
    setStep("payment");
  }

  async function handlePay() {
    if (!service || !guestInfo || !termsAccepted) return;

    setLaunching(true);
    setPaymentError(null);
    setSessionExpired(false);
    setPaymentCanceled(false);

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
            signatureData: "data:image/png;base64,placeholder",
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
      const base = `/checkout?product=${encodeURIComponent(service.slug ?? "")}`;
      const successUrl = `${origin}${base}&checkout_status=success`;
      const cancelUrl = `${origin}${base}&checkout_status=canceled`;

      const sessionRes = await fetch("/api/portal/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: [service.id],
          contractIds: [contractId],
          guestEmail: guestInfo.email,
          successUrl,
          cancelUrl,
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

  const priceDisplay = service
    ? service.billingType === "recurring_monthly"
      ? `${fmtPrice(Number(service.price ?? 0) * 100)}/mo`
      : fmtPrice(Number(service.price ?? 0) * 100)
    : null;

  const isWizardStep = WIZARD_STEPS.includes(step);

  return (
    <Layout>
      <SEOMeta
        title="Checkout | Shane McCaw Consulting"
        description="Securely purchase a Microsoft 365 consulting service from Shane McCaw."
      />

      <div className="min-h-screen bg-[#F7F9FC] py-16">
        <div className="max-w-2xl mx-auto px-4">
          {/* Loading */}
          {step === "loading" && (
            <div className="flex justify-center py-24">
              <Loader2 className="size-8 animate-spin text-[#0078D4]" />
            </div>
          )}

          {/* Catalog error */}
          {step === "catalog-error" && (
            <div className="bg-white rounded-2xl border border-border shadow-sm p-10 text-center space-y-4">
              <AlertCircle className="mx-auto size-12 text-destructive" />
              <h2 className="text-xl font-bold text-[#0A2540]">Unable to load service catalogue</h2>
              <p className="text-muted-foreground">
                There was a problem fetching service information. Please refresh and try again.
              </p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Refresh
              </Button>
            </div>
          )}

          {/* Not found */}
          {step === "not-found" && (
            <div className="bg-white rounded-2xl border border-border shadow-sm p-10 text-center space-y-4">
              <AlertCircle className="mx-auto size-12 text-muted-foreground" />
              <h2 className="text-xl font-bold text-[#0A2540]">Service not found</h2>
              <p className="text-muted-foreground">
                We couldn't find a service matching{" "}
                <strong>{slug ?? "the requested product"}</strong>. It may have been removed or
                the link may be incorrect.
              </p>
              <Link href="/pricing">
                <Button variant="outline">View all services</Button>
              </Link>
            </div>
          )}

          {/* Not yet available */}
          {step === "unavailable" && service && (
            <div className="bg-white rounded-2xl border border-border shadow-sm p-10 text-center space-y-4">
              <Clock className="mx-auto size-12 text-[#0078D4]" />
              <h2 className="text-xl font-bold text-[#0A2540]">{service.name}</h2>
              <p className="text-muted-foreground">
                This service isn't yet available for online purchase. Please contact Shane directly
                to discuss your requirements and get started.
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <Link href="/contact">
                  <Button>Contact Shane</Button>
                </Link>
                <Link href="/book">
                  <Button variant="outline">Book a discovery call</Button>
                </Link>
              </div>
            </div>
          )}

          {/* Wizard */}
          {isWizardStep && (
            <>
              <StepIndicator current={step} />

              <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
                {/* Step 1: Guest info */}
                {step === "guest-info" && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-semibold text-[#0A2540]">Your information</h2>
                      <p className="text-muted-foreground mt-1">Enter your details to get started.</p>
                    </div>

                    {service && (
                      <div className="rounded-xl bg-[#F7F9FC] border border-border p-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                            Selected service
                          </p>
                          <p className="font-semibold text-[#0A2540]">{service.name}</p>
                        </div>
                        {priceDisplay && (
                          <p className="text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
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
                                <Input placeholder="Jane Smith" autoComplete="name" {...field} />
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
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full">
                          Continue <ArrowRight className="ml-2 size-4" />
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
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0A2540]"
                    >
                      <ArrowLeft className="size-3.5" /> Back
                    </button>

                    <div>
                      <h2 className="text-2xl font-semibold text-[#0A2540]">
                        Microsoft 365 admin consent
                      </h2>
                      <p className="text-muted-foreground mt-1">
                        Shane's monitoring and automation tools need read access to your Microsoft
                        365 tenant. This is granted once by your M365 administrator.
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-[#F7F9FC] p-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <Users className="size-5 text-[#0078D4] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[#0A2540] text-sm">Who does this step</p>
                          <p className="text-sm text-muted-foreground">
                            Your Microsoft 365 Global Administrator or a Privileged Role
                            Administrator.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="size-5 text-[#0078D4] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[#0A2540] text-sm">
                            What access is granted
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Read-only access to tenant configuration, user data, and service health.
                            No changes are made without your explicit approval.
                          </p>
                        </div>
                      </div>
                    </div>

                    {consentDeclined ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-amber-900 text-sm">
                              Admin consent needed to proceed
                            </p>
                            <p className="text-sm text-amber-700 mt-1">
                              Shane needs access to monitor and optimize your M365 tenant. If your
                              administrator is unavailable right now, you can still complete
                              payment — Shane will follow up with consent instructions after
                              purchase.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConsentDeclined(false)}
                          >
                            Try consent again
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setConsentGranted(true);
                              setConsentDeclined(false);
                              setStep("payment");
                            }}
                          >
                            Continue to payment <ArrowRight className="ml-1 size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {consentUrl ? (
                          <a
                            href={consentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg border border-[#0078D4] text-[#0078D4] font-semibold text-sm hover:bg-[#0078D4]/5 transition-colors"
                          >
                            Grant admin consent in Microsoft{" "}
                            <ExternalLink className="size-4" />
                          </a>
                        ) : (
                          <div className="rounded-xl bg-[#F7F9FC] border border-border p-4 text-sm text-muted-foreground">
                            Your M365 administrator will receive consent instructions from Shane
                            after purchase. You can skip this step for now.
                          </div>
                        )}

                        <div className="flex items-start gap-3 pt-1">
                          <Checkbox
                            id="consent-check"
                            checked={consentGranted}
                            onCheckedChange={(v) => setConsentGranted(!!v)}
                          />
                          <label
                            htmlFor="consent-check"
                            className="text-sm text-foreground leading-snug cursor-pointer"
                          >
                            I confirm that our Microsoft 365 administrator has granted — or will
                            grant — admin consent for Shane's service account.
                          </label>
                        </div>

                        <div className="flex gap-3 flex-col sm:flex-row">
                          <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => setConsentDeclined(true)}
                          >
                            I'll arrange this separately
                          </Button>
                          <Button
                            className="flex-1"
                            onClick={handleConsentContinue}
                            disabled={!consentGranted}
                          >
                            Continue to payment <ArrowRight className="ml-2 size-4" />
                          </Button>
                        </div>
                      </>
                    )}
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
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#0A2540]"
                      >
                        <ArrowLeft className="size-3.5" /> Back
                      </button>
                    )}

                    <div>
                      <h2 className="text-2xl font-semibold text-[#0A2540]">Review & pay</h2>
                      <p className="text-muted-foreground mt-1">Confirm your order details below.</p>
                    </div>

                    {/* Order summary */}
                    <div className="rounded-xl border border-border bg-[#F7F9FC] p-5 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-[#0A2540]">{service.name}</p>
                          {service.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {service.description}
                            </p>
                          )}
                        </div>
                        {priceDisplay && (
                          <p className="text-primary font-bold text-lg shrink-0">{priceDisplay}</p>
                        )}
                      </div>
                      {guestInfo && (
                        <div className="border-t border-border pt-3 text-sm text-muted-foreground">
                          <span className="font-medium text-[#0A2540]">Purchasing as:</span>{" "}
                          {guestInfo.name} · {guestInfo.email}
                        </div>
                      )}
                    </div>

                    {/* Payment canceled notice */}
                    {paymentCanceled && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                        <XCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-900 text-sm">
                            Payment was not completed
                          </p>
                          <p className="text-sm text-amber-700 mt-0.5">
                            You left the Stripe payment page before completing your purchase. Your
                            information has been saved — click "Proceed to payment" to try again.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Session expired */}
                    {sessionExpired && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                        <Clock className="size-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-amber-900 text-sm">Session expired</p>
                          <p className="text-sm text-amber-700 mt-0.5">
                            Your checkout session timed out. Click "Proceed to payment" to start a
                            fresh session — your information has been saved.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Payment error */}
                    {paymentError && !sessionExpired && (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                        <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-destructive text-sm">Payment error</p>
                          <p className="text-sm text-destructive/80 mt-0.5">{paymentError}</p>
                        </div>
                      </div>
                    )}

                    {/* Terms / clickwrap */}
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="terms-check"
                        checked={termsAccepted}
                        onCheckedChange={(v) => setTermsAccepted(!!v)}
                      />
                      <label
                        htmlFor="terms-check"
                        className="text-sm text-foreground leading-snug cursor-pointer"
                      >
                        I agree to the{" "}
                        <Link href="/legal/terms" className="underline text-primary">
                          Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link href="/legal/privacy" className="underline text-primary">
                          Privacy Policy
                        </Link>
                        . I understand that clicking "Proceed to payment" will redirect me to
                        Stripe to complete the purchase.
                      </label>
                    </div>

                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>
                        Payments are processed securely by Stripe. Your card details are never
                        stored on our servers.
                      </span>
                    </div>

                    <Button
                      onClick={handlePay}
                      disabled={launching || !termsAccepted}
                      className="w-full"
                      size="lg"
                    >
                      {launching ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" /> Preparing secure
                          checkout…
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
                    <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-2">
                      <CheckCircle2 className="size-8 text-[#0078D4]" />
                    </div>
                    <h2 className="text-2xl font-semibold text-[#0A2540]">Order confirmed!</h2>
                    {guestInfo?.email ? (
                      <p className="text-muted-foreground max-w-sm">
                        Thank you for your purchase. You'll receive an email at{" "}
                        <strong>{guestInfo.email}</strong> with account setup instructions within
                        one business day.
                      </p>
                    ) : (
                      <p className="text-muted-foreground max-w-sm">
                        Thank you for your purchase. You'll receive setup instructions by email
                        within one business day.
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Shane will personally reach out to schedule your onboarding call and begin
                      your engagement.
                    </p>
                    <Link href="/">
                      <Button variant="outline" className="mt-2">
                        Return home
                      </Button>
                    </Link>
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-muted-foreground mt-6">
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

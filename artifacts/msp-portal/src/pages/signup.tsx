import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldCheck, CheckCircle2, ArrowRight, ArrowLeft, Building2, CreditCard, FileText } from "lucide-react";

interface Tier {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  tagline: string | null;
  price: string | null;
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean> | null;
  features: string[] | null;
  inclusions: string[] | null;
  badge: string | null;
  highlighted: boolean;
}

interface PlatformAgreement {
  id: number;
  version: string;
  title: string;
  body: string;
}

const companySchema = z.object({
  companyName: z.string().min(2, "Company name must be at least 2 characters"),
  domain: z.string().optional(),
  contactName: z.string().min(2, "Contact name must be at least 2 characters"),
  contactEmail: z.string().email("Enter a valid email address"),
});
type CompanyForm = z.infer<typeof companySchema>;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json();
}

type Step = "company" | "tier" | "agreement" | "checkout";
const STEPS: Step[] = ["company", "tier", "agreement", "checkout"];
const STEP_LABELS: Record<Step, string> = {
  company: "Company Info",
  tier: "Choose Plan",
  agreement: "Review Agreement",
  checkout: "Payment",
};

function stepIndex(s: Step) {
  return STEPS.indexOf(s);
}

export default function SignupPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("company");
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [selectedTierId, setSelectedTierId] = useState<number | null>(null);
  const [companyData, setCompanyData] = useState<CompanyForm | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Agreement step state
  const [agreement, setAgreement] = useState<PlatformAgreement | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(false);
  const [agreementChecked, setAgreementChecked] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CompanyForm>({ resolver: zodResolver(companySchema) });

  useEffect(() => {
    if (step === "tier" && tiers.length === 0) {
      setTiersLoading(true);
      apiFetch("/api/msp/signup/tiers")
        .then((data: { tiers: Tier[] }) => setTiers(data.tiers))
        .catch((err: Error) => setError(err.message))
        .finally(() => setTiersLoading(false));
    }
  }, [step, tiers.length]);

  useEffect(() => {
    if (step === "agreement" && !agreement && !agreementLoading) {
      setAgreementLoading(true);
      apiFetch("/api/platform/agreement/current")
        .then((data: { agreement: PlatformAgreement | null }) => {
          setAgreement(data.agreement);
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setAgreementLoading(false));
    }
  }, [step, agreement, agreementLoading]);

  function onCompanySubmit(data: CompanyForm) {
    setCompanyData(data);
    setStep("tier");
  }

  async function handleCheckout() {
    if (!companyData || !selectedTierId) return;
    setCheckoutLoading(true);
    setError(null);
    try {
      const result = await apiFetch("/api/msp/signup/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...companyData,
          serviceId: selectedTierId,
          agreementVersion: agreement?.version ?? null,
          agreementId: agreement?.id ?? null,
          // Explicit clickwrap attestation — required by the server when an agreement is published
          checkboxConfirmed: agreement !== null ? agreementChecked : undefined,
        }),
      }) as { checkoutUrl: string };
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setCheckoutLoading(false);
    }
  }

  const selectedTier = tiers.find(t => t.id === selectedTierId) ?? null;
  const currentStepIdx = stepIndex(step);

  return (
    <div className="min-h-screen bg-sidebar flex flex-col items-center justify-start p-4 pt-12">
      <div className="w-full max-w-2xl space-y-6">
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-2 text-sidebar-foreground">
          <ShieldCheck className="size-10 text-sidebar-primary" />
          <h1 className="text-2xl font-bold tracking-tight">MSP Platform</h1>
          <p className="text-sm text-sidebar-foreground/60">Self-Service Signup</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 text-sm">
          {STEPS.map((s, i) => {
            const isActive = step === s;
            const isDone = currentStepIdx > i;
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-6 h-px bg-sidebar-border" />}
                <div className={`flex items-center gap-1.5 ${isActive ? "text-sidebar-primary font-medium" : isDone ? "text-sidebar-foreground/60" : "text-sidebar-foreground/40"}`}>
                  <div className={`size-5 rounded-full flex items-center justify-center text-xs ${isActive ? "bg-sidebar-primary text-white" : isDone ? "bg-sidebar-primary/20 text-sidebar-primary" : "bg-sidebar-border text-sidebar-foreground/40"}`}>
                    {isDone ? <CheckCircle2 className="size-3" /> : i + 1}
                  </div>
                  <span className="hidden sm:inline capitalize">{STEP_LABELS[s]}</span>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── Step 1: Company Info ── */}
        {step === "company" && (
          <Card className="border-sidebar-border bg-card/95 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="size-5" /> Company Information</CardTitle>
              <CardDescription>Tell us about your MSP organisation to get started.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onCompanySubmit)} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="companyName">Company Name *</Label>
                    <Input id="companyName" placeholder="Acme IT Solutions" {...register("companyName")} />
                    {errors.companyName && <p className="text-destructive text-xs">{errors.companyName.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="domain">Company Domain</Label>
                    <Input id="domain" placeholder="acme.com" {...register("domain")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactName">Your Name *</Label>
                    <Input id="contactName" placeholder="Jane Smith" {...register("contactName")} />
                    {errors.contactName && <p className="text-destructive text-xs">{errors.contactName.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactEmail">Work Email *</Label>
                    <Input id="contactEmail" type="email" placeholder="jane@acme.com" {...register("contactEmail")} />
                    {errors.contactEmail && <p className="text-destructive text-xs">{errors.contactEmail.message}</p>}
                  </div>
                </div>
                <div className="pt-2 flex justify-end">
                  <Button type="submit" className="gap-2">
                    Continue <ArrowRight className="size-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Step 2: Tier Selection ── */}
        {step === "tier" && (
          <div className="space-y-4">
            <Card className="border-sidebar-border bg-card/95">
              <CardHeader>
                <CardTitle>Choose Your Platform Plan</CardTitle>
                <CardDescription>Select the tier that fits your MSP. Overage is metered monthly — you're never hard-blocked for having more tenants than your plan includes.</CardDescription>
              </CardHeader>
            </Card>

            {tiersLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : tiers.length === 0 ? (
              <Card className="border-sidebar-border bg-card/95">
                <CardContent className="py-8 text-center text-muted-foreground">
                  No subscription tiers are configured yet. Please contact us to get started.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tiers.map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => setSelectedTierId(tier.id)}
                    className={`text-left rounded-lg border p-5 transition-all ${selectedTierId === tier.id ? "border-sidebar-primary bg-sidebar-primary/10 ring-1 ring-sidebar-primary" : "border-sidebar-border bg-card/95 hover:border-sidebar-primary/50"} ${tier.highlighted ? "relative" : ""}`}
                  >
                    {tier.badge && (
                      <span className="absolute -top-2.5 left-4 bg-sidebar-primary text-white text-xs px-2 py-0.5 rounded-full">{tier.badge}</span>
                    )}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-card-foreground">{tier.name}</h3>
                        {tier.tagline && <p className="text-sm text-muted-foreground mt-0.5">{tier.tagline}</p>}
                      </div>
                      {selectedTierId === tier.id && (
                        <CheckCircle2 className="size-5 text-sidebar-primary shrink-0 mt-0.5" />
                      )}
                    </div>

                    <div className="mt-3">
                      <span className="text-2xl font-bold text-card-foreground">
                        ${tier.price ? parseFloat(tier.price).toLocaleString("en-US", { minimumFractionDigits: 0 }) : "—"}
                      </span>
                      <span className="text-muted-foreground text-sm">/month</span>
                    </div>

                    <div className="mt-3 space-y-1">
                      {tier.tenantAllowance !== null && tier.tenantAllowance !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {tier.tenantAllowance === 0 ? "Unlimited tenants" : `Up to ${tier.tenantAllowance} tenants included`}
                          {tier.overageRateCents && tier.tenantAllowance > 0 ? ` · $${(tier.overageRateCents / 100).toFixed(2)}/extra/month` : ""}
                        </p>
                      )}
                      {tier.aiCreditAllowance !== null && tier.aiCreditAllowance !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {tier.aiCreditAllowance === 0 ? "Unlimited AI credits" : `${tier.aiCreditAllowance.toLocaleString()} AI credits/month`}
                        </p>
                      )}
                    </div>

                    {(tier.features ?? tier.inclusions) && (
                      <ul className="mt-3 space-y-1">
                        {(tier.features ?? tier.inclusions ?? []).slice(0, 4).map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-card-foreground/80">
                            <CheckCircle2 className="size-3 text-sidebar-primary shrink-0 mt-0.5" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => { setStep("company"); setError(null); }} className="gap-2">
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button
                disabled={!selectedTierId}
                onClick={() => { setStep("agreement"); setError(null); }}
                className="gap-2"
              >
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Platform Agreement Clickwrap ── */}
        {step === "agreement" && (
          <Card className="border-sidebar-border bg-card/95 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-5" />
                {agreementLoading ? "Loading Agreement…" : (agreement?.title ?? "Platform Agreement")}
              </CardTitle>
              <CardDescription>
                Please read the agreement below carefully and confirm your acceptance before proceeding.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {agreementLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : agreement ? (
                <>
                  {/* Agreement version badge */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      Version {agreement.version}
                    </span>
                  </div>

                  {/* Scrollable agreement body */}
                  <div
                    className="rounded-lg border border-sidebar-border bg-background/50 p-4 overflow-y-auto max-h-72 text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed"
                    role="region"
                    aria-label="Agreement text"
                  >
                    {agreement.body}
                  </div>

                  {/* Clickwrap checkbox */}
                  <div className="flex items-start gap-3 rounded-lg border border-sidebar-border bg-sidebar-primary/5 p-4">
                    <Checkbox
                      id="agreement-checkbox"
                      checked={agreementChecked}
                      onCheckedChange={(checked) => setAgreementChecked(checked === true)}
                      className="mt-0.5 shrink-0"
                    />
                    <label
                      htmlFor="agreement-checkbox"
                      className="text-sm leading-snug cursor-pointer select-none"
                    >
                      I have read and agree to the <strong>{agreement.title}</strong> (Version {agreement.version}). I confirm I have authority to bind my organisation to these terms.
                    </label>
                  </div>
                </>
              ) : (
                /* No published agreement — allow proceeding with a notice */
                <div className="rounded-lg border border-sidebar-border bg-muted/40 p-4 text-sm text-muted-foreground text-center">
                  No platform agreement is currently published. You may proceed.
                </div>
              )}

              <div className="flex justify-between pt-1">
                <Button variant="outline" onClick={() => { setStep("tier"); setError(null); }} className="gap-2">
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button
                  disabled={agreement !== null && !agreementChecked}
                  onClick={() => { setStep("checkout"); setError(null); }}
                  className="gap-2"
                >
                  Continue to Payment <ArrowRight className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Step 4: Checkout Confirmation ── */}
        {step === "checkout" && companyData && selectedTier && (
          <Card className="border-sidebar-border bg-card/95 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="size-5" /> Confirm & Pay</CardTitle>
              <CardDescription>Review your details before proceeding to Stripe's secure checkout.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-sidebar-border p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Company</span>
                  <span className="font-medium">{companyData.companyName}</span>
                </div>
                {companyData.domain && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Domain</span>
                    <span>{companyData.domain}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contact</span>
                  <span>{companyData.contactName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{companyData.contactEmail}</span>
                </div>
                <div className="border-t border-sidebar-border my-1" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium">{selectedTier.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Billing</span>
                  <span className="font-semibold text-sidebar-primary">
                    ${selectedTier.price ? parseFloat(selectedTier.price).toLocaleString("en-US", { minimumFractionDigits: 0 }) : "—"}/month
                  </span>
                </div>
                {agreement && (
                  <>
                    <div className="border-t border-sidebar-border my-1" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Agreement</span>
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="size-3.5" />
                        Accepted (v{agreement.version})
                      </span>
                    </div>
                  </>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                You'll be redirected to Stripe's secure checkout. Your MSP account will be automatically created once payment is confirmed. No manual provisioning required.
              </p>

              <div className="flex justify-between pt-1">
                <Button variant="outline" onClick={() => { setStep("agreement"); setError(null); }} className="gap-2" disabled={checkoutLoading}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button onClick={handleCheckout} disabled={checkoutLoading} className="gap-2">
                  {checkoutLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                  {checkoutLoading ? "Redirecting…" : "Pay & Activate"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-sidebar-foreground/50 pb-6">
          Already have an account?{" "}
          <button onClick={() => navigate("/login")} className="underline hover:text-sidebar-foreground">Sign in</button>
        </p>
      </div>
    </div>
  );
}

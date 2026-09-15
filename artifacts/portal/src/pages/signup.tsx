import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Loader2, Info } from "lucide-react";
import { SignupFlowShell } from "@/components/auth/SignupFlowShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  fetchSignupTiers,
  startMspSignup,
  formatTierPrice,
  MspSignupApiError,
  type SignupTier,
} from "@/lib/msp-signup-api";

interface CompanyDetails {
  companyName: string;
  domain: string;
  contactName: string;
  contactEmail: string;
}

/**
 * Signup — tier selection off the real services catalog (#3992, Feature
 * #1649). Wired to GET /api/msp/signup/tiers and POST /api/msp/signup/start
 * per the contract pack. Design: `Signup Agreement and Invite.dc.html`,
 * scene "tiers".
 *
 * The design's agreement checkbox + "read the full agreement" modal only
 * ever apply once a platform agreement is published. `GET
 * /api/platform/agreement/current` (and the admin UI that would publish one)
 * were deleted by Git #3412 ("no longer needed per Shane", 2026-09-10) — a
 * week after this Feature's own contract pack certified them live. Git #4048
 * restored the admin-publish path (`platform-agreements.ts`, the admin page,
 * its nav entry), so a version can be published again — but no version has
 * actually been published yet (the one `platform_agreements` row that has
 * ever existed was never published), so the "no agreement published" banner
 * below still reflects the current, real state rather than a state this page
 * polls for. `agreementVersion`/`agreementId`/`checkboxConfirmed` are
 * therefore never sent; the server's own gate (msp-signup.ts:150-196,
 * unaffected by #3412 — it queries the table directly) sees no current
 * agreement and proceeds, the same real no-op the design describes.
 */
export default function SignupPage() {
  const [tiers, setTiers] = useState<SignupTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [details, setDetails] = useState<CompanyDetails>({
    companyName: "",
    domain: "",
    contactName: "",
    contactEmail: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchSignupTiers();
        if (cancelled) return;
        setTiers(data);
        if (data.length > 0) setSelectedId(data[0].id);
      } catch (err) {
        if (!cancelled) setTiersError(err instanceof Error ? err.message : "Failed to load subscription tiers");
      } finally {
        if (!cancelled) setTiersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTier = tiers.find((t) => t.id === selectedId) ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!details.companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    if (!details.contactEmail.trim() || !details.contactEmail.includes("@")) {
      setError("A valid work email is required.");
      return;
    }
    if (!selectedTier) {
      setError("Choose a tier to continue.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await startMspSignup({
        companyName: details.companyName.trim(),
        domain: details.domain.trim() || undefined,
        contactName: details.contactName.trim() || undefined,
        contactEmail: details.contactEmail.trim(),
        serviceId: selectedTier.id,
      });
      window.location.href = result.checkoutUrl;
    } catch (err) {
      if (err instanceof MspSignupApiError) {
        setError(err.message);
      } else {
        setError("Failed to start checkout. Please try again.");
      }
      setSubmitting(false);
    }
  }

  function tierAllowanceLine(t: SignupTier): string | null {
    const attrs = t.typeAttributes ?? {};
    const label = attrs.tenantAllowanceLabel as string | undefined;
    const count = attrs.tenantAllowance as number | null | undefined;
    if (label) return `${label} customer tenants`;
    if (count === 0) return "Unlimited customer tenants";
    if (typeof count === "number") return `Up to ${count} customer tenant${count === 1 ? "" : "s"}`;
    return null;
  }

  function tierSeatsLine(t: SignupTier): string | null {
    const attrs = t.typeAttributes ?? {};
    const label = attrs.mspStaffSeatsLabel as string | undefined;
    const seats = attrs.mspStaffSeats as number | null | undefined;
    if (label) return `${label} MSP staff seats`;
    if (typeof seats === "number") return `${seats} MSP staff seat${seats === 1 ? "" : "s"}`;
    return null;
  }

  function tierSupportLine(t: SignupTier): string | null {
    const support = (t.typeAttributes ?? {}).support as string | undefined;
    if (!support) return null;
    return `${support.charAt(0).toUpperCase()}${support.slice(1)} support`;
  }

  function tierWhiteLabelLine(t: SignupTier): string | null {
    return (t.typeAttributes ?? {}).whiteLabel ? "White-label portal and emails" : null;
  }

  return (
    <SignupFlowShell
      brand="Shane McCaw Consulting"
      statusLine="Public · tiers read live · agreement not published"
      maxWidthClassName="max-w-[900px]"
    >
      <div className="flex max-w-[640px] flex-col gap-1.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-primary">
          FOR MANAGED SERVICE PROVIDERS
        </span>
        <span className="text-2xl font-bold leading-tight tracking-tight text-foreground">
          Run your customers' Microsoft 365 tenants on the platform
        </span>
        <span className="text-[13px] leading-relaxed text-muted-foreground">
          Pick a tier, agree to the platform terms, pay by card. Your provider account is created
          once payment is confirmed — not before.
        </span>
      </div>

      {tiersLoading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading tiers…
        </Card>
      ) : tiersError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load subscription tiers</AlertTitle>
          <AlertDescription>{tiersError}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((t) => {
            const lines = [tierAllowanceLine(t), tierSeatsLine(t), tierSupportLine(t), tierWhiteLabelLine(t)].filter(
              (l): l is string => !!l,
            );
            const selected = selectedId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`relative flex flex-col gap-2.5 rounded-[14px] border p-[18px_20px] text-left transition-colors ${
                  selected ? "border-primary/55 bg-primary/[0.06]" : "border-border bg-card/40 hover:border-primary/30"
                }`}
              >
                {t.badge ? (
                  <span className="absolute -top-2.5 left-[18px] rounded-full bg-primary px-2.5 py-[3px] text-[10px] font-bold tracking-wide text-primary-foreground">
                    {t.badge}
                  </span>
                ) : null}
                <span className="text-[15px] font-bold text-foreground">{t.name}</span>
                <span className="min-h-9 text-xs leading-relaxed text-muted-foreground">
                  {t.description ?? t.tagline ?? ""}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-[26px] font-extrabold tracking-tight text-foreground tabular-nums">
                    {formatTierPrice(t.priceCents)}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">per month</span>
                </div>
                {lines.length > 0 ? (
                  <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
                    {lines.map((l) => (
                      <span key={l} className="text-[11.5px] leading-relaxed text-foreground/80">
                        {l}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      <span className="max-w-[720px] text-[10.5px] leading-relaxed text-muted-foreground">
        Prices come from the single price resolver the checkout itself charges from, so what is
        shown is what is billed.
      </span>

      <Card className="flex flex-col gap-3 p-4">
        <span className="text-[13.5px] font-semibold text-foreground">Your details</span>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="companyName">Company name</Label>
              <Input
                id="companyName"
                placeholder="Northwind Managed IT"
                value={details.companyName}
                onChange={(e) => setDetails((d) => ({ ...d, companyName: e.target.value }))}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="domain">Company domain (optional)</Label>
              <Input
                id="domain"
                placeholder="northwind-it.com"
                value={details.domain}
                onChange={(e) => setDetails((d) => ({ ...d, domain: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="contactName">Your name</Label>
              <Input
                id="contactName"
                placeholder="Dana Whitfield"
                value={details.contactName}
                onChange={(e) => setDetails((d) => ({ ...d, contactName: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="contactEmail">Work email</Label>
              <Input
                id="contactEmail"
                type="email"
                placeholder="dana@northwind-it.com"
                value={details.contactEmail}
                onChange={(e) => setDetails((d) => ({ ...d, contactEmail: e.target.value }))}
                required
              />
            </div>
          </div>

          <Alert variant="warning" className="flex gap-2.5">
            <Info className="mt-0.5 size-[15px] flex-none" />
            <AlertDescription className="text-[11.5px] leading-relaxed text-foreground/80">
              No platform agreement has been published yet, so there is nothing to agree to and
              signup proceeds without the step. That is the platform's real state today.
            </AlertDescription>
          </Alert>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-3">
            <span className="max-w-[460px] text-[11px] leading-relaxed text-muted-foreground">
              Continues to card payment. Your account and your agreement record are created by the
              payment confirmation, so nothing exists yet if you close the payment page.
            </span>
            <Button type="submit" className="ml-auto flex-none" disabled={submitting || !selectedTier}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? "Redirecting…" : `Continue to payment — ${selectedTier?.name ?? ""}`}
            </Button>
          </div>
        </form>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </SignupFlowShell>
  );
}

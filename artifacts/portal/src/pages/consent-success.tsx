import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { ConsentOnboardingShell, ConsentCard, ConsentLedger } from "@/components/consent/ConsentOnboardingShell";
import { CaptchaGate } from "@/components/consent/CaptchaGate";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchCheckoutSession,
  fetchCatalogServices,
  loadGuestInfoCache,
  clearCheckoutCaches,
  serviceIsFree,
  postOnboardingContract,
  postCheckoutFree,
  ConsentOnboardingApiError,
  type CheckoutSessionInfo,
  type CatalogService,
} from "@/lib/consent-onboarding-api";

/**
 * Consent — success (Feature #1650, Git #3993). The real "portal"-origin
 * redirect target of GET /api/consent/callback (contract pack #2758 §1a):
 * `/portal/consent/success?tenant=<GUID>`.
 *
 * §9a's finding is load-bearing here: a `session` query param (the
 * "finalize" sub-scene the design also enumerates) only ever appears for a
 * popup-origin consent that got opened in a normal tab instead — every
 * checkout-session-backed consent otherwise resolves to the self-closing
 * popup page and never reaches this route at all. That degraded path is
 * real and handled (this page's own inline finalize), but it is the
 * exception, not the common case — the primary caller is an MSP-invite-link
 * or reconsent flow with no `session` param, which is the plain "connected"
 * acknowledgement below.
 */
export default function ConsentSuccessPage() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tenant = params.get("tenant");
  const sessionId = params.get("session");
  const isFinalize = !!sessionId;

  const [sessionInfo, setSessionInfo] = useState<CheckoutSessionInfo | null>(null);
  const [service, setService] = useState<CatalogService | null>(null);
  const [guestInfo, setGuestInfo] = useState<{ name: string; email: string; termsAccepted: boolean } | null>(null);
  const [loading, setLoading] = useState(isFinalize);

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [sentSetupEmail, setSentSetupEmail] = useState(false);
  const [error, setError] = useState<{ message: string; is409: boolean } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const sess = await fetchCheckoutSession(sessionId);
      if (cancelled) return;
      setSessionInfo(sess);
      if (sess) {
        const all = await fetchCatalogServices();
        if (!cancelled && all) {
          setService(all.find((s) => s.slug === sess.productSlug) ?? null);
        }
      }
      const cached = loadGuestInfoCache(sessionId);
      if (!cancelled && cached) setGuestInfo(cached);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const isFree = service ? serviceIsFree(service) : null;
  const productName = service?.name ?? null;
  const seats = sessionInfo?.seats ?? 1;
  const termsAccepted = guestInfo?.termsAccepted === true;
  const canFinalizeInline = isFinalize && isFree === true && !!service && !!guestInfo && termsAccepted;

  function goToCheckout() {
    const seatsParam = seats > 1 ? `&seats=${seats}` : "";
    window.location.href = sessionInfo
      ? `${window.location.origin}/checkout/${encodeURIComponent(sessionInfo.productSlug)}?session=${encodeURIComponent(sessionId ?? "")}${seatsParam}`
      : "/portal/";
  }

  async function handleFinalize() {
    if (!service || !guestInfo || !captchaToken) return;
    setFinalizing(true);
    setError(null);
    try {
      const { contractIds } = await postOnboardingContract({
        serviceIds: [service.id],
        guestEmail: guestInfo.email,
        signerName: guestInfo.name,
        seats,
      });
      const contractId = contractIds[0];
      if (!contractId) {
        setError({ message: "We couldn't finalize your order. Please try again.", is409: false });
        return;
      }
      const done = await postCheckoutFree({
        serviceIds: [service.id],
        contractIds: [contractId],
        guestEmail: guestInfo.email,
        captchaToken,
      });
      setSentSetupEmail(done.sentSetupEmail);
      if (sessionId) clearCheckoutCaches(sessionId);
      setFinalized(true);
    } catch (err) {
      if (err instanceof ConsentOnboardingApiError) {
        setError({ message: err.message, is409: err.status === 409 });
      } else {
        setError({ message: "A network error occurred. Please check your connection and try again.", is409: false });
      }
    } finally {
      setFinalizing(false);
    }
  }

  if (!isFinalize) {
    // Plain MSP-invite-link / reconsent acknowledgement — no order to finalize.
    return (
      <ConsentOnboardingShell stateLine="Consent callback · portal origin · granted">
        <ConsentCard>
          <div className="flex items-center gap-3">
            <span className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-status-green/25 bg-status-green/10">
              <CheckCircle2 className="size-[18px] text-status-green" />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-lg font-bold tracking-tight text-foreground">
                Your Microsoft 365 tenant is connected
              </span>
              {tenant ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  tenant {tenant} · consent granted by a Global Administrator
                </span>
              ) : null}
            </div>
          </div>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            Read access to your directory, usage reports and audit log was granted to one app
            registration, which covers both Microsoft Graph and SharePoint. Your organisation's
            account moved from onboarding to active the moment consent landed.
          </span>
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Already started in the background
            </span>
            {[
              "A first diagnostics run against your tenant — the six signal engines' opening read.",
              "Provisioning of the role groups that let DLP and sensitivity-label findings be read.",
              "A best-effort capture of your primary domain name for the portal header.",
            ].map((t) => (
              <div key={t} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-[5px] flex-none rounded-full bg-primary" />
                <span className="text-xs text-foreground/90">{t}</span>
              </div>
            ))}
            <span className="text-[11px] text-muted-foreground">
              None of these hold this page up, and none of them can fail it. First results appear
              on your Overview as they land.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3.5">
            <span className="max-w-[340px] text-[11px] text-muted-foreground">
              This link came from your provider and has now been used. It will not work a second
              time.
            </span>
            <Button className="ml-auto" onClick={() => (window.location.href = "/portal/")}>
              Continue to your portal
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </ConsentCard>
        <ConsentLedger />
      </ConsentOnboardingShell>
    );
  }

  if (finalized) {
    return (
      <ConsentOnboardingShell stateLine="Consent callback · same-tab fallback · registered">
        <ConsentCard>
          <span className="text-lg font-bold tracking-tight text-foreground">
            {sentSetupEmail ? "You're registered — check your email" : "You're registered — confirmation sent"}
          </span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            {sentSetupEmail
              ? `A setup link has been sent to ${guestInfo?.email ?? "your email"}. It works for 72 hours and is the only way to choose your password; this page does not sign you in.`
              : `Your account already had a password, so no setup link was needed. A confirmation of this order has been sent to ${guestInfo?.email ?? "your email"} instead.`}
          </span>
          <Button variant="outline" className="self-start" onClick={() => (window.location.href = "/portal/")}>
            Go to portal
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </ConsentCard>
        <ConsentLedger />
      </ConsentOnboardingShell>
    );
  }

  return (
    <ConsentOnboardingShell stateLine="Consent callback · same-tab fallback · session present">
      <ConsentCard>
        <div className="flex flex-col gap-1">
          <span className="text-lg font-bold tracking-tight text-foreground">
            Connected — one step left to finish your order
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Microsoft opened in this tab instead of a pop-up, so the checkout that started on the
            website is completed here. Your name and email were kept on this device by the
            checkout; this page only reads them.
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading your order…
          </div>
        ) : (
          <>
            <div className="flex flex-col border-t border-border/60">
              {[
                {
                  n: "1",
                  title: "Checkout session resolved",
                  detail: `${sessionInfo?.productSlug ?? "—"} · ${seats} seat${seats === 1 ? "" : "s"} · status: ${sessionInfo?.status ?? "—"}. Only those three fields come back — no name or email is ever served here.`,
                  done: !!sessionInfo,
                },
                {
                  n: "2",
                  title: "Service resolved from the public catalogue",
                  detail: `${productName ?? "—"}${isFree ? " — free offering" : ""}. Its price is checked again on the server before anything is created; a paid service cannot finish through this route.`,
                  done: !!service,
                },
                {
                  n: "3",
                  title: "Contract signed",
                  detail: "One contract per service, PDF generated and filed to your SharePoint contracts folder when possible — a filing failure never fails the signing.",
                  done: finalizing || error !== null,
                },
                {
                  n: "4",
                  title: "Free registration completed",
                  detail: "Creates your project, service record and a $0 invoice. Replaying the same order later changes nothing.",
                  done: finalized,
                },
              ].map((st) => (
                <div key={st.n} className="flex items-start gap-3 border-b border-border/40 py-2.5">
                  <span
                    className={`mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-full border text-[9.5px] font-bold ${
                      st.done ? "border-status-green/30 bg-status-green/10 text-status-green" : "border-primary/35 bg-primary/10 text-primary"
                    }`}
                  >
                    {st.n}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[12.5px] text-foreground">{st.title}</span>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">{st.detail}</span>
                  </div>
                </div>
              ))}
            </div>

            {error ? (
              error.is409 ? (
                <div className="flex gap-2.5 rounded-xl border border-dashed border-status-amber/50 bg-status-amber/[0.06] p-3.5">
                  <AlertCircle className="mt-0.5 size-[15px] flex-none text-status-amber" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      Your Microsoft 365 connection hasn't been set up yet
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      Please complete the connection step first so your order can be linked to
                      your organization. Registration was refused rather than creating an account
                      that belongs to no tenant — that has gone wrong before, and this stop exists
                      because of it.
                    </span>
                    <span className="font-mono text-[11px] text-status-amber">409 · consent-first</span>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" onClick={goToCheckout}>
                        Reconnect Microsoft 365
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => window.history.back()}>
                        Contact your provider
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              )
            ) : null}

            {canFinalizeInline ? (
              <div className="flex flex-col gap-2.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Signed by</span>
                <span className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2 text-[12.5px] text-foreground">
                  {guestInfo?.name}
                </span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  Typing your name is the signature for an assessment. A drawn signature is only
                  asked for on a project or retainer.
                </span>
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <span className="max-w-[320px] text-[11px] text-muted-foreground">
                    A human check runs before anything is created. Nothing is charged: this order
                    is $0.
                  </span>
                  <CaptchaGate onVerify={setCaptchaToken} />
                  <Button className="ml-auto" onClick={handleFinalize} disabled={finalizing || !captchaToken}>
                    {finalizing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Sign and complete registration
                  </Button>
                </div>
              </div>
            ) : !service || isFree !== true ? (
              <Button onClick={goToCheckout}>
                Continue to checkout{productName ? ` for ${productName}` : ""}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            ) : null}
          </>
        )}
      </ConsentCard>
      <ConsentLedger />
    </ConsentOnboardingShell>
  );
}

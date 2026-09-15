import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, FileCheck2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchCurrentAgreement,
  fetchAcceptanceStatus,
  acceptCurrentAgreement,
  PlatformAgreementApiError,
  type PlatformAgreement,
  type AcceptanceStatus,
} from "@/lib/platform-agreement-api";

/**
 * Accept Agreement (#4009, Feature #1649) — STUB UI PENDING DESIGN REVIEW.
 *
 * No `.dc.html` export exists for this scene (confirmed live in #4009 and the
 * #4049 contract pack — `Design/portal/` covers only the 3 signup/invite
 * scenes). Authorized as a real stub anyway by Shane, 2026-09-15: "a stub is
 * better than nothing" — wired to real endpoints and real data, matching the
 * platform's established shadcn/ui "new-york" component patterns and the
 * visual language of this Feature's other auth-adjacent pages
 * (accept-invite.tsx, sign-in-help.tsx), rather than waiting indefinitely on
 * a commissioned export. Reconcile against a real Design export if/when
 * Shane commissions one.
 *
 * The standalone, authenticated gate a signed-in MSP user hits when a
 * *newer* platform agreement version is published after they already have
 * an account — distinct from `signup.tsx`'s own inline clickwrap gate, which
 * only ever runs at signup time. Wired to the 3 real endpoints restored by
 * #4048 (`platform-agreement-api.ts`, contract pack
 * `Design/portal/design_handoff_full_site/docs/accept-agreement-contract-pack.md`):
 *
 *   - GET  /api/platform/agreement/current
 *   - GET  /api/platform/agreement/acceptance-status
 *   - POST /api/platform/agreement/accept
 *
 * Not a nav item — there is nothing to browse to on purpose. It renders only
 * for a signed-in user (this file guards for that itself; the endpoints
 * themselves require `ladder.free`), which is why it sits outside
 * `ProtectedRoutes`/`PortalLayout` in App.tsx alongside the other standalone
 * auth-adjacent screens rather than getting a sidebar entry — a user lands
 * here by direct link/redirect once a real version exists to accept, not by
 * browsing.
 *
 * Real, permanent common case today (contract pack §2, confirmed live
 * against the local DB): the only `platform_agreements` row that has ever
 * existed was never published, so `required` is `false` and every signed-in
 * user sees the "nothing to accept" state below — never fabricated as
 * "accepted", read honestly off the real endpoint.
 */
export default function AcceptAgreementPage() {
  const { user, isLoading: authLoading, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AcceptanceStatus | null>(null);
  const [agreement, setAgreement] = useState<PlatformAgreement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justAccepted, setJustAccepted] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await fetchAcceptanceStatus(fetchWithAuth);
        if (cancelled) return;
        setStatus(s);
        if (s.required && !s.accepted) {
          const current = await fetchCurrentAgreement();
          if (!cancelled) setAgreement(current);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof PlatformAgreementApiError ? err.message : "Failed to load the agreement");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  async function handleAccept() {
    if (!checked) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await acceptCurrentAgreement(fetchWithAuth);
      setJustAccepted(true);
    } catch (err) {
      setSubmitError(err instanceof PlatformAgreementApiError ? err.message : "Failed to record acceptance");
    } finally {
      setSubmitting(false);
    }
  }

  const nothingToAccept = !loading && !loadError && status && (!status.required || status.accepted);
  const needsAcceptance = !loading && !loadError && status?.required && !status.accepted && !justAccepted;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2.5 px-7 pt-[18px]">
        <span className="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-status-blue text-[10px] font-extrabold text-primary-foreground">
          SM
        </span>
        <span className="text-[13px] font-semibold text-foreground">Shane McCaw Consulting</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-status-green" />
          Platform agreement
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center gap-3.5 px-6 py-8 pb-14">
        <div className="flex w-full max-w-[600px] flex-col gap-4">
          {loading ? (
            <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking your agreement status…
            </Card>
          ) : loadError ? (
            <Card className="flex flex-col gap-1.5 p-6">
              <span className="text-[19px] font-bold tracking-tight text-foreground">Could not check your agreement status</span>
              <span className="text-[12.5px] leading-relaxed text-muted-foreground">{loadError}</span>
              <Button variant="outline" size="sm" className="mt-2 self-start" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </Card>
          ) : justAccepted ? (
            <Card className="flex flex-col gap-3 p-6">
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="size-5 text-status-green" />
                <span className="text-[19px] font-bold tracking-tight text-foreground">Thanks — you're all set</span>
              </div>
              <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                Your acceptance of the current platform agreement has been recorded.
              </span>
              <Button className="mt-1 self-start" onClick={() => navigate("/")}>
                Continue to the portal
              </Button>
            </Card>
          ) : needsAcceptance ? (
            <Card className="flex flex-col gap-3.5 p-6">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-primary">
                  UPDATED AGREEMENT{status?.version ? ` · VERSION ${status.version.toUpperCase()}` : ""}
                </span>
                <span className="text-[19px] font-bold tracking-tight text-foreground">
                  {agreement?.title ?? "Platform MSA + DPA"}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  A newer version of the platform agreement has been published since you last accepted. Read it
                  below and accept to continue.
                </span>
              </div>

              <div className="max-h-[360px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">
                {agreement?.body ?? "The agreement text could not be loaded."}
              </div>

              {submitError ? (
                <Alert variant="destructive">
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}

              <label className="flex items-start gap-2.5 border-t border-border pt-3.5">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => setChecked(v === true)}
                  className="mt-0.5"
                  data-testid="accept-agreement-checkbox"
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  I have read and agree to the platform agreement{status?.version ? ` (version ${status.version})` : ""}.
                </span>
              </label>

              <Button
                data-testid="accept-agreement-submit"
                className="self-start"
                disabled={!checked || submitting}
                onClick={() => void handleAccept()}
              >
                {submitting ? <Loader2 className="animate-spin" /> : null}
                Accept and continue
              </Button>
            </Card>
          ) : nothingToAccept ? (
            <Card className="flex flex-col gap-2 p-6" data-testid="accept-agreement-up-to-date">
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="size-5 text-status-green" />
                <span className="text-[19px] font-bold tracking-tight text-foreground">You're up to date</span>
              </div>
              <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                There is nothing to accept right now — no newer platform agreement has been published since you
                last signed in.
              </span>
              <Button className="mt-1 self-start" onClick={() => navigate("/")}>
                Continue to the portal
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

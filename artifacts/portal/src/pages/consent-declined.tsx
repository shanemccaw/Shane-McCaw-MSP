import { useEffect, useState } from "react";
import { ConsentOnboardingShell, ConsentCard } from "@/components/consent/ConsentOnboardingShell";
import { Button } from "@/components/ui/button";
import { fetchConsentScopes, scopeWhy } from "@/lib/consent-onboarding-api";

/**
 * Consent — declined (Feature #1650, Git #3993). Real target of
 * GET /api/consent/callback's `"portal"`-origin decline redirect (contract
 * pack #2758 §1b): `/portal/consent/declined?tenant=<GUID>`.
 *
 * The scope list reads the live GET /api/public/consent-scopes manifest
 * (added alongside this page) rather than a hand-typed copy, per §9b's own
 * finding — a display list with no compiler/runtime tie to REQUIRED_MT_SCOPES
 * is drift-risk the moment that array changes.
 */
export default function ConsentDeclinedPage() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tenant = params.get("tenant");

  const [scopes, setScopes] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchConsentScopes().then((s) => {
      if (!cancelled) setScopes(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ConsentOnboardingShell stateLine="Consent callback · access_denied" isAlert>
      <ConsentCard>
        <div className="flex flex-col gap-1">
          <span className="text-lg font-bold tracking-tight text-foreground">Consent was not granted</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            No changes were made to your Microsoft 365 tenant. Nothing was read, nothing was
            created, and no charge was made.
          </span>
          {tenant ? (
            <span className="font-mono text-[11px] text-muted-foreground">tenant {tenant}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            What would have been requested · read from the live scope manifest
          </span>
          {scopes === null ? (
            <span className="text-xs text-muted-foreground">Reading the current scope manifest…</span>
          ) : (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {scopes.map((s) => (
                <div key={s} className="flex flex-wrap items-baseline gap-3">
                  <span className="w-[190px] flex-none font-mono text-[11.5px] text-foreground/90">{s}</span>
                  <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {scopeWhy(s)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <span className="text-[11px] text-muted-foreground">
            All read-only. Nothing here can change a setting, a user or a policy in your tenant.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3.5">
          <span className="max-w-[330px] text-[11px] text-muted-foreground">
            Declining used up the invitation link, the same way accepting would have. There is no
            retry from here — your provider issues a fresh one.
          </span>
          <Button variant="outline" className="ml-auto" onClick={() => window.history.back()}>
            Ask for a new link
          </Button>
        </div>
      </ConsentCard>
    </ConsentOnboardingShell>
  );
}

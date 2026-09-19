import { ConsentOnboardingShell, ConsentCard } from "@/components/consent/ConsentOnboardingShell";
import { Button } from "@/components/ui/button";

/**
 * Consent — tenant conflict (Feature #1650, Git #3993). Real target of
 * GET /api/consent/callback's `"portal"`-origin conflict redirect (contract
 * pack #2758 §1c): `/portal/consent/tenant-conflict?tenant=<GUID>`, fired
 * when the Microsoft tenant that just consented already belongs to a
 * different MSP — the guard behind a real, cited past cross-tenant leak. No
 * payment occurred and no row was written on this path; the copy below says
 * so rather than offering a way round it.
 */
export default function ConsentTenantConflictPage() {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tenant = params.get("tenant");

  return (
    <ConsentOnboardingShell stateLine="Consent callback · tenant belongs to another MSP" isAlert>
      <ConsentCard tone="danger">
        <div className="flex flex-col gap-1">
          <span className="text-lg font-bold tracking-tight text-foreground">
            This tenant is already managed by a different provider
          </span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">
            The Microsoft 365 organisation that just consented belongs to another provider's book.
            We stopped before doing anything: no payment was taken, no account was created and
            nothing in your tenant was touched.
          </span>
        </div>
        <span className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
          This stop exists so one organisation's data can never appear inside another provider's
          portal. If you believe this tenant should move, that is a conversation between the two
          providers, not a button here.
        </span>
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-3.5">
          {tenant ? <span className="font-mono text-[11px] text-muted-foreground">tenant {tenant}</span> : null}
          <Button variant="outline" className="ml-auto" onClick={() => window.history.back()}>
            Contact your provider
          </Button>
        </div>
      </ConsentCard>
    </ConsentOnboardingShell>
  );
}

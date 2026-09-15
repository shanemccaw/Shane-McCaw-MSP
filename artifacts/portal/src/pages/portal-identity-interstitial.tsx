import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ConsentOnboardingShell, ConsentCard, ConsentLedger } from "@/components/consent/ConsentOnboardingShell";

/**
 * Identity interstitial (Feature #1650, Git #3993; originally Git #1296).
 * `/portal/` is customer-only. A staff role (PlatformAdmin, MSPAdmin,
 * MSPOperator, ServiceAccount, Free, RetainerNoConsent, RetainerConsented)
 * that authenticates here instead of at /admin-panel/ needs to know that's
 * what happened, rather than silently landing on a customer page —
 * App.tsx's RequireAuth renders this in place of the protected routes
 * whenever `user.mspRole` is present and isn't `"Customer"`. Not a routed
 * page: there is no dedicated URL, it is a client-side gate on the JWT
 * already in hand (contract pack #2758 §7 — no endpoint of its own).
 *
 * Git #4088 — `CustomerUser` was renamed `Customer` (and `Assessment`
 * folded into `Free`) by #3590; this file's own copy of the taxonomy had not
 * been updated, so every real Customer failed `!== "CustomerUser"` above and
 * was wrongly shown this screen. Mirrors `LEGACY_ROLE_ORDER` /
 * `LEGACY_ROLE` in `lib/db/src/rbac/legacy-ladder.ts` (the real, current
 * 8-value taxonomy) as a local literal rather than importing
 * `@workspace/db` into this Vite app — the same reason
 * `account-security-api.ts` (`artifacts/msp-console`) keeps its own literal
 * copy instead of importing the server's Drizzle schema type.
 */
const ROLE_LABELS: Record<string, string> = {
  Free: "Free",
  RetainerNoConsent: "Retainer (No Consent)",
  RetainerConsented: "Retainer (Consented)",
  Customer: "Customer",
  ServiceAccount: "Service Account",
  MSPOperator: "MSP Operator",
  MSPAdmin: "MSP Admin",
  PlatformAdmin: "Platform Admin",
};
const ALL_ROLES = [
  "Free",
  "RetainerNoConsent",
  "RetainerConsented",
  "Customer",
  "ServiceAccount",
  "MSPOperator",
  "MSPAdmin",
  "PlatformAdmin",
];

export default function PortalIdentityInterstitialPage({ onContinue }: { onContinue: () => void }) {
  const { user, logout } = useAuth();
  const roleLabel = (user?.mspRole && ROLE_LABELS[user.mspRole]) || "a staff";

  async function handleLogOut() {
    await logout();
    window.location.href = `${window.location.origin}/admin-panel/`;
  }

  return (
    <ConsentOnboardingShell stateLine="Client-side · role read from your token">
      <ConsentCard>
        <div className="flex flex-col gap-1" data-testid="identity-interstitial-card">
          <span className="text-lg font-bold tracking-tight text-foreground">
            You signed in with a staff account
          </span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground" data-testid="identity-interstitial-role">
            This is the customer portal. Your session carries the{" "}
            <span className="font-semibold text-foreground">{roleLabel}</span> role, whose home is
            the Admin Panel. Nothing here is broken — you are just in the customer-facing half of
            the platform.
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
          {ALL_ROLES.map((r) => (
            <span
              key={r}
              className={`rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${
                r === "Customer"
                  ? "border-status-green/25 bg-status-green/10 text-status-green"
                  : "border-border/50 bg-muted/40 text-muted-foreground"
              }`}
            >
              {ROLE_LABELS[r]}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          The eight roles the platform knows. Only Customer belongs on this side; the rest are
          read straight from your signed-in token — no request was made to decide this.
        </span>

        <div className="flex flex-wrap gap-2.5 border-t border-border/60 pt-3.5">
          <Button variant="outline" data-testid="identity-interstitial-logout" onClick={() => void handleLogOut()}>
            Log out and sign in at the Admin Panel
          </Button>
          <Button data-testid="identity-interstitial-accept" onClick={onContinue}>
            Continue into the customer portal
          </Button>
        </div>
      </ConsentCard>
      <ConsentLedger />
    </ConsentOnboardingShell>
  );
}

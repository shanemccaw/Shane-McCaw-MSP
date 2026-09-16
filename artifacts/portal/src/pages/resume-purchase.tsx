import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ConsentOnboardingShell, ConsentCard } from "@/components/consent/ConsentOnboardingShell";

/**
 * Resume-your-purchase stub (Feature #4370/#4376, Issue 3 of #4376 — #4379).
 *
 * The real destination the pending-purchase gate (#4375,
 * `pending-purchase-gate.ts`) sends every request to for a `*Pending`
 * account: `MonitoringPending` / `PackPending` / `RetainerPending` holds a
 * real, immediately-usable account (#4374) with no tenant yet — the only
 * thing left is the Microsoft consent step, so there is exactly one real
 * "stage" to report, not a machine to render. Per Shane's confirmation on
 * #4370: a `*Pending` account can see ONLY this screen — nothing else in the
 * portal (enforced client-side in App.tsx's RequireAuth, and server-side by
 * the gate for every API call).
 *
 * `product`/`email`/`mspRole` are read straight off the signed JWT already in
 * hand (the same source `PortalIdentityInterstitialPage` reads `mspRole`
 * from) — no fixture copy and no extra request; the account row that minted
 * that token is the real state. "Continue" hands off to the marketing site's
 * existing `/buy?product=...` entry point (same origin, root path — see
 * `.replit-artifact/artifact.toml` for both apps' path prefixes), which is
 * the live, working way to reach Microsoft consent today and will pick this
 * session up mid-flow once #4377/#4378 land their account-first reorder.
 *
 * No dedicated `.dc.html` design export exists for this screen (checked
 * `Design/portal/`) — it is a stub by the issue's own title, so this reuses
 * the same undesigned utility chrome (`ConsentOnboardingShell`/`ConsentCard`)
 * the staff interstitial uses, rather than inventing a one-off look.
 */
const PRODUCT_BY_PENDING_ROLE: Record<string, { slug: "monitoring" | "pack" | "retainer"; label: string }> = {
  MonitoringPending: { slug: "monitoring", label: "Monitoring" },
  PackPending: { slug: "pack", label: "Configuration Pack" },
  RetainerPending: { slug: "retainer", label: "Fractional Retainer" },
};

export default function ResumePurchasePage() {
  const { user, logout } = useAuth();
  const product = (user?.mspRole && PRODUCT_BY_PENDING_ROLE[user.mspRole]) || null;

  async function handleLogOut() {
    await logout();
    window.location.href = `${window.location.origin}/login`;
  }

  function handleContinue() {
    if (!product) return;
    window.location.href = `${window.location.origin}/buy?product=${product.slug}`;
  }

  return (
    <ConsentOnboardingShell stateLine="Account created · Microsoft consent not yet granted">
      <ConsentCard>
        <div className="flex flex-col gap-1" data-testid="resume-purchase-card">
          <span className="text-lg font-bold tracking-tight text-foreground">
            Your {product?.label ?? "purchase"} account is ready — pick up where you left off
          </span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground" data-testid="resume-purchase-status">
            {user?.email ? (
              <>
                Signed in as <span className="font-semibold text-foreground">{user.email}</span>.{" "}
              </>
            ) : null}
            Your account is real and already usable, but no Microsoft tenant is connected yet. The
            next step is granting consent for {product?.label ?? "your product"} — nothing else in
            the portal is available until that's done.
          </span>
        </div>

        <div className="flex flex-wrap gap-2.5 border-t border-border/60 pt-3.5">
          <Button variant="outline" data-testid="resume-purchase-logout" onClick={() => void handleLogOut()}>
            Log out
          </Button>
          <Button data-testid="resume-purchase-continue" onClick={handleContinue} disabled={!product}>
            Continue to Microsoft consent
          </Button>
        </div>
      </ConsentCard>
    </ConsentOnboardingShell>
  );
}

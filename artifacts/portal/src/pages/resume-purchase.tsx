import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ConsentOnboardingShell, ConsentCard } from "@/components/consent/ConsentOnboardingShell";
import { Loader2 } from "lucide-react";

/**
 * Resume-your-purchase stub (Feature #4370/#4376, Issue 3 of #4376 — #4379).
 *
 * The real destination the pending-purchase gate (#4375,
 * `pending-purchase-gate.ts`) sends every request to for a `*Pending`
 * account: `MonitoringPending` / `PackPending` / `RetainerPending` holds a
 * real, immediately-usable account (#4374) with no tenant yet. Per Shane's
 * confirmation on #4370: a `*Pending` account can see ONLY this screen —
 * nothing else in the portal (enforced client-side in App.tsx's RequireAuth,
 * and server-side by the gate for every API call).
 *
 * Real per-user state has two tiers, in the order each became available:
 *
 *   1. `product`/`email`/`mspRole` off the signed JWT already in hand (the
 *      same source `PortalIdentityInterstitialPage` reads `mspRole` from) —
 *      always available the instant this renders, no request needed.
 *   2. For Monitoring/Packs/Retainer (`GET /api/public/purchase/resume`,
 *      landed on `main` by #4377 the same day as this issue; Retainer joined
 *      with #4383 — `productCategory` is `"monitoring"`, `"config_pack"` or
 *      `"retainer"`, `ACCOUNT_FIRST_CATEGORIES` in `account-first-purchase.ts`):
 *      the buyer's actual unfinished
 *      checkout session — seats and real status (`pending`/`consented`/
 *      `paid`), not just "there is exactly one stage left". Already under
 *      `/public/*`, so it needs no addition to the pending-purchase gate's
 *      allowlist. A 404 (`no_purchase_in_progress`) is expected and not an
 *      error — a session can genuinely lapse past its resume window, and a
 *      Retainer bought before #4383 has no account-bound session; the JWT
 *      tier above still carries the page in either case.
 *
 * "Continue" hands off to the marketing site's `/buy?product=...` entry
 * point (same origin, root path — see `.replit-artifact/artifact.toml` for
 * both apps' path prefixes). With a real resume session found, it adds
 * `&resume=1`, the query param #4377 wired Buy.tsx's own sign-in-to-resume
 * panel to (that panel re-authenticates independently — Buy.tsx is a
 * separate app/bundle and cannot read this portal's in-memory token — then
 * calls this same endpoint to land the buyer back on their real stage).
 *
 * No dedicated `.dc.html` design export exists for this screen (checked
 * `Design/portal/`) — it is a stub by the issue's own title, so this reuses
 * the same undesigned utility chrome (`ConsentOnboardingShell`/`ConsentCard`)
 * the staff interstitial uses, rather than inventing a one-off look.
 */
const PRODUCT_BY_PENDING_ROLE: Record<string, { buyProduct: "monitoring" | "pack" | "retainer"; label: string }> = {
  MonitoringPending: { buyProduct: "monitoring", label: "Monitoring" },
  PackPending: { buyProduct: "pack", label: "Configuration Pack" },
  RetainerPending: { buyProduct: "retainer", label: "Fractional Retainer" },
};

/** `checkout_sessions` categories `findResumablePurchase` can return (account-first-purchase.ts). */
const BUY_PRODUCT_BY_CATEGORY: Record<string, "monitoring" | "pack" | "retainer"> = {
  monitoring: "monitoring",
  config_pack: "pack",
  // #4383 — Retainer is account-first too, so its session is resumable.
  retainer: "retainer",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Microsoft consent not yet granted",
  consented: "Consent granted — payment not yet completed",
  paid: "Paid — finishing setup",
};

/** `GET /api/public/purchase/resume` response shape (public-purchase-resume.ts). */
interface ResumablePurchase {
  sessionId: string;
  productSlug: string;
  productCategory: string;
  seats: number;
  status: "pending" | "consented" | "paid";
  tenantConnected: boolean;
  email: string;
  fullName: string;
  company: string | null;
  renewed: boolean;
}

export default function ResumePurchasePage() {
  const { user, logout, fetchWithAuth } = useAuth();
  const roleProduct = (user?.mspRole && PRODUCT_BY_PENDING_ROLE[user.mspRole]) || null;

  const [purchase, setPurchase] = useState<ResumablePurchase | null>(null);
  const [checkedPurchase, setCheckedPurchase] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/public/purchase/resume", undefined, { silent: true })
      .then((res) => (res.ok ? (res.json() as Promise<ResumablePurchase>) : null))
      .then((data) => {
        if (!cancelled) setPurchase(data);
      })
      .catch(() => {
        if (!cancelled) setPurchase(null);
      })
      .finally(() => {
        if (!cancelled) setCheckedPurchase(true);
      });
    return () => {
      cancelled = true;
    };
    // fetchWithAuth is recreated on every access-token change (silent refresh);
    // this should run once per mount, not on each refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buyProduct = purchase ? (BUY_PRODUCT_BY_CATEGORY[purchase.productCategory] ?? roleProduct?.buyProduct) : roleProduct?.buyProduct;
  const productLabel = purchase
    ? purchase.productCategory === "config_pack"
      ? "Configuration Pack"
      : purchase.productCategory === "monitoring"
        ? "Monitoring"
        : purchase.productCategory === "retainer"
          ? "Fractional Retainer"
          : (roleProduct?.label ?? "purchase")
    : (roleProduct?.label ?? "purchase");

  async function handleLogOut() {
    await logout();
    window.location.href = `${window.location.origin}/login`;
  }

  function handleContinue() {
    if (!buyProduct) return;
    const resumeParam = purchase ? "&resume=1" : "";
    window.location.href = `${window.location.origin}/buy?product=${buyProduct}${resumeParam}`;
  }

  return (
    <ConsentOnboardingShell
      stateLine={
        checkedPurchase
          ? purchase
            ? STATUS_LABEL[purchase.status]
            : "Account created · Microsoft consent not yet granted"
          : "Reading your account…"
      }
    >
      <ConsentCard>
        <div className="flex flex-col gap-1" data-testid="resume-purchase-card">
          <span className="text-lg font-bold tracking-tight text-foreground">
            Your {productLabel} account is ready — pick up where you left off
          </span>
          {!checkedPurchase ? (
            <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Checking for an unfinished purchase…
            </span>
          ) : (
            <span className="text-[12.5px] leading-relaxed text-muted-foreground" data-testid="resume-purchase-status">
              {user?.email ? (
                <>
                  Signed in as <span className="font-semibold text-foreground">{user.email}</span>.{" "}
                </>
              ) : null}
              {purchase ? (
                <>
                  {productLabel}
                  {purchase.seats > 0 ? ` · ${purchase.seats.toLocaleString("en-US")} seats` : ""} ·{" "}
                  {STATUS_LABEL[purchase.status]}. Your account is real and already usable — nothing
                  else in the portal is available until this purchase is finished.
                </>
              ) : (
                <>
                  Your account is real and already usable, but no Microsoft tenant is connected yet.
                  The next step is granting consent for {productLabel} — nothing else in the portal
                  is available until that's done.
                </>
              )}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5 border-t border-border/60 pt-3.5">
          <Button variant="outline" data-testid="resume-purchase-logout" onClick={() => void handleLogOut()}>
            Log out
          </Button>
          <Button data-testid="resume-purchase-continue" onClick={handleContinue} disabled={!buyProduct || !checkedPurchase}>
            Continue to Microsoft consent
          </Button>
        </div>
      </ConsentCard>
    </ConsentOnboardingShell>
  );
}

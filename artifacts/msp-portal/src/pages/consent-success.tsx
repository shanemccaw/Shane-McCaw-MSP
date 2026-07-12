import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, ArrowRight, Loader2 } from "lucide-react";

interface CheckoutSessionInfo {
  productSlug: string;
  status: string;
  seats: number;
}

const PRODUCT_NAMES: Record<string, string> = {
  "m365-jumpstart": "Microsoft 365 Jumpstart",
  "copilot-readiness": "Copilot AI Readiness Assessment",
  "sharepoint-intranet": "SharePoint Intranet Build",
  "governance-health": "Governance Health Check",
  "power-automate": "Power Platform Automation",
  "tenant-migration": "Microsoft 365 Tenant Migration",
};

function getProductName(slug: string): string {
  return PRODUCT_NAMES[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ConsentSuccessPage() {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const tenant = params.get("tenant");
  const sessionId = params.get("session");

  const [sessionInfo, setSessionInfo] = useState<CheckoutSessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(!!sessionId);

  useEffect(() => {
    if (!sessionId) return;
    setSessionLoading(true);
    fetch(`/api/public/checkout-session/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<CheckoutSessionInfo>) : null))
      .then((d) => setSessionInfo(d))
      .catch(() => setSessionInfo(null))
      .finally(() => setSessionLoading(false));
  }, [sessionId]);

  const productName = sessionInfo ? getProductName(sessionInfo.productSlug) : null;

  function handleContinueToPayment() {
    if (!sessionInfo) return;
    const base = window.location.origin;
    const seatsParam = sessionInfo.seats > 1 ? `&seats=${sessionInfo.seats}` : "";
    window.location.href = `${base}/checkout?product=${encodeURIComponent(sessionInfo.productSlug)}&session=${encodeURIComponent(sessionId ?? "")}${seatsParam}`;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
            <ShieldCheck className="h-8 w-8 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Consent Granted
          </h1>
          <p className="text-muted-foreground">
            Your organisation has been successfully connected to the platform.
          </p>
          {tenant && (
            <p className="text-xs font-mono text-muted-foreground/60 bg-muted px-3 py-1.5 rounded-md inline-block">
              Tenant: {tenant}
            </p>
          )}
        </div>

        {/* What happens next */}
        <Alert>
          <AlertDescription className="text-sm leading-relaxed">
            Your Microsoft 365 Global Administrator clicked <strong>Accept</strong>{" "}
            on the Microsoft permissions screen. The platform can now access your
            organisation's data according to the granted permissions.
          </AlertDescription>
        </Alert>

        {/* Next steps */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">What happens next</h2>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>Your MSP has been notified that consent was granted.</li>
            <li>
              Your organisation's Microsoft 365 data will begin syncing
              shortly.
            </li>
            <li>
              You can now sign in to the portal to view your dashboard and
              reports.
            </li>
          </ol>
        </div>

        {/* Action — shows "Continue to payment" when session is present, else portal link */}
        {sessionId ? (
          sessionLoading ? (
            <Button className="w-full" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </Button>
          ) : sessionInfo ? (
            <Button className="w-full" onClick={handleContinueToPayment}>
              Continue to payment{productName ? ` for ${productName}` : ""}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={() => { window.location.href = "/portal/"; }}
            >
              Go to portal
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )
        ) : (
          <Button
            className="w-full"
            onClick={() => { window.location.href = "/portal/"; }}
          >
            Go to portal
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}

        <p className="text-center text-xs text-muted-foreground">
          If you have any questions, please contact your MSP directly.
        </p>
      </div>
    </div>
  );
}

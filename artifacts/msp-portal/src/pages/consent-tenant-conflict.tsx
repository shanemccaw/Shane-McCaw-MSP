import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, ArrowRight, LifeBuoy } from "lucide-react";

/**
 * Shown when a self-service checkout's Microsoft tenant is already connected to
 * a DIFFERENT account (MSP) than the one making the purchase. The consent
 * callback rejects the purchase before payment rather than silently linking the
 * buyer to another organisation's data — see routes/consent.ts.
 */
export default function ConsentTenantConflictPage() {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const tenant = params.get("tenant");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            This Microsoft Tenant Is Already Connected
          </h1>
          <p className="text-muted-foreground">
            The Microsoft 365 organisation you just approved is already
            connected to a different account and can&apos;t be used for this
            purchase. No payment has been taken and no changes were made to your
            Microsoft 365 tenant.
          </p>
          {tenant && (
            <p className="text-xs font-mono text-muted-foreground/60 bg-muted px-3 py-1.5 rounded-md inline-block">
              Tenant: {tenant}
            </p>
          )}
        </div>

        {/* What happened */}
        <Alert>
          <AlertDescription className="text-sm leading-relaxed">
            To protect your data, we don&apos;t allow the same Microsoft 365
            tenant to be linked to more than one account. Because this tenant is
            already connected elsewhere, we stopped the checkout before charging
            you.
          </AlertDescription>
        </Alert>

        {/* Next steps */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-muted-foreground shrink-0" />
            <h2 className="text-sm font-semibold">What to do next</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            If you believe this is a mistake, or you expected this tenant to be
            available for this purchase, please contact support and mention the
            tenant ID above so we can look into it for you.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            className="flex-1"
            onClick={() => {
              window.location.href = "/portal/";
            }}
          >
            Return to portal
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Need help? Contact support and reference the tenant ID shown above.
        </p>
      </div>
    </div>
  );
}

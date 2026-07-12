import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldX, RefreshCw, ArrowRight, Lock } from "lucide-react";

const REQUIRED_PERMISSIONS = [
  {
    name: "Directory.Read.All",
    reason: "Read your organisation's users, groups, and directory objects so we can map Microsoft 365 licences to seats.",
  },
  {
    name: "User.Read.All",
    reason: "Enumerate licensed users to track seat consumption and identify unassigned licences.",
  },
  {
    name: "Reports.Read.All",
    reason: "Fetch Microsoft 365 usage analytics (active users, storage, service health) to surface insights on your dashboard.",
  },
  {
    name: "AuditLog.Read.All",
    reason: "Read sign-in and audit logs to support compliance reporting and anomaly detection.",
  },
];

export default function ConsentDeclinedPage() {
  const [location] = useLocation();

  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const tenant = params.get("tenant");

  function handleContactMsp() {
    window.history.back();
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <ShieldX className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Consent Not Granted
          </h1>
          <p className="text-muted-foreground">
            Your organisation has not yet been connected to the platform. No
            changes were made to your Microsoft 365 tenant.
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
            You (or the Microsoft 365 Global Admin) clicked <strong>No</strong>{" "}
            at the Microsoft permission screen. This is completely safe — no
            data was accessed or shared. The connection simply wasn't
            established.
          </AlertDescription>
        </Alert>

        {/* Permissions needed */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
            <h2 className="text-sm font-semibold">
              Permissions required &amp; why
            </h2>
          </div>
          <ul className="space-y-3">
            {REQUIRED_PERMISSIONS.map((perm) => (
              <li key={perm.name} className="space-y-0.5">
                <p className="text-xs font-mono font-medium text-foreground">
                  {perm.name}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {perm.reason}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground pt-1 border-t">
            All permissions are <strong>read-only</strong>. The platform never
            writes to or modifies your Microsoft 365 environment.
          </p>
        </div>

        {/* Next steps */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">What to do next</h2>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
            <li>
              Contact your MSP and ask them to send you a fresh consent link.
            </li>
            <li>
              Forward the link to your organisation's{" "}
              <strong>Microsoft 365 Global Administrator</strong>.
            </li>
            <li>
              The Global Admin opens the link and clicks{" "}
              <strong>Accept</strong> on the Microsoft permissions screen.
            </li>
            <li>Your organisation will be connected automatically.</li>
          </ol>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleContactMsp}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Go back
          </Button>
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
          If you believe this was a mistake or need help, please contact your
          MSP directly.
        </p>
      </div>
    </div>
  );
}

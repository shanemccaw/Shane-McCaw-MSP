/**
 * Billing Settings sub-page.
 * Surfaces subscription status and opens Stripe Billing Portal for card management.
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, CreditCard, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Link } from "wouter";

interface BillingInfo {
  status: string;
  dunningState: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  tenantCountSnapshot: number;
  contactEmail: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past Due",
  canceled: "Cancelled",
  unpaid: "Unpaid",
};

const DUNNING_LABELS: Record<string, string> = {
  reminder_sent: "Payment Reminder Sent",
  suspended: "Suspended",
  access_revoked: "Access Revoked",
  archival_flagged: "Flagged for Archival",
};

export default function SettingsBillingPage() {
  const { fetchWithAuth } = useAuth();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/msp/settings/billing")
      .then((r) => r.json())
      .then((data: BillingInfo | null) => setBilling(data))
      .catch(() => toast.error("Failed to load billing info"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  async function openStripePortal() {
    setOpeningPortal(true);
    try {
      const res = await fetchWithAuth("/api/msp/settings/billing/portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        window.location.href = data.url;
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to open billing portal");
      }
    } finally {
      setOpeningPortal(false);
    }
  }

  const statusVariant = (s: string) => {
    if (s === "active" || s === "trialing") return "default";
    if (s === "past_due" || s === "unpaid") return "destructive";
    return "secondary";
  };

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  return (
    <AppShell title="Billing" actions={actions}>
      <div className="p-6 max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <CreditCard className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Billing</h2>
            <p className="text-sm text-muted-foreground">Manage your subscription and payment details.</p>
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
            </CardContent>
          </Card>
        ) : !billing ? (
          <Card>
            <CardContent className="pt-6 pb-6 text-center">
              <p className="text-sm text-muted-foreground">No subscription found.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Contact your platform administrator to set up a subscription.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Subscription Status
                  <Badge variant={statusVariant(billing.status) as "default" | "destructive" | "secondary"} className="text-[11px]">
                    {STATUS_LABELS[billing.status] ?? billing.status}
                  </Badge>
                </CardTitle>
                {billing.dunningState && (
                  <CardDescription className="text-xs text-destructive font-medium">
                    ⚠ {DUNNING_LABELS[billing.dunningState] ?? billing.dunningState}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {billing.currentPeriodStart && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Period Start</dt>
                      <dd className="font-medium mt-0.5">
                        {new Date(billing.currentPeriodStart).toLocaleDateString()}
                      </dd>
                    </div>
                  )}
                  {billing.currentPeriodEnd && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Period End</dt>
                      <dd className="font-medium mt-0.5">
                        {new Date(billing.currentPeriodEnd).toLocaleDateString()}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Active Tenants</dt>
                    <dd className="font-medium mt-0.5">{billing.tenantCountSnapshot}</dd>
                  </div>
                  {billing.contactEmail && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Billing Email</dt>
                      <dd className="font-medium mt-0.5 truncate">{billing.contactEmail}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>

            {billing.stripeCustomerId && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Payment Method</CardTitle>
                  <CardDescription className="text-xs">
                    Manage your card on file, download invoices, and update billing details via the Stripe portal.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={openingPortal}
                    onClick={() => void openStripePortal()}
                  >
                    {openingPortal
                      ? <Loader2 className="size-3.5 animate-spin" />
                      : <ExternalLink className="size-3.5" />}
                    Open Billing Portal
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Partner Revenue View — real wholesale spend (what this MSP pays the platform)
 * plus a clearly-labeled, self-declared pricing worksheet (what the MSP has set
 * as resale prices on its Sales Bundles). The platform has no visibility into
 * what an MSP actually charges its own customers — invoicing happens entirely
 * outside this platform — so the worksheet section is never presented as real
 * revenue.
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, DollarSign, Info } from "lucide-react";
import { Link } from "wouter";

interface WholesaleSpend {
  tierName: string;
  status: string;
  dunningState: string | null;
  billingInterval: string;
  monthlyCostCents: number | null;
  annualPriceCents: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  activeTenantCount: number;
}

interface WorksheetBundle {
  bundleId: string;
  name: string;
  status: string;
  activeAssignmentCount: number;
  resalePriceCentsPerUnit: number;
  internalCostCentsPerUnit: number;
  worksheetMonthlyResaleCents: number;
  worksheetMonthlyCostCents: number;
  worksheetMonthlyMarginCents: number;
}

interface RevenueData {
  wholesaleSpend: WholesaleSpend | null;
  pricingWorksheet: {
    disclaimer: string;
    bundles: WorksheetBundle[];
  };
}

const STATUS_LABELS: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past Due",
  canceled: "Cancelled",
  unpaid: "Unpaid",
};

function fmtCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RevenuePage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/msp/billing/revenue")
      .then((r) => r.json())
      .then((d: RevenueData) => setData(d))
      .catch(() => toast.error("Failed to load partner revenue"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const statusVariant = (s: string) => {
    if (s === "active" || s === "trialing") return "default";
    if (s === "past_due" || s === "unpaid") return "destructive";
    return "secondary";
  };

  const actions = (
    <Link href="/settings/billing">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Billing
      </Button>
    </Link>
  );

  const worksheet = data?.pricingWorksheet;
  const totals = worksheet?.bundles.reduce(
    (acc, b) => ({
      resale: acc.resale + b.worksheetMonthlyResaleCents,
      cost: acc.cost + b.worksheetMonthlyCostCents,
      margin: acc.margin + b.worksheetMonthlyMarginCents,
    }),
    { resale: 0, cost: 0, margin: 0 },
  );

  return (
    <AppShell title="Partner Revenue" actions={actions}>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <DollarSign className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Partner Revenue</h2>
            <p className="text-sm text-muted-foreground">
              What you pay the platform, and your own resale pricing worksheet.
            </p>
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
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Your Wholesale Spend</CardTitle>
                <CardDescription className="text-xs">
                  What you pay the platform for your subscription — real, from Stripe.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!data?.wholesaleSpend ? (
                  <p className="text-sm text-muted-foreground">No subscription found.</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Plan</dt>
                      <dd className="font-medium mt-0.5 flex items-center gap-2">
                        {data.wholesaleSpend.tierName}
                        <Badge
                          variant={statusVariant(data.wholesaleSpend.status) as "default" | "destructive" | "secondary"}
                          className="text-[11px]"
                        >
                          {STATUS_LABELS[data.wholesaleSpend.status] ?? data.wholesaleSpend.status}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {data.wholesaleSpend.billingInterval === "year" ? "Annual Cost" : "Monthly Cost"}
                      </dt>
                      <dd className="font-medium mt-0.5">
                        {data.wholesaleSpend.billingInterval === "year"
                          ? fmtCents(data.wholesaleSpend.annualPriceCents)
                          : fmtCents(data.wholesaleSpend.monthlyCostCents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Active Tenants</dt>
                      <dd className="font-medium mt-0.5">{data.wholesaleSpend.activeTenantCount}</dd>
                    </div>
                    {data.wholesaleSpend.currentPeriodEnd && (
                      <div>
                        <dt className="text-xs text-muted-foreground">Next Renewal</dt>
                        <dd className="font-medium mt-0.5">
                          {new Date(data.wholesaleSpend.currentPeriodEnd).toLocaleDateString()}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Pricing Worksheet</CardTitle>
                <CardDescription className="text-xs flex items-start gap-1.5 text-amber-600 dark:text-amber-500">
                  <Info className="size-3.5 shrink-0 mt-0.5" />
                  <span>{worksheet?.disclaimer}</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!worksheet?.bundles.length ? (
                  <p className="text-sm text-muted-foreground">No active Sales Bundles.</p>
                ) : (
                  <div className="space-y-3">
                    {worksheet.bundles.map((b) => (
                      <div key={b.bundleId} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{b.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {b.activeAssignmentCount} active customer{b.activeAssignmentCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        <dl className="grid grid-cols-3 gap-3 mt-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">Worksheet Resale</dt>
                            <dd className="font-medium mt-0.5">{fmtCents(b.worksheetMonthlyResaleCents)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Wholesale Cost</dt>
                            <dd className="font-medium mt-0.5">{fmtCents(b.worksheetMonthlyCostCents)}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Worksheet Margin</dt>
                            <dd className="font-medium mt-0.5">{fmtCents(b.worksheetMonthlyMarginCents)}</dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                    {totals && (
                      <div className="rounded-md bg-muted/40 p-3 text-sm flex items-center justify-between">
                        <span className="font-medium">Total (worksheet, unverified)</span>
                        <span className="font-medium">{fmtCents(totals.margin)} margin</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

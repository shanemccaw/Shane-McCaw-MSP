/**
 * Plan Settings — self-service platform tier & billing interval management.
 *
 * MSPAdmins can switch tier and/or monthly ⟷ yearly billing here. Changes are
 * scheduled with Stripe and take effect at the START of the next billing
 * cycle — never mid-cycle, never prorated. All tier names, prices, and
 * intervals come from the API; nothing is hardcoded here.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, Check, CreditCard, Loader2, X } from "lucide-react";
import { Link } from "wouter";

type BillingInterval = "month" | "year";

interface PendingChange {
  serviceId: number;
  serviceName: string;
  billingInterval: BillingInterval;
  effectiveAt: string | null;
}

interface CurrentPlan {
  tier: {
    id: number;
    name: string;
    slug: string | null;
    monthlyPriceCents: number | null;
    annualPriceCents: number | null;
    tenantAllowance: number | null;
  };
  billingInterval: BillingInterval;
  status: string;
  dunningState: string | null;
  currentPeriodEnd: string | null;
  tenantCountSnapshot: number;
  pendingChange: PendingChange | null;
}

interface AvailableTier {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  tenantAllowance: number | null;
}

function dollars(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function intervalLabel(interval: BillingInterval): string {
  return interval === "year" ? "yearly" : "monthly";
}

export default function PlanSettingsPage() {
  const { fetchWithAuth } = useAuth();
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [tiers, setTiers] = useState<AvailableTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval_] = useState<BillingInterval>("month");
  const [confirmTarget, setConfirmTarget] = useState<AvailableTier | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [currentRes, availableRes] = await Promise.all([
        fetchWithAuth("/api/msp/plan/current"),
        fetchWithAuth("/api/msp/plan/available"),
      ]);
      if (currentRes.ok) {
        const data = (await currentRes.json()) as CurrentPlan | null;
        setCurrent(data);
        if (data) setInterval_(data.billingInterval);
      }
      if (availableRes.ok) setTiers((await availableRes.json()) as AvailableTier[]);
    } catch {
      toast.error("Failed to load plan information");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handleConfirmChange() {
    if (!confirmTarget) return;
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/msp/plan/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetServiceId: confirmTarget.id, targetInterval: interval }),
      });
      const data = (await res.json()) as { ok?: boolean; effectiveAt?: string; error?: string };
      if (res.ok && data.ok) {
        toast.success(
          `Plan change scheduled — takes effect ${data.effectiveAt ? new Date(data.effectiveAt).toLocaleDateString() : "at your next billing date"}.`,
        );
        setConfirmTarget(null);
        await loadData();
      } else {
        toast.error(data.error ?? "Failed to schedule plan change");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelPending() {
    setCancelling(true);
    try {
      const res = await fetchWithAuth("/api/msp/plan/cancel-pending-change", { method: "POST" });
      if (res.ok) {
        toast.success("Pending plan change canceled — you'll stay on your current plan.");
        await loadData();
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to cancel pending change");
      }
    } finally {
      setCancelling(false);
    }
  }

  const actions = (
    <Link href="/settings">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
        <ArrowLeft className="size-3.5" />
        Settings
      </Button>
    </Link>
  );

  const periodEndLabel = current?.currentPeriodEnd
    ? new Date(current.currentPeriodEnd).toLocaleDateString()
    : "your next billing date";

  return (
    <AppShell title="Plan" actions={actions}>
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted/60 p-2">
            <CreditCard className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Plan &amp; Billing Interval</h2>
            <p className="text-sm text-muted-foreground">
              Changes take effect at the start of your next billing cycle — never mid-cycle.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !current ? (
          <Card>
            <CardContent className="pt-6 pb-6 text-center">
              <p className="text-sm text-muted-foreground">No platform subscription found.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Pending change banner */}
            {current.pendingChange && (
              <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
                <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <CalendarClock className="size-4 text-amber-600 shrink-0" />
                    <p className="text-sm">
                      Switching to <span className="font-semibold">{current.pendingChange.serviceName}</span>{" "}
                      ({intervalLabel(current.pendingChange.billingInterval)}) on{" "}
                      <span className="font-semibold">
                        {current.pendingChange.effectiveAt
                          ? new Date(current.pendingChange.effectiveAt).toLocaleDateString()
                          : "your next billing date"}
                      </span>.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    disabled={cancelling}
                    onClick={() => void handleCancelPending()}
                  >
                    {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                    Cancel Change
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Current plan */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Current Plan
                  <Badge className="text-[11px]">{current.tier.name}</Badge>
                  <Badge variant="outline" className="text-[11px]">
                    {intervalLabel(current.billingInterval)}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  {current.billingInterval === "year"
                    ? `${dollars(current.tier.annualPriceCents)}/year`
                    : `${dollars(current.tier.monthlyPriceCents)}/month`}
                  {current.currentPeriodEnd && ` · current period ends ${periodEndLabel}`}
                  {current.tier.tenantAllowance
                    ? ` · ${current.tenantCountSnapshot}/${current.tier.tenantAllowance} tenants`
                    : ""}
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Interval toggle */}
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Billing interval</p>
              <div className="inline-flex rounded-lg border border-border p-0.5">
                {(["month", "year"] as const).map((iv) => (
                  <button
                    key={iv}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      interval === iv ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"
                    }`}
                    onClick={() => setInterval_(iv)}
                  >
                    {iv === "month" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            {/* Tier picker */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tiers.map((tier) => {
                const priceCents = interval === "year" ? tier.annualPriceCents : tier.monthlyPriceCents;
                const isCurrent = tier.id === current.tier.id && interval === current.billingInterval;
                const yearlyUnavailable = interval === "year" && tier.annualPriceCents == null;
                return (
                  <Card key={tier.id} className={isCurrent ? "border-primary" : undefined}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        {tier.name}
                        {isCurrent && (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Check className="size-3" />
                            Current
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        <span className="text-base font-semibold text-foreground">{dollars(priceCents)}</span>
                        {priceCents != null && `/${interval === "year" ? "yr" : "mo"}`}
                        {tier.tenantAllowance ? ` · up to ${tier.tenantAllowance} tenants` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {tier.description && (
                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{tier.description}</p>
                      )}
                      <Button
                        size="sm"
                        variant={isCurrent ? "ghost" : "outline"}
                        className="w-full"
                        disabled={isCurrent || yearlyUnavailable}
                        onClick={() => setConfirmTarget(tier)}
                      >
                        {isCurrent
                          ? "Your plan"
                          : yearlyUnavailable
                            ? "Yearly not available"
                            : `Switch to ${tier.name}`}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmTarget != null} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Switch to {confirmTarget?.name} ({intervalLabel(interval)})?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-sm">
              {confirmTarget && (
                <p>
                  New price:{" "}
                  <span className="font-semibold">
                    {dollars(interval === "year" ? confirmTarget.annualPriceCents : confirmTarget.monthlyPriceCents)}
                    /{interval === "year" ? "year" : "month"}
                  </span>
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              This change takes effect at your <span className="font-medium text-foreground">next billing date
              ({periodEndLabel})</span> — <span className="font-medium text-foreground">not immediately</span>.
              You'll stay on your current plan and price until then, with no mid-cycle charges or prorations.
              You can cancel the scheduled change any time before it takes effect.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmTarget(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={submitting} onClick={() => void handleConfirmChange()} className="gap-1.5">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarClock className="size-3.5" />}
              Schedule Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

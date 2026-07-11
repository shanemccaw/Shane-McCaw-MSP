import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Zap,
  TrendingUp,
  DollarSign,
  RefreshCw,
  ShoppingCart,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AiBalanceSummary {
  mspId: number;
  balanceCents: number;
  monthlyGrantCents: number;
  purchasedCents: number;
  totalConsumedCents: number;
  periodKey: string;
  periodAllowanceCents: number;
  periodConsumedCents: number;
  periodUsagePct: number;
  alertThreshold: null | 80 | 90 | 95 | 100;
}

interface AiPurchase {
  purchaseId: string;
  pricePaidCents: number;
  creditGrantedCents: number;
  status: "pending" | "active" | "exhausted" | "refunded";
  createdAt: string;
  activatedAt: string | null;
}

interface UsageEvent {
  eventId: string;
  nodeType: string;
  feature: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costCents: number;
  costOwner: "msp" | "platform";
  runId: string | null;
  model: string | null;
  occurredAt: string;
}

interface LedgerRow {
  ledgerId: string;
  txnType: "monthly_grant" | "purchase" | "consumption" | "period_reset";
  amountCents: number;
  description: string | null;
  balanceAfterCents: number | null;
  periodKey: string | null;
  createdAt: string;
}

interface PurchaseOption {
  id: string;
  priceCents: number;
  creditCents: number;
  label: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function alertColor(threshold: null | 80 | 90 | 95 | 100): string {
  if (!threshold) return "";
  if (threshold >= 100) return "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400";
  if (threshold >= 95)  return "bg-orange-500/15 border-orange-500/40 text-orange-700 dark:text-orange-400";
  if (threshold >= 90)  return "bg-yellow-500/15 border-yellow-500/40 text-yellow-700 dark:text-yellow-400";
  return "bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-400";
}

function txnBadgeVariant(txnType: LedgerRow["txnType"]): "default" | "secondary" | "destructive" | "outline" {
  switch (txnType) {
    case "monthly_grant": return "default";
    case "purchase":      return "default";
    case "consumption":   return "destructive";
    case "period_reset":  return "secondary";
    default:              return "outline";
  }
}

function txnLabel(txnType: LedgerRow["txnType"]): string {
  switch (txnType) {
    case "monthly_grant": return "Grant";
    case "purchase":      return "Purchase";
    case "consumption":   return "Usage";
    case "period_reset":  return "Expiry";
    default:              return txnType;
  }
}

function purchaseStatusIcon(status: AiPurchase["status"]) {
  switch (status) {
    case "active":    return <CheckCircle2 className="size-4 text-green-500" />;
    case "exhausted": return <XCircle className="size-4 text-muted-foreground" />;
    case "pending":   return <Clock className="size-4 text-yellow-500" />;
    case "refunded":  return <RefreshCw className="size-4 text-muted-foreground" />;
  }
}

// ── Usage progress bar ─────────────────────────────────────────────────────────

function UsageBar({ pct, threshold }: { pct: number; threshold: null | 80 | 90 | 95 | 100 }) {
  const clampedPct = Math.min(pct, 100);
  const barColor =
    threshold === 100 ? "bg-red-500" :
    threshold === 95  ? "bg-orange-500" :
    threshold === 90  ? "bg-yellow-500" :
    threshold === 80  ? "bg-blue-500" :
    "bg-green-500";

  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${clampedPct}%` }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AiBillingPage() {
  const { user, fetchWithAuth } = useAuth();

  const [summary, setSummary] = useState<AiBalanceSummary | null>(null);
  const [purchases, setPurchases] = useState<AiPurchase[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [purchaseOptions, setPurchaseOptions] = useState<PurchaseOption[]>([]);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"usage" | "ledger">("usage");

  const mspId = user?.mspId;

  const loadBalance = useCallback(async () => {
    if (!mspId) return;
    setLoadingBalance(true);
    try {
      const res = await fetchWithAuth(`/api/msp/v1/ai-billing/balance/${mspId}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { summary: AiBalanceSummary; recentPurchases: AiPurchase[] };
      setSummary(data.summary);
      setPurchases(data.recentPurchases);
    } catch (err) {
      console.error("Failed to load AI balance", err);
    } finally {
      setLoadingBalance(false);
    }
  }, [mspId, fetchWithAuth]);

  const loadUsage = useCallback(async () => {
    if (!mspId) return;
    setLoadingUsage(true);
    try {
      const res = await fetchWithAuth(`/api/msp/v1/ai-billing/usage/${mspId}?pageSize=50`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { rows: UsageEvent[] };
      setUsageEvents(data.rows ?? []);
    } catch (err) {
      console.error("Failed to load usage events", err);
    } finally {
      setLoadingUsage(false);
    }
  }, [mspId, fetchWithAuth]);

  const loadLedger = useCallback(async () => {
    if (!mspId) return;
    setLoadingLedger(true);
    try {
      const res = await fetchWithAuth(`/api/msp/v1/ai-billing/ledger/${mspId}?pageSize=100`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { rows: LedgerRow[] };
      setLedger(data.rows ?? []);
    } catch (err) {
      console.error("Failed to load ledger", err);
    } finally {
      setLoadingLedger(false);
    }
  }, [mspId, fetchWithAuth]);

  const loadPurchaseOptions = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/msp/v1/ai-billing/purchase-options");
      if (!res.ok) return;
      const data = await res.json() as { options: PurchaseOption[] };
      setPurchaseOptions(data.options ?? []);
      if (data.options?.[0]) setSelectedBlock(data.options[0].id);
    } catch {
      // Non-critical
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadBalance();
    void loadUsage();
    void loadLedger();
    void loadPurchaseOptions();
  }, [loadBalance, loadUsage, loadLedger, loadPurchaseOptions]);

  const handlePurchase = async () => {
    if (!mspId || !selectedBlock) return;
    setPurchasing(true);
    try {
      const res = await fetchWithAuth(`/api/msp/v1/ai-billing/purchase/${mspId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: selectedBlock,
          successUrl: window.location.href + "?purchase=success",
          cancelUrl: window.location.href + "?purchase=cancelled",
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(err.message ?? "Failed to start purchase");
        return;
      }
      const data = await res.json() as { checkoutUrl: string };
      window.location.href = data.checkoutUrl;
    } catch (err) {
      toast.error("Failed to start purchase. Please try again.");
    } finally {
      setPurchasing(false);
    }
  };

  // Show purchase success toast on redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") === "success") {
      toast.success("AI credit purchase confirmed! Your balance will update shortly.");
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => void loadBalance(), 3000);
    } else if (params.get("purchase") === "cancelled") {
      toast.info("Purchase cancelled.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadBalance]);

  return (
    <DashboardShell>
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="size-6 text-primary" />
              AI Billing & Usage
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitor your AI credit balance, usage history, and purchase additional credits.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void loadBalance(); void loadUsage(); void loadLedger(); }}
            disabled={loadingBalance}
          >
            <RefreshCw className={`mr-2 size-4 ${loadingBalance ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Alert banner */}
        {summary?.alertThreshold && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${alertColor(summary.alertThreshold)}`}>
            <AlertTriangle className="size-5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">
                {summary.alertThreshold === 100
                  ? "AI credit allowance exhausted"
                  : `${summary.alertThreshold}% of monthly AI allowance used`}
              </p>
              <p className="text-xs opacity-80">
                {summary.alertThreshold === 100
                  ? "AI-dependent workflow nodes are blocked. Purchase additional credits to continue."
                  : "Consider purchasing additional AI credits to avoid service interruption."}
              </p>
            </div>
            {summary.alertThreshold >= 90 && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto shrink-0"
                onClick={() => document.getElementById("purchase-section")?.scrollIntoView({ behavior: "smooth" })}
              >
                Buy Credits
              </Button>
            )}
          </div>
        )}

        {/* Balance cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Current Balance</CardDescription>
              <CardTitle className={`text-2xl ${summary && summary.balanceCents <= 0 ? "text-red-500" : "text-green-600"}`}>
                {loadingBalance ? "—" : formatCents(summary?.balanceCents ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {summary && summary.balanceCents > 0 ? "Available to spend" : "No credits remaining"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Period Usage</CardDescription>
              <CardTitle className="text-2xl">
                {loadingBalance ? "—" : `${summary?.periodUsagePct ?? 0}%`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <UsageBar
                pct={summary?.periodUsagePct ?? 0}
                threshold={summary?.alertThreshold ?? null}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                {loadingBalance
                  ? "Loading..."
                  : `${formatCents(summary?.periodConsumedCents ?? 0)} of ${formatCents(summary?.periodAllowanceCents ?? 0)} (${summary?.periodKey ?? ""})`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Monthly Grant</CardDescription>
              <CardTitle className="text-2xl">
                {loadingBalance ? "—" : formatCents(summary?.monthlyGrantCents ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Included in your plan</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Purchased Credits</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                {loadingBalance ? "—" : formatCents(summary?.purchasedCents ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Never expire</p>
            </CardContent>
          </Card>
        </div>

        {/* Purchase section */}
        <Card id="purchase-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="size-4" />
              Purchase AI Credits
            </CardTitle>
            <CardDescription>
              Additional credits never expire and are consumed after your monthly grant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {purchaseOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSelectedBlock(opt.id)}
                  className={`text-left px-3 py-3 rounded-lg border transition-colors ${
                    selectedBlock === opt.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <p className="font-semibold text-sm">{formatCents(opt.priceCents)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatCents(opt.creditCents)} credits
                  </p>
                </button>
              ))}
            </div>
            <Button
              onClick={() => void handlePurchase()}
              disabled={purchasing || !selectedBlock}
              className="w-full sm:w-auto"
            >
              {purchasing ? (
                <><RefreshCw className="mr-2 size-4 animate-spin" /> Processing…</>
              ) : (
                <><ShoppingCart className="mr-2 size-4" /> Purchase Credits via Stripe</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Recent purchases */}
        {purchases.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Purchases</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {purchases.map((p) => (
                  <div key={p.purchaseId} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {purchaseStatusIcon(p.status)}
                      <div>
                        <p className="text-sm font-medium">{formatCents(p.creditGrantedCents)} AI credits</p>
                        <p className="text-xs text-muted-foreground">
                          Paid {formatCents(p.pricePaidCents)} · {new Date(p.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant={p.status === "active" ? "default" : "secondary"}>
                      {p.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Usage / Ledger tabs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="size-4" />
                {activeTab === "usage" ? "Usage History" : "Transaction Ledger"}
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  variant={activeTab === "usage" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveTab("usage")}
                >
                  Usage
                </Button>
                <Button
                  variant={activeTab === "ledger" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveTab("ledger")}
                >
                  Ledger
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {activeTab === "usage" && (
              <>
                {loadingUsage ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : usageEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No AI usage events recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {usageEvents.map((ev) => (
                      <div key={ev.eventId} className="py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{ev.feature ?? ev.nodeType}</p>
                          <p className="text-xs text-muted-foreground">
                            {ev.model && <span className="mr-2">{ev.model}</span>}
                            {ev.totalTokens != null && <span className="mr-2">{ev.totalTokens.toLocaleString()} tokens</span>}
                            {new Date(ev.occurredAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={ev.costOwner === "msp" ? "destructive" : "secondary"} className="text-xs">
                            {ev.costOwner}
                          </Badge>
                          <span className={`text-sm font-mono font-medium ${ev.costOwner === "msp" ? "text-red-600" : "text-muted-foreground"}`}>
                            -{formatCents(ev.costCents)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === "ledger" && (
              <>
                {loadingLedger ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : ledger.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No ledger transactions yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {ledger.map((row) => (
                      <div key={row.ledgerId} className="py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex items-center gap-3">
                          <Badge variant={txnBadgeVariant(row.txnType)} className="shrink-0 text-xs">
                            {txnLabel(row.txnType)}
                          </Badge>
                          <div className="min-w-0">
                            <p className="text-sm truncate">{row.description ?? row.txnType}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleString()}
                              {row.periodKey && ` · ${row.periodKey}`}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-sm font-mono font-medium ${row.amountCents >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {row.amountCents >= 0 ? "+" : ""}
                            {formatCents(row.amountCents)}
                          </p>
                          {row.balanceAfterCents != null && (
                            <p className="text-xs text-muted-foreground font-mono">
                              bal: {formatCents(row.balanceAfterCents)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

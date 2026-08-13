/**
 * Chargeback page — MSP-scoped purchase ledger.
 *
 * Shows everything this MSP has purchased across all three fulfillment_queue
 * source types (offer/sow/bundle), with wholesaleChargedCents (what the MSP
 * owes the platform) and customerQuoteCents (what the MSP charged their own
 * customer) shown side by side per row. Backed by GET /api/msp/:mspId/fulfillment-queue,
 * which is hard-scoped server-side via requireMspScope.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useMspId } from "@/lib/slug-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Package,
  Receipt,
  RefreshCw,
  Search,
  XCircle,
  Zap,
} from "lucide-react";

type DeliveryStatus = "not_started" | "in_progress" | "delivered" | "blocked";
type SourceType = "offer" | "sow" | "bundle";

interface ChargebackItem {
  id: number;
  sourceType: SourceType;
  sourceId: string;
  customerId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  itemTitle: string;
  itemDescription: string | null;
  purchasedAt: string | null;
  purchaseAmountCents: number | null;
  wholesaleChargedCents: number | null;
  customerQuoteCents: number | null;
  deliveryStatus: DeliveryStatus;
  statusNote: string | null;
  slaDueAt: string | null;
  slaThresholdDays: number | null;
  createdAt: string;
  isOverdue: boolean;
}

interface ChargebackResponse {
  items: ChargebackItem[];
  total: number;
  overdueCount: number;
  limit: number;
  offset: number;
}

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; className: string; icon: typeof Clock }> = {
  not_started: {
    label: "Not Started",
    className: "bg-muted text-muted-foreground border-border",
    icon: Clock,
  },
  in_progress: {
    label: "In Progress",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    icon: Loader2,
  },
  delivered: {
    label: "Delivered",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    icon: CheckCircle2,
  },
  blocked: {
    label: "Blocked",
    className: "bg-red-500/15 text-red-400 border-red-500/20",
    icon: XCircle,
  },
};

const SOURCE_CONFIG: Record<SourceType, { label: string; icon: typeof Zap }> = {
  offer: { label: "Micro-Offer", icon: Zap },
  sow: { label: "SOW", icon: FileText },
  bundle: { label: "Bundle", icon: Package },
};

function formatCurrency(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PAGE_SIZE = 20;

export default function ChargebackPage() {
  const { fetchWithAuth } = useAuth();
  const mspId = useMspId();

  const [items, setItems] = useState<ChargebackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DeliveryStatus>("all");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<"all" | SourceType>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hasActiveFilters =
    !!search || statusFilter !== "all" || sourceTypeFilter !== "all" || overdueOnly || !!dateFrom || !!dateTo;

  const fetchItems = useCallback(
    async (p = page) => {
      if (!mspId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String((p - 1) * PAGE_SIZE),
        });
        if (search.trim()) params.set("q", search.trim());
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (sourceTypeFilter !== "all") params.set("sourceType", sourceTypeFilter);
        if (overdueOnly) params.set("overdue", "1");
        if (dateFrom) params.set("from", dateFrom);
        if (dateTo) params.set("to", dateTo);

        const res = await fetchWithAuth(`/api/msp/${mspId}/fulfillment-queue?${params}`);
        if (!res.ok) {
          setError("Failed to load your purchase ledger. Please try again.");
          setItems([]);
          setTotal(0);
          setOverdueCount(0);
          return;
        }
        const data = (await res.json()) as ChargebackResponse;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setOverdueCount(data.overdueCount ?? 0);
      } catch {
        setError("Failed to load your purchase ledger. Check your connection and try again.");
        setItems([]);
        setTotal(0);
        setOverdueCount(0);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchWithAuth, mspId, search, statusFilter, sourceTypeFilter, overdueOnly, dateFrom, dateTo],
  );

  useEffect(() => { void fetchItems(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); void fetchItems(1); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    setPage(1);
    void fetchItems(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sourceTypeFilter, overdueOnly, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actions = (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 text-muted-foreground rounded-lg"
      onClick={() => void fetchItems(page)}
    >
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Chargeback" actions={actions}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Chargeback</h2>
            <p className="text-sm text-muted-foreground">
              Every purchase fulfilled for your customers — what you owe the platform vs. what you charged them.
            </p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Total Purchases</p>
              <p className="text-2xl font-bold mt-1">{total}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <Receipt className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Overdue Fulfillment</p>
              <p className={`text-2xl font-bold mt-1 ${overdueCount > 0 ? "text-red-400" : ""}`}>{overdueCount}</p>
            </div>
            <div className={`p-2.5 rounded-lg ${overdueCount > 0 ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
              <AlertTriangle className="size-5" />
            </div>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search customer, item…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm rounded-lg border-border/60 bg-background/50"
              />
            </div>

            <div className="w-40">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | DeliveryStatus)}>
                <SelectTrigger className="h-9 text-sm rounded-lg border-border/60">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {(Object.keys(STATUS_CONFIG) as DeliveryStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-40">
              <Select value={sourceTypeFilter} onValueChange={(v) => setSourceTypeFilter(v as "all" | SourceType)}>
                <SelectTrigger className="h-9 text-sm rounded-lg border-border/60">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {(Object.keys(SOURCE_CONFIG) as SourceType[]).map((s) => (
                    <SelectItem key={s} value={s}>{SOURCE_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant={overdueOnly ? "default" : "outline"}
              size="sm"
              className="h-9 gap-1.5 rounded-lg"
              onClick={() => setOverdueOnly((v) => !v)}
            >
              <AlertTriangle className="size-3.5" />
              Overdue only
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex items-center gap-2">
              <Label htmlFor="chargeback-date-from" className="text-xs text-muted-foreground whitespace-nowrap">Purchased from</Label>
              <Input
                id="chargeback-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 text-sm rounded-lg border-border/60 bg-background/50 w-[150px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="chargeback-date-to" className="text-xs text-muted-foreground whitespace-nowrap">to</Label>
              <Input
                id="chargeback-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 text-sm rounded-lg border-border/60 bg-background/50 w-[150px]"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-muted-foreground"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
              >
                Clear dates
              </Button>
            )}
          </div>
        </div>

        {/* Data Table */}
        <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="font-semibold">Item</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold">Type</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Purchased</TableHead>
                <TableHead className="font-semibold">SLA Due</TableHead>
                <TableHead className="font-semibold text-right">You Owe Platform</TableHead>
                <TableHead className="font-semibold text-right">You Charged Customer</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center">
                    <div className="flex flex-col items-center gap-3 py-4">
                      <AlertCircle className="size-8 text-red-400" />
                      <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
                      <Button variant="outline" size="sm" onClick={() => void fetchItems(page)}>
                        <RefreshCw className="size-3.5 mr-1.5" />
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center">
                    <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
                      <Receipt className="size-8 opacity-40" />
                      <p className="text-sm">
                        {hasActiveFilters
                          ? "No purchases match your filters."
                          : "No purchases yet — items appear here once your customers complete a purchase."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => {
                  const statusCfg = STATUS_CONFIG[item.deliveryStatus];
                  const sourceCfg = SOURCE_CONFIG[item.sourceType];
                  const StatusIcon = statusCfg.icon;
                  const SourceIcon = sourceCfg.icon;
                  return (
                    <TableRow
                      key={`${item.sourceType}-${item.id}`}
                      className={`transition-colors ${item.isOverdue ? "border-l-2 border-l-red-500" : ""}`}
                    >
                      <TableCell className="max-w-[220px]">
                        <div className="flex items-center gap-1.5 font-medium text-slate-200">
                          {item.isOverdue && <AlertTriangle className="size-3.5 text-red-400 shrink-0" />}
                          <span className="truncate">{item.itemTitle}</span>
                        </div>
                        {item.itemDescription && (
                          <p className="text-xs text-muted-foreground truncate">{item.itemDescription}</p>
                        )}
                      </TableCell>

                      <TableCell className="text-sm">
                        {item.customerId ? (
                          <Link href={`/customers/${item.customerId}`} className="text-primary hover:underline">
                            {item.clientName ?? item.clientEmail ?? `Customer #${item.customerId}`}
                          </Link>
                        ) : (
                          <span className="text-slate-300">{item.clientName ?? item.clientEmail ?? "—"}</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className="text-[11px] gap-1 font-medium">
                          <SourceIcon className="size-3" />
                          {sourceCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] gap-1 font-medium ${statusCfg.className}`}>
                          <StatusIcon className={`size-3 ${item.deliveryStatus === "in_progress" ? "animate-spin" : ""}`} />
                          {statusCfg.label}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(item.purchasedAt)}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        {item.slaDueAt ? (
                          <span className={`text-xs ${item.isOverdue ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>
                            {formatDate(item.slaDueAt)}
                            {item.isOverdue && " ⚠"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-mono text-sm text-amber-400 font-semibold tabular-nums">
                        {formatCurrency(item.wholesaleChargedCents)}
                      </TableCell>

                      <TableCell className="text-right font-mono text-sm text-emerald-400 font-semibold tabular-nums">
                        {formatCurrency(item.customerQuoteCents)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
          <span>{loading ? "Loading…" : `Showing ${items.length} of ${total} purchases`}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs tabular-nums font-medium px-2">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

      </div>
    </AppShell>
  );
}

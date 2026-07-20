import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, Settings,
  ExternalLink, ChevronDown, Search, Filter, XCircle, Package,
  FileText, Zap, AlertCircle,
} from "lucide-react";

type DeliveryStatus = "not_started" | "in_progress" | "delivered" | "blocked";
type SourceType = "offer" | "sow" | "bundle";

interface FulfillmentItem {
  id: number;
  sourceType: SourceType;
  sourceId: string;
  clientUserId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
  itemTitle: string;
  itemDescription: string | null;
  purchasedAt: string | null;
  purchaseAmountCents: number | null;
  deliveryStatus: DeliveryStatus;
  statusUpdatedAt: string | null;
  statusNote: string | null;
  projectId: number | null;
  presentationId: number | null;
  invoiceId: number | null;
  slaDueAt: string | null;
  slaThresholdDays: number | null;
  isOverdue: boolean;
  createdAt: string;
}

interface SlaConfig {
  id: number;
  key: string;
  label: string;
  thresholdDays: number;
}

interface QueueMeta {
  total: number;
  overdue: number;
  byStatus: Record<DeliveryStatus, number>;
  page: number;
  pageSize: number;
}

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  not_started: {
    label: "Not Started",
    color: "text-muted-foreground",
    bg: "bg-accent",
    icon: <Clock className="w-3 h-3" />,
  },
  in_progress: {
    label: "In Progress",
    color: "text-primary",
    bg: "bg-[#0D2035]",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  delivered: {
    label: "Delivered",
    color: "text-[#3FB950]",
    bg: "bg-[#0D2B0D]",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  blocked: {
    label: "Blocked",
    color: "text-destructive",
    bg: "bg-[#2B0D0D]",
    icon: <XCircle className="w-3 h-3" />,
  },
};

const SOURCE_CONFIG: Record<SourceType, { label: string; icon: React.ReactNode; color: string }> = {
  offer: {
    label: "Micro-Offer",
    icon: <Zap className="w-3 h-3" />,
    color: "text-[#00B4D8]",
  },
  sow: {
    label: "SOW",
    icon: <FileText className="w-3 h-3" />,
    color: "text-primary",
  },
  bundle: {
    label: "Bundle",
    icon: <Package className="w-3 h-3" />,
    color: "text-[#7C3AED]",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function FulfillmentQueuePage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [items, setItems] = useState<FulfillmentItem[]>([]);
  const [meta, setMeta] = useState<QueueMeta | null>(null);
  const [slaConfigs, setSlaConfigs] = useState<SlaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showSlaPanel, setShowSlaPanel] = useState(false);

  const [filterStatus, setFilterStatus] = useState<DeliveryStatus | "">("");
  const [filterSource, setFilterSource] = useState<SourceType | "">("");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [statusModalItem, setStatusModalItem] = useState<FulfillmentItem | null>(null);
  const [newStatus, setNewStatus] = useState<DeliveryStatus>("not_started");
  const [statusNote, setStatusNote] = useState("");

  const [slaEdits, setSlaEdits] = useState<Record<string, string>>({});
  const [savingSla, setSavingSla] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filterStatus) params.set("status", filterStatus);
      if (filterSource) params.set("sourceType", filterSource);
      if (filterOverdue) params.set("overdue", "1");
      if (search.trim()) params.set("q", search.trim());

      const [qRes, slaRes] = await Promise.all([
        fetchWithAuth(`/api/admin/fulfillment-queue?${params}`).then(r => r.json()),
        fetchWithAuth("/api/admin/fulfillment-sla-config").then(r => r.json()),
      ]);

      setItems(qRes.items ?? []);
      setMeta(qRes.meta ?? null);
      setSlaConfigs(Array.isArray(slaRes) ? slaRes : []);
    } catch {
      toast({ title: "Failed to load fulfillment queue", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, filterStatus, filterSource, filterOverdue, search, page, toast]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterSource, filterOverdue, search]);

  async function syncQueue() {
    setSyncing(true);
    try {
      const res = await fetchWithAuth("/api/admin/fulfillment-queue/sync", { method: "POST" });
      const body = await res.json() as { added: number };
      toast({ title: `Sync complete — ${body.added} new item(s) added` });
      await loadQueue();
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  function openStatusModal(item: FulfillmentItem) {
    setStatusModalItem(item);
    setNewStatus(item.deliveryStatus);
    setStatusNote(item.statusNote ?? "");
  }

  async function saveStatus() {
    if (!statusModalItem) return;
    setUpdatingId(statusModalItem.id);
    try {
      const res = await fetchWithAuth(`/api/admin/fulfillment-queue/${statusModalItem.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryStatus: newStatus, statusNote: statusNote.trim() || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Delivery status updated" });
      setStatusModalItem(null);
      await loadQueue();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  }

  async function saveSlaConfig(key: string, thresholdDays: number) {
    setSavingSla(true);
    try {
      await fetchWithAuth(`/api/admin/fulfillment-sla-config/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdDays }),
      });
      toast({ title: "SLA threshold saved" });
      setSlaEdits(prev => { const n = { ...prev }; delete n[key]; return n; });
      const slaRes = await fetchWithAuth("/api/admin/fulfillment-sla-config").then(r => r.json());
      setSlaConfigs(Array.isArray(slaRes) ? slaRes : []);
    } catch {
      toast({ title: "Failed to save SLA config", variant: "destructive" });
    } finally {
      setSavingSla(false);
    }
  }

  function getDeepLink(item: FulfillmentItem): { label: string; url: string } | null {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    if (item.projectId) return { label: "View Project", url: `${base}/../crm/projects/${item.projectId}` };
    if (item.presentationId) return { label: "View Presentation", url: `${base}/../crm/purchases/${item.presentationId}` };
    if (item.invoiceId) return { label: "View Invoice", url: `${base}/../finance/invoices` };
    return null;
  }

  return (
    <div className="p-6 space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Fulfillment Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Everything sold that requires delivery — across all MSPs and customers.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowSlaPanel(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground rounded-md transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            SLA Config
          </button>
          <button
            onClick={syncQueue}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-[#006BBF] text-white rounded-md transition-colors disabled:opacity-60"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync from Purchases
          </button>
        </div>
      </div>

      {/* Metric pills */}
      {meta && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted-foreground">
            <span className="text-foreground font-medium">{meta.total}</span> total
          </div>
          {meta.overdue > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2B0D0D] border border-destructive rounded-lg text-xs text-destructive font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              {meta.overdue} overdue
            </div>
          )}
          {(["not_started", "in_progress", "blocked"] as DeliveryStatus[]).map(s => (
            meta.byStatus[s] > 0 && (
              <div key={s} className={`flex items-center gap-1.5 px-3 py-1.5 ${STATUS_CONFIG[s].bg} border border-border rounded-lg text-xs ${STATUS_CONFIG[s].color}`}>
                {STATUS_CONFIG[s].icon}
                <span className="text-foreground font-medium">{meta.byStatus[s]}</span> {STATUS_CONFIG[s].label.toLowerCase()}
              </div>
            )
          ))}
        </div>
      )}

      {/* SLA Config panel */}
      {showSlaPanel && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Internal Fulfillment SLA Thresholds</span>
            <span className="text-xs text-muted-foreground">— operator-facing, separate from customer-facing SLAs</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {slaConfigs.map(cfg => {
              const edit = slaEdits[cfg.key];
              const displayVal = edit !== undefined ? edit : String(cfg.thresholdDays);
              const isDirty = edit !== undefined && edit !== String(cfg.thresholdDays);
              return (
                <div key={cfg.key} className="bg-background border border-border rounded-lg p-3 space-y-2">
                  <div className="text-xs font-medium text-foreground">{cfg.label}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={displayVal}
                      onChange={e => setSlaEdits(prev => ({ ...prev, [cfg.key]: e.target.value }))}
                      className="w-16 px-2 py-1 text-xs bg-card border border-border rounded text-foreground focus:outline-none focus:border-primary"
                    />
                    <span className="text-xs text-muted-foreground">days</span>
                    {isDirty && (
                      <button
                        onClick={() => saveSlaConfig(cfg.key, parseInt(displayVal, 10))}
                        disabled={savingSla || !parseInt(displayVal, 10)}
                        className="text-xs px-2 py-1 bg-primary text-white rounded hover:bg-[#006BBF] disabled:opacity-50"
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card border border-border rounded-lg text-xs text-muted-foreground">
          <Search className="w-3.5 h-3.5" />
          <input
            type="text"
            placeholder="Search client, title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent outline-none text-foreground placeholder-muted-foreground w-48"
          />
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card border border-border rounded-lg text-xs">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as DeliveryStatus | "")}
            className="bg-transparent outline-none text-foreground cursor-pointer"
          >
            <option value="">All statuses</option>
            {(["not_started", "in_progress", "delivered", "blocked"] as DeliveryStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-card border border-border rounded-lg text-xs">
          <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value as SourceType | "")}
            className="bg-transparent outline-none text-foreground cursor-pointer"
          >
            <option value="">All types</option>
            {(["offer", "sow", "bundle"] as SourceType[]).map(s => (
              <option key={s} value={s}>{SOURCE_CONFIG[s].label}</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-1.5 px-2 py-1.5 bg-card border border-border rounded-lg text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filterOverdue}
            onChange={e => setFilterOverdue(e.target.checked)}
            className="accent-destructive"
          />
          <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
          Overdue only
        </label>

        {(filterStatus || filterSource || filterOverdue || search) && (
          <button
            onClick={() => { setFilterStatus(""); setFilterSource(""); setFilterOverdue(false); setSearch(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="w-10 h-10 text-border mb-3" />
          <p className="text-muted-foreground text-sm">No fulfillment items found.</p>
          <p className="text-muted-foreground text-xs mt-1">
            Click <span className="text-foreground">Sync from Purchases</span> to populate the queue from existing purchases.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Item</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Customer</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">MSP</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Type</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Status</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">SLA Due</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Purchased</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Amount</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-3">Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(item => {
                  const sc = STATUS_CONFIG[item.deliveryStatus];
                  const src = SOURCE_CONFIG[item.sourceType];
                  const deepLink = getDeepLink(item);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-accent transition-colors ${item.isOverdue && item.deliveryStatus !== "delivered" ? "border-l-2 border-l-destructive" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground max-w-[200px] truncate" title={item.itemTitle}>
                          {item.isOverdue && item.deliveryStatus !== "delivered" && (
                            <AlertTriangle className="w-3.5 h-3.5 text-destructive inline mr-1 mb-0.5" />
                          )}
                          {item.itemTitle}
                        </div>
                        {item.itemDescription && (
                          <div className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">{item.itemDescription}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-foreground text-xs">{item.clientName ?? item.clientEmail ?? "—"}</div>
                        {item.clientEmail && item.clientName && (
                          <div className="text-muted-foreground text-xs">{item.clientEmail}</div>
                        )}
                        {item.customerName && (
                          <div className="text-muted-foreground text-xs mt-0.5">{item.customerName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {item.mspName ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs ${src.color}`}>
                          {src.icon}
                          {src.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openStatusModal(item)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.color} hover:opacity-80 transition-opacity`}
                        >
                          {sc.icon}
                          {sc.label}
                          <ChevronDown className="w-3 h-3 opacity-60" />
                        </button>
                        {item.statusNote && (
                          <div className="text-xs text-muted-foreground mt-0.5 max-w-[140px] truncate" title={item.statusNote}>
                            {item.statusNote}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.slaDueAt ? (
                          <span className={`text-xs ${item.isOverdue && item.deliveryStatus !== "delivered" ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                            {formatDate(item.slaDueAt)}
                            {item.isOverdue && item.deliveryStatus !== "delivered" && " ⚠"}
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(item.purchasedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground">
                        {formatCents(item.purchaseAmountCents)}
                      </td>
                      <td className="px-4 py-3">
                        {deepLink ? (
                          <a
                            href={deepLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {deepLink.label}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {meta && meta.total > meta.pageSize && (
            <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-border bg-accent/40">
              <p className="text-xs text-muted-foreground">
                {((page - 1) * meta.pageSize) + 1}–{Math.min(page * meta.pageSize, meta.total)} of {meta.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {page} of {Math.max(1, Math.ceil(meta.total / meta.pageSize))}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(Math.ceil(meta.total / meta.pageSize), p + 1))}
                  disabled={page >= Math.ceil(meta.total / meta.pageSize)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status update modal */}
      {statusModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setStatusModalItem(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-foreground mb-1">Update Delivery Status</h2>
            <p className="text-xs text-muted-foreground mb-4 truncate">{statusModalItem.itemTitle}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">Status</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["not_started", "in_progress", "delivered", "blocked"] as DeliveryStatus[]).map(s => {
                    const sc = STATUS_CONFIG[s];
                    return (
                      <button
                        key={s}
                        onClick={() => setNewStatus(s)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${newStatus === s
                          ? `${sc.bg} border-current ${sc.color} font-medium`
                          : "bg-background border-border text-muted-foreground hover:border-primary"
                        }`}
                      >
                        {sc.icon}
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">Note (optional)</label>
                <textarea
                  rows={2}
                  value={statusNote}
                  onChange={e => setStatusNote(e.target.value)}
                  placeholder="Add context about this status change…"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setStatusModalItem(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveStatus}
                disabled={updatingId === statusModalItem.id}
                className="px-4 py-1.5 text-xs bg-primary hover:bg-[#006BBF] text-white rounded-lg transition-colors disabled:opacity-60 flex items-center gap-1.5"
              >
                {updatingId === statusModalItem.id && <Loader2 className="w-3 h-3 animate-spin" />}
                Save Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

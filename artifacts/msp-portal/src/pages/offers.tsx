/**
 * Offers — MSP Offer Pipeline Dashboard
 *
 * Shows the full offer pipeline for an MSP: draft → sent → accepted/rejected/expired.
 * MSPs can generate new offers for a tenant, review, edit, and send drafts, and delete
 * unwanted drafts. All offer logic lives in the Sales Offer Engine — no offer
 * logic is duplicated here.
 *
 * Real-time: subscribes to the canonical event bus via SSE at
 * /api/msp/sales-offers/sse. Falls back to 30 s polling if SSE is unavailable.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Edit2,
  Loader2,
  PackageSearch,
  Plus,
  RefreshCw,
  Save,
  Send,
  Star,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/confirm-modal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SalesOffer {
  id: number;
  tenantId: number | null;
  mspId: number | null;
  title: string;
  rationale: string | null;
  firedSignalKeys: string[];
  bundledOfferIds: number[];
  basePriceCents: number;
  adjustedPriceCents: number;
  score: number;
  state: string;
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SalesOfferEvent {
  id: number;
  offerId: number;
  eventName: string;
  payload: Record<string, unknown>;
  actorUserId: number | null;
  createdAt: string;
}

type OfferState = "draft" | "sent" | "accepted" | "rejected" | "expired";

const STATE_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  draft: { label: "Draft", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", icon: Clock },
  sent: { label: "Sent", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: Send },
  accepted: { label: "Accepted", color: "bg-green-500/15 text-green-400 border-green-500/30", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle },
  expired: { label: "Expired", color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertCircle },
};

const ALL_STATES: OfferState[] = ["draft", "sent", "accepted", "rejected", "expired"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex flex-col items-center px-4 py-3 rounded-lg border ${color}`}>
      <span className="text-xl font-bold">{value}</span>
      <span className="text-xs text-muted-foreground mt-0.5">{label}</span>
    </div>
  );
}

function OfferStateBadge({ state }: { state: string }) {
  const cfg = STATE_CONFIG[state] ?? { label: state, color: "bg-muted text-muted-foreground border-border", icon: Clock };
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 gap-1 border ${cfg.color}`}>
      <Icon className="size-2.5" />
      {cfg.label}
    </Badge>
  );
}

// ── Generate Offers Dialog ────────────────────────────────────────────────────

interface GenerateDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
}

function GenerateDialog({ open, onClose, onGenerated, fetchWithAuth }: GenerateDialogProps) {
  const [tenantId, setTenantId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ insertedOfferIds: number[]; candidateCount: number } | null>(null);

  useEffect(() => {
    if (!open) { setTenantId(""); setResult(null); }
  }, [open]);

  async function handleGenerate() {
    const tid = parseInt(tenantId.trim(), 10);
    if (isNaN(tid) || tid <= 0) { toast.error("Enter a valid tenant ID"); return; }
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetchWithAuth("/api/msp/sales-offers/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tid }),
      });
      const data = await res.json() as { insertedOfferIds?: number[]; candidateCount?: number; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Generation failed"); return; }
      setResult({ insertedOfferIds: data.insertedOfferIds ?? [], candidateCount: data.candidateCount ?? 0 });
      toast.success(`${data.insertedOfferIds?.length ?? 0} new offer(s) generated`);
      onGenerated();
    } catch {
      toast.error("Failed to generate offers");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Offers</DialogTitle>
          <DialogDescription>
            Run the Sales Offer Engine for a tenant. Candidates are scored, priced, and persisted as
            drafts. Duplicate signal sets are skipped (idempotent).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tenant-id-input">Tenant ID</Label>
            <Input
              id="tenant-id-input"
              placeholder="e.g. 42"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              type="number"
              min="1"
            />
            <p className="text-xs text-muted-foreground">
              The MSP customer ID to generate offers for.
            </p>
          </div>

          {result && (
            <Card className="bg-green-500/5 border-green-500/20">
              <CardContent className="pt-4 pb-3">
                <p className="text-sm font-medium text-green-400">
                  {result.insertedOfferIds.length} offer{result.insertedOfferIds.length !== 1 ? "s" : ""} created
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Engine evaluated {result.candidateCount} candidate{result.candidateCount !== 1 ? "s" : ""}.
                  {result.candidateCount > result.insertedOfferIds.length
                    ? ` ${result.candidateCount - result.insertedOfferIds.length} duplicate(s) skipped.`
                    : ""}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={generating}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={generating || !tenantId.trim()}>
            {generating && <Loader2 className="size-4 animate-spin mr-2" />}
            Run Engine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Offer Detail Sheet ────────────────────────────────────────────────────────

interface OfferDetailSheetProps {
  offer: SalesOffer | null;
  onClose: () => void;
  onStateChanged: () => void;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
}

function OfferDetailSheet({ offer, onClose, onStateChanged, fetchWithAuth }: OfferDetailSheetProps) {
  const [events, setEvents] = useState<SalesOfferEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Edit mode (draft offers only)
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editRationale, setEditRationale] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!offer) { setEvents([]); setEditing(false); return; }
    setEditTitle(offer.title);
    setEditRationale(offer.rationale ?? "");
    setEventsLoading(true);
    fetchWithAuth(`/api/msp/sales-offers/${offer.id}/events`)
      .then((r) => r.json())
      .then((d: { events?: SalesOfferEvent[] }) => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, [offer, fetchWithAuth]);

  async function handleSaveEdit() {
    if (!offer) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${offer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim(), rationale: editRationale.trim() || null }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Save failed"); return; }
      toast.success("Offer updated");
      setEditing(false);
      onStateChanged();
    } catch {
      toast.error("Failed to save offer");
    } finally {
      setSaving(false);
    }
  }

  async function transition(newState: string, extra: Record<string, unknown> = {}) {
    if (!offer) return;
    setTransitioning(true);
    try {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${offer.id}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newState, ...extra }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Transition failed"); return; }
      toast.success(`Offer moved to "${newState}"`);
      onStateChanged();
      onClose();
    } catch {
      toast.error("Failed to update offer");
    } finally {
      setTransitioning(false);
    }
  }

  async function handleDelete() {
    if (!offer) return;
    setTransitioning(true);
    try {
      const res = await fetchWithAuth(`/api/msp/sales-offers/${offer.id}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Delete failed"); return; }
      toast.success("Draft offer deleted");
      onStateChanged();
      onClose();
    } catch {
      toast.error("Failed to delete offer");
    } finally {
      setTransitioning(false);
    }
  }

  if (!offer) return null;

  const discount =
    offer.basePriceCents > 0 && offer.adjustedPriceCents < offer.basePriceCents
      ? Math.round(((offer.basePriceCents - offer.adjustedPriceCents) / offer.basePriceCents) * 100)
      : 0;

  return (
    <>
      <Sheet open={!!offer} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="pr-8">{offer.title}</SheetTitle>
            <SheetDescription className="flex items-center gap-2 flex-wrap">
              <OfferStateBadge state={offer.state} />
              <span className="text-xs text-muted-foreground">ID #{offer.id}</span>
              {offer.tenantId && (
                <span className="text-xs text-muted-foreground">Tenant {offer.tenantId}</span>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5">
            {/* Edit form — draft offers only */}
            {offer.state === "draft" && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-4 pb-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Edit offer copy
                    </p>
                    {editing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs gap-1"
                        onClick={() => setEditing(false)}
                        disabled={saving}
                      >
                        <X className="size-3" />
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs gap-1"
                        onClick={() => setEditing(true)}
                      >
                        <Edit2 className="size-3" />
                        Edit
                      </Button>
                    )}
                  </div>
                  {editing ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-title" className="text-xs">Title</Label>
                        <Input
                          id="edit-title"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="h-8 text-sm"
                          maxLength={200}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-rationale" className="text-xs">Rationale (shown to customer)</Label>
                        <Textarea
                          id="edit-rationale"
                          value={editRationale}
                          onChange={(e) => setEditRationale(e.target.value)}
                          rows={3}
                          className="text-sm"
                          maxLength={1000}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 w-full"
                        onClick={handleSaveEdit}
                        disabled={saving || !editTitle.trim()}
                      >
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                        Save changes
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Personalise the title and rationale before sending to the client.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Pricing */}
            <Card>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <DollarSign className="size-3.5 text-muted-foreground" />
                  Pricing
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Base price</p>
                    <p className="font-medium">{formatCents(offer.basePriceCents)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Adjusted price</p>
                    <p className="font-semibold text-primary">{formatCents(offer.adjustedPriceCents)}</p>
                  </div>
                  {discount > 0 && (
                    <div className="col-span-2">
                      <Badge variant="outline" className="text-[10px] bg-green-500/10 border-green-500/30 text-green-400">
                        {discount}% discount applied by rules
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Score */}
            <Card>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Star className="size-3.5 text-muted-foreground" />
                    Relevance Score
                  </div>
                  <span className={`text-sm font-bold ${offer.score >= 70 ? "text-green-400" : offer.score >= 40 ? "text-amber-400" : "text-red-400"}`}>
                    {offer.score}/100
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${offer.score >= 70 ? "bg-green-400" : offer.score >= 40 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${Math.min(100, offer.score)}%` }}
                  />
                </div>
                {offer.firedSignalKeys.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {offer.firedSignalKeys.map((k) => (
                      <Badge key={k} variant="outline" className="text-[10px] font-mono">
                        {k}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rationale */}
            {offer.rationale && !editing && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rationale</p>
                <p className="text-sm text-foreground leading-relaxed">{offer.rationale}</p>
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Timeline</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{relativeDate(offer.createdAt)}</span>
                </div>
                {offer.sentAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sent</span>
                    <span>{relativeDate(offer.sentAt)}</span>
                  </div>
                )}
                {offer.expiresAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span className={new Date(offer.expiresAt) < new Date() ? "text-red-400" : ""}>
                      {new Date(offer.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                )}
                {offer.acceptedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Accepted</span>
                    <span className="text-green-400">{relativeDate(offer.acceptedAt)}</span>
                  </div>
                )}
                {offer.closedAt && offer.state !== "accepted" && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Closed</span>
                    <span>{relativeDate(offer.closedAt)}</span>
                  </div>
                )}
                {offer.rejectionReason && (
                  <div className="flex justify-between items-start gap-4">
                    <span className="text-muted-foreground shrink-0">Reason</span>
                    <span className="text-right text-xs text-muted-foreground">{offer.rejectionReason}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Event history */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Event History</p>
              {eventsLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events recorded yet.</p>
              ) : (
                <div className="space-y-1">
                  {events.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 text-xs">
                      <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                      <span className="font-mono text-primary">{ev.eventName}</span>
                      <span className="text-muted-foreground ml-auto shrink-0">{relativeDate(ev.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              {offer.state === "draft" && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => transition("sent")}
                    disabled={transitioning || editing}
                  >
                    {transitioning ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    Send to Client
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5"
                    onClick={() => setDeleteConfirm(true)}
                    disabled={transitioning || editing}
                  >
                    <Trash2 className="size-3.5" />
                    Delete Draft
                  </Button>
                </>
              )}
              {offer.state === "sent" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-green-400 border-green-500/30 hover:bg-green-500/10"
                    onClick={() => transition("accepted")}
                    disabled={transitioning}
                  >
                    {transitioning ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                    Mark Accepted
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                    onClick={() => transition("rejected")}
                    disabled={transitioning}
                  >
                    <XCircle className="size-3.5" />
                    Mark Rejected
                  </Button>
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmModal
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title="Delete Draft Offer"
        description={`Permanently delete "${offer.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
}

// ── Pipeline stats ────────────────────────────────────────────────────────────

function PipelineStats({ offers }: { offers: SalesOffer[] }) {
  const counts = ALL_STATES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = offers.filter((o) => o.state === s).length;
    return acc;
  }, {});

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <StatPill label="Draft" value={counts["draft"] ?? 0} color="border-zinc-500/30 text-zinc-300" />
      <StatPill label="Sent" value={counts["sent"] ?? 0} color="border-blue-500/30 text-blue-300" />
      <StatPill label="Accepted" value={counts["accepted"] ?? 0} color="border-green-500/30 text-green-300" />
      <StatPill label="Rejected" value={counts["rejected"] ?? 0} color="border-red-500/30 text-red-300" />
      <StatPill label="Expired" value={counts["expired"] ?? 0} color="border-amber-500/30 text-amber-300" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OffersPage() {
  const { fetchWithAuth, accessToken } = useAuth();
  const mspSlug = useMspSlug();
  const [offers, setOffers] = useState<SalesOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [selectedOffer, setSelectedOffer] = useState<SalesOffer | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const loadOffers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      try {
        const params = new URLSearchParams({ limit: "200" });
        if (stateFilter !== "all") params.set("state", stateFilter);
        if (mspSlug) params.set("slug", mspSlug);
        const res = await fetchWithAuth(`/api/msp/sales-offers?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { offers: SalesOffer[] };
        setOffers(data.offers ?? []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchWithAuth, mspSlug, stateFilter],
  );

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  // SSE subscription — canonical event bus for real-time offer state changes
  useEffect(() => {
    if (!accessToken) return;
    const sseParams = new URLSearchParams({ token: accessToken });
    if (mspSlug) sseParams.set("slug", mspSlug);
    const url = `/api/msp/sales-offers/sse?${sseParams.toString()}`;
    const es = new EventSource(url);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { type: string };
        if (data.type === "offer_changed") {
          void loadOffers(true);
        }
      } catch { }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };

    sseRef.current = es;
    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [accessToken, loadOffers]);

  // Fallback: poll every 30 s when SSE is not connected
  useEffect(() => {
    const id = setInterval(() => {
      if (!sseRef.current || sseRef.current.readyState === EventSource.CLOSED) {
        void loadOffers(true);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [loadOffers]);

  return (
    <AppShell title="Offer Pipeline">
      <div className="p-6 space-y-5 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Offer Pipeline</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Sales offers generated by the engine — review, edit, send, and track acceptance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void loadOffers(true)}
              disabled={refreshing}
            >
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setGenerateOpen(true)}>
              <Plus className="size-4" />
              Generate Offers
            </Button>
          </div>
        </div>

        {/* Pipeline stats */}
        {!loading && <PipelineStats offers={offers} />}

        {/* Filter */}
        <div className="flex items-center gap-3">
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {ALL_STATES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {offers.length} offer{offers.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : offers.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
              <PackageSearch className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No offers</p>
              <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
                {stateFilter !== "all"
                  ? `No ${stateFilter} offers.`
                  : "Generate offers to start the pipeline."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Title</TableHead>
                  <TableHead className="text-xs w-24">State</TableHead>
                  <TableHead className="text-xs w-20 text-right">Score</TableHead>
                  <TableHead className="text-xs w-28 text-right">Price</TableHead>
                  <TableHead className="text-xs w-24 text-right">Tenant</TableHead>
                  <TableHead className="text-xs w-24 text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((offer) => (
                  <TableRow
                    key={offer.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedOffer(offer)}
                  >
                    <TableCell className="text-sm font-medium max-w-xs truncate">{offer.title}</TableCell>
                    <TableCell><OfferStateBadge state={offer.state} /></TableCell>
                    <TableCell className="text-right">
                      <span className={`text-xs font-semibold ${offer.score >= 70 ? "text-green-400" : offer.score >= 40 ? "text-amber-400" : "text-red-400"}`}>
                        {offer.score}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs">{formatCents(offer.adjustedPriceCents)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{offer.tenantId ?? "—"}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{relativeDate(offer.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <OfferDetailSheet
        offer={selectedOffer}
        onClose={() => setSelectedOffer(null)}
        onStateChanged={() => void loadOffers(true)}
        fetchWithAuth={fetchWithAuth}
      />

      <GenerateDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerated={() => void loadOffers(true)}
        fetchWithAuth={fetchWithAuth}
      />
    </AppShell>
  );
}

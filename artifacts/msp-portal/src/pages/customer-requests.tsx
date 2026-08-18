/**
 * customer-requests.tsx  (Git #1158, part of #1045)
 *
 * Customer-facing "My Requests" page: open a new support request and watch its
 * status + conversation thread without leaving the portal. Backed by Zoho Desk
 * via /api/portal/customer/requests (see portal-customer-requests.ts).
 *
 * - List: the caller's own requests (GET /api/portal/customer/requests).
 * - Open a Request: a Dialog form (POST /api/portal/customer/requests).
 * - Thread: a right-side Sheet showing status + conversation and a reply
 *   composer (GET/POST /api/portal/customer/requests/:id[/reply]).
 *
 * Requests are created through a queued Zoho Desk write (drained ~every 5 min),
 * so a freshly-submitted request appears in the list on the next refresh, not
 * instantly — the empty/"just submitted" copy says so.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { Inbox, LifeBuoy, Plus, RefreshCw, Send } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RequestSummary {
  id: string;
  ticketNumber: string | null;
  subject: string;
  status: string | null;
  statusType: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  webUrl: string | null;
}

interface ThreadEntry {
  id: string;
  kind: "thread" | "comment";
  direction: "in" | "out" | null;
  author: string | null;
  isPublic: boolean;
  content: string;
  createdTime: string | null;
}

const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadgeClass(statusType: string | null): string {
  switch ((statusType ?? "").toLowerCase()) {
    case "closed":
      return "bg-muted text-muted-foreground border-border";
    case "on hold":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "escalated":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default: // Open / anything active
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerRequestsPage() {
  const { fetchWithAuth } = useAuth();
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-request dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("Medium");
  const [submitting, setSubmitting] = useState(false);

  // Thread sheet
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ request: RequestSummary; thread: ThreadEntry[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  const loadList = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetchWithAuth("/api/portal/customer/requests");
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to load your requests");
        }
        const json = (await res.json()) as { configured: boolean; requests: RequestSummary[] };
        setConfigured(json.configured);
        setRequests(json.requests ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load your requests");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const res = await fetchWithAuth(`/api/portal/customer/requests/${encodeURIComponent(id)}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to load this request");
        }
        const json = (await res.json()) as { request: RequestSummary; thread: ThreadEntry[] };
        setDetail(json);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Unable to load this request");
        setActiveId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (activeId) void loadDetail(activeId);
    else setDetail(null);
  }, [activeId, loadDetail]);

  async function submitRequest() {
    if (!subject.trim()) {
      toast.error("Please enter a subject.");
      return;
    }
    if (!description.trim()) {
      toast.error("Please describe your request.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/portal/customer/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description, priority }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to submit request");
      toast.success(body.message ?? "Your request has been submitted.");
      setDialogOpen(false);
      setSubject("");
      setDescription("");
      setPriority("Medium");
      // The ticket is created on the next Zoho drain, so it won't be in the list
      // immediately — refresh anyway to catch it as soon as it lands.
      void loadList(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendReply() {
    if (!activeId || !reply.trim()) return;
    setReplying(true);
    try {
      const res = await fetchWithAuth(`/api/portal/customer/requests/${encodeURIComponent(activeId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to add reply");
      toast.success(body.message ?? "Your reply has been added.");
      setReply("");
      void loadDetail(activeId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add reply");
    } finally {
      setReplying(false);
    }
  }

  return (
    <AppShell title="My Requests">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">My Requests</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Open a request and follow its progress here
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void loadList(true)}
              disabled={refreshing}
              title="Refresh"
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button data-testid="open-request-button" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Open a Request
            </Button>
          </div>
        </div>

        {/* Ticketing-unavailable state */}
        {!configured && !loading && (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-300"
            data-testid="requests-unconfigured"
          >
            Request submission isn't available just yet. Please reach out to your service team directly in the
            meantime.
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-4 text-sm text-red-300">{error}</div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          configured && (
            <div
              className="rounded-lg border border-border bg-card/40 p-10 text-center"
              data-testid="requests-empty"
            >
              <Inbox className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No requests yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Open your first request and it'll appear here — new requests can take a few minutes to show up.
              </p>
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="size-4 mr-1.5" />
                Open a Request
              </Button>
            </div>
          )
        ) : (
          <ul className="space-y-3" data-testid="requests-list">
            {requests.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-testid={`request-row-${r.id}`}
                  onClick={() => setActiveId(r.id)}
                  className="w-full text-left rounded-lg border border-border bg-card/40 hover:bg-card/70 transition-colors p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.subject}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.ticketNumber ? `#${r.ticketNumber} · ` : ""}
                      Updated {relativeTime(r.modifiedTime ?? r.createdTime)}
                    </p>
                  </div>
                  <Badge variant="outline" className={statusBadgeClass(r.statusType)}>
                    {r.status ?? r.statusType ?? "Open"}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* New-request dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !submitting && setDialogOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LifeBuoy className="size-5" />
              Open a Request
            </DialogTitle>
            <DialogDescription>
              Tell us what you need. Your service team is notified as soon as you submit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="request-subject">Subject</Label>
              <Input
                id="request-subject"
                data-testid="request-subject-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Short summary of your request"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="request-priority" data-testid="request-priority-select">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-description">Details</Label>
              <Textarea
                id="request-description"
                data-testid="request-description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your request in as much detail as you can"
                rows={5}
                maxLength={5000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button data-testid="request-submit-button" onClick={() => void submitRequest()} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Thread sheet */}
      <Sheet open={activeId !== null} onOpenChange={(o) => !o && setActiveId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="p-6 pb-4 border-b border-border">
            <SheetTitle className="pr-8">{detail?.request.subject ?? "Request"}</SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              {detail?.request.ticketNumber ? <span>#{detail.request.ticketNumber}</span> : null}
              {detail?.request ? (
                <Badge variant="outline" className={statusBadgeClass(detail.request.statusType)}>
                  {detail.request.status ?? detail.request.statusType ?? "Open"}
                </Badge>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-4" data-testid="request-thread">
            {detailLoading ? (
              <>
                <Skeleton className="h-16 w-3/4 rounded-lg" />
                <Skeleton className="h-16 w-3/4 rounded-lg ml-auto" />
              </>
            ) : detail && detail.thread.length > 0 ? (
              detail.thread.map((entry) => {
                const fromCustomer = entry.direction === "in";
                return (
                  <div
                    key={entry.id}
                    className={`rounded-lg border p-3 text-sm max-w-[85%] ${
                      fromCustomer
                        ? "ml-auto bg-primary/10 border-primary/20"
                        : "bg-card/60 border-border"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground mb-1">
                      {entry.author ?? (fromCustomer ? "You" : "Support")}
                      {entry.createdTime ? ` · ${relativeTime(entry.createdTime)}` : ""}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{entry.content || "(no content)"}</p>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No messages on this request yet.
              </p>
            )}
          </div>

          <div className="border-t border-border p-4 space-y-2">
            <Textarea
              data-testid="request-reply-input"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Add a reply…"
              rows={2}
              disabled={replying || detailLoading}
            />
            <div className="flex justify-end">
              <Button
                data-testid="request-reply-send"
                size="sm"
                onClick={() => void sendReply()}
                disabled={replying || detailLoading || !reply.trim()}
              >
                <Send className="size-4 mr-1.5" />
                {replying ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

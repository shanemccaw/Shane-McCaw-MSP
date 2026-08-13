/**
 * Data Rights — MSP-facing view of GDPR export/deletion activity across the
 * caller's book, plus recording a deletion request on the customer's behalf
 * when they contact the MSP directly instead of using self-service
 * (Privacy & Data in the customer portal). Reuses the exact same underlying
 * audit-log + admin-email mechanism as the customer-initiated flow — this
 * page is read+action, not a second/competing request path.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Trash2, Download, Loader2, CheckCircle2, XCircle, Info } from "lucide-react";

interface CurrentSchemaSummary {
  customerId: number;
  mspId: number | null;
  customerName: string | null;
  diagnosticRuns: number;
  diagnosticFindings: number;
  sows: number;
  mspDocuments: number;
  engineSnapshots: number;
}

interface DataRightsRequest {
  id: number;
  actionType: "deletion_request_submitted" | "data_export_downloaded";
  submittedByAdmin: boolean;
  submittedByName: string;
  customerId: number | null;
  customerName: string | null;
  currentSchema: CurrentSchemaSummary | null;
  createdAt: string;
}

interface MspCustomer { id: number; name: string }
interface LinkedUser { userId: number; name: string | null; email: string; isActive: boolean }

type AlertState = { type: "success" | "error"; message: string } | null;

function AlertBox({ alert, onDismiss }: { alert: AlertState; onDismiss?: () => void }) {
  if (!alert) return null;
  const isSuccess = alert.type === "success";
  return (
    <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border mb-4 ${
      isSuccess ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"
    }`}>
      {isSuccess ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
      <span className="flex-1">{alert.message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="flex-shrink-0 opacity-60 hover:opacity-100">
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function RecordDeletionRequestDialog({ open, onOpenChange, onSubmitted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const { fetchWithAuth, user } = useAuth();
  const [customers, setCustomers] = useState<MspCustomer[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [users, setUsers] = useState<LinkedUser[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setUserId("");
    setUsers([]);
    setAlert(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/msp/customers?limit=200&mspId=${user?.mspId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { customers: MspCustomer[] };
        setCustomers(data.customers || []);
      } catch {
        // ignore
      }
    })();
  }, [open, fetchWithAuth, user?.mspId]);

  useEffect(() => {
    if (!customerId) { setUsers([]); setUserId(""); return; }
    setLoadingUsers(true);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/msp/data-rights/customers/${customerId}/users`);
        const data = (await res.json()) as { users?: LinkedUser[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load linked users");
        setUsers(data.users || []);
      } catch (err) {
        setAlert({ type: "error", message: err instanceof Error ? err.message : "Failed to load linked users" });
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, [customerId, fetchWithAuth]);

  const handleSubmit = async () => {
    if (!customerId || !userId) return;
    setSubmitting(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth(`/api/msp/data-rights/customers/${customerId}/deletion-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: Number(userId) }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Request failed");
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      setAlert({ type: "error", message: err instanceof Error ? err.message : "Request failed. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a Deletion Request</DialogTitle>
          <DialogDescription>
            For when a customer asks you directly to delete their data instead of using self-service in the portal. This
            writes to the exact same request log and triggers the same admin notification as self-service.
          </DialogDescription>
        </DialogHeader>

        <AlertBox alert={alert} onDismiss={() => setAlert(null)} />

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer</label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select a customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Portal user</label>
            <Select value={userId} onValueChange={setUserId} disabled={!customerId || loadingUsers}>
              <SelectTrigger>
                <SelectValue placeholder={loadingUsers ? "Loading…" : "Select the portal user"} />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.userId} value={String(u.userId)}>
                    {u.name ?? u.email} {!u.isActive ? "(inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerId && !loadingUsers && users.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">No portal users are linked to this customer.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!customerId || !userId || submitting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Recording…</> : <><Trash2 className="w-4 h-4 mr-2" />Record Request</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({ req }: { req: DataRightsRequest }) {
  const isDeletion = req.actionType === "deletion_request_submitted";
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="flex items-start gap-3 min-w-0">
        {isDeletion
          ? <Trash2 className="h-4 w-4 mt-1 flex-shrink-0 text-amber-600" />
          : <Download className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={isDeletion ? "outline" : "secondary"} className={isDeletion ? "text-amber-700 border-amber-300 bg-amber-50" : ""}>
              {isDeletion ? "Deletion request" : "Data export"}
            </Badge>
            {req.submittedByAdmin && <Badge variant="outline">Recorded by MSP staff</Badge>}
            <span className="font-medium truncate">{req.customerName ?? "Unknown customer"}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {req.submittedByAdmin ? `Recorded by ${req.submittedByName}` : "Submitted via self-service"} · {new Date(req.createdAt).toLocaleString()}
          </div>
          {isDeletion && req.currentSchema && (
            <div className="text-xs text-muted-foreground mt-1">
              {req.currentSchema.diagnosticRuns} runs · {req.currentSchema.diagnosticFindings} findings · {req.currentSchema.sows} SOWs · {req.currentSchema.mspDocuments} documents · {req.currentSchema.engineSnapshots} engine snapshots
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DataRightsPage() {
  const { fetchWithAuth } = useAuth();
  const [requests, setRequests] = useState<DataRightsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/data-rights");
      if (!res.ok) { setRequests([]); return; }
      const data = (await res.json()) as { requests: DataRightsRequest[] };
      setRequests(data.requests || []);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchRequests(); }, [fetchRequests]);

  return (
    <AppShell title="Data Rights">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Trash2 className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-semibold">Data Rights</h1>
              <p className="text-sm text-muted-foreground">
                Export and deletion requests across every customer in your book, plus recording a request when a customer
                contacts you directly instead of using self-service.
              </p>
            </div>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Trash2 className="w-4 h-4 mr-2" />
            Record Deletion Request
          </Button>
        </div>

        <AlertBox alert={alert} onDismiss={() => setAlert(null)} />

        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              Fulfillment is a manual process (see the <code>data-subject-rights.md</code> runbook): every request must
              still be actioned via the Admin Panel within 30 days. Signed contracts, invoices, and signed SOWs are
              retained per legal requirements regardless of who recorded the request.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${requests.length} request${requests.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : requests.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No export or deletion requests recorded for your customers yet.
              </div>
            ) : (
              requests.map((r) => <RequestRow key={`${r.actionType}:${r.id}`} req={r} />)
            )}
          </CardContent>
        </Card>
      </div>

      <RecordDeletionRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmitted={() => {
          setAlert({ type: "success", message: "Deletion request recorded on the customer's behalf." });
          void fetchRequests();
        }}
      />
    </AppShell>
  );
}

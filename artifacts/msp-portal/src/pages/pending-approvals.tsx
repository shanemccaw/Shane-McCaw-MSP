import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  FileText,
  Clock,
  RefreshCw,
  TrendingUp,
  Building2,
  User,
  MessageSquare,
  Check,
  X,
  Eye
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

type PendingApproval = {
  id: number;
  runId: number;
  nodeId: string;
  approverRole: string;
  mspId: number | null;
  timeoutSeconds: number;
  status: "pending" | "approved" | "rejected" | "timed_out";
  decidedBy: string | null;
  decisionNote: string | null;
  context: Record<string, any>;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  definitionName: string | null;
  sow: {
    title: string;
    amountCents: number;
    currency: string;
  } | null;
  customer: {
    id: number;
    name: string;
  } | null;
};

type StatusFilter = "pending" | "approved" | "rejected";

export default function PendingApprovalsPage() {
  const { fetchWithAuth, user } = useAuth();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [actionType, setActionType] = useState<"approved" | "rejected" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mspId = user?.mspId;

  const fetchApprovals = useCallback(async () => {
    if (!mspId) return;
    setIsLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/msp/v1/msps/${mspId}/pending-approvals?status=${statusFilter}`
      );
      if (res.ok) {
        const data = (await res.json()) as PendingApproval[];
        setApprovals(data ?? []);
      } else {
        toast.error("Failed to load approvals");
      }
    } catch (err) {
      toast.error("An error occurred while loading approvals");
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, mspId, statusFilter]);

  useEffect(() => {
    void fetchApprovals();
  }, [fetchApprovals]);

  const handleOpenDecisionModal = (approval: PendingApproval, action: "approved" | "rejected") => {
    setSelectedApproval(approval);
    setActionType(action);
    setDecisionNote("");
  };

  const handleCloseDecisionModal = () => {
    setSelectedApproval(null);
    setActionType(null);
    setDecisionNote("");
  };

  const handleConfirmDecision = async () => {
    if (!selectedApproval || !actionType || !mspId) return;
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth(
        `/api/msp/v1/msps/${mspId}/pending-approvals/${selectedApproval.id}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: actionType,
            note: decisionNote.trim() || undefined,
          }),
        }
      );

      if (res.ok) {
        toast.success(`Request successfully ${actionType === "approved" ? "approved" : "rejected"}`);
        handleCloseDecisionModal();
        void fetchApprovals();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error ?? "Failed to save decision");
      }
    } catch (err) {
      toast.error("An error occurred while processing decision");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (cents: number, currency: string = "usd") => {
    const amount = cents / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return "Just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString();
  };

  const isMspAdmin = user?.mspRole === "MSPAdmin" || user?.role === "admin";
  const canDecide = isMspAdmin;

  const actions = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => void fetchApprovals()}
    >
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Approvals" actions={actions}>
      <div className="p-6 max-w-6xl space-y-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-bold tracking-tight">Purchase Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Review and approve pending charges, SOWs, and resale catalog purchases.
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex border-b border-border gap-6">
          {(["pending", "approved", "rejected"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`pb-3 text-sm font-medium transition-all relative capitalize ${
                statusFilter === tab
                  ? "text-primary border-b-2 border-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {tab === "pending" && approvals.length > 0 && (
                <Badge variant="default" className="ml-2 h-4 px-1.5 py-0 text-[10px] min-w-4 justify-center">
                  {approvals.length}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* List Content */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse border-border/80">
                <CardHeader className="space-y-2">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="h-10 bg-muted rounded" />
                  <div className="h-6 bg-muted rounded w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : approvals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg border-dashed bg-card/25 gap-3.5">
            <CheckCircle className="size-9 text-emerald-500/80 stroke-[1.5]" />
            <div>
              <h3 className="text-sm font-medium">All caught up!</h3>
              <p className="text-xs text-muted-foreground mt-1">
                No {statusFilter} approvals found for your MSP.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {approvals.map((app) => {
              const amount = app.sow?.amountCents ?? app.context.amountCents;
              const formattedAmt = amount != null ? formatCurrency(amount, app.sow?.currency ?? "usd") : null;
              const customerName = app.customer?.name ?? app.context.customerName ?? "Internal / Direct";

              return (
                <Card
                  key={app.id}
                  className="bg-card/60 backdrop-blur-sm border-border/80 hover:shadow-md hover:border-border transition-all flex flex-col justify-between"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider mb-1">
                          Run #{app.runId}
                        </Badge>
                        <CardTitle className="text-base font-semibold leading-none">
                          {app.definitionName ?? "MSP SOW Charge Approval"}
                        </CardTitle>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1.5">
                          <Building2 className="size-3.5" />
                          <span className="font-medium text-foreground">{customerName}</span>
                        </div>
                      </div>
                      
                      {app.status === "approved" && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] font-semibold gap-1">
                          <CheckCircle className="size-3" />
                          Approved
                        </Badge>
                      )}
                      {app.status === "rejected" && (
                        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] font-semibold gap-1">
                          <XCircle className="size-3" />
                          Rejected
                        </Badge>
                      )}
                      {app.status === "timed_out" && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] font-semibold gap-1">
                          <AlertCircle className="size-3" />
                          Timed Out
                        </Badge>
                      )}
                      {app.status === "pending" && (
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] font-semibold gap-1">
                          <Clock className="size-3" />
                          Awaiting Approval
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 pt-0">
                    <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                      {app.sow?.title && (
                        <div className="flex items-start gap-2">
                          <FileText className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Signed Statement of Work</p>
                            <p className="text-sm font-medium truncate">{app.sow.title}</p>
                          </div>
                        </div>
                      )}

                      {formattedAmt && (
                        <div className="flex items-start gap-2">
                          <TrendingUp className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                          <div>
                            <p className="text-xs text-muted-foreground">Charge Amount</p>
                            <p className="text-sm font-semibold text-primary">{formattedAmt}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Decided Info (if history tab) */}
                    {(app.status === "approved" || app.status === "rejected") && (
                      <div className="border-t border-border pt-3 space-y-2 text-xs">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <User className="size-3.5 text-muted-foreground" />
                          <span>Decided by: <span className="text-foreground font-medium">{app.decidedBy}</span></span>
                        </div>
                        {app.decidedAt && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="size-3.5 text-muted-foreground" />
                            <span>Date: <span className="text-foreground font-medium">{new Date(app.decidedAt).toLocaleString()}</span></span>
                          </div>
                        )}
                        {app.decisionNote && (
                          <div className="bg-muted/40 p-2.5 rounded border border-border/50 text-muted-foreground flex gap-1.5 items-start">
                            <MessageSquare className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
                            <span className="italic">Note: &ldquo;{app.decisionNote}&rdquo;</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pending Action Buttons */}
                    {app.status === "pending" && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                        <Link href={`/runs/${app.runId}`} className="shrink-0">
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Inspect workflow run">
                            <Eye className="size-3.5" />
                          </Button>
                        </Link>
                        {canDecide ? (
                          <>
                            <Button
                              size="sm"
                              className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-600/90 text-white font-medium"
                              onClick={() => handleOpenDecisionModal(app, "approved")}
                            >
                              <Check className="size-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 flex-1 font-medium"
                              onClick={() => handleOpenDecisionModal(app, "rejected")}
                            >
                              <X className="size-3.5 mr-1" />
                              Reject
                            </Button>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground italic flex-1 text-center py-1">
                            Requires approval permissions to act.
                          </p>
                        )}
                      </div>
                    )}

                    {app.status === "pending" && (
                      <p className="text-[10px] text-muted-foreground text-right block pt-1.5">
                        Requested {relativeTime(app.createdAt)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Decision Modal */}
      <Dialog open={!!selectedApproval} onOpenChange={(open) => !open && handleCloseDecisionModal()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionType === "approved" ? "Approve SOW Charge?" : "Reject SOW Charge?"}
            </DialogTitle>
            <DialogDescription>
              {actionType === "approved"
                ? "This will authorize charging the MSP's card on file for this SOW amount. The workflow will proceed."
                : "This will decline the charge. The workflow run will fail and no charge will occur."}
            </DialogDescription>
          </DialogHeader>

          {selectedApproval && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-medium">
                    {selectedApproval.customer?.name ?? selectedApproval.context.customerName ?? "Internal"}
                  </span>
                </div>
                {selectedApproval.sow?.title && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SOW:</span>
                    <span className="font-medium truncate max-w-[200px]">{selectedApproval.sow.title}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated Charge:</span>
                  <span className="font-semibold text-primary">
                    {selectedApproval.sow?.amountCents != null
                      ? formatCurrency(selectedApproval.sow.amountCents, selectedApproval.sow.currency)
                      : selectedApproval.context.amountCents != null
                      ? formatCurrency(selectedApproval.context.amountCents)
                      : "Unspecified"}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="decision-note" className="text-xs">
                  Decision Note {actionType === "rejected" && <span className="text-destructive">*</span>}
                </Label>
                <Textarea
                  id="decision-note"
                  placeholder={
                    actionType === "approved"
                      ? "Optional confirmation details or approval reason..."
                      : "Required reason for rejection..."
                  }
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  disabled={isSubmitting}
                  className="min-h-[80px]"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={handleCloseDecisionModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={actionType === "approved" ? "default" : "destructive"}
              onClick={() => void handleConfirmDecision()}
              disabled={isSubmitting || (actionType === "rejected" && !decisionNote.trim())}
              className="gap-1.5"
            >
              {isSubmitting && <Loader2 className="size-3.5 animate-spin" />}
              {actionType === "approved" ? "Confirm Approve" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
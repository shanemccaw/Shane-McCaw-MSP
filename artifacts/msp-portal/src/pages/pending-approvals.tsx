import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle, XCircle, FileText, Users, Clock, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ConfirmModal } from "@/components/confirm-modal";

type Approval = {
  id: string;
  type: "sow" | "offer" | "bundle_assignment";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt?: string;
  customer: {
    id: number;
    name: string;
    tenantSlug: string;
  };
  payload: {
    sowId?: string;
    offerId?: string;
    bundleId?: string;
    title?: string;
    amount?: number;
    currency?: string;
  };
};

export function PendingApprovalsPage() {
  const { fetchWithAuth } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | null>(null);

  const fetchApprovals = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetchWithAuth("/api/msp/approvals/pending");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to fetch pending approvals");
      }
      const data = await res.json();
      setApprovals(data.approvals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, [fetchWithAuth]);

  const handleAction = async (id: string, actionType: "approve" | "reject") => {
    setSelectedId(id);
    setAction(actionType);
  };

  const confirmAction = async () => {
    if (!selectedId || !action) return;

    try {
      const res = await fetchWithAuth(`/api/msp/approvals/${selectedId}/${action}`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed to ${action} approval`);
      }

      // Refresh the list
      await fetchApprovals();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSelectedId(null);
      setAction(null);
    }
  };

  const getTypeIcon = (type: Approval["type"]) => {
    switch (type) {
      case "sow":
        return <FileText className="size-4 text-blue-500" />;
      case "offer":
        return <Users className="size-4 text-green-500" />;
      case "bundle_assignment":
        return <Clock className="size-4 text-purple-500" />;
    }
  };

  const getTypeLabel = (type: Approval["type"]) => {
    switch (type) {
      case "sow":
        return "SOW Approval";
      case "offer":
        return "Offer Acceptance";
      case "bundle_assignment":
        return "Bundle Assignment";
    }
  };

  const getStatusBadge = (status: Approval["status"]) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="gap-1">
            <AlertCircle className="size-3" />
            Pending
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800 gap-1">
            <CheckCircle className="size-3" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="size-3" />
            Rejected
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <AlertCircle className="size-12 text-destructive" />
        <div>
          <h2 className="text-lg font-semibold">Failed to load approvals</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <Button onClick={fetchApprovals} variant="outline">
          <RefreshCw className="size-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pending Approvals</h1>
          <p className="text-muted-foreground">
            Review and approve SOWs, offer acceptances, and bundle assignments
          </p>
        </div>
        <Button onClick={fetchApprovals} variant="outline" size="sm">
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </div>

      {approvals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="size-12 text-green-500 mb-4" />
            <h3 className="text-lg font-medium">No pending approvals</h3>
            <p className="text-muted-foreground">All caught up! New approvals will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {approvals.map((approval) => (
            <Card key={approval.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-muted rounded-lg">{getTypeIcon(approval.type)}</div>
                  <div>
                    <CardTitle className="text-lg">{getTypeLabel(approval.type)}</CardTitle>
                    <p className="text-sm text-muted-foreground">{approval.customer.name}</p>
                  </div>
                </div>
                {getStatusBadge(approval.status)}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Created</p>
                    <p className="font-medium">
                      {format(new Date(approval.createdAt), "PPp")}
                    </p>
                  </div>
                  {approval.updatedAt && (
                    <div>
                      <p className="text-muted-foreground">Updated</p>
                      <p className="font-medium">
                        {format(new Date(approval.updatedAt), "PPp")}
                      </p>
                    </div>
                  )}
                </div>

                {approval.payload.title && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium">{approval.payload.title}</p>
                  </div>
                )}

                {approval.payload.amount && (
                  <div className="text-lg font-semibold text-primary">
                    {approval.payload.currency ?? "$"}{approval.payload.amount.toLocaleString()}
                  </div>
                )}

                {approval.status === "pending" && (
                  <div className="flex gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => handleAction(approval.id, "approve")}
                    >
                      <CheckCircle className="size-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => handleAction(approval.id, "reject")}
                    >
                      <XCircle className="size-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setAction(null);
          }
        }}
        onConfirm={confirmAction}
        title={action === "approve" ? "Approve this item?" : "Reject this item?"}
        description={
          action === "approve"
            ? "This will approve the request and notify the customer."
            : "This will reject the request. The customer will be notified."
        }
        confirmLabel={action === "approve" ? "Approve" : "Reject"}
        variant={action === "approve" ? "default" : "destructive"}
      />
    </div>
  );
} export default PendingApprovalsPage;
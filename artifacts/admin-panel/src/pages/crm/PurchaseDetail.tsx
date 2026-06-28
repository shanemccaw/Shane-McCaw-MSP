import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Trash2, AlertTriangle, ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface WizardOption {
  id: string;
  label: string;
  description?: string;
  priceAdjustment: number;
}

interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

interface WizardSelection {
  stepId: string;
  optionId: string;
}

interface ContractEntry {
  contractId: number;
  serviceName: string | null;
  wizardSelections: WizardSelection[] | null;
  orderWorkflow: WizardStep[] | null;
}

interface PurchaseDetail {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  stripeSessionId: string | null;
  couponCode: string | null;
  discountAmount: string | null;
  createdAt: string;
  client: {
    id: number | null;
    name: string | null;
    email: string | null;
    company: string | null;
  };
  project: { id: number; name: string } | null;
  contracts: ContractEntry[];
}

interface Blockers {
  project: { id: number; title: string; status: string };
  kanbanTasks: number;
  documents: number;
  workflowSteps: number;
  statusReports: number;
}

function statusBadge(status: string) {
  const base = "text-xs font-semibold px-2.5 py-1 rounded-full capitalize";
  if (status === "paid") return `${base} bg-green-500/15 text-green-400`;
  if (status === "overdue") return `${base} bg-red-500/15 text-red-400`;
  return `${base} bg-yellow-500/15 text-yellow-400`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-[#1C2128]">
        <h2 className="text-sm font-semibold text-[#E6EDF3]">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 text-sm">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className="text-[#E6EDF3] font-medium break-all">{value ?? "—"}</span>
    </div>
  );
}

function resolveSelections(contract: ContractEntry) {
  if (!contract.wizardSelections || !contract.orderWorkflow) return [];
  const result: Array<{ stepTitle: string; optionLabel: string; priceAdjustment: number }> = [];
  for (const sel of contract.wizardSelections) {
    const step = contract.orderWorkflow.find(s => s.id === sel.stepId);
    if (!step) continue;
    const option = step.options.find(o => o.id === sel.optionId);
    if (!option) continue;
    result.push({ stepTitle: step.title, optionLabel: option.label, priceAdjustment: option.priceAdjustment });
  }
  return result;
}

export default function PurchaseDetailPage() {
  const [, params] = useRoute("/crm/purchases/:id");
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [blockers, setBlockers] = useState<Blockers | null>(null);

  const id = params?.id;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchWithAuth(`/api/admin/purchases/${id}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PurchaseDetail>;
      })
      .then(data => { setDetail(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [id, fetchWithAuth]);

  function openDeleteDialog() {
    setConfirmText("");
    setBlockers(null);
    setShowDeleteDialog(true);
  }

  function closeDeleteDialog() {
    if (!deleting) {
      setShowDeleteDialog(false);
      setConfirmText("");
      setBlockers(null);
    }
  }

  const isPaid = detail?.status === "paid";
  const confirmReady = !isPaid || confirmText === detail?.invoiceNumber;

  async function executeDelete(force: boolean) {
    if (!detail) return;
    setDeleting(true);
    try {
      const url = `/api/admin/purchases/${detail.id}${force ? "?force=true" : ""}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });

      if (res.status === 409) {
        const body = await res.json() as { error: string; blockers: Blockers };
        setBlockers(body.blockers);
        setDeleting(false);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Purchase deleted", description: `${detail.invoiceNumber} has been removed.` });
      navigate("/crm/purchases");
    } catch {
      toast({ title: "Delete failed", description: "Could not delete the purchase. Please try again.", variant: "destructive" });
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  async function handleDelete() {
    if (!confirmReady) return;
    await executeDelete(false);
  }

  async function handleForceDelete() {
    await executeDelete(true);
  }

  function blockerSummary(b: Blockers): string[] {
    const lines: string[] = [];
    if (b.project.status === "active") lines.push("Project is currently active");
    if (b.kanbanTasks > 0) lines.push(`${b.kanbanTasks} kanban task${b.kanbanTasks !== 1 ? "s" : ""}`);
    if (b.documents > 0) lines.push(`${b.documents} document${b.documents !== 1 ? "s" : ""}`);
    if (b.workflowSteps > 0) lines.push(`${b.workflowSteps} workflow step${b.workflowSteps !== 1 ? "s" : ""}`);
    if (b.statusReports > 0) lines.push(`${b.statusReports} status report${b.statusReports !== 1 ? "s" : ""}`);
    return lines;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 sm:p-6 max-w-[900px]">
        <button onClick={() => navigate("/crm/purchases")} className="text-sm text-[#0078D4] hover:underline mb-4 flex items-center gap-1">
          ← Purchases
        </button>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-sm text-red-400">
          {error ?? "Purchase not found."}
        </div>
      </div>
    );
  }

  const fmt = (ts: string | null) => ts ? new Date(ts).toLocaleString() : "—";
  const currency = (detail.currency ?? "usd").toUpperCase();
  const amount = `${currency} $${parseFloat(detail.amount).toFixed(2)}`;

  const contractsWithSelections = detail.contracts.filter(c => {
    const resolved = resolveSelections(c);
    return resolved.length > 0;
  });

  return (
    <div className="p-4 sm:p-6 max-w-[900px] space-y-6">
      <div>
        <button
          onClick={() => navigate("/crm/purchases")}
          className="text-sm text-[#0078D4] hover:underline mb-4 flex items-center gap-1"
        >
          ← Purchases
        </button>
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-[#E6EDF3]">{detail.invoiceNumber}</h1>
            <span className={statusBadge(detail.status)}>{detail.status}</span>
          </div>
          <button
            onClick={openDeleteDialog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <Card title="Client">
        <Row label="Name" value={detail.client.name} />
        <Row label="Email" value={detail.client.email} />
        <Row label="Company" value={detail.client.company} />
      </Card>

      <Card title="Purchase Details">
        <Row label="Service / Description" value={detail.description} />
        <Row label="Invoice Number" value={detail.invoiceNumber} />
        <Row label="Amount" value={amount} />
        {detail.couponCode && (
          <Row
            label="Promo Code Applied"
            value={
              <span className="inline-flex items-center gap-2">
                <span className="font-mono bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-semibold px-2 py-0.5 rounded">
                  {detail.couponCode}
                </span>
                {detail.discountAmount && (
                  <span className="text-green-400 text-xs font-semibold">
                    −${parseFloat(detail.discountAmount).toFixed(2)} savings
                  </span>
                )}
              </span>
            }
          />
        )}
        <Row label="Status" value={<span className={statusBadge(detail.status)}>{detail.status}</span>} />
        <Row label="Created" value={fmt(detail.createdAt)} />
        <Row label="Paid At" value={fmt(detail.paidAt)} />
      </Card>

      {contractsWithSelections.length > 0 && (
        <Card title="Order Configuration">
          {contractsWithSelections.map((contract, ci) => {
            const selections = resolveSelections(contract);
            return (
              <div key={contract.contractId}>
                {contractsWithSelections.length > 1 && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {contract.serviceName ?? `Service ${ci + 1}`}
                  </p>
                )}
                <div className="divide-y divide-border -mx-5">
                  {selections.map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span className="text-muted-foreground">{s.stepTitle}</span>
                      <div className="flex items-center gap-2 text-right">
                        <span className="font-medium text-[#E6EDF3]">{s.optionLabel}</span>
                        {s.priceAdjustment !== 0 ? (
                          <span className={`text-xs font-semibold ${s.priceAdjustment > 0 ? "text-green-400" : "text-red-400"}`}>
                            {s.priceAdjustment > 0 ? `+$${s.priceAdjustment}` : `-$${Math.abs(s.priceAdjustment)}`}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Included</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {ci < contractsWithSelections.length - 1 && <div className="mt-4" />}
              </div>
            );
          })}
        </Card>
      )}

      <Card title="Payment">
        <Row label="Stripe Session ID" value={detail.stripeSessionId} />
        <Row label="Paid At" value={fmt(detail.paidAt)} />
      </Card>

      {detail.project && (
        <Card title="Project">
          <Row
            label="Project Name"
            value={
              <button
                onClick={() => navigate(`/crm/projects/${detail.project!.id}`)}
                className="text-[#0078D4] hover:underline text-left"
              >
                {detail.project.name}
              </button>
            }
          />
        </Card>
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
        <AlertDialogContent className={isPaid || blockers ? "border-red-500/60" : undefined}>
          <AlertDialogHeader>
            {(isPaid || blockers) && (
              <div className="flex items-center gap-2 mb-1 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">
                  {blockers ? "Cannot delete — linked records exist" : "Warning — this is a paid purchase"}
                </span>
              </div>
            )}
            <AlertDialogTitle className="flex items-center gap-2">
              Delete this purchase?
              {isPaid && !blockers && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                  PAID
                </span>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {blockers ? (
                  <>
                    <p>This purchase is linked to a project that has associated records. Resolve them first, or use <strong className="text-[#E6EDF3]">Force Delete</strong> to permanently remove everything.</p>
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#E6EDF3]">
                          Project: {blockers.project.title}
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${blockers.project.status === "active" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>
                          {blockers.project.status}
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {blockerSummary(blockers).map((line, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs text-amber-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            {line}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => { closeDeleteDialog(); navigate(`/crm/projects/${blockers.project.id}`); }}
                        className="flex items-center gap-1 text-xs text-[#0078D4] hover:underline mt-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open project to resolve
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-red-400">Force Delete</strong> will permanently erase the project, all its kanban tasks, documents, and workflow steps — this cannot be undone.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      {isPaid
                        ? "You are about to permanently delete a paid purchase record. This will also remove linked contracts and client services and cannot be undone."
                        : "This will also remove linked contracts and client services. This cannot be undone."}
                    </p>
                    {detail.stripeSessionId && (
                      <p className="text-xs text-muted-foreground">
                        The linked Stripe session will not be modified — only the local record is deleted.
                      </p>
                    )}
                    {isPaid && (
                      <div className="pt-1 space-y-1.5">
                        <p className="text-xs font-medium text-[#E6EDF3]">
                          Type the invoice number to confirm:{" "}
                          <span className="font-mono text-red-400">{detail.invoiceNumber}</span>
                        </p>
                        <Input
                          value={confirmText}
                          onChange={e => setConfirmText(e.target.value)}
                          placeholder={detail.invoiceNumber}
                          className="font-mono text-sm border-red-500/40 focus-visible:ring-red-500/50"
                          autoFocus
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            {blockers ? (
              <AlertDialogAction
                onClick={handleForceDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Force Delete"}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting || !confirmReady}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

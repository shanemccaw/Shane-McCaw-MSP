import { useEffect, useState } from "react";
import { useLocation } from "wouter";
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

interface Purchase {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  stripeSessionId: string | null;
  createdAt: string;
  clientEmail: string | null;
  clientName: string | null;
  clientCompany: string | null;
}

interface Blockers {
  project: { id: number; title: string; status: string };
  kanbanTasks: number;
  documents: number;
  workflowSteps: number;
  statusReports: number;
}

export default function PurchasesPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [blockers, setBlockers] = useState<Blockers | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/admin/purchases")
      .then(r => r.json() as Promise<Purchase[]>)
      .then(data => { setPurchases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  function openDeleteDialog(p: Purchase) {
    setConfirmText("");
    setBlockers(null);
    setDeleteTarget(p);
  }

  function closeDeleteDialog() {
    if (!deleting) {
      setDeleteTarget(null);
      setConfirmText("");
      setBlockers(null);
    }
  }

  const isPaid = deleteTarget?.status === "paid";
  const confirmReady = !isPaid || confirmText === deleteTarget?.invoiceNumber;

  async function executDelete(force: boolean) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const url = `/api/admin/purchases/${deleteTarget.id}${force ? "?force=true" : ""}`;
      const res = await fetchWithAuth(url, { method: "DELETE" });

      if (res.status === 409) {
        const body = await res.json() as { error: string; blockers: Blockers };
        setBlockers(body.blockers);
        setDeleting(false);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPurchases(prev => prev.filter(p => p.id !== deleteTarget.id));
      toast({ title: "Purchase deleted", description: `${deleteTarget.invoiceNumber} has been removed.` });
      setDeleteTarget(null);
      setConfirmText("");
      setBlockers(null);
    } catch {
      toast({ title: "Delete failed", description: "Could not delete the purchase. Please try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleDelete() {
    if (!confirmReady) return;
    await executDelete(false);
  }

  async function handleForceDelete() {
    await executDelete(true);
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

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Purchases</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Purchases appear here once clients complete checkout.</p>
        </div>
        <span className="text-sm text-muted-foreground">{purchases.length} total</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : purchases.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-20 text-center text-muted-foreground text-sm">
          No self-service purchases yet.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-accent">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Service</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Date</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-12" />
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors">
                    <td className="px-5 py-3.5 cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>
                      <p className="font-semibold text-foreground">{p.clientName ?? p.clientEmail ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{p.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>{p.description ?? p.invoiceNumber}</td>
                    <td className="px-5 py-3.5 font-bold text-foreground cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>${parseFloat(p.amount).toFixed(2)}</td>
                    <td className="px-5 py-3.5 cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${p.status === "paid" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>{new Date(p.createdAt).toLocaleDateString()}</td>
                    <td className="px-3 py-3.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); openDeleteDialog(p); }}
                        className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete purchase"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
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
                    <p>This purchase is linked to a project that has associated records. Resolve them first, or use <strong className="text-foreground">Force Delete</strong> to permanently remove everything.</p>
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
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
                        className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
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
                    {deleteTarget?.stripeSessionId && (
                      <p className="text-xs text-muted-foreground">
                        The linked Stripe session will not be modified — only the local record is deleted.
                      </p>
                    )}
                    {isPaid && (
                      <div className="pt-1 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">
                          Type the invoice number to confirm:{" "}
                          <span className="font-mono text-red-400">{deleteTarget?.invoiceNumber}</span>
                        </p>
                        <Input
                          value={confirmText}
                          onChange={e => setConfirmText(e.target.value)}
                          placeholder={deleteTarget?.invoiceNumber}
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

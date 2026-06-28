import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Trash2, AlertTriangle } from "lucide-react";
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

export default function PurchasesPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    fetchWithAuth("/api/admin/purchases")
      .then(r => r.json() as Promise<Purchase[]>)
      .then(data => { setPurchases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  function openDeleteDialog(p: Purchase) {
    setConfirmText("");
    setDeleteTarget(p);
  }

  function closeDeleteDialog() {
    if (!deleting) {
      setDeleteTarget(null);
      setConfirmText("");
    }
  }

  const isPaid = deleteTarget?.status === "paid";
  const confirmReady = !isPaid || confirmText === deleteTarget?.invoiceNumber;

  async function handleDelete() {
    if (!deleteTarget || !confirmReady) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/purchases/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPurchases(prev => prev.filter(p => p.id !== deleteTarget.id));
      toast({ title: "Purchase deleted", description: `${deleteTarget.invoiceNumber} has been removed.` });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete the purchase. Please try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
      setConfirmText("");
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Purchases</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Purchases appear here once clients complete checkout.</p>
        </div>
        <span className="text-sm text-muted-foreground">{purchases.length} total</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : purchases.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl py-20 text-center text-muted-foreground text-sm">
          No self-service purchases yet.
        </div>
      ) : (
        <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[#1C2128]">
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
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-[#1C2128] transition-colors">
                    <td className="px-5 py-3.5 cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>
                      <p className="font-semibold text-[#E6EDF3]">{p.clientName ?? p.clientEmail ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{p.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>{p.description ?? p.invoiceNumber}</td>
                    <td className="px-5 py-3.5 font-bold text-[#E6EDF3] cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>${parseFloat(p.amount).toFixed(2)}</td>
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
        <AlertDialogContent className={isPaid ? "border-red-500/60" : undefined}>
          <AlertDialogHeader>
            {isPaid && (
              <div className="flex items-center gap-2 mb-1 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Warning — this is a paid purchase</span>
              </div>
            )}
            <AlertDialogTitle className="flex items-center gap-2">
              Delete this purchase?
              {isPaid && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                  PAID
                </span>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
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
                    <p className="text-xs font-medium text-[#E6EDF3]">
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
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting || !confirmReady}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

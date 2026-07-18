import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
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
import { useToast } from "@/hooks/use-toast";

interface Contract {
  id: number;
  serviceId: number;
  userId: number;
  signerName: string | null;
  signedAt: string;
  contractVersion: string;
  projectId: number | null;
  stripeSessionId: string | null;
  serviceName: string | null;
  serviceSlug: string | null;
  clientEmail: string | null;
}

export default function ContractsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/admin/contracts")
      .then(r => r.json() as Promise<Contract[]>)
      .then(data => { setContracts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  const handleDelete = async () => {
    if (pendingDeleteId === null) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/contracts/${pendingDeleteId}`, { method: "DELETE" });
      if (res.ok) {
        setContracts(prev => prev.filter(c => c.id !== pendingDeleteId));
        toast({ title: "Contract deleted" });
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        toast({ title: "Failed to delete contract", description: body.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to delete contract", description: "Network error", variant: "destructive" });
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const contractToDelete = contracts.find(c => c.id === pendingDeleteId);

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Contracts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Contracts appear here after clients complete the onboarding agreement step.</p>
        </div>
        <span className="text-sm text-muted-foreground">{contracts.length} total</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : contracts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-20 flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-1">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="font-semibold text-foreground text-sm">No contracts yet</p>
          <p className="text-xs text-muted-foreground max-w-xs">Contracts appear here after a client completes the onboarding agreement step in the self-service portal.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-accent">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Service</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Version</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Project</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Signed</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-foreground">{c.signerName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{c.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{c.serviceName ?? c.serviceSlug ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">{c.contractVersion}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      {c.projectId ? (
                        <span className="text-xs bg-green-500/15 text-green-400 font-semibold px-2.5 py-1 rounded-full">Project #{c.projectId}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending payment</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">{new Date(c.signedAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setPendingDeleteId(c.id)}
                        className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                        title="Delete contract"
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

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={open => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contract?</AlertDialogTitle>
            <AlertDialogDescription>
              {contractToDelete
                ? `This will permanently delete the ${contractToDelete.contractVersion} contract signed by ${contractToDelete.signerName ?? contractToDelete.clientEmail ?? "this client"}. This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

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
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/admin/contracts")
      .then(r => r.json() as Promise<Contract[]>)
      .then(data => { setContracts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Signed Contracts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Contracts appear here after clients complete the onboarding agreement step.</p>
        </div>
        <span className="text-sm text-muted-foreground">{contracts.length} total</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : contracts.length === 0 ? (
        <div className="bg-white border border-border rounded-xl py-20 text-center text-muted-foreground text-sm">
          No signed contracts yet.
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[#F7F9FC]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Service</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Version</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Project</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Signed</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-[#F7F9FC] transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0A2540]">{c.signerName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{c.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{c.serviceName ?? c.serviceSlug ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">{c.contractVersion}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      {c.projectId ? (
                        <span className="text-xs bg-green-100 text-green-700 font-semibold px-2.5 py-1 rounded-full">Project #{c.projectId}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending payment</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">{new Date(c.signedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

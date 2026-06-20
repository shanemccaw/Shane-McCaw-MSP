import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

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
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/admin/purchases")
      .then(r => r.json() as Promise<Purchase[]>)
      .then(data => { setPurchases(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fetchWithAuth]);

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Self-Service Purchases</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Purchases appear here once clients complete checkout.</p>
        </div>
        <span className="text-sm text-muted-foreground">{purchases.length} total</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : purchases.length === 0 ? (
        <div className="bg-white border border-border rounded-xl py-20 text-center text-muted-foreground text-sm">
          No self-service purchases yet.
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-[#F7F9FC]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Client</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Service</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-[#F7F9FC] transition-colors cursor-pointer" onClick={() => navigate(`/crm/purchases/${p.id}`)}>
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-[#0A2540]">{p.clientName ?? p.clientEmail ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{p.clientEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{p.description ?? p.invoiceNumber}</td>
                    <td className="px-5 py-3.5 font-bold text-[#0A2540]">${parseFloat(p.amount).toFixed(2)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${p.status === "paid" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">{new Date(p.createdAt).toLocaleDateString()}</td>
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

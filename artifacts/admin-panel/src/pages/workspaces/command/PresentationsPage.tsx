import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  ExternalLink, Copy, ChevronDown, ChevronUp, CheckCircle,
  Clock, DollarSign, FileText, User, Calendar, CreditCard,
} from "lucide-react";

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
}

interface PaymentScheduleEntry {
  dueDate?: string;
  amount?: number;
  label?: string;
}

interface Presentation {
  id: number;
  shareToken: string | null;
  status: "draft" | "signed" | "paid";
  totalPrice: number | null;
  paymentPlan: "full" | "phased" | null;
  paymentSchedule: PaymentScheduleEntry[] | null;
  sowPhases: SowPhase[] | null;
  selectedPhaseIds: string[] | null;
  documentsIncluded: number[] | null;
  signedAt: string | null;
  signerName: string | null;
  stripeSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: number | null;
  projectName: string | null;
  clientUserId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
}

interface ApiResponse {
  presentations: Presentation[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  signed: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
};

function formatCurrency(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function PresentationDetailPanel({ p }: { p: Presentation }) {
  const { toast } = useToast();

  const selectedPhases = p.sowPhases?.filter(ph => p.selectedPhaseIds?.includes(ph.id) ?? ph.selected) ?? [];
  const allPhases = p.sowPhases ?? [];

  function copyToken() {
    if (!p.shareToken) return;
    const url = `${window.location.origin}/portal/presentation/${p.shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Copied", description: "Presentation link copied to clipboard." });
    });
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-5 text-sm">
      {allPhases.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-blue-500" /> SOW Phases
          </h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-200">
                <th className="text-left py-1 font-medium">Phase</th>
                <th className="text-left py-1 font-medium">Description</th>
                <th className="text-right py-1 font-medium">Price</th>
                <th className="text-center py-1 font-medium">Selected</th>
              </tr>
            </thead>
            <tbody>
              {allPhases.map(ph => {
                const isSelected = p.selectedPhaseIds ? p.selectedPhaseIds.includes(ph.id) : ph.selected;
                return (
                  <tr key={ph.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-gray-800 whitespace-nowrap">{ph.title}</td>
                    <td className="py-1.5 pr-3 text-gray-500">{ph.description || "—"}</td>
                    <td className="py-1.5 text-right text-gray-800 whitespace-nowrap">{formatCurrency(ph.price)}</td>
                    <td className="py-1.5 text-center">
                      {isSelected
                        ? <CheckCircle className="w-3.5 h-3.5 text-green-500 inline-block" />
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {p.signedAt && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-green-500" /> Signature
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-gray-400">Signer:</span> <span className="text-gray-800">{p.signerName || "—"}</span></div>
            <div><span className="text-gray-400">Signed:</span> <span className="text-gray-800">{formatDate(p.signedAt)}</span></div>
          </div>
        </div>
      )}

      {p.paymentSchedule && Array.isArray(p.paymentSchedule) && p.paymentSchedule.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-purple-500" /> Payment Schedule
          </h4>
          <div className="space-y-1">
            {(p.paymentSchedule as PaymentScheduleEntry[]).map((entry, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-gray-700">
                <span>{entry.label ?? `Payment ${i + 1}`}</span>
                <span className="font-medium">{formatCurrency(entry.amount ?? null)}</span>
                {entry.dueDate && <span className="text-gray-400">{formatDate(entry.dueDate)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {(p.documentsIncluded?.length ?? 0) > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-gray-400" /> Documents Included
          </h4>
          <p className="text-xs text-gray-500">{p.documentsIncluded!.length} document{p.documentsIncluded!.length !== 1 ? "s" : ""} attached (IDs: {p.documentsIncluded!.join(", ")})</p>
        </div>
      )}

      {p.stripeSessionId && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
            <DollarSign className="w-4 h-4 text-green-500" /> Stripe Session
          </h4>
          <p className="text-xs text-gray-500 font-mono break-all">{p.stripeSessionId}</p>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {p.shareToken && (
          <>
            <button
              onClick={copyToken}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copy Link
            </button>
            <a
              href={`/portal/presentation/${p.shareToken}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open Presentation
            </a>
          </>
        )}
        {!p.shareToken && (
          <span className="text-xs text-gray-400 italic">No share link available</span>
        )}
      </div>
    </div>
  );
}

function PresentationCard({ p }: { p: Presentation }) {
  const [expanded, setExpanded] = useState(false);

  const selectedCount = p.selectedPhaseIds?.length
    ?? p.sowPhases?.filter(ph => ph.selected).length
    ?? 0;
  const totalPhases = p.sowPhases?.length ?? 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      <button
        className="w-full text-left px-5 py-4 flex items-start gap-4"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="font-semibold text-gray-900 text-sm truncate">
              {p.projectName ?? `Presentation #${p.id}`}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}>
              {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            {(p.clientName || p.clientEmail) && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {p.clientName ?? p.clientEmail}
                {p.clientCompany && ` · ${p.clientCompany}`}
              </span>
            )}
            {p.totalPrice != null && (
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                {formatCurrency(p.totalPrice)}
                {p.paymentPlan && ` (${p.paymentPlan})`}
              </span>
            )}
            {totalPhases > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {selectedCount}/{totalPhases} phases selected
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(p.createdAt)}
            </span>
            {p.signedAt && (
              <span className="flex items-center gap-1 text-green-600">
                <Clock className="w-3 h-3" />
                Signed {formatDate(p.signedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-gray-400 mt-0.5">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && <PresentationDetailPanel p={p} />}
    </div>
  );
}

const PAGE_SIZE = 50;

export default function PresentationsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: number) => {
    setLoading(true);
    fetchWithAuth(`/api/admin/presentations?page=${p}&limit=${PAGE_SIZE}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiResponse>;
      })
      .then(data => {
        setPresentations(data.presentations);
        setTotal(data.total);
        setPage(data.page);
        setLoading(false);
      })
      .catch(err => {
        toast({ title: "Error", description: String(err), variant: "destructive" });
        setLoading(false);
      });
  }, [fetchWithAuth, toast]);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Presentations</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            All Quick Win presentations — {loading ? "…" : `${total} total`}
          </p>
        </div>
        <button
          onClick={() => load(page)}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && presentations.length === 0 && (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          Loading presentations…
        </div>
      )}

      {!loading && presentations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-sm">No presentations yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {presentations.map(p => (
          <PresentationCard key={p.id} p={p} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface Report {
  id: number;
  clientUserId: number;
  title: string;
  period: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  reportDate: string | null;
  createdAt: string;
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  executive_summary: "Executive Summary",
  other: "Other",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReportsPage() {
  const { fetchWithAuth } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ clientUserId: "", title: "", period: "monthly", reportDate: "" });
  const [file, setFile] = useState<File | null>(null);

  const load = async () => {
    const [rptRes, clientRes] = await Promise.all([fetchWithAuth("/api/admin/reports"), fetchWithAuth("/api/admin/clients")]);
    if (rptRes.ok) setReports(await rptRes.json() as Report[]);
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const clientName = (id: number) => {
    const c = clients.find(c => c.id === id);
    return c ? (c.name ?? c.email) : String(id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !form.clientUserId || !form.title) { setError("Client, title, and file are required."); return; }
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("clientUserId", form.clientUserId);
      fd.append("title", form.title);
      fd.append("period", form.period);
      if (form.reportDate) fd.append("reportDate", form.reportDate);
      const res = await fetchWithAuth("/api/admin/reports", { method: "POST", body: fd });
      if (!res.ok) {
        setError((await res.json() as { error: string }).error);
      } else {
        setShowForm(false);
        setForm({ clientUserId: "", title: "", period: "monthly", reportDate: "" });
        setFile(null);
        await load();
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this report?")) return;
    await fetchWithAuth(`/api/admin/reports/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Upload reports for clients to download from their portal.</p>
        </div>
        <button onClick={() => { setShowForm(true); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          Upload Report
        </button>
      </div>

      {showForm && (
        <div className="bg-[#1C2128] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#E6EDF3] mb-4">Upload Report</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Client *</label>
              <select required value={form.clientUserId} onChange={e => setForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]">
                <option value="">— Select Client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Period</label>
              <select value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]">
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="executive_summary">Executive Summary</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Report Title *</label>
              <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. May 2026 Monthly Report"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Report Date</label>
              <input type="date" value={form.reportDate} onChange={e => setForm(f => ({ ...f, reportDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">File (PDF or HTML) *</label>
              <input type="file" accept=".pdf,.html,.htm,.docx" required onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none file:mr-3 file:text-xs file:font-semibold file:bg-[#0078D4] file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={uploading} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {uploading ? "Uploading…" : "Upload Report"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1C2128] transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : reports.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">No reports yet.</div>
      ) : (
        <div className="bg-[#161B22] border border-border rounded-xl divide-y divide-border">
          {reports.map(r => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#E6EDF3] truncate">{r.title}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span>{clientName(r.clientUserId)}</span>
                  <span>{PERIOD_LABELS[r.period] ?? r.period}</span>
                  {r.sizeBytes && <span>{formatBytes(r.sizeBytes)}</span>}
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button onClick={() => void handleDelete(r.id)}
                className="text-xs text-red-500 hover:text-red-400 font-semibold transition-colors flex-shrink-0">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

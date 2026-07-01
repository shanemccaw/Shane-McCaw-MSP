import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  BarChart2, FileText, Users, Settings, RefreshCw, X, ChevronRight,
  Download, Send, CheckCircle, Archive, AlertTriangle, Plus, Pencil,
  Trash2, Eye, Zap, Shield, Globe, Cpu, BookOpen, Clock,
} from "lucide-react";

const API = "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Scores {
  security: number; governance: number; readiness: number; composite: number;
}

interface ScoresData {
  scores: Scores;
  coveragePct: number; totalGaps: number; totalRuns: number;
  findings: string[]; recommendations: string[];
  weeklyTrend: { week: string; composite: number; security: number; governance: number; readiness: number }[];
  conditionalAccessPct: number; deviceCompliancePct: number;
}

interface HeatmapEntry {
  domain: string; high: number; medium: number; low: number; total: number; riskScore: number;
}

interface InsightsDoc {
  id: number; customerId: number | null; projectId: number | null;
  category: "report" | "consulting"; docType: string; title: string;
  pdfUrl: string | null;
  status: "draft" | "approved" | "delivered" | "archived";
  approvedAt: string | null; deliveredAt: string | null; createdAt: string;
}

interface InsightsDocFull extends InsightsDoc { htmlContent: string; }

interface Automation {
  id: number; name: string; customerId: number | null; projectId: number | null;
  automationType: string; cronExpression: string; cronLabel: string; enabled: boolean;
  linkedRunbookScriptId: string | null; generateDocument: boolean;
  lastRunAt: string | null; nextRunAt: string | null; createdAt: string;
}

interface Customer { id: number; name: string; email: string; company: string; }
interface Project  { id: number; title: string; status: string; phase: string | null; }

// ── Constants ─────────────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { key: "executive_summary",          label: "Executive Summary",          icon: FileText,       desc: "High-level M365 health overview for executives and stakeholders" },
  { key: "full_readiness_report",      label: "Full Readiness Report",      icon: BarChart2,      desc: "Comprehensive M365 readiness assessment across all domains" },
  { key: "security_posture_report",    label: "Security Posture Report",    icon: Shield,         desc: "Detailed security configuration, gaps, and hardening recommendations" },
  { key: "governance_maturity_report", label: "Governance Maturity Report", icon: Globe,          desc: "Governance framework maturity analysis and improvement roadmap" },
  { key: "data_exposure_risk_report",  label: "Data Exposure Risk Report",  icon: AlertTriangle,  desc: "SharePoint, OneDrive, and Exchange data exposure assessment" },
  { key: "license_optimization_report",label: "License Optimization Report",icon: Cpu,            desc: "License utilisation analysis with cost reduction opportunities" },
] as const;

const CONSULTING_TYPES = [
  { key: "sow",                         label: "Statement of Work",          icon: FileText,      desc: "Formal SOW with scope, timeline, pricing placeholders" },
  { key: "remediation_plan",            label: "Remediation Plan",           icon: AlertTriangle, desc: "Prioritised steps for identified security and governance gaps" },
  { key: "deployment_plan",             label: "Deployment Plan",            icon: Settings,      desc: "Phased rollout with pre-checks, milestones, rollback procedures" },
  { key: "governance_framework",        label: "Governance Framework",       icon: Globe,         desc: "Tailored governance policies, roles, and enforcement mechanisms" },
  { key: "security_hardening_plan",     label: "Security Hardening Plan",    icon: Shield,        desc: "Identity, CA, Defender, and MFA hardening roadmap" },
  { key: "copilot_enablement_plan",     label: "Copilot Enablement Plan",    icon: Zap,           desc: "Readiness, data governance, pilot, and adoption strategy" },
  { key: "identity_modernization_plan", label: "Identity Modernization Plan",icon: Users,         desc: "Entra ID modernisation, MFA, PIM, and legacy decommission" },
] as const;

const AUTOMATION_TYPES = [
  { key: "monthly_tenant_health_report",       label: "Monthly Tenant Health Report",  defaultCron: "0 9 1 * *",  desc: "Executive Summary on the 1st of every month at 9am" },
  { key: "quarterly_governance_review",        label: "Quarterly Governance Review",   defaultCron: "0 9 1 */3 *",desc: "Governance Maturity Report every quarter" },
  { key: "weekly_security_drift_alerts",       label: "Weekly Security Drift Alerts",  defaultCron: "0 9 * * 1",  desc: "Security Posture Report every Monday at 9am" },
  { key: "license_waste_monitoring",           label: "License Waste Monitoring",      defaultCron: "0 0 * * 0",  desc: "License Optimization Report every Sunday at midnight" },
  { key: "conditional_access_drift_detection", label: "CA Drift Detection",            defaultCron: "0 6 * * *",  desc: "Security check every day at 6am" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  draft:    "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  approved: "bg-green-500/20 text-green-300 border-green-500/30",
  delivered:"bg-blue-500/20 text-blue-300 border-blue-500/30",
  archived: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// ── Shared UI helpers ──────────────────────────────────────────────────────────

function ScoreBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center justify-center bg-[#161B22] border border-gray-700/50 rounded-xl p-4 gap-1">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle cx="40" cy="40" r="32" fill="none" stroke="#2d333b" strokeWidth="8" />
          <circle cx="40" cy="40" r="32" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${(value / 100) * 201} 201`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-white">{value}</span>
        </div>
      </div>
      <span className="text-xs text-gray-400 text-center">{label}</span>
    </div>
  );
}

function ProgressBar({ label, value, color = "#0078D4" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span><span>{value}%</span>
      </div>
      <div className="h-2 bg-[#2d333b] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${STATUS_COLORS[status] ?? "bg-gray-700 text-gray-300 border-gray-600"}`}>
      {status}
    </span>
  );
}

function SlideOver({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-[#0D1117] border-l border-gray-700/50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#161B22] border border-gray-700/50 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Dashboard Tab ──────────────────────────────────────────────────────────────

function DashboardTab({
  customerId, projectId, fetchWithAuth,
}: {
  customerId: number | null; projectId: number | null;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [scoresData, setScoresData] = useState<ScoresData | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (customerId) params.set("customerId", String(customerId));
      if (projectId)  params.set("projectId",  String(projectId));
      const qs = params.size > 0 ? `?${params}` : "";

      const [sr, hr] = await Promise.all([
        fetchWithAuth(`${API}/admin/insights/scores${qs}`),
        fetchWithAuth(`${API}/admin/insights/heatmap${qs}`),
      ]);
      if (!sr.ok) throw new Error("Failed to load scores");
      setScoresData(await sr.json() as ScoresData);
      if (hr.ok) setHeatmap(((await hr.json()) as { heatmap: HeatmapEntry[] }).heatmap ?? []);
    } catch (e) {
      setError(String(e));
    } finally { setLoading(false); }
  }, [customerId, projectId, fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col gap-4 animate-pulse">
      {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-[#161B22] rounded-xl" />)}
    </div>
  );
  if (error) return (
    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" />{error}
      <button onClick={() => void load()} className="ml-auto text-xs underline">Retry</button>
    </div>
  );

  const sd = scoresData;
  const SCORE_COLORS = { security: "#ef4444", governance: "#f59e0b", readiness: "#3b82f6", composite: "#0078D4" };

  return (
    <div className="flex gap-5 h-full">
      <div className="flex-1 flex flex-col gap-5 min-w-0">
        {/* Score cards */}
        <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">M365 Health Scores</h3>
            <button onClick={() => void load()} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <ScoreBadge label="Security"   value={sd?.scores.security   ?? 0} color={SCORE_COLORS.security}   />
            <ScoreBadge label="Governance"  value={sd?.scores.governance  ?? 0} color={SCORE_COLORS.governance}  />
            <ScoreBadge label="Readiness"   value={sd?.scores.readiness   ?? 0} color={SCORE_COLORS.readiness}   />
            <ScoreBadge label="Composite"   value={sd?.scores.composite   ?? 0} color={SCORE_COLORS.composite}   />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="bg-[#0D1117] rounded-lg p-3">
              <div className="text-lg font-bold text-white">{sd?.totalRuns ?? 0}</div>
              <div className="text-xs text-gray-400">Script Runs</div>
            </div>
            <div className="bg-[#0D1117] rounded-lg p-3">
              <div className="text-lg font-bold text-yellow-400">{sd?.totalGaps ?? 0}</div>
              <div className="text-xs text-gray-400">Config Gaps</div>
            </div>
            <div className="bg-[#0D1117] rounded-lg p-3">
              <div className="text-lg font-bold text-blue-400">{sd?.coveragePct ?? 0}%</div>
              <div className="text-xs text-gray-400">Coverage</div>
            </div>
          </div>
        </div>

        {/* Coverage bars */}
        <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Infrastructure Coverage</h3>
          <div className="flex flex-col gap-3">
            <ProgressBar label="Conditional Access Coverage" value={sd?.conditionalAccessPct ?? 0} color="#0078D4" />
            <ProgressBar label="Device Compliance"           value={sd?.deviceCompliancePct  ?? 0} color="#10b981" />
            <ProgressBar label="Assessment Coverage"         value={sd?.coveragePct           ?? 0} color="#f59e0b" />
          </div>
        </div>

        {/* Risk heatmap */}
        {heatmap.length > 0 && (
          <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-4">Risk Heatmap by Domain</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={heatmap} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d333b" />
                <XAxis dataKey="domain" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #374151", borderRadius: 8, color: "#fff" }} />
                <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} />
                <Bar dataKey="high"   name="High"   fill="#ef4444" stackId="a" />
                <Bar dataKey="medium" name="Medium" fill="#f59e0b" stackId="a" />
                <Bar dataKey="low"    name="Low"    fill="#3b82f6" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Score trend */}
        {(sd?.weeklyTrend.length ?? 0) > 0 && (
          <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-5">
            <h3 className="text-white font-semibold mb-4">Score Trend (8-week)</h3>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={sd!.weeklyTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d333b" />
                <XAxis dataKey="week" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #374151", borderRadius: 8, color: "#fff" }} />
                <Bar dataKey="composite" name="Composite" fill="#0078D4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Right inspector panel */}
      <div className="w-80 shrink-0 flex flex-col gap-4">
        <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4 flex-1 overflow-y-auto max-h-80">
          <h4 className="text-white font-medium text-sm mb-3">Latest Findings</h4>
          {(sd?.findings.length ?? 0) === 0 ? (
            <p className="text-gray-500 text-xs">No findings yet. Run PowerShell assessments to populate.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sd!.findings.slice(0, 20).map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-300"><span className="text-red-400 shrink-0">•</span>{f}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4">
          <h4 className="text-white font-medium text-sm mb-3">Recommendations</h4>
          {(sd?.recommendations.length ?? 0) === 0 ? (
            <p className="text-gray-500 text-xs">No recommendations yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sd!.recommendations.slice(0, 10).map((r, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-300">
                  <CheckCircle className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />{r}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Documents Tab ──────────────────────────────────────────────────────────────

type WizardStep = "confirm" | "generating" | "done";

function DocumentsTab({
  customerId, projectId, fetchWithAuth, customers,
}: {
  customerId: number | null; projectId: number | null;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  customers: Customer[];
}) {
  const [docs, setDocs] = useState<InsightsDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<InsightsDocFull | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardType, setWizardType] = useState<string>("");
  const [wizardStep, setWizardStep] = useState<WizardStep>("confirm");
  const [wizardTitle, setWizardTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendDoc, setSendDoc] = useState<InsightsDoc | null>(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const buildQs = useCallback(() => {
    const p = new URLSearchParams({ category: "report" });
    if (customerId) p.set("customerId", String(customerId));
    if (projectId)  p.set("projectId",  String(projectId));
    return `?${p}`;
  }, [customerId, projectId]);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/documents${buildQs()}`);
      setDocs(((await r.json()) as { documents: InsightsDoc[] }).documents ?? []);
    } catch { /* empty */ } finally { setLoading(false); }
  }, [fetchWithAuth, buildQs]);

  useEffect(() => { void loadDocs(); }, [loadDocs]);

  const openWizard = (type: string) => {
    const t = REPORT_TYPES.find(r => r.key === type);
    setWizardType(type);
    setWizardTitle(`${t?.label ?? type} — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`);
    setWizardStep("confirm"); setError(null); setWizardOpen(true);
  };

  const generate = async () => {
    setWizardStep("generating"); setError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/documents/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId ?? undefined,
          projectId:  projectId  ?? undefined,
          docType: wizardType, title: wizardTitle,
        }),
      });
      const d = await r.json() as { document?: InsightsDocFull; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Generation failed");
      setSelectedDoc(d.document!);
      setWizardStep("done");
      void loadDocs();
    } catch (e) { setError(String(e)); setWizardStep("confirm"); }
  };

  const openPreview = async (doc: InsightsDoc) => {
    const r = await fetchWithAuth(`${API}/admin/insights/documents/${doc.id}`);
    setSelectedDoc(((await r.json()) as { document: InsightsDocFull }).document);
    setPreviewOpen(true);
  };

  const updateStatus = async (id: number, status: string) => {
    await fetchWithAuth(`${API}/admin/insights/documents/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    void loadDocs();
  };

  const deleteDoc = async (id: number) => {
    if (!confirm("Delete this document?")) return;
    await fetchWithAuth(`${API}/admin/insights/documents/${id}`, { method: "DELETE" });
    void loadDocs();
    if (selectedDoc?.id === id) setSelectedDoc(null);
  };

  const downloadPdf = (doc: InsightsDoc) => window.open(`${API}/admin/insights/documents/${doc.id}/download`, "_blank");

  const openSend = (doc: InsightsDoc) => {
    const customerEmail = doc.customerId
      ? (customers.find(c => c.id === doc.customerId)?.email ?? "")
      : "";
    setSendDoc(doc); setSendEmail(customerEmail); setSendSubject(doc.title); setSendResult(null); setSendOpen(true);
  };

  const sendDocument = async () => {
    if (!sendDoc) return;
    setSending(true); setSendResult(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/documents/${sendDoc.id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: sendEmail || undefined, subject: sendSubject }),
      });
      const d = await r.json() as { ok?: boolean; sentTo?: string; sharepointUrl?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Send failed");
      let msg = `✓ Sent to ${d.sentTo}`;
      if (d.sharepointUrl) msg += ` · Uploaded to SharePoint`;
      setSendResult(msg);
      void loadDocs();
      if (selectedDoc && selectedDoc.id === sendDoc.id) {
        setSelectedDoc(prev => prev ? { ...prev, status: "delivered", deliveredAt: new Date().toISOString() } : prev);
      }
    } catch (e) { setSendResult(`Error: ${String(e)}`); } finally { setSending(false); }
  };

  return (
    <div className="flex gap-5">
      {/* Left: type cards + list */}
      <div className="flex-1 flex flex-col gap-5 min-w-0">
        <div className="grid grid-cols-3 gap-3">
          {REPORT_TYPES.map(rt => {
            const Icon = rt.icon;
            const count = docs.filter(d => d.docType === rt.key).length;
            return (
              <div key={rt.key} className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg shrink-0"><Icon className="w-4 h-4 text-blue-400" /></div>
                  <div>
                    <div className="text-white text-sm font-medium">{rt.label}</div>
                    <div className="text-gray-400 text-xs mt-0.5">{rt.desc}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-auto">
                  {count > 0 && <span className="text-xs text-gray-500">{count} generated</span>}
                  <button onClick={() => openWizard(rt.key)} className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    <Plus className="w-3 h-3" /> Generate
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-[#161B22] border border-gray-700/50 rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <h3 className="text-white font-medium text-sm">Generated Reports ({docs.length})</h3>
            <button onClick={() => void loadDocs()} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"><RefreshCw className="w-3 h-3" /></button>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No reports generated yet. Use the cards above to generate your first one.</div>
          ) : (
            <div className="divide-y divide-gray-700/30">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/20 transition-colors group">
                  <FileText className="w-4 h-4 text-gray-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm truncate">{doc.title}</div>
                    <div className="text-gray-500 text-xs">{new Date(doc.createdAt).toLocaleDateString()}</div>
                  </div>
                  <StatusPill status={doc.status} />
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => void openPreview(doc)} title="Preview" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><Eye className="w-3.5 h-3.5" /></button>
                    <button onClick={() => downloadPdf(doc)} title="Download PDF" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><Download className="w-3.5 h-3.5" /></button>
                    {doc.status === "draft" && (
                      <button onClick={() => void updateStatus(doc.id, "approved")} title="Approve" className="p-1 rounded text-gray-400 hover:text-green-400 hover:bg-gray-700"><CheckCircle className="w-3.5 h-3.5" /></button>
                    )}
                    {doc.status === "approved" && (
                      <button onClick={() => openSend(doc)} title="Send to Client" className="p-1 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-700"><Send className="w-3.5 h-3.5" /></button>
                    )}
                    <button onClick={() => void updateStatus(doc.id, "archived")} title="Archive" className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-gray-700"><Archive className="w-3.5 h-3.5" /></button>
                    <button onClick={() => void deleteDoc(doc.id)} title="Delete" className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: preview */}
      {selectedDoc && (
        <div className="w-[480px] shrink-0 bg-[#161B22] border border-gray-700/50 rounded-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <div><div className="text-white text-sm font-medium truncate max-w-[260px]">{selectedDoc.title}</div><StatusPill status={selectedDoc.status} /></div>
            <div className="flex gap-1">
              <button onClick={() => downloadPdf(selectedDoc)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700" title="Download PDF"><Download className="w-3.5 h-3.5" /></button>
              {selectedDoc.status === "approved" && (
                <button
                  onClick={() => { const d = docs.find(x => x.id === selectedDoc.id); if (d) openSend(d); }}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                  title="Send to Client"
                >
                  <Send className="w-3 h-3" /> Send
                </button>
              )}
              <button onClick={() => setSelectedDoc(null)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <iframe srcDoc={selectedDoc.htmlContent} className="flex-1 w-full rounded-b-xl min-h-96" sandbox="allow-same-origin" title="Document Preview" />
        </div>
      )}

      {/* Wizard */}
      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="Generate Report">
        {wizardStep === "confirm" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Report Title</label>
              <input value={wizardTitle} onChange={e => setWizardTitle(e.target.value)}
                className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="bg-[#0D1117] rounded-lg p-3 text-xs text-gray-400">
              <div className="text-gray-300 font-medium mb-1">This will:</div>
              <ul className="list-disc list-inside flex flex-col gap-1">
                <li>Fetch real telemetry from script_run_results{customerId ? " for the selected customer" : ""}{projectId ? " and project" : ""}</li>
                <li>Generate AI narrative using Claude Haiku with structured profileUpdates context</li>
                <li>Stage as <strong className="text-yellow-400">Draft</strong> — no delivery until you approve</li>
                <li>Provide a downloadable <strong className="text-blue-400">PDF</strong> via pdf-lib</li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWizardOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={() => void generate()} disabled={!wizardTitle.trim()} className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 transition-colors">Generate Report</button>
            </div>
          </div>
        )}
        {wizardStep === "generating" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            <p className="text-white font-medium">Generating report…</p>
            <p className="text-gray-400 text-sm text-center">Fetching telemetry, analysing findings, and writing narrative with Claude AI. This takes 10–30 seconds.</p>
          </div>
        )}
        {wizardStep === "done" && selectedDoc && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              <div><div className="text-white font-medium text-sm">Report generated</div><div className="text-gray-400 text-xs">Staged as Draft. Approve it to allow delivery.</div></div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWizardOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700">Close</button>
              <button onClick={() => { setWizardOpen(false); void openPreview(selectedDoc); }} className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium">Preview</button>
            </div>
          </div>
        )}
      </Modal>

      <SlideOver open={previewOpen} onClose={() => setPreviewOpen(false)} title={selectedDoc?.title ?? "Preview"}>
        {selectedDoc && (
          <iframe srcDoc={selectedDoc.htmlContent} className="w-full h-full min-h-[600px] rounded-lg" sandbox="allow-same-origin" title="Full Preview" />
        )}
      </SlideOver>

      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title="Send to Client">
        <div className="flex flex-col gap-4">
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-300 text-xs flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            This will email the report via Exchange Online and upload a PDF to the client's SharePoint site (if configured). This action cannot be undone.
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block">Recipient Email (optional — uses customer email if blank)</label>
            <input value={sendEmail} onChange={e => setSendEmail(e.target.value)} type="email" placeholder="client@company.com"
              className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block">Email Subject</label>
            <input value={sendSubject} onChange={e => setSendSubject(e.target.value)}
              className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          {sendResult && <p className={`text-xs ${sendResult.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>{sendResult}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setSendOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700">Cancel</button>
            <button onClick={() => void sendDocument()} disabled={sending}
              className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 flex items-center gap-2">
              {sending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send Now</>}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Consulting Tab ─────────────────────────────────────────────────────────────

function ConsultingTab({
  customerId, projectId, fetchWithAuth,
}: {
  customerId: number | null; projectId: number | null;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [docs, setDocs] = useState<InsightsDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<InsightsDocFull | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardType, setWizardType] = useState<string>("");
  const [wizardTitle, setWizardTitle] = useState("");
  const [wizardStep, setWizardStep] = useState<WizardStep>("confirm");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendDoc, setSendDoc] = useState<InsightsDoc | null>(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildQs = useCallback(() => {
    const p = new URLSearchParams({ category: "consulting" });
    if (customerId) p.set("customerId", String(customerId));
    if (projectId)  p.set("projectId",  String(projectId));
    return `?${p}`;
  }, [customerId, projectId]);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/documents${buildQs()}`);
      setDocs(((await r.json()) as { documents: InsightsDoc[] }).documents ?? []);
    } catch { /* empty */ } finally { setLoading(false); }
  }, [fetchWithAuth, buildQs]);

  useEffect(() => { void loadDocs(); }, [loadDocs]);

  const openWizard = (type: string) => {
    const t = CONSULTING_TYPES.find(c => c.key === type);
    setWizardType(type);
    setWizardTitle(`${t?.label ?? type} — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`);
    setWizardStep("confirm"); setError(null); setWizardOpen(true);
  };

  const generate = async () => {
    setWizardStep("generating"); setError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/consulting/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId ?? undefined, projectId: projectId ?? undefined,
          deliverableType: wizardType, title: wizardTitle,
        }),
      });
      const d = await r.json() as { document?: InsightsDocFull; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Generation failed");
      setSelectedDoc(d.document!); setWizardStep("done"); void loadDocs();
    } catch (e) { setError(String(e)); setWizardStep("confirm"); }
  };

  const openPreview = async (doc: InsightsDoc) => {
    const r = await fetchWithAuth(`${API}/admin/insights/documents/${doc.id}`);
    setSelectedDoc(((await r.json()) as { document: InsightsDocFull }).document);
  };

  const approve = async (doc: InsightsDoc) => {
    await fetchWithAuth(`${API}/admin/insights/documents/${doc.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    void loadDocs();
  };

  const openSend = (doc: InsightsDoc) => {
    setSendDoc(doc); setSendEmail(""); setSendSubject(doc.title); setSendResult(null); setSendOpen(true);
  };

  const sendDeliverable = async () => {
    if (!sendDoc) return;
    setSending(true); setSendResult(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/consulting/${sendDoc.id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: sendEmail || undefined, subject: sendSubject }),
      });
      const d = await r.json() as { ok?: boolean; sentTo?: string; sharepointUrl?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Send failed");
      let msg = `✓ Sent to ${d.sentTo}`;
      if (d.sharepointUrl) msg += ` · Uploaded to SharePoint`;
      setSendResult(msg);
      void loadDocs();
    } catch (e) { setSendResult(`Error: ${String(e)}`); } finally { setSending(false); }
  };

  const deleteDoc = async (id: number) => {
    if (!confirm("Delete this deliverable?")) return;
    await fetchWithAuth(`${API}/admin/insights/documents/${id}`, { method: "DELETE" });
    void loadDocs();
    if (selectedDoc?.id === id) setSelectedDoc(null);
  };

  const downloadPdf = (doc: InsightsDoc) => window.open(`${API}/admin/insights/documents/${doc.id}/download`, "_blank");

  return (
    <div className="flex gap-5">
      {/* Left: type cards + list */}
      <div className="flex-1 flex flex-col gap-5 min-w-0">
        <div className="grid grid-cols-2 gap-3">
          {CONSULTING_TYPES.map(ct => {
            const Icon = ct.icon;
            const count = docs.filter(d => d.docType === ct.key).length;
            return (
              <div key={ct.key} className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg shrink-0"><Icon className="w-4 h-4 text-purple-400" /></div>
                  <div>
                    <div className="text-white text-sm font-medium">{ct.label}</div>
                    <div className="text-gray-400 text-xs mt-0.5">{ct.desc}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  {count > 0 && <span className="text-xs text-gray-500">{count} staged</span>}
                  <button onClick={() => openWizard(ct.key)} className="ml-auto flex items-center gap-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    <Plus className="w-3 h-3" /> Generate
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-[#161B22] border border-gray-700/50 rounded-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
            <h3 className="text-white font-medium text-sm">Consulting Deliverables ({docs.length})</h3>
            <button onClick={() => void loadDocs()} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"><RefreshCw className="w-3 h-3" /></button>
          </div>
          {loading ? <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
          : docs.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">No deliverables yet. Use the cards above to generate one.</div>
          : (
            <div className="divide-y divide-gray-700/30">
              {docs.map(doc => (
                <div key={doc.id}
                  onClick={() => void openPreview(doc)}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-700/20 cursor-pointer transition-colors group ${selectedDoc?.id === doc.id ? "bg-gray-700/30" : ""}`}>
                  <BookOpen className="w-4 h-4 text-gray-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm truncate">{doc.title}</div>
                    <div className="text-gray-500 text-xs">{new Date(doc.createdAt).toLocaleDateString()}</div>
                  </div>
                  <StatusPill status={doc.status} />
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => downloadPdf(doc)} title="Download PDF" className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><Download className="w-3.5 h-3.5" /></button>
                    {doc.status === "draft" && (
                      <button onClick={() => void approve(doc)} title="Approve" className="p-1 rounded text-gray-400 hover:text-green-400 hover:bg-gray-700"><CheckCircle className="w-3.5 h-3.5" /></button>
                    )}
                    {doc.status === "approved" && (
                      <button onClick={() => openSend(doc)} title="Send to Customer" className="p-1 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-700"><Send className="w-3.5 h-3.5" /></button>
                    )}
                    <button onClick={() => void deleteDoc(doc.id)} title="Delete" className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right inspector */}
      <div className="w-[480px] shrink-0 bg-[#161B22] border border-gray-700/50 rounded-xl flex flex-col">
        {selectedDoc ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
              <div><div className="text-white text-sm font-medium truncate max-w-[280px]">{selectedDoc.title}</div><StatusPill status={selectedDoc.status} /></div>
              <div className="flex gap-1">
                <button onClick={() => downloadPdf(selectedDoc)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700" title="Download PDF"><Download className="w-3.5 h-3.5" /></button>
                {selectedDoc.status === "approved" && (
                  <button onClick={() => { const d = docs.find(x => x.id === selectedDoc.id); if (d) openSend(d); }}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                    <Send className="w-3 h-3" /> Send
                  </button>
                )}
                {selectedDoc.status === "draft" && (
                  <button onClick={() => { const d = docs.find(x => x.id === selectedDoc.id); if (d) void approve(d).then(() => void loadDocs()); }}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg">
                    <CheckCircle className="w-3 h-3" /> Approve
                  </button>
                )}
                <button onClick={() => setSelectedDoc(null)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <iframe srcDoc={selectedDoc.htmlContent} className="flex-1 w-full rounded-b-xl min-h-96" sandbox="allow-same-origin" title="Deliverable Preview" />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-500">
            <ChevronRight className="w-8 h-8" />
            <p className="text-sm">Select a deliverable to preview</p>
          </div>
        )}
      </div>

      {/* Wizard */}
      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="Generate Consulting Deliverable">
        {wizardStep === "confirm" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Deliverable Title</label>
              <input value={wizardTitle} onChange={e => setWizardTitle(e.target.value)}
                className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500" />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="bg-[#0D1117] rounded-lg p-3 text-xs text-gray-400">
              Generates a professional {CONSULTING_TYPES.find(c => c.key === wizardType)?.label ?? wizardType} using real script telemetry and Claude AI. Staged as Draft — you must explicitly approve and send. SharePoint upload occurs automatically on delivery if the client site is configured.
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWizardOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700">Cancel</button>
              <button onClick={() => void generate()} disabled={!wizardTitle.trim()} className="px-4 py-2 rounded-lg text-sm bg-purple-700 hover:bg-purple-600 text-white font-medium disabled:opacity-40">Generate</button>
            </div>
          </div>
        )}
        {wizardStep === "generating" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
            <p className="text-white font-medium">Generating deliverable…</p>
            <p className="text-gray-400 text-sm text-center">This takes 15–40 seconds for consulting documents.</p>
          </div>
        )}
        {wizardStep === "done" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
              <div><div className="text-white font-medium text-sm">Deliverable generated</div><div className="text-gray-400 text-xs">Staged as Draft. Approve it before sending to the customer.</div></div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWizardOpen(false)} className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium">Done</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title="Send to Customer">
        <div className="flex flex-col gap-4">
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-300 text-xs flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            This will email the deliverable via Exchange Online and upload a PDF to the client's SharePoint site (if configured). This action cannot be undone.
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block">Recipient Email (optional — uses customer email if blank)</label>
            <input value={sendEmail} onChange={e => setSendEmail(e.target.value)} type="email" placeholder="client@company.com"
              className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1.5 block">Email Subject</label>
            <input value={sendSubject} onChange={e => setSendSubject(e.target.value)}
              className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          {sendResult && <p className={`text-xs ${sendResult.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>{sendResult}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setSendOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700">Cancel</button>
            <button onClick={() => void sendDeliverable()} disabled={sending}
              className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 flex items-center gap-2">
              {sending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sending…</> : <><Send className="w-3.5 h-3.5" /> Send Now</>}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Automation Tab ─────────────────────────────────────────────────────────────

function AutomationTab({
  customerId, projectId, fetchWithAuth,
}: {
  customerId: number | null; projectId: number | null;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Automation | null>(null);

  const [wType, setWType]             = useState<string>("monthly_tenant_health_report");
  const [wName, setWName]             = useState("");
  const [wCron, setWCron]             = useState("0 9 1 * *");
  const [wGenerate, setWGenerate]     = useState(true);
  const [wEnabled, setWEnabled]       = useState(true);
  const [wLinkedScript, setWLinkedScript] = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const loadAutomations = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/automations`);
      setAutomations(((await r.json()) as { automations: Automation[] }).automations ?? []);
    } catch { /* empty */ } finally { setLoading(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void loadAutomations(); }, [loadAutomations]);

  const openWizard = (preset?: typeof AUTOMATION_TYPES[number]) => {
    setWType(preset?.key ?? "monthly_tenant_health_report");
    setWName(preset?.label ?? ""); setWCron(preset?.defaultCron ?? "0 9 1 * *");
    setWGenerate(true); setWEnabled(true); setWLinkedScript("");
    setError(null); setWizardOpen(true);
  };

  const openEdit = (a: Automation) => {
    setEditTarget(a); setWType(a.automationType); setWName(a.name); setWCron(a.cronExpression);
    setWGenerate(a.generateDocument); setWEnabled(a.enabled); setWLinkedScript(a.linkedRunbookScriptId ?? "");
    setError(null); setEditOpen(true);
  };

  const saveNew = async () => {
    setSaving(true); setError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/automations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wName, automationType: wType, cronExpression: wCron,
          enabled: wEnabled, generateDocument: wGenerate,
          linkedRunbookScriptId: wLinkedScript || undefined,
          customerId: customerId ?? undefined, projectId: projectId ?? undefined,
        }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error: string }).error);
      setWizardOpen(false); void loadAutomations();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true); setError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/insights/automations/${editTarget.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wName, cronExpression: wCron, enabled: wEnabled,
          generateDocument: wGenerate, linkedRunbookScriptId: wLinkedScript || null,
        }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error: string }).error);
      setEditOpen(false); void loadAutomations();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const toggleEnabled = async (a: Automation) => {
    await fetchWithAuth(`${API}/admin/insights/automations/${a.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    void loadAutomations();
  };

  const deleteAutomation = async (id: number) => {
    if (!confirm("Delete this automation?")) return;
    await fetchWithAuth(`${API}/admin/insights/automations/${id}`, { method: "DELETE" });
    void loadAutomations();
  };

  const AutomationForm = () => (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-gray-400 text-xs mb-1.5 block">Automation Type</label>
        <select value={wType} onChange={e => {
          const at = AUTOMATION_TYPES.find(t => t.key === e.target.value);
          setWType(e.target.value);
          if (at) { setWCron(at.defaultCron); if (!wName || AUTOMATION_TYPES.some(t => t.label === wName)) setWName(at.label); }
        }} className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2">
          {AUTOMATION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <p className="text-gray-500 text-xs mt-1">{AUTOMATION_TYPES.find(t => t.key === wType)?.desc}</p>
      </div>
      <div>
        <label className="text-gray-400 text-xs mb-1.5 block">Name</label>
        <input value={wName} onChange={e => setWName(e.target.value)}
          className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Automation name…" />
      </div>
      <div>
        <label className="text-gray-400 text-xs mb-1.5 block">Cron Schedule</label>
        <input value={wCron} onChange={e => setWCron(e.target.value)}
          className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <p className="text-gray-500 text-xs mt-1">Format: minute hour day month weekday — e.g. <code>0 9 1 * *</code> = 9am on 1st of month</p>
      </div>
      <div>
        <label className="text-gray-400 text-xs mb-1.5 block">Linked Runbook Script ID (optional — triggers Azure runbook on fire)</label>
        <input value={wLinkedScript} onChange={e => setWLinkedScript(e.target.value)}
          className="w-full bg-[#0D1117] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="UUID of PowerShell script…" />
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" checked={wGenerate} onChange={e => setWGenerate(e.target.checked)} className="rounded" />
          Generate report document when fired
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" checked={wEnabled} onChange={e => setWEnabled(e.target.checked)} className="rounded" />
          Enabled
        </label>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {AUTOMATION_TYPES.map(at => {
          const existing = automations.find(a => a.automationType === at.key);
          return (
            <div key={at.key} className="bg-[#161B22] border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-white text-sm font-medium">{at.label}</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${
                  existing
                    ? existing.enabled ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                    : "bg-gray-700/30 text-gray-500 border-gray-600/30"
                }`}>
                  {existing ? (existing.enabled ? "Active" : "Paused") : "Not set up"}
                </span>
              </div>
              <p className="text-gray-400 text-xs mb-3">{at.desc}</p>
              {existing ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock className="w-3 h-3" />
                  <span className="text-gray-300">{existing.cronLabel || existing.cronExpression}</span>
                  {existing.nextRunAt && <span>· {new Date(existing.nextRunAt).toLocaleDateString()}</span>}
                </div>
              ) : (
                <button onClick={() => openWizard(at)} className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg transition-colors">
                  <Plus className="w-3 h-3" /> Set up
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-[#161B22] border border-gray-700/50 rounded-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
          <h3 className="text-white font-medium text-sm">All Automations ({automations.length})</h3>
          <div className="flex gap-2">
            <button onClick={() => void loadAutomations()} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"><RefreshCw className="w-3 h-3" /></button>
            <button onClick={() => openWizard()} className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium">
              <Plus className="w-3 h-3" /> New Automation
            </button>
          </div>
        </div>
        {loading ? <div className="p-6 text-center text-gray-500 text-sm">Loading…</div>
        : automations.length === 0 ? <div className="p-6 text-center text-gray-500 text-sm">No automations configured. Use the cards above or "New Automation" to create one.</div>
        : (
          <div className="divide-y divide-gray-700/30">
            {automations.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-700/20 transition-colors group">
                <button onClick={() => void toggleEnabled(a)}
                  className={`w-9 h-5 rounded-full transition-colors shrink-0 relative ${a.enabled ? "bg-blue-600" : "bg-gray-600"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${a.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm">{a.name}</div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
                    <Clock className="w-3 h-3" />
                    <span className="text-gray-300">{a.cronLabel || a.cronExpression}</span>
                    <code className="text-gray-600 text-[10px]">({a.cronExpression})</code>
                    {a.nextRunAt && <span>· next {new Date(a.nextRunAt).toLocaleDateString()}</span>}
                    {a.lastRunAt && <span>· last ran {new Date(a.lastRunAt).toLocaleDateString()}</span>}
                    {a.linkedRunbookScriptId && <span className="text-purple-400">· runbook linked</span>}
                  </div>
                </div>
                {a.generateDocument && <span className="text-[10px] text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded shrink-0">Generates Doc</span>}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(a)} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => void deleteAutomation(a.id)} className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="New Automation">
        <div className="flex flex-col gap-4">
          <AutomationForm />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setWizardOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700">Cancel</button>
            <button onClick={() => void saveNew()} disabled={saving || !wName.trim()} className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40">
              {saving ? "Saving…" : "Create Automation"}
            </button>
          </div>
        </div>
      </Modal>

      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title={`Edit: ${editTarget?.name ?? ""}`}>
        <div className="flex flex-col gap-4">
          <AutomationForm />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700">Cancel</button>
            <button onClick={() => void saveEdit()} disabled={saving || !wName.trim()} className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </SlideOver>
    </div>
  );
}

// ── Selectors ─────────────────────────────────────────────────────────────────

function Selectors({
  customers, projects, selectedCustomer, selectedProject,
  onSelectCustomer, onSelectProject,
}: {
  customers: Customer[]; projects: Project[];
  selectedCustomer: number | null; selectedProject: number | null;
  onSelectCustomer: (id: number | null) => void;
  onSelectProject:  (id: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 whitespace-nowrap">Viewing:</span>
      <select
        value={selectedCustomer ?? ""}
        onChange={e => { onSelectCustomer(e.target.value ? parseInt(e.target.value, 10) : null); onSelectProject(null); }}
        className="bg-[#161B22] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">All Customers</option>
        {customers.map(c => (
          <option key={c.id} value={c.id}>{c.name ?? c.email}{c.company ? ` — ${c.company}` : ""}</option>
        ))}
      </select>
      {selectedCustomer && projects.length > 0 && (
        <select
          value={selectedProject ?? ""}
          onChange={e => onSelectProject(e.target.value ? parseInt(e.target.value, 10) : null)}
          className="bg-[#161B22] border border-gray-700/50 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.title}{p.phase ? ` (${p.phase})` : ""}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

type Tab = "dashboard" | "documents" | "consulting" | "automation";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "dashboard",  label: "Dashboard",  icon: BarChart2  },
  { key: "documents",  label: "Documents",  icon: FileText   },
  { key: "consulting", label: "Consulting", icon: Users      },
  { key: "automation", label: "Automation", icon: Settings   },
];

export default function InsightsOutputs() {
  const { fetchWithAuth } = useAuth();
  const [tab, setTab]                         = useState<Tab>("dashboard");
  const [customers, setCustomers]             = useState<Customer[]>([]);
  const [projects, setProjects]               = useState<Project[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [selectedProject,  setSelectedProject]  = useState<number | null>(null);

  // Load customers on mount
  useEffect(() => {
    fetchWithAuth(`${API}/admin/insights/customers`)
      .then(r => r.json())
      .then((d: unknown) => { setCustomers((d as { customers: Customer[] }).customers ?? []); })
      .catch(() => { /* non-fatal */ });
  }, [fetchWithAuth]);

  // Load projects when customer changes
  useEffect(() => {
    if (!selectedCustomer) { setProjects([]); return; }
    fetchWithAuth(`${API}/admin/insights/projects?customerId=${selectedCustomer}`)
      .then(r => r.json())
      .then((d: unknown) => { setProjects((d as { projects: Project[] }).projects ?? []); })
      .catch(() => { setProjects([]); });
  }, [selectedCustomer, fetchWithAuth]);

  const tabProps = { customerId: selectedCustomer, projectId: selectedProject, fetchWithAuth, customers };

  return (
    <div className="flex flex-col h-full bg-[#0D1117] text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Insights & Outputs</h1>
          <p className="text-gray-400 text-sm mt-0.5">AI-generated reports and deliverables powered by real M365 telemetry</p>
        </div>
        <Selectors
          customers={customers} projects={projects}
          selectedCustomer={selectedCustomer} selectedProject={selectedProject}
          onSelectCustomer={setSelectedCustomer} onSelectProject={setSelectedProject}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 border-b border-gray-700/50">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.key
                  ? "text-blue-400 border-blue-500 bg-blue-500/5"
                  : "text-gray-400 border-transparent hover:text-gray-200 hover:bg-gray-700/30"
              }`}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "dashboard"  && <DashboardTab  {...tabProps} />}
        {tab === "documents"  && <DocumentsTab  {...tabProps} />}
        {tab === "consulting" && <ConsultingTab {...tabProps} />}
        {tab === "automation" && <AutomationTab {...tabProps} />}
      </div>
    </div>
  );
}

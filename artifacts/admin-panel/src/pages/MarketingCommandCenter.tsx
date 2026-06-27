import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, FunnelChart, Funnel, LabelList,
} from "recharts";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent, useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const API = "/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecommendedLead {
  id: number;
  name: string;
  company?: string;
  role?: string;
  email?: string;
  industry?: string;
  companySize?: string;
  location?: string;
  painPoints: string[];
  whyFit?: string;
  recommendedService?: string;
  confidence: number;
  status: "pending" | "converted" | "dismissed";
}

interface Lead {
  id: number;
  name: string;
  email: string;
  company?: string;
  industry?: string;
  companySize?: string;
  location?: string;
  status: string;
  stage: string;
  score: number;
  source: string;
  createdAt: string;
}

interface MarketingTask {
  id: number;
  title: string;
  description?: string;
  status: "ideas" | "in_progress" | "scheduled" | "published" | "completed";
  order: number;
  dueDate?: string;
  relatedLeadId?: number | null;
  relatedCampaignId?: number | null;
}

interface Campaign {
  id: number;
  name: string;
  goal: string;
  audience: string;
  offer: string;
  status: "draft" | "active" | "paused" | "completed";
  leadsGenerated: number;
  emailsSent: number;
  emailsSentAuto: number;
  revenueAttributed: string;
  createdAt: string;
}

interface PreviewAsset {
  assetType: string;
  title: string;
  content: string;
}

interface CampaignAsset extends PreviewAsset {
  id: number;
  campaignId?: number | null;
}

interface KPI {
  visitorsToday: number;
  leadsThisWeek: number;
  conversionRate: string;
  activeCampaigns: number;
}

interface FunnelEntry { stage: string; value: number }
interface CampaignPerf { id: number; name: string; status: string; assetCount: number; leadsGenerated: number; revenueAttributed: number; revenuePerLead: number | null }
interface AnalyticsData {
  dailyVisitors: Array<{ day: string; visitors: number }>;
  topPages: Array<{ page: string; views: number }>;
  trafficSources: Array<{ source: string; sessions: number }>;
  conversionFunnel: FunnelEntry[];
  campaignPerformance: CampaignPerf[];
}

interface EmailStats {
  totalSent: number;
  hasData: boolean;
  dailyTrend: Array<{ day: string; sent: number }>;
}

interface SeoRanking {
  id: number;
  keyword: string;
  position: number;
  previousPosition: number | null;
  url: string | null;
  searchVolume: number | null;
  notes: string | null;
  checkedAt: string;
  updatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COLORS = ["#0078D4", "#00B4D8", "#7C3AED", "#059669", "#F59E0B", "#EF4444", "#EC4899", "#6366F1"];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function Badge({ text, color = "blue" }: { text: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-[#0078D4]/20 text-[#58A6FF]",
    green: "bg-emerald-500/20 text-emerald-400",
    yellow: "bg-amber-500/20 text-amber-400",
    red: "bg-red-500/20 text-red-400",
    purple: "bg-violet-500/20 text-violet-400",
    gray: "bg-[#30363D] text-[#7D8590]",
    teal: "bg-teal-500/20 text-teal-400",
  };
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colors[color] ?? colors["gray"]}`}>{text}</span>;
}

function SkeletonCard({ count = 1 }: { count?: number }) {
  return <>{Array.from({ length: count }).map((_, i) => <div key={i} className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 animate-pulse h-24" />)}</>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMAIL_TYPES = new Set(["cold_email", "followup", "newsletter"]);

function parseSubjectFromContent(content: string): string {
  const match = /^SUBJECT:\s*(.+)/im.exec(content);
  return match?.[1]?.trim() ?? "";
}

// ─── Send Email Modal ─────────────────────────────────────────────────────────

function SendEmailModal({ initialTo, initialSubject, initialBody, leadId, campaignId, onClose, fetchWithAuth }: {
  initialTo: string; initialSubject: string; initialBody: string; leadId?: number; campaignId?: number; onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isConfigError, setIsConfigError] = useState(false);

  const send = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    setSending(true); setResult(null); setIsConfigError(false);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/send-outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, leadId, campaignId, bodyType: "text" }),
      });
      if (r.ok) {
        setResult("success");
        setTimeout(onClose, 1800);
      } else {
        const d = await r.json() as { error?: string };
        const msg = d.error ?? "Send failed";
        setErrorMsg(msg);
        setIsConfigError(r.status === 503 || r.status === 401 || r.status === 403);
        setResult("error");
      }
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[#E6EDF3] font-semibold">Send via Exchange Online</h3>
            <p className="text-[10px] text-[#7D8590] mt-0.5">Sends from Shane's Exchange mailbox via Microsoft Graph</p>
          </div>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3]">✕</button>
        </div>
        {result === "success" ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2">
            <span className="text-2xl">✓</span>
            <p className="text-emerald-400 text-sm font-medium">Email sent from your Exchange mailbox</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">To</label>
                <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@company.com"
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
              </div>
              <div>
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject…"
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
              </div>
              <div>
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Body</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none font-mono" />
              </div>
              {result === "error" && (
                <div className={`rounded-lg px-3 py-2 text-xs ${isConfigError ? "bg-amber-500/10 border border-amber-500/30 text-amber-300" : "bg-red-500/10 border border-red-500/30 text-red-400"}`}>
                  {isConfigError && <p className="font-semibold mb-0.5">Setup required</p>}
                  <p>{errorMsg || "Failed to send — check that Exchange Online / Graph credentials are configured."}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { void send(); }} disabled={sending || !to.trim() || !subject.trim()}
                className="flex-1 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
                {sending ? "Sending…" : "Send Email"}
              </button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Outreach Modal ───────────────────────────────────────────────────────────

function OutreachModal({ leadName, leadEmail, leadId, templateType, onClose, fetchWithAuth, onGenerated }: {
  leadName?: string; leadEmail?: string; leadId?: number; templateType?: string; onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onGenerated?: (content: string) => void;
}) {
  const [selectedType, setSelectedType] = useState(templateType ?? "cold_email");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [sendModal, setSendModal] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, name: leadName, templateType: selectedType }),
      });
      const data = await r.json() as { content: string };
      const generated = data.content ?? "";
      setContent(generated);
      if (generated) onGenerated?.(generated);
    } finally { setGenerating(false); }
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await fetchWithAuth(`${API}/admin/marketing/outreach-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName, templateType: selectedType, body: content, leadId }),
      });
      onClose();
    } finally { setSaving(false); }
  };

  const TYPE_LABELS: Record<string, string> = {
    cold_email: "Cold Email", linkedin: "LinkedIn", followup: "Follow-Up Seq.", cold_call: "Cold Call Script",
  };

  const canSendEmail = content && EMAIL_TYPES.has(selectedType);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-[#30363D]">
            <h3 className="text-[#E6EDF3] font-semibold">Generate Outreach{leadName ? ` — ${leadName}` : ""}</h3>
            <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3]">✕</button>
          </div>
          <div className="p-4 flex gap-2 flex-wrap">
            {(["cold_email", "linkedin", "followup", "cold_call"] as const).map(t => (
              <button key={t} onClick={() => { setSelectedType(t); setContent(""); }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${selectedType === t ? "bg-[#0078D4]/20 border-[#0078D4]/40 text-[#58A6FF]" : "border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3]"}`}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {generating ? (
              <div className="flex items-center justify-center h-32 text-[#7D8590]">
                <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin mr-2" />Generating…
              </div>
            ) : content ? (
              <div className="relative">
                <div className="absolute top-2 right-2"><CopyButton text={content} /></div>
                <pre className="text-[#E6EDF3] text-sm whitespace-pre-wrap font-sans bg-[#0D1117] rounded-lg p-4 pt-8">{content}</pre>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-[#7D8590] text-sm">Click Generate to create content</div>
            )}
          </div>
          <div className="p-4 border-t border-[#30363D] flex flex-col gap-2">
            {content && (
              <div className="flex gap-2 flex-wrap">
                <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Template name to save…"
                  className="flex-1 min-w-32 bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
                <button onClick={() => { void saveTemplate(); }} disabled={saving || !templateName.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors">
                  {saving ? "Saving…" : "Save Template"}
                </button>
                {canSendEmail && (
                  <button onClick={() => setSendModal(true)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">
                    Send Email
                  </button>
                )}
              </div>
            )}
            <button onClick={() => { void generate(); }} disabled={generating}
              className="w-full py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
              {generating ? "Generating…" : content ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>
      </div>
      {sendModal && (
        <SendEmailModal
          initialTo={leadEmail ?? ""}
          initialSubject={parseSubjectFromContent(content)}
          initialBody={content}
          leadId={leadId}
          onClose={() => setSendModal(false)}
          fetchWithAuth={fetchWithAuth}
        />
      )}
    </>
  );
}

// ─── Add-to-Task Modal ────────────────────────────────────────────────────────

function AddTaskModal({ lead, onClose, fetchWithAuth }: {
  lead: RecommendedLead; onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [title, setTitle] = useState(`Outreach: ${lead.name} @ ${lead.company ?? "unknown"}`);
  const [description, setDescription] = useState(lead.whyFit ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetchWithAuth(`${API}/admin/marketing/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, status: "ideas" }),
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[#E6EDF3] font-semibold">Add to Marketing Tasks</h3>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3]">✕</button>
        </div>
        <div className="space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Description…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => { void save(); }} disabled={saving || !title.trim()}
            className="flex-1 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
            {saving ? "Adding…" : "Add Task"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Add-to-Campaign Modal ────────────────────────────────────────────────────

function AddToCampaignModal({ lead, campaigns, onClose, fetchWithAuth }: {
  lead: RecommendedLead; campaigns: Campaign[]; onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(campaigns[0]?.id ?? null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await fetchWithAuth(`${API}/admin/marketing/campaign-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedId,
          assetType: "follow_up_task",
          title: `Lead: ${lead.name} @ ${lead.company ?? "unknown"}`,
          content: `Name: ${lead.name}\nCompany: ${lead.company ?? ""}\nRole: ${lead.role ?? ""}\nEmail: ${lead.email ?? ""}\nWhy fit: ${lead.whyFit ?? ""}\nPain points: ${lead.painPoints.join(", ")}\nRecommended service: ${lead.recommendedService ?? ""}`,
        }),
      });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[#E6EDF3] font-semibold">Add to Campaign</h3>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3]">✕</button>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-[#7D8590] text-sm">No campaigns yet — create one in the Campaigns section first.</p>
        ) : (
          <>
            <div className="space-y-2">
              {campaigns.map(c => (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${selectedId === c.id ? "border-[#0078D4]/60 bg-[#0078D4]/10 text-[#E6EDF3]" : "border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:border-[#58A6FF]/40"}`}>
                  <span className="font-medium">{c.name}</span>
                  <Badge text={c.status} color={c.status === "active" ? "green" : "gray"} />
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { void save(); }} disabled={saving || !selectedId}
                className="flex-1 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
                {saving ? "Adding…" : "Add to Campaign"}
              </button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Lead Email History Modal ─────────────────────────────────────────────────

interface OutreachEmailRecord {
  id: number;
  recipient: string | null;
  subject: string | null;
  eventType: string;
  sentAt: string;
  campaignId: number | null;
}

function LeadEmailHistoryModal({ lead, onClose, fetchWithAuth }: {
  lead: { id: number; name: string; email: string };
  onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [emails, setEmails] = useState<OutreachEmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/leads/${lead.id}/emails`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) setEmails(d as OutreachEmailRecord[]);
        else setError((d as { error?: string }).error ?? "Failed to load history");
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [lead.id, fetchWithAuth]);

  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[#30363D]">
          <div>
            <h3 className="text-[#E6EDF3] font-semibold">Email History — {lead.name}</h3>
            <p className="text-[10px] text-[#7D8590] mt-0.5">{lead.email}</p>
          </div>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3]">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-24 text-[#7D8590] text-sm">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin mr-2" />Loading…
            </div>
          ) : error ? (
            <p className="text-red-400 text-sm text-center py-8">{error}</p>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 text-[#7D8590] text-sm gap-1">
              <span className="text-2xl">✉</span>
              <p>No emails sent to this lead yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {emails.map(e => (
                <div key={e.id} className="bg-[#0D1117] border border-[#30363D] rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[#E6EDF3] text-sm font-medium truncate">{e.subject ?? "(no subject)"}</p>
                    <p className="text-[10px] text-[#7D8590] mt-0.5">To: {e.recipient ?? "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge text={e.eventType} color={e.eventType === "sent" ? "blue" : e.eventType === "delivered" ? "green" : e.eventType === "bounced" ? "red" : "gray"} />
                    <p className="text-[10px] text-[#484F58] mt-1">{fmt(e.sentAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-[#30363D] text-[10px] text-[#484F58]">
          {!loading && !error && `${emails.length} email${emails.length === 1 ? "" : "s"} in history`}
        </div>
      </div>
    </div>
  );
}

// ─── Section 0: Recommended Leads ─────────────────────────────────────────────

function RecommendedLeadsSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [leads, setLeads] = useState<RecommendedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [outreachModal, setOutreachModal] = useState<{ leadId: number; leadName: string; leadEmail: string; type: string } | null>(null);
  const [taskModal, setTaskModal] = useState<RecommendedLead | null>(null);
  const [campaignModal, setCampaignModal] = useState<RecommendedLead | null>(null);
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<number, string>>({});
  const [genError, setGenError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const loadLeads = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/recommended-leads`);
      const data = await r.json() as unknown;
      if (!r.ok || !Array.isArray(data)) {
        const msg = (data as { error?: string })?.error ?? "Failed to load leads";
        setGenError(msg);
        return [] as RecommendedLead[];
      }
      setLeads(data as RecommendedLead[]);
      return data as RecommendedLead[];
    } catch (e) {
      setGenError(String(e));
      return [] as RecommendedLead[];
    } finally { setLoading(false); }
  }, [fetchWithAuth]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/recommended-leads/generate`, { method: "POST" });
      const data = await r.json() as unknown;
      if (!r.ok || !Array.isArray(data)) {
        const msg = (data as { error?: string })?.error ?? "Lead generation failed";
        setGenError(msg);
        return;
      }
      setLeads(prev => [...(data as RecommendedLead[]), ...prev]);
    } catch (e) {
      setGenError(String(e));
    } finally { setGenerating(false); }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void loadLeads().then(data => {
      // Auto-generate if no pending leads exist
      const pending = data.filter(l => l.status === "pending");
      if (pending.length === 0) void generate();
    });
    fetchWithAuth(`${API}/admin/marketing/campaigns`).then(r => r.json()).then(d => setCampaigns(d as Campaign[])).catch(() => null);
  }, [loadLeads, generate, fetchWithAuth]);

  const convert = async (id: number) => {
    const draft = generatedDrafts[id] ?? null;
    await fetchWithAuth(`${API}/admin/marketing/recommended-leads/${id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outreachDraft: draft }),
    });
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: "converted" as const } : l));
  };

  const dismiss = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/recommended-leads/${id}/dismiss`, { method: "PATCH" });
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: "dismissed" as const } : l));
  };

  const active = leads.filter(l => l.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#E6EDF3]">AI Lead Recommendations</h2>
          <p className="text-xs text-[#7D8590]">AI-powered leads matched to your ICP and services — auto-refreshed from DB context</p>
        </div>
        <button onClick={() => { void generate(); }} disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-60 transition-colors">
          {generating
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generating…</>
            : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Generate Leads</>}
        </button>
      </div>

      {genError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <span>{genError}</span>
          <button onClick={() => setGenError(null)} className="text-red-400/60 hover:text-red-400 flex-shrink-0">✕</button>
        </div>
      )}

      {loading || generating && active.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"><SkeletonCard count={3} /></div>
      ) : active.length === 0 ? (
        <div className="bg-[#161B22] border border-dashed border-[#30363D] rounded-xl p-8 text-center">
          <p className="text-[#7D8590] text-sm">No pending leads — click Generate to refresh</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {active.map(lead => (
            <div key={lead.id} className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3 hover:border-[#0078D4]/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[#E6EDF3] truncate">{lead.name}</p>
                  <p className="text-xs text-[#7D8590] truncate">{lead.role}{lead.company ? ` · ${lead.company}` : ""}</p>
                  {lead.email && <p className="text-[10px] text-[#484F58] truncate">{lead.email}</p>}
                </div>
                <Badge text={`${lead.confidence}%`} color={lead.confidence >= 80 ? "green" : lead.confidence >= 60 ? "yellow" : "gray"} />
              </div>
              <div className="flex flex-wrap gap-1">
                {lead.industry && <Badge text={lead.industry} color="blue" />}
                {lead.companySize && <Badge text={lead.companySize} color="gray" />}
                {lead.location && <Badge text={lead.location} color="gray" />}
                {lead.recommendedService && <Badge text={lead.recommendedService} color="teal" />}
              </div>
              {lead.whyFit && <p className="text-xs text-[#7D8590] line-clamp-2">{lead.whyFit}</p>}
              {lead.painPoints.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {lead.painPoints.slice(0, 2).map((p, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">{p}</span>)}
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-1 border-t border-[#30363D]">
                <button onClick={() => { void convert(lead.id); }} className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors">Add to Leads</button>
                <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "cold_email" })} className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Email</button>
                <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "linkedin" })} className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">LinkedIn</button>
                <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "followup" })} className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Follow-Up Seq.</button>
                <button onClick={() => setTaskModal(lead)} className="text-[10px] px-2 py-1 rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors">Add Task</button>
                <button onClick={() => setCampaignModal(lead)} className="text-[10px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">Add to Campaign</button>
                <button onClick={() => { void dismiss(lead.id); }} className="text-[10px] px-2 py-1 rounded bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {outreachModal && (
        <OutreachModal leadId={outreachModal.leadId} leadName={outreachModal.leadName} leadEmail={outreachModal.leadEmail}
          templateType={outreachModal.type} onClose={() => setOutreachModal(null)} fetchWithAuth={fetchWithAuth}
          onGenerated={(content) => setGeneratedDrafts(prev => ({ ...prev, [outreachModal.leadId]: content }))} />
      )}
      {taskModal && (
        <AddTaskModal lead={taskModal} onClose={() => setTaskModal(null)} fetchWithAuth={fetchWithAuth} />
      )}
      {campaignModal && (
        <AddToCampaignModal lead={campaignModal} campaigns={campaigns} onClose={() => setCampaignModal(null)} fetchWithAuth={fetchWithAuth} />
      )}
    </div>
  );
}

// ─── Section 1: KPI Strip ──────────────────────────────────────────────────────

function KPIStrip({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [kpi, setKpi] = useState<KPI | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/kpi`).then(r => r.json()).then(d => setKpi(d as KPI)).catch(() => null);
  }, [fetchWithAuth]);

  const cards = [
    { label: "Visitors Today", value: kpi?.visitorsToday ?? "—", icon: "👁", color: "blue" },
    { label: "Leads This Week", value: kpi?.leadsThisWeek ?? "—", icon: "🎯", color: "green" },
    { label: "Conversion Rate", value: kpi ? `${kpi.conversionRate}%` : "—", icon: "📈", color: "yellow" },
    { label: "Active Campaigns", value: kpi?.activeCampaigns ?? "—", icon: "🚀", color: "purple" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">KPI Overview</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
            {!kpi ? <div className="animate-pulse h-10 bg-[#30363D] rounded" /> : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-xs text-[#7D8590]">{c.label}</span>
                </div>
                <p className="text-2xl font-bold text-[#E6EDF3]">{String(c.value)}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section 2: Lead Finder ────────────────────────────────────────────────────

function LeadFinderSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterIndustry, setFilterIndustry] = useState("all");
  const [filterCompanySize, setFilterCompanySize] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [outreachModal, setOutreachModal] = useState<{ leadId: number; leadName: string; leadEmail: string; type: string } | null>(null);
  const [emailHistoryLead, setEmailHistoryLead] = useState<{ id: number; name: string; email: string } | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/leads?limit=100`).then(r => r.json()).then(d => {
      setLeads((d as { leads: Lead[] }).leads ?? (d as Lead[]));
    }).catch(() => null).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const industries = [...new Set(leads.map(l => l.industry).filter(Boolean))] as string[];
  const companySizes = [...new Set(leads.map(l => l.companySize).filter(Boolean))] as string[];
  const locations = [...new Set(leads.map(l => l.location).filter(Boolean))] as string[];

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchSearch = !q || l.name.toLowerCase().includes(q) || (l.company ?? "").toLowerCase().includes(q) || (l.email ?? "").toLowerCase().includes(q) || (l.industry ?? "").toLowerCase().includes(q);
    return matchSearch
      && (filterStatus === "all" || l.status === filterStatus)
      && (filterSource === "all" || l.source === filterSource)
      && (filterIndustry === "all" || l.industry === filterIndustry)
      && (filterCompanySize === "all" || l.companySize === filterCompanySize)
      && (filterLocation === "all" || l.location === filterLocation);
  });

  const select = "bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">Lead Finder</h2>
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, email…"
          className="flex-1 min-w-40 bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={select}>
          <option value="all">All Statuses</option>
          {["new", "contacted", "qualified", "converted", "archived"].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className={select}>
          <option value="all">All Sources</option>
          <option value="ai_recommended">AI Recommended</option>
          <option value="contact_form">Contact Form</option>
          <option value="lead_magnet">Lead Magnet</option>
        </select>
        <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} className={select}>
          <option value="all">All Industries</option>
          {industries.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterCompanySize} onChange={e => setFilterCompanySize(e.target.value)} className={select}>
          <option value="all">All Sizes</option>
          {companySizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {locations.length > 0 && (
          <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} className={select}>
            <option value="all">All Locations</option>
            {locations.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {loading ? <SkeletonCard /> : (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[#30363D] bg-[#0D1117]">
                <tr>
                  {["Name", "Company", "Industry / Size", "Source", "Status", "Stage", "Score", "Actions"].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-[#7D8590]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363D]">
                {filtered.slice(0, 50).map(lead => (
                  <tr key={lead.id} className="hover:bg-[#1C2128] transition-colors">
                    <td className="px-4 py-2">
                      <p className="font-medium text-[#E6EDF3]">{lead.name}</p>
                      <p className="text-[10px] text-[#7D8590]">{lead.email}</p>
                    </td>
                    <td className="px-4 py-2 text-[#7D8590] text-xs">
                      {lead.company ?? "—"}
                      {lead.location && <p className="text-[10px] text-[#484F58]">{lead.location}</p>}
                    </td>
                    <td className="px-4 py-2 text-[#7D8590] text-xs">
                      {lead.industry ?? "—"}
                      {lead.companySize && <p className="text-[10px] text-[#484F58]">{lead.companySize}</p>}
                    </td>
                    <td className="px-4 py-2">
                      {lead.source === "ai_recommended" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400">
                          <span>✦</span> AI Recommended
                        </span>
                      ) : lead.source === "lead_magnet" ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400">Lead Magnet</span>
                      ) : lead.source === "contact_form" ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#0078D4]/20 text-[#58A6FF]">Contact Form</span>
                      ) : (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#30363D] text-[#7D8590]">{lead.source}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge text={lead.status} color={lead.status === "converted" ? "green" : lead.status === "new" ? "blue" : lead.status === "archived" ? "gray" : "yellow"} />
                    </td>
                    <td className="px-4 py-2">
                      <Badge text={lead.stage} color={lead.stage === "SQL" ? "green" : lead.stage === "AQL" ? "yellow" : "gray"} />
                    </td>
                    <td className="px-4 py-2 text-[#E6EDF3] text-xs font-mono">{lead.score}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "cold_email" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Email</button>
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "linkedin" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">LinkedIn</button>
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "followup" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Follow-Up</button>
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "cold_call" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Call Script</button>
                        <button onClick={() => setEmailHistoryLead({ id: lead.id, name: lead.name, email: lead.email })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">History</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-[#7D8590] text-sm">No leads match the filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-2 border-t border-[#30363D] text-[10px] text-[#484F58]">
              Showing {Math.min(50, filtered.length)} of {filtered.length} leads
            </div>
          )}
        </div>
      )}

      {outreachModal && (
        <OutreachModal leadId={outreachModal.leadId} leadName={outreachModal.leadName} leadEmail={outreachModal.leadEmail}
          templateType={outreachModal.type} onClose={() => setOutreachModal(null)} fetchWithAuth={fetchWithAuth} />
      )}
      {emailHistoryLead && (
        <LeadEmailHistoryModal lead={emailHistoryLead} onClose={() => setEmailHistoryLead(null)} fetchWithAuth={fetchWithAuth} />
      )}
    </div>
  );
}

// ─── Section 3: Outreach Automation ───────────────────────────────────────────

function OutreachAutomationSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>; }) {
  const [activeTab, setActiveTab] = useState<"cold_email" | "linkedin" | "followup" | "cold_call">("cold_email");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [industry, setIndustry] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: number; name: string; templateType: string; body: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [sendDialog, setSendDialog] = useState<{ to: string; subject: string; body: string; campaignId?: number } | null>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: number; name: string }>>([]);
  const [tagCampaignId, setTagCampaignId] = useState<number | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/outreach-templates`).then(r => r.json()).then(d => setTemplates(d as typeof templates)).catch(() => null);
    fetchWithAuth(`${API}/admin/marketing/campaigns`).then(r => r.json()).then(d => {
      if (Array.isArray(d)) setCampaigns(d as Array<{ id: number; name: string }>);
    }).catch(() => null);
  }, [fetchWithAuth]);

  const generate = async () => {
    setGenerating(true); setContent("");
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateType: activeTab, name, company, role, industry }),
      });
      const data = await r.json() as { content: string };
      setContent(data.content ?? "");
    } finally { setGenerating(false); }
  };

  const save = async () => {
    if (!saveName.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/outreach-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName, templateType: activeTab, body: content }),
      });
      const t = await r.json() as { id: number; name: string; templateType: string; body: string };
      setTemplates(prev => [t, ...prev]);
      setSaveName("");
    } finally { setSaving(false); }
  };

  const deleteTemplate = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/outreach-templates/${id}`, { method: "DELETE" });
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const tabs = [
    { id: "cold_email" as const, label: "Cold Email" },
    { id: "linkedin" as const, label: "LinkedIn" },
    { id: "followup" as const, label: "Follow-Up Seq." },
    { id: "cold_call" as const, label: "Call Script" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">Outreach Automation</h2>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {tabs.map(t => (
                <button key={t.id} onClick={() => { setActiveTab(t.id); setContent(""); }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${activeTab === t.id ? "bg-[#0078D4]/20 border-[#0078D4]/40 text-[#58A6FF]" : "border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3]"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {campaigns.length > 0 && (
              <select
                value={tagCampaignId ?? ""}
                onChange={e => setTagCampaignId(e.target.value ? Number(e.target.value) : null)}
                className="ml-auto text-[11px] bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[#7D8590] outline-none focus:border-[#0078D4]/60"
                title="Tag outreach emails to a campaign for auto-tracking"
              >
                <option value="">No campaign tag</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([["Name", name, setName], ["Company", company, setCompany], ["Role", role, setRole], ["Industry", industry, setIndustry]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
              <div key={label}>
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">{label}</label>
                <input value={val} onChange={e => setter(e.target.value)} placeholder={`Lead ${label.toLowerCase()}…`}
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
              </div>
            ))}
          </div>
          <button onClick={() => { void generate(); }} disabled={generating}
            className="w-full py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
            {generating ? "Generating…" : "Generate"}
          </button>
          {content && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#7D8590]">Generated content</span>
                <CopyButton text={content} />
              </div>
              <pre className="text-[#E6EDF3] text-sm whitespace-pre-wrap font-sans bg-[#0D1117] rounded-lg p-3 max-h-64 overflow-y-auto">{content}</pre>
              <div className="flex gap-2 flex-wrap">
                <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Template name…"
                  className="flex-1 min-w-24 bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
                <button onClick={() => { void save(); }} disabled={saving || !saveName.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors">
                  {saving ? "Saving…" : "Save"}
                </button>
                {EMAIL_TYPES.has(activeTab) && (
                  <button onClick={() => setSendDialog({ to: "", subject: parseSubjectFromContent(content), body: content, campaignId: tagCampaignId ?? undefined })}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">
                    Send Email
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Saved Templates</h3>
          {templates.length === 0 ? (
            <p className="text-xs text-[#7D8590]">No templates saved yet</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {templates.map(t => (
                <div key={t.id} className="bg-[#0D1117] rounded-lg p-2 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-[#E6EDF3] truncate">{t.name}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      <Badge text={t.templateType} color="blue" />
                      <button onClick={() => { void deleteTemplate(t.id); }} className="text-[#484F58] hover:text-red-400 transition-colors text-[10px]">✕</button>
                    </div>
                  </div>
                  <p className="text-[#7D8590] line-clamp-2">{t.body}</p>
                  <div className="flex gap-1">
                    <CopyButton text={t.body} />
                    {EMAIL_TYPES.has(t.templateType) && (
                      <button onClick={() => setSendDialog({ to: "", subject: parseSubjectFromContent(t.body), body: t.body, campaignId: tagCampaignId ?? undefined })}
                        className="text-xs px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">
                        Send
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {sendDialog && (
        <SendEmailModal
          initialTo={sendDialog.to}
          initialSubject={sendDialog.subject}
          initialBody={sendDialog.body}
          campaignId={sendDialog.campaignId}
          onClose={() => setSendDialog(null)}
          fetchWithAuth={fetchWithAuth}
        />
      )}
    </div>
  );
}

// ─── Section 4: Content Hub ────────────────────────────────────────────────────

interface CampaignAsset {
  id: number;
  assetType: string;
  title: string;
  content: string;
  createdAt: string;
  campaignId?: number | null;
}

function ContentHubSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [activeTab, setActiveTab] = useState<"blog_post" | "linkedin_post" | "newsletter" | "social_post" | "seo_keywords">("blog_post");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [keywords, setKeywords] = useState("");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedAssets, setSavedAssets] = useState<CampaignAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadAssets = useCallback(async (tab: string) => {
    setLoadingAssets(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/campaign-assets?assetType=${encodeURIComponent(tab)}`);
      const data = await r.json() as CampaignAsset[];
      setSavedAssets(Array.isArray(data) ? data : []);
    } catch { setSavedAssets([]); }
    finally { setLoadingAssets(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void loadAssets(activeTab); }, [activeTab, loadAssets]);

  const generate = async () => {
    if (!topic.trim()) return;
    setGenerating(true); setContent("");
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: activeTab, topic, tone, keywords }),
      });
      const data = await r.json() as { content: string };
      setContent(data.content ?? "");
    } finally { setGenerating(false); }
  };

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await fetchWithAuth(`${API}/admin/marketing/campaign-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetType: activeTab, title: topic || activeTab, content }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      void loadAssets(activeTab);
    } finally { setSaving(false); }
  };

  const tabs = [
    { id: "blog_post" as const, label: "Blog Post" },
    { id: "linkedin_post" as const, label: "LinkedIn" },
    { id: "newsletter" as const, label: "Newsletter" },
    { id: "social_post" as const, label: "Social Posts" },
    { id: "seo_keywords" as const, label: "SEO Keywords" },
  ];

  const TAB_LABEL: Record<string, string> = {
    blog_post: "Blog Post", linkedin_post: "LinkedIn", newsletter: "Newsletter",
    social_post: "Social Post", seo_keywords: "SEO Keywords",
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">Content Hub</h2>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap gap-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setContent(""); setExpandedId(null); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${activeTab === t.id ? "bg-[#0078D4]/20 border-[#0078D4]/40 text-[#58A6FF]" : "border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3]"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-1 space-y-3">
            <div>
              <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Topic *</label>
              <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Microsoft Copilot for Teams…"
                className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            </div>
            <div>
              <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Tone</label>
              <input value={tone} onChange={e => setTone(e.target.value)} placeholder="e.g. authoritative, friendly…"
                className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            </div>
            <div>
              <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Keywords</label>
              <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="comma-separated…"
                className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            </div>
            <button onClick={() => { void generate(); }} disabled={generating || !topic.trim()}
              className="w-full py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
          <div className="md:col-span-2">
            {generating ? (
              <div className="flex items-center justify-center h-48 text-[#7D8590]">
                <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin mr-2" />Generating…
              </div>
            ) : content ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#7D8590]">Generated content</span>
                  <div className="flex gap-2">
                    <CopyButton text={content} />
                    <button onClick={() => { void save(); }} disabled={saving || saveSuccess}
                      className={`text-xs px-2 py-1 rounded transition-colors ${saveSuccess ? "bg-emerald-500/30 text-emerald-300" : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40"}`}>
                      {saving ? "Saving…" : saveSuccess ? "Saved!" : "Save Asset"}
                    </button>
                  </div>
                </div>
                <pre className="text-[#E6EDF3] text-sm whitespace-pre-wrap font-sans bg-[#0D1117] rounded-lg p-4 max-h-80 overflow-y-auto">{content}</pre>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-[#7D8590] text-sm">Fill in the topic and click Generate</div>
            )}
          </div>
        </div>
      </div>

      {/* Saved Assets */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Saved {TAB_LABEL[activeTab] ?? activeTab} Assets</h3>
        {loadingAssets ? (
          <SkeletonCard count={2} />
        ) : savedAssets.length === 0 ? (
          <p className="text-xs text-[#7D8590] py-2">No {TAB_LABEL[activeTab]?.toLowerCase() ?? activeTab} assets saved yet — generate one above and click Save Asset.</p>
        ) : (
          <div className="space-y-2">
            {savedAssets.map(asset => (
              <div key={asset.id} className="bg-[#0D1117] rounded-lg overflow-hidden border border-[#30363D] hover:border-[#0078D4]/30 transition-colors">
                <button
                  onClick={() => setExpandedId(prev => prev === asset.id ? null : asset.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#E6EDF3] truncate">{asset.title}</p>
                    <p className="text-[11px] text-[#7D8590] mt-0.5 line-clamp-1">{asset.content.slice(0, 120)}{asset.content.length > 120 ? "…" : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge text={TAB_LABEL[asset.assetType] ?? asset.assetType} color="blue" />
                    <span className="text-[10px] text-[#484F58]">{new Date(asset.createdAt).toLocaleDateString()}</span>
                    <span className="text-[#484F58] text-xs">{expandedId === asset.id ? "▲" : "▼"}</span>
                  </div>
                </button>
                {expandedId === asset.id && (
                  <div className="border-t border-[#30363D] px-3 pb-3 pt-2 space-y-2">
                    <div className="flex justify-end">
                      <CopyButton text={asset.content} />
                    </div>
                    <pre className="text-[#E6EDF3] text-sm whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">{asset.content}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 5: Traffic & Analytics ───────────────────────────────────────────

function EmailStatsCard({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [stats, setStats] = useState<EmailStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/email-stats`)
      .then(r => r.json())
      .then(d => setStats(d as EmailStats))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) return <SkeletonCard />;

  if (!stats?.hasData) {
    return (
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Emails Sent</h3>
        <div className="flex items-center justify-center h-28 text-[#7D8590] text-sm">
          <span className="px-3 py-1 rounded-full bg-[#30363D] text-[#484F58] text-xs">No emails recorded yet — volume will appear here automatically</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Emails Sent</h3>
        <span className="text-[10px] text-[#7D8590]">Last 30 days</span>
      </div>
      <div className="flex gap-3">
        <div className="bg-[#0D1117] rounded-lg p-3 text-center flex-1">
          <p className="text-2xl font-bold text-[#E6EDF3]">{stats.totalSent}</p>
          <p className="text-[10px] text-[#7D8590] mt-0.5">Total sent</p>
        </div>
      </div>
      {stats.dailyTrend.length > 0 && (
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={stats.dailyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
            <XAxis dataKey="day" tick={{ fill: "#7D8590", fontSize: 9 }} tickFormatter={v => String(v).slice(5)} />
            <YAxis tick={{ fill: "#7D8590", fontSize: 9 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} labelStyle={{ color: "#E6EDF3" }} itemStyle={{ color: "#58A6FF" }} />
            <Line type="monotone" dataKey="sent" stroke="#0078D4" strokeWidth={2} dot={{ fill: "#0078D4", r: 3 }} name="Sent" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function SeoRankingsCard({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [rankings, setRankings] = useState<SeoRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [position, setPosition] = useState("");
  const [url, setUrl] = useState("");
  const [volume, setVolume] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; inserted: number; updated: number; message?: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/seo-rankings`);
      setRankings(await r.json() as SeoRanking[]);
    } finally { setLoading(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setKeyword(""); setPosition(""); setUrl(""); setVolume("");
    setEditingId(null); setShowForm(false);
  };

  const startEdit = (r: SeoRanking) => {
    setEditingId(r.id);
    setKeyword(r.keyword);
    setPosition(String(r.position));
    setUrl(r.url ?? "");
    setVolume(r.searchVolume ? String(r.searchVolume) : "");
    setShowForm(true);
  };

  const save = async () => {
    const pos = parseInt(position, 10);
    if (!keyword.trim() || isNaN(pos)) return;
    setSaving(true);
    try {
      const body = {
        keyword: keyword.trim(),
        position: pos,
        url: url.trim() || undefined,
        searchVolume: volume ? parseInt(volume, 10) : undefined,
      };
      if (editingId !== null) {
        const r = await fetchWithAuth(`${API}/admin/marketing/seo-rankings/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const updated = await r.json() as SeoRanking;
        setRankings(prev => prev.map(x => x.id === editingId ? updated : x));
      } else {
        const r = await fetchWithAuth(`${API}/admin/marketing/seo-rankings`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const created = await r.json() as SeoRanking;
        setRankings(prev => [...prev, created].sort((a, b) => a.position - b.position));
      }
      resetForm();
    } finally { setSaving(false); }
  };

  const deleteRanking = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/seo-rankings/${id}`, { method: "DELETE" });
    setRankings(prev => prev.filter(r => r.id !== id));
  };

  const syncFromSearchConsole = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/seo-rankings/sync-search-console`, { method: "POST" });
      const data = await r.json() as { synced?: number; inserted?: number; updated?: number; message?: string; error?: string };
      if (!r.ok) {
        setSyncError(data.error ?? "Sync failed");
        return;
      }
      setSyncResult({ synced: data.synced ?? 0, inserted: data.inserted ?? 0, updated: data.updated ?? 0, message: data.message });
      await load();
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setSyncing(false);
      setTimeout(() => { setSyncResult(null); setSyncError(null); }, 6000);
    }
  };

  const positionColor = (pos: number) => {
    if (pos <= 3) return "text-emerald-400";
    if (pos <= 10) return "text-[#58A6FF]";
    if (pos <= 20) return "text-amber-400";
    return "text-[#7D8590]";
  };

  const changeIndicator = (r: SeoRanking) => {
    if (r.previousPosition === null || r.previousPosition === r.position) return null;
    const improved = r.position < r.previousPosition;
    const delta = Math.abs(r.previousPosition - r.position);
    return (
      <span className={`text-[10px] font-bold ${improved ? "text-emerald-400" : "text-red-400"}`}>
        {improved ? "▲" : "▼"}{delta}
      </span>
    );
  };

  if (loading) return <SkeletonCard />;

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">SEO Rankings</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void syncFromSearchConsole(); }}
            disabled={syncing}
            title="Pull latest positions from Google Search Console"
            className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors flex items-center gap-1">
            {syncing ? (
              <><span className="w-2.5 h-2.5 border border-emerald-400 border-t-transparent rounded-full animate-spin inline-block" /> Syncing…</>
            ) : "↻ Sync Search Console"}
          </button>
          <button onClick={() => { resetForm(); setShowForm(f => !f); }}
            className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">
            {showForm && editingId === null ? "Cancel" : "+ Add Keyword"}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
          <p className="text-[11px] text-emerald-400 font-medium">
            {syncResult.message
              ? syncResult.message
              : `Synced ${syncResult.synced} keywords — ${syncResult.inserted} new, ${syncResult.updated} updated`}
          </p>
        </div>
      )}

      {syncError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 space-y-1">
          <p className="text-[11px] text-red-400 font-medium">Sync failed</p>
          <p className="text-[10px] text-red-400/70">{syncError}</p>
          {syncError.includes("GOOGLE_SEARCH_CONSOLE") && (
            <p className="text-[10px] text-[#7D8590]">
              Set <code className="bg-[#0D1117] px-1 rounded">GOOGLE_SEARCH_CONSOLE_KEY_JSON</code> and{" "}
              <code className="bg-[#0D1117] px-1 rounded">GOOGLE_SEARCH_CONSOLE_SITE_URL</code> in Replit Secrets to enable automatic sync.
            </p>
          )}
        </div>
      )}

      {showForm && (
        <div className="bg-[#0D1117] rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="Keyword…"
              className="col-span-2 bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            <input value={position} onChange={e => setPosition(e.target.value)} placeholder="Position (1–100)" type="number" min="1" max="100"
              className="bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            <input value={volume} onChange={e => setVolume(e.target.value)} placeholder="Monthly volume" type="number" min="0"
              className="bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Ranking URL (optional)"
              className="col-span-2 bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void save(); }} disabled={saving || !keyword.trim() || !position}
              className="flex-1 py-1.5 rounded bg-[#0078D4] text-white text-xs font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : editingId !== null ? "Update" : "Add"}
            </button>
            <button onClick={resetForm} className="px-3 py-1.5 rounded border border-[#30363D] text-[#7D8590] text-xs hover:text-[#E6EDF3] transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {rankings.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-[#7D8590] text-xs">No keywords tracked yet — add your first keyword above</p>
          <p className="text-[10px] text-[#484F58] mt-1">Or click "Sync Search Console" to import live rankings automatically</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          <div className="grid grid-cols-12 gap-1 px-2 pb-1 border-b border-[#30363D]">
            <span className="col-span-1 text-[10px] text-[#484F58]">#</span>
            <span className="col-span-7 text-[10px] text-[#484F58]">Keyword</span>
            <span className="col-span-2 text-[10px] text-[#484F58] text-right">Vol.</span>
            <span className="col-span-2 text-[10px] text-[#484F58] text-right">Actions</span>
          </div>
          {rankings.map(r => (
            <div key={r.id} className="grid grid-cols-12 gap-1 items-center px-2 py-1 rounded hover:bg-[#0D1117] transition-colors group">
              <span className={`col-span-1 text-sm font-bold ${positionColor(r.position)}`}>{r.position}</span>
              <div className="col-span-7 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[#E6EDF3] truncate">{r.keyword}</span>
                  {changeIndicator(r)}
                </div>
                {r.url && <p className="text-[10px] text-[#484F58] truncate">{r.url}</p>}
              </div>
              <span className="col-span-2 text-[10px] text-[#7D8590] text-right">
                {r.searchVolume ? r.searchVolume.toLocaleString() : "—"}
              </span>
              <div className="col-span-2 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(r)} className="text-[10px] text-[#58A6FF] hover:text-white transition-colors">Edit</button>
                <button onClick={() => { void deleteRanking(r.id); }} className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors">×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrafficAnalyticsSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/analytics`).then(r => r.json()).then(d => setAnalytics(d as AnalyticsData)).catch(() => null).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">Traffic & Analytics</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><SkeletonCard count={4} /></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">Traffic & Analytics</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-4">Visitors (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={analytics?.dailyVisitors ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
              <XAxis dataKey="day" tick={{ fill: "#7D8590", fontSize: 10 }} tickFormatter={v => String(v).slice(5)} />
              <YAxis tick={{ fill: "#7D8590", fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} labelStyle={{ color: "#E6EDF3" }} itemStyle={{ color: "#58A6FF" }} />
              <Line type="monotone" dataKey="visitors" stroke="#0078D4" strokeWidth={2} dot={{ fill: "#0078D4", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-4">Traffic Sources</h3>
          {analytics?.trafficSources && analytics.trafficSources.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={analytics.trafficSources} dataKey="sessions" nameKey="source" cx="50%" cy="50%" outerRadius={70} label={({ source, percent }) => `${String(source)} ${(Number(percent) * 100).toFixed(0)}%`} labelLine={false}>
                  {analytics.trafficSources.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-[#7D8590] text-sm text-center py-8">No traffic data yet</p>}
        </div>

        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-4">Conversion Funnel (30 Days)</h3>
          {analytics?.conversionFunnel && analytics.conversionFunnel.some(f => f.value > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <FunnelChart>
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} />
                <Funnel dataKey="value" data={analytics.conversionFunnel} isAnimationActive>
                  {analytics.conversionFunnel.map((entry, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                  <LabelList position="right" fill="#E6EDF3" stroke="none" dataKey="stage" style={{ fontSize: 11 }} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-32 text-[#7D8590] text-sm">
              <span className="px-3 py-1 rounded-full bg-[#30363D] text-[#484F58] text-xs">No funnel data yet — drive traffic to see results</span>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-1">Revenue per Lead by Campaign</h3>
          <p className="text-xs text-[#7D8590] mb-4">Revenue attributed ÷ leads generated. Campaigns with no leads show —.</p>
          {analytics?.campaignPerformance && analytics.campaignPerformance.length > 0 ? (() => {
            const sorted = [...analytics.campaignPerformance].sort((a, b) => {
              if (a.revenuePerLead === null && b.revenuePerLead === null) return 0;
              if (a.revenuePerLead === null) return 1;
              if (b.revenuePerLead === null) return -1;
              return b.revenuePerLead - a.revenuePerLead;
            });
            const maxRpl = sorted[0]?.revenuePerLead ?? 0;
            const topId = maxRpl > 0 ? sorted[0]?.id ?? null : null;
            return (
              <div className="space-y-2">
                {sorted.map(c => {
                  const isTop = c.id === topId && c.revenuePerLead !== null;
                  const barPct = maxRpl > 0 && c.revenuePerLead !== null ? (c.revenuePerLead / maxRpl) * 100 : 0;
                  return (
                    <div key={c.id} className={`rounded-lg px-3 py-2.5 ${isTop ? "bg-[#0D1117] ring-1 ring-[#0078D4]/50" : "bg-[#0D1117]"}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm text-[#E6EDF3] truncate font-medium">{c.name}</p>
                          {isTop && <span className="text-[10px] font-bold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-full px-2 py-0.5 flex-shrink-0">★ Top</span>}
                          <Badge text={c.status} color={c.status === "active" ? "green" : "gray"} />
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          {c.revenuePerLead !== null
                            ? <span className="text-sm font-bold text-[#E6EDF3]">${c.revenuePerLead.toLocaleString("en-US", { maximumFractionDigits: 0 })}<span className="text-[#7D8590] font-normal text-xs">/lead</span></span>
                            : <span className="text-[#484F58] text-sm">—</span>
                          }
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#21262D] overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isTop ? "bg-[#0078D4]" : "bg-[#30363D]"}`} style={{ width: `${barPct}%` }} />
                      </div>
                      <div className="flex gap-3 mt-1.5">
                        <span className="text-[10px] text-[#7D8590]">{c.leadsGenerated} lead{c.leadsGenerated !== 1 ? "s" : ""}</span>
                        <span className="text-[10px] text-[#7D8590]">${c.revenueAttributed.toLocaleString("en-US", { maximumFractionDigits: 0 })} revenue</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })() : <p className="text-[#7D8590] text-sm text-center py-4">No campaigns yet. Add campaigns and track revenue to see ROI.</p>}
        </div>

        <div className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-[#E6EDF3] mb-4">Top Pages (Last 30 Days)</h3>
          {analytics?.topPages && analytics.topPages.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={analytics.topPages.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#7D8590", fontSize: 10 }} />
                <YAxis type="category" dataKey="page" tick={{ fill: "#7D8590", fontSize: 10 }} width={150} tickFormatter={v => String(v).length > 22 ? String(v).slice(0, 22) + "…" : String(v)} />
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} labelStyle={{ color: "#E6EDF3" }} itemStyle={{ color: "#58A6FF" }} />
                <Bar dataKey="views" fill="#0078D4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-[#7D8590] text-sm text-center py-8">No page view data yet</p>}
        </div>

        <EmailStatsCard fetchWithAuth={fetchWithAuth} />
        <SeoRankingsCard fetchWithAuth={fetchWithAuth} />
      </div>
    </div>
  );
}

// ─── Section 6: Marketing Tasks Kanban ────────────────────────────────────────

const KANBAN_COLUMNS: { id: MarketingTask["status"]; label: string; color: string }[] = [
  { id: "ideas", label: "Ideas", color: "text-[#7D8590]" },
  { id: "in_progress", label: "In Progress", color: "text-amber-400" },
  { id: "scheduled", label: "Scheduled", color: "text-blue-400" },
  { id: "published", label: "Published", color: "text-emerald-400" },
  { id: "completed", label: "Completed", color: "text-violet-400" },
];

type TaskStatus = MarketingTask["status"];

interface SortableTaskCardProps {
  task: MarketingTask;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
}

function SortableTaskCard({ task, onDelete, onStatusChange }: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 space-y-1.5 hover:border-[#0078D4]/40 transition-colors">
      <div className="flex items-start gap-1">
        <div {...attributes} {...listeners} className="mt-0.5 cursor-grab active:cursor-grabbing text-[#484F58] hover:text-[#7D8590] flex-shrink-0">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
          </svg>
        </div>
        <p className="text-xs font-medium text-[#E6EDF3] flex-1">{task.title}</p>
      </div>
      {task.description && <p className="text-[10px] text-[#7D8590] line-clamp-2 ml-4.5">{task.description}</p>}
      {task.dueDate && <p className="text-[10px] text-amber-400 ml-4.5">Due: {new Date(task.dueDate).toLocaleDateString()}</p>}
      {(task.relatedLeadId || task.relatedCampaignId) && (
        <div className="flex gap-1 ml-4.5">
          {task.relatedLeadId && <Badge text={`Lead #${task.relatedLeadId}`} color="blue" />}
          {task.relatedCampaignId && <Badge text={`Campaign #${task.relatedCampaignId}`} color="yellow" />}
        </div>
      )}
      <div className="flex items-center gap-1 ml-4.5 relative">
        <button onClick={() => setShowStatusMenu(m => !m)} className="text-[10px] px-1.5 py-0.5 rounded bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
          Status ▾
        </button>
        {showStatusMenu && (
          <div className="absolute top-5 left-0 z-20 bg-[#161B22] border border-[#30363D] rounded-lg shadow-xl py-1 min-w-28">
            {KANBAN_COLUMNS.map(col => (
              <button key={col.id} onClick={() => { onStatusChange(task.id, col.id); setShowStatusMenu(false); }}
                className={`w-full text-left px-3 py-1.5 text-[10px] hover:bg-[#1C2128] transition-colors ${col.color} ${task.status === col.id ? "font-bold" : ""}`}>
                {col.label}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => onDelete(task.id)} className="text-[10px] text-[#484F58] hover:text-red-400 transition-colors ml-auto">Delete</button>
      </div>
    </div>
  );
}

function DroppableColumn({ col, tasks, onDelete, onStatusChange }: {
  col: typeof KANBAN_COLUMNS[0];
  tasks: MarketingTask[];
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: TaskStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  return (
    <div ref={setNodeRef} className={`bg-[#161B22] border rounded-xl p-3 min-h-40 transition-colors ${isOver ? "border-[#0078D4]/60 bg-[#0D1117]" : "border-[#30363D]"}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${col.color}`}>{col.label}</h3>
        <span className="text-[10px] text-[#484F58]">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {tasks.map(t => <SortableTaskCard key={t.id} task={t} onDelete={onDelete} onStatusChange={onStatusChange} />)}
        </div>
      </SortableContext>
    </div>
  );
}

function MarketingTasksKanban({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/tasks`);
      setTasks(await r.json() as MarketingTask[]);
    } finally { setLoading(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const overId = String(over.id);
    const colIds = KANBAN_COLUMNS.map(c => c.id as string);
    let newStatus: TaskStatus | undefined;

    if (colIds.includes(overId)) {
      newStatus = overId as TaskStatus;
    } else {
      const overTask = tasks.find(t => t.id === over.id);
      if (overTask) newStatus = overTask.status;
    }

    const activeTask = tasks.find(t => t.id === active.id);
    if (!activeTask || !newStatus) return;

    setTasks(prev => {
      const updated = prev.map(t => t.id === activeTask.id ? { ...t, status: newStatus! } : t);
      if (newStatus === activeTask.status) {
        const sameCols = updated.filter(t => t.status === newStatus);
        const oldIdx = sameCols.findIndex(t => t.id === activeTask.id);
        const overTaskIdx = sameCols.findIndex(t => t.id === over.id);
        return [...updated.filter(t => t.status !== newStatus), ...arrayMove(sameCols, oldIdx, overTaskIdx)];
      }
      return updated;
    });

    await fetchWithAuth(`${API}/admin/marketing/tasks/${activeTask.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    }).catch(() => null);
  };

  const handleStatusChange = async (id: number, status: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    await fetchWithAuth(`${API}/admin/marketing/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
  };

  const addTask = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, description: newDesc || null, status: "ideas" }),
      });
      const t = await r.json() as MarketingTask;
      setTasks(prev => [t, ...prev]);
      setNewTitle(""); setNewDesc(""); setShowForm(false);
    } finally { setAdding(false); }
  };

  const deleteTask = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/tasks/${id}`, { method: "DELETE" });
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#E6EDF3]">Marketing Tasks</h2>
        <button onClick={() => setShowForm(f => !f)} className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/80 transition-colors">+ Add Task</button>
      </div>

      {showForm && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Task title…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)…"
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          <div className="flex gap-2">
            <button onClick={() => { void addTask(); }} disabled={adding || !newTitle.trim()}
              className="px-4 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
              {adding ? "Adding…" : "Add Task"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div className="grid grid-cols-5 gap-3"><SkeletonCard count={5} /></div> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => { void handleDragEnd(e); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {KANBAN_COLUMNS.map(col => (
              <DroppableColumn
                key={col.id}
                col={col}
                tasks={tasks.filter(t => t.status === col.id)}
                onDelete={id => { void deleteTask(id); }}
                onStatusChange={(id, status) => { void handleStatusChange(id, status); }}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}

// ─── Campaign Metrics Panel ────────────────────────────────────────────────────

function CampaignMetricsPanel({ campaign, fetchWithAuth, onUpdated }: {
  campaign: Campaign;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onUpdated: (updated: Campaign) => void;
}) {
  const autoCount = campaign.emailsSentAuto ?? 0;
  const manualCount = campaign.emailsSent ?? 0;
  const hasManualOverride = manualCount > 0;
  const hasAutoData = autoCount > 0 && !hasManualOverride;
  const displayedEmailCount = hasManualOverride ? manualCount : autoCount;

  const [leads, setLeads] = useState(String(campaign.leadsGenerated ?? 0));
  const [emails, setEmails] = useState(String(campaign.emailsSent ?? 0));
  const [revenue, setRevenue] = useState(String(Number(campaign.revenueAttributed ?? 0).toFixed(2)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadsGenerated: parseInt(leads, 10) || 0,
          emailsSent: parseInt(emails, 10) || 0,
          revenueAttributed: parseFloat(revenue) || 0,
        }),
      });
      const updated = await r.json() as Campaign;
      onUpdated({ ...updated, emailsSentAuto: campaign.emailsSentAuto });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">Performance Metrics</h3>
        <span className="text-[10px] text-[#7D8590] bg-[#30363D] px-2 py-0.5 rounded-full truncate max-w-[120px]">{campaign.name}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#0D1117] rounded-lg p-3 text-center">
          <p className="text-[10px] text-[#7D8590] mb-1">Leads Generated</p>
          <p className="text-lg font-bold text-emerald-400">{campaign.leadsGenerated ?? 0}</p>
        </div>
        <div className="bg-[#0D1117] rounded-lg p-3 text-center">
          <p className="text-[10px] text-[#7D8590] mb-1">Emails Sent</p>
          <p className="text-lg font-bold text-[#58A6FF]">{displayedEmailCount}</p>
          {hasManualOverride && autoCount > 0 ? (
            <span className="inline-block mt-0.5 text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">override ({autoCount} auto)</span>
          ) : hasManualOverride ? (
            <span className="inline-block mt-0.5 text-[9px] bg-[#30363D] text-[#7D8590] px-1.5 py-0.5 rounded-full">manual</span>
          ) : hasAutoData ? (
            <span className="inline-block mt-0.5 text-[9px] bg-[#0078D4]/20 text-[#58A6FF] px-1.5 py-0.5 rounded-full">auto-tracked</span>
          ) : null}
        </div>
        <div className="bg-[#0D1117] rounded-lg p-3 text-center">
          <p className="text-[10px] text-[#7D8590] mb-1">Revenue</p>
          <p className="text-lg font-bold text-amber-400">${Number(campaign.revenueAttributed ?? 0).toLocaleString()}</p>
        </div>
      </div>
      <div className="space-y-2 pt-1 border-t border-[#30363D]">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">Update Metrics</p>
          {autoCount > 0 && (
            <span className="text-[9px] text-[#58A6FF]">{hasManualOverride ? `Auto: ${autoCount} · overridden` : "Auto-tracked · set override below"}</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-[#7D8590]">Leads</label>
            <input type="number" min="0" value={leads} onChange={e => setLeads(e.target.value)}
              className="mt-0.5 w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590]">{autoCount > 0 ? "Emails (manual override)" : "Emails Sent"}</label>
            <input type="number" min="0" value={emails} onChange={e => setEmails(e.target.value)}
              className={`mt-0.5 w-full bg-[#0D1117] border rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 ${autoCount > 0 ? "border-[#0078D4]/30" : "border-[#30363D]"}`} />
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590]">Revenue ($)</label>
            <input type="number" min="0" step="0.01" value={revenue} onChange={e => setRevenue(e.target.value)}
              className="mt-0.5 w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/60" />
          </div>
        </div>
        <button onClick={() => { void handleSave(); }} disabled={saving}
          className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors ${saved ? "bg-emerald-500/20 text-emerald-400" : "bg-[#0078D4] text-white hover:bg-[#0078D4]/80"} disabled:opacity-40`}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Metrics"}
        </button>
      </div>
    </div>
  );
}

// ─── Section 7: Campaign Builder Wizard ───────────────────────────────────────

function CampaignBuilderWizard({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [name, setName] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCampaignId, setSavedCampaignId] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/campaigns`).then(r => r.json()).then(d => setCampaigns(d as Campaign[])).catch(() => null).finally(() => setLoadingCampaigns(false));
  }, [fetchWithAuth]);

  const previewAssetGeneration = async () => {
    setPreviewing(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/campaigns/preview-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || `Campaign ${new Date().toLocaleDateString()}`, goal, audience, offer }),
      });
      const assets = await r.json() as PreviewAsset[];
      setPreviewAssets(assets);
      setStep(4);
    } finally { setPreviewing(false); }
  };

  const confirmSave = async () => {
    setSaving(true);
    try {
      const campaignName = name || `Campaign ${new Date().toLocaleDateString()}`;
      const cr = await fetchWithAuth(`${API}/admin/marketing/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campaignName, goal, audience, offer }),
      });
      const campaign = await cr.json() as Campaign;
      setSavedCampaignId(campaign.id);

      await fetchWithAuth(`${API}/admin/marketing/campaigns/save-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, assets: previewAssets }),
      });

      setCampaigns(prev => [campaign, ...prev]);
      setSelectedCampaign(campaign);
      setStep(5);
    } finally { setSaving(false); }
  };

  const reset = () => {
    setStep(1); setGoal(""); setAudience(""); setOffer(""); setName(""); setPreviewAssets([]); setSavedCampaignId(null);
  };

  const handleMetricsUpdated = (updated: Campaign) => {
    setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c));
    if (selectedCampaign?.id === updated.id) setSelectedCampaign(updated);
  };

  const steps = [
    { n: 1, label: "Goal" }, { n: 2, label: "Audience" }, { n: 3, label: "Offer" },
    { n: 4, label: "Review" }, { n: 5, label: "Saved" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">Campaign Builder</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-4">
          {/* Stepper */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {steps.map((s, i) => (
              <div key={s.n} className="flex items-center gap-1 flex-shrink-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= s.n ? "bg-[#0078D4] text-white" : "bg-[#30363D] text-[#7D8590]"}`}>{s.n}</div>
                <span className={`text-xs ${step === s.n ? "text-[#E6EDF3] font-semibold" : "text-[#7D8590]"}`}>{s.label}</span>
                {i < steps.length - 1 && <div className={`h-px w-4 ${step > s.n ? "bg-[#0078D4]" : "bg-[#30363D]"}`} />}
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#E6EDF3]">Campaign Name <span className="text-[#7D8590] font-normal">(optional)</span></label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q3 Copilot Rollout Push…"
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#E6EDF3]">Campaign Goal *</label>
                <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} placeholder="e.g. Generate 20 qualified leads for Microsoft Copilot workshops…"
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none" />
              </div>
              <button onClick={() => setStep(2)} disabled={!goal.trim()}
                className="px-6 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">Next →</button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#E6EDF3]">Target Audience *</label>
                <textarea value={audience} onChange={e => setAudience(e.target.value)} rows={3} placeholder="e.g. IT Directors and CTOs at mid-market companies (100-500 employees) using Microsoft 365…"
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">← Back</button>
                <button onClick={() => setStep(3)} disabled={!audience.trim()}
                  className="px-6 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">Next →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#E6EDF3]">Your Offer *</label>
                <textarea value={offer} onChange={e => setOffer(e.target.value)} rows={3} placeholder="e.g. Free 30-min Microsoft Copilot Readiness Assessment ($297 value)…"
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 resize-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">← Back</button>
                <button onClick={() => { void previewAssetGeneration(); }} disabled={!offer.trim() || previewing}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
                  {previewing ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generating Preview…</> : "Preview Campaign →"}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[#E6EDF3]">Review Generated Assets</p>
                <span className="text-[10px] text-[#7D8590] px-2 py-0.5 rounded-full bg-[#30363D]">Preview — not yet saved</span>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {previewAssets.map((asset, idx) => (
                  <div key={idx} className="bg-[#0D1117] rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#E6EDF3]">{asset.title}</span>
                      <div className="flex gap-2">
                        <Badge text={asset.assetType} color="blue" />
                        <CopyButton text={asset.content} />
                      </div>
                    </div>
                    <pre className="text-[10px] text-[#7D8590] whitespace-pre-wrap font-sans line-clamp-4">{asset.content}</pre>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-2 border-t border-[#30363D]">
                <button onClick={() => setStep(3)} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">← Back</button>
                <button onClick={() => { void confirmSave(); }} disabled={saving}
                  className="flex items-center gap-2 flex-1 justify-center py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-400 disabled:opacity-40 transition-colors">
                  {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : "✓ Confirm & Save Campaign"}
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-400">Campaign saved!</p>
                  {savedCampaignId && <p className="text-xs text-[#7D8590]">ID: {savedCampaignId} — update its metrics in the panel →</p>}
                </div>
              </div>
              <button onClick={reset} className="text-xs px-3 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
                Create Another Campaign
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {selectedCampaign && (
            <CampaignMetricsPanel
              key={selectedCampaign.id}
              campaign={selectedCampaign}
              fetchWithAuth={fetchWithAuth}
              onUpdated={handleMetricsUpdated}
            />
          )}
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[#E6EDF3]">Saved Campaigns</h3>
            {loadingCampaigns ? <SkeletonCard /> : campaigns.length === 0 ? (
              <p className="text-xs text-[#7D8590]">No campaigns yet — build your first one!</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {campaigns.map(c => (
                  <button key={c.id} onClick={() => setSelectedCampaign(prev => prev?.id === c.id ? null : c)}
                    className={`w-full text-left bg-[#0D1117] rounded-lg p-2 text-xs space-y-1.5 border transition-colors ${selectedCampaign?.id === c.id ? "border-[#0078D4]/60" : "border-transparent hover:border-[#30363D]"}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-[#E6EDF3] truncate">{c.name}</span>
                      <Badge text={c.status} color={c.status === "active" ? "green" : c.status === "completed" ? "gray" : "yellow"} />
                    </div>
                    <p className="text-[#7D8590] line-clamp-1">{c.goal}</p>
                    {/* Mini KPI strip */}
                    <div className="flex items-center gap-3 pt-0.5 border-t border-[#30363D]">
                      <span className="text-emerald-400 font-semibold">{c.leadsGenerated ?? 0} leads</span>
                      <span className="text-[#58A6FF]">{c.emailsSent ?? 0} emails</span>
                      <span className="text-amber-400">${Number(c.revenueAttributed ?? 0).toLocaleString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "recommendations", label: "AI Leads" },
  { id: "kpi", label: "KPIs" },
  { id: "lead-finder", label: "Lead Finder" },
  { id: "outreach", label: "Outreach" },
  { id: "content", label: "Content" },
  { id: "analytics", label: "Analytics" },
  { id: "tasks", label: "Tasks" },
  { id: "campaigns", label: "Campaigns" },
];

export default function MarketingCommandCenter() {
  const { fetchWithAuth } = useAuth();
  const [activeSection, setActiveSection] = useState("recommendations");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 bg-[#161B22] border-b border-[#30363D] px-4 overflow-x-auto">
        <div className="flex gap-1 py-1">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`flex-shrink-0 text-xs px-3 py-2 rounded-lg font-medium transition-colors ${activeSection === s.id ? "bg-[#0078D4]/20 text-[#58A6FF]" : "text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8">
        {activeSection === "recommendations" && <RecommendedLeadsSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "kpi" && <KPIStrip fetchWithAuth={fetchWithAuth} />}
        {activeSection === "lead-finder" && <LeadFinderSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "outreach" && <OutreachAutomationSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "content" && <ContentHubSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "analytics" && <TrafficAnalyticsSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "tasks" && <MarketingTasksKanban fetchWithAuth={fetchWithAuth} />}
        {activeSection === "campaigns" && <CampaignBuilderWizard fetchWithAuth={fetchWithAuth} />}
      </div>
    </div>
  );
}

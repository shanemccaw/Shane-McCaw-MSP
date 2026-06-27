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
  lastOutreachDraft?: string | null;
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
  status: "ideas" | "in_progress" | "scheduled" | "published" | "completed" | "money_task";
  order: number;
  dueDate?: string;
  relatedLeadId?: number | null;
  relatedCampaignId?: number | null;
}

interface Offer {
  id: number;
  name: string;
  goal: string;
  audience: string;
  pricing?: string | null;
  deliverables: string[];
  outcomes: string[];
  cta?: string | null;
  campaignId?: number | null;
  createdAt: string;
}

interface LandingPage {
  id: number;
  slug: string;
  title: string;
  headline?: string | null;
  subheadline?: string | null;
  valuePropBlocks: Array<{ icon?: string; heading: string; body: string }>;
  socialProof: Array<{ quote: string; author: string; role?: string }>;
  cta: { buttonText: string; href: string; subtext?: string } | null;
  campaignId?: number | null;
  published: boolean;
  createdAt: string;
}

interface FollowUp {
  id: number;
  leadId?: number | null;
  campaignId?: number | null;
  scheduledAt: string;
  completedAt?: string | null;
  channel: string;
  subject?: string | null;
  aiDraftContent?: string | null;
  status: string;
  leadName?: string | null;
  leadEmail?: string | null;
  createdAt: string;
}

interface HotLead {
  id: number;
  name: string;
  email: string;
  company?: string | null;
  industry?: string | null;
  score: number;
  status: string;
  stage: string;
  recentEvents: number;
}

interface DailyCommand {
  leadsToContact: Array<{ id: number; name: string; company?: string | null; score: number; stage: string; email: string; industry?: string | null }>;
  followUpsTodo: Array<{ id: number; leadId?: number | null; channel: string; subject?: string | null; aiDraftContent?: string | null; scheduledAt: string; status: string; leadName?: string | null; leadEmail?: string | null }>;
  offerToPush: { id: number; name: string; goal: string; pricing?: string | null; cta?: string | null } | null;
  campaignAction: { id: number; name: string; status: string; leadsGenerated: number; revenueAttributed: string } | null;
  contentSuggestion: { id: number; title: string; assetType: string } | null;
  revenueThisMonth: number;
  publishedLandingPages: number;
  aiInsight: {
    topPriority: string;
    quickWins: string[];
    revenueInsight: string;
    revenueOpportunities: string[];
    closestToBuying: string;
    nextBestActions: string[];
  };
  generatedAt: string;
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
  hotLeadsCount: number;
  intentSignalsToday: number;
  followUpsDue: number;
  activeOffers: number;
  revenueThisMonth: number;
  revenueOpportunity: number;
  offerConversionRate: string;
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(campaignId ?? null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/campaigns`)
      .then(r => r.json())
      .then((d: Campaign[]) => setCampaigns(d))
      .catch(() => {});
  }, [fetchWithAuth]);

  const send = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    setSending(true); setResult(null); setIsConfigError(false);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/send-outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, leadId, campaignId: selectedCampaignId ?? undefined, bodyType: "text" }),
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
              <div>
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Campaign <span className="normal-case">(optional)</span></label>
                <select
                  value={selectedCampaignId ?? ""}
                  onChange={e => setSelectedCampaignId(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                >
                  <option value="">— No campaign —</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
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

function OutreachModal({ leadName, leadEmail, leadId, recommendedLeadId, templateType, onClose, fetchWithAuth, onGenerated }: {
  leadName?: string; leadEmail?: string; leadId?: number; recommendedLeadId?: number; templateType?: string; onClose: () => void;
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
        body: JSON.stringify({ leadId, recommendedLeadId, name: leadName, templateType: selectedType }),
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

// ─── Recommended Lead Slide-Over ──────────────────────────────────────────────

function RecommendedLeadSlideOver({ lead, campaigns, generatedDrafts, fetchWithAuth, onClose, onConvert, onDismiss, onOutreach, onTask, onCampaign }: {
  lead: RecommendedLead;
  campaigns: Campaign[];
  generatedDrafts: Record<number, string>;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onConvert: (id: number) => void;
  onDismiss: (id: number) => void;
  onOutreach: (opts: { recommendedLeadId: number; leadName: string; leadEmail: string; type: string }) => void;
  onTask: (lead: RecommendedLead) => void;
  onCampaign: (lead: RecommendedLead) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full sm:max-w-lg bg-[#161B22] shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363D] bg-[#0A2540] flex-shrink-0">
          <h2 className="text-white font-bold">AI Lead Details</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-5">
          {/* Identity */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Name</p>
                <p className="text-[#E6EDF3] font-semibold text-base">{lead.name}</p>
              </div>
              <Badge text={`${lead.confidence}%`} color={lead.confidence >= 80 ? "green" : lead.confidence >= 60 ? "yellow" : "gray"} />
            </div>
            {lead.role && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Role</p>
                <p className="text-sm text-[#E6EDF3]">{lead.role}</p>
              </div>
            )}
            {lead.company && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Company</p>
                <p className="text-sm text-[#E6EDF3]">{lead.company}</p>
              </div>
            )}
            {lead.email && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Email</p>
                <a href={`mailto:${lead.email}`} className="text-sm text-[#0078D4] hover:underline">{lead.email}</a>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              {lead.industry && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Industry</p>
                  <Badge text={lead.industry} color="blue" />
                </div>
              )}
              {lead.companySize && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Company Size</p>
                  <Badge text={lead.companySize} color="gray" />
                </div>
              )}
              {lead.location && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Location</p>
                  <Badge text={lead.location} color="gray" />
                </div>
              )}
            </div>
          </div>

          {/* Recommended service */}
          {lead.recommendedService && (
            <div className="bg-[#0D1117] border border-[#30363D] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-1">Recommended Service</p>
              <p className="text-sm text-[#E6EDF3] font-medium">{lead.recommendedService}</p>
            </div>
          )}

          {/* Why fit */}
          {lead.whyFit && (
            <div className="bg-[#0D1117] border border-[#30363D] rounded-xl p-4">
              <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wider mb-1.5">Why They Fit</p>
              <p className="text-sm text-[#E6EDF3] leading-relaxed">{lead.whyFit}</p>
            </div>
          )}

          {/* Pain points */}
          {lead.painPoints.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">Pain Points</p>
              <div className="space-y-1.5">
                {lead.painPoints.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-sm text-[#E6EDF3]">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Outreach draft badge */}
          {generatedDrafts[lead.id] && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              <span className="text-xs text-emerald-400 font-medium">Outreach draft saved</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-6 py-4 border-t border-[#30363D] space-y-2 flex-shrink-0">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { onConvert(lead.id); onClose(); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-medium">
              Add to Leads
            </button>
            <button onClick={() => onOutreach({ recommendedLeadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "cold_email" })}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors font-medium">
              Email
            </button>
            <button onClick={() => onOutreach({ recommendedLeadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "linkedin" })}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors font-medium">
              LinkedIn
            </button>
            <button onClick={() => onOutreach({ recommendedLeadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "followup" })}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors font-medium">
              Follow-Up Seq.
            </button>
            <button onClick={() => onTask(lead)}
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors font-medium">
              Add Task
            </button>
            <button onClick={() => { onCampaign(lead); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium">
              Add to Campaign
            </button>
          </div>
          <button onClick={() => { onDismiss(lead.id); onClose(); }}
            className="w-full py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] hover:border-[#484F58] transition-colors">
            Dismiss Lead
          </button>
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
  const [outreachModal, setOutreachModal] = useState<{ recommendedLeadId: number; leadName: string; leadEmail: string; type: string } | null>(null);
  const [taskModal, setTaskModal] = useState<RecommendedLead | null>(null);
  const [campaignModal, setCampaignModal] = useState<RecommendedLead | null>(null);
  const [generatedDrafts, setGeneratedDrafts] = useState<Record<number, string>>({});
  const [genError, setGenError] = useState<string | null>(null);
  const [pendingDismiss, setPendingDismiss] = useState<{ id: number; leadName: string; timerId: ReturnType<typeof setTimeout> } | null>(null);
  const [selectedLead, setSelectedLead] = useState<RecommendedLead | null>(null);
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
      const loaded = data as RecommendedLead[];
      setLeads(loaded);
      setGeneratedDrafts(prev => {
        const seeded: Record<number, string> = { ...prev };
        for (const lead of loaded) {
          if (lead.lastOutreachDraft && !seeded[lead.id]) {
            seeded[lead.id] = lead.lastOutreachDraft;
          }
        }
        return seeded;
      });
      return loaded;
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

  const commitDismiss = useCallback(async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/recommended-leads/${id}/dismiss`, { method: "PATCH" });
  }, [fetchWithAuth]);

  const dismiss = (id: number) => {
    const lead = leads.find(l => l.id === id);
    const hasDraft = !!(generatedDrafts[id] ?? lead?.lastOutreachDraft);
    // Optimistically hide the lead immediately
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: "dismissed" as const } : l));
    if (hasDraft) {
      // Show undo toast — defer the PATCH for 5 seconds
      const timerId = setTimeout(() => {
        void commitDismiss(id);
        setPendingDismiss(null);
      }, 5000);
      setPendingDismiss({ id, leadName: lead?.name ?? "Lead", timerId });
    } else {
      // No draft — dismiss immediately, no toast needed
      void commitDismiss(id);
    }
  };

  const undoDismiss = () => {
    if (!pendingDismiss) return;
    clearTimeout(pendingDismiss.timerId);
    setLeads(prev => prev.map(l => l.id === pendingDismiss.id ? { ...l, status: "pending" as const } : l));
    setPendingDismiss(null);
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
            <div key={lead.id} onClick={() => setSelectedLead(lead)}
              className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3 hover:border-[#0078D4]/40 transition-colors cursor-pointer">
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
              {generatedDrafts[lead.id] && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <span className="text-[10px] text-emerald-400">Draft saved</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-1 border-t border-[#30363D]">
                <button onClick={e => { e.stopPropagation(); void convert(lead.id); }} className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors">Add to Leads</button>
                <button onClick={e => { e.stopPropagation(); setOutreachModal({ recommendedLeadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "cold_email" }); }} className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Email</button>
                <button onClick={e => { e.stopPropagation(); setOutreachModal({ recommendedLeadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "linkedin" }); }} className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">LinkedIn</button>
                <button onClick={e => { e.stopPropagation(); setOutreachModal({ recommendedLeadId: lead.id, leadName: lead.name, leadEmail: lead.email ?? "", type: "followup" }); }} className="text-[10px] px-2 py-1 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Follow-Up Seq.</button>
                <button onClick={e => { e.stopPropagation(); setTaskModal(lead); }} className="text-[10px] px-2 py-1 rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors">Add Task</button>
                <button onClick={e => { e.stopPropagation(); setCampaignModal(lead); }} className="text-[10px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">Add to Campaign</button>
                <button onClick={e => { e.stopPropagation(); void dismiss(lead.id); }} className="text-[10px] px-2 py-1 rounded bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingDismiss && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#21262D] border border-[#30363D] shadow-2xl text-sm text-[#E6EDF3]">
          <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          <span><span className="font-medium">{pendingDismiss.leadName}</span> dismissed — saved draft will be lost</span>
          <button onClick={undoDismiss}
            className="ml-1 px-3 py-1 rounded-lg bg-[#0078D4] text-white text-xs font-semibold hover:bg-[#0078D4]/80 transition-colors flex-shrink-0">
            Undo
          </button>
        </div>
      )}

      {selectedLead && (
        <RecommendedLeadSlideOver
          lead={selectedLead}
          campaigns={campaigns}
          generatedDrafts={generatedDrafts}
          fetchWithAuth={fetchWithAuth}
          onClose={() => setSelectedLead(null)}
          onConvert={(id) => { void convert(id); setSelectedLead(null); }}
          onDismiss={(id) => { dismiss(id); setSelectedLead(null); }}
          onOutreach={(opts) => { setOutreachModal(opts); setSelectedLead(null); }}
          onTask={(lead) => { setTaskModal(lead); setSelectedLead(null); }}
          onCampaign={(lead) => { setCampaignModal(lead); setSelectedLead(null); }}
        />
      )}
      {outreachModal && (
        <OutreachModal recommendedLeadId={outreachModal.recommendedLeadId} leadName={outreachModal.leadName} leadEmail={outreachModal.leadEmail}
          templateType={outreachModal.type} onClose={() => setOutreachModal(null)} fetchWithAuth={fetchWithAuth}
          onGenerated={(content) => setGeneratedDrafts(prev => ({ ...prev, [outreachModal.recommendedLeadId]: content }))} />
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

// ─── Daily Revenue Command Panel ─────────────────────────────────────────────

function DailyCommandPanel({ fetchWithAuth, onNavigate }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>; onNavigate?: (section: string) => void }) {
  const [cmd, setCmd] = useState<DailyCommand | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = (bust = false) => {
    const url = `${API}/admin/marketing/daily-command${bust ? "?refresh=1" : ""}`;
    if (bust) setRefreshing(true); else setLoading(true);
    fetchWithAuth(url).then(r => r.json()).then(d => setCmd(d as DailyCommand)).catch(() => null)
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); }, [fetchWithAuth]);

  if (loading) return (
    <div className="bg-gradient-to-r from-[#0A2540] to-[#0D1B35] border border-[#0078D4]/30 rounded-xl p-5">
      <div className="animate-pulse space-y-3">
        <div className="h-5 w-48 bg-[#1C2128] rounded" />
        <div className="h-20 bg-[#1C2128] rounded" />
      </div>
    </div>
  );

  if (!cmd) return null;

  const followUpsTodo = cmd.followUpsTodo ?? [];
  const leadsToContact = cmd.leadsToContact ?? [];
  const overdueCount = followUpsTodo.filter(f => f.status === "overdue").length;

  return (
    <div className="bg-gradient-to-r from-[#0A2540] to-[#0D1B35] border border-[#0078D4]/30 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[#58A6FF] uppercase tracking-wide">Revenue Command Center</h2>
          <p className="text-xs text-[#7D8590] mt-0.5">Updated {new Date(cmd.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <div className="flex items-center gap-3">
          {[
            { label: "Contacts Today", value: leadsToContact.length, urgent: false, icon: "🎯" },
            { label: "Follow-Ups", value: followUpsTodo.length, urgent: false, icon: "📅" },
            { label: "Overdue", value: overdueCount, urgent: overdueCount > 0, icon: "⚠" },
            { label: "Live Pages", value: cmd.publishedLandingPages, urgent: false, icon: "🌐" },
          ].map(s => (
            <div key={s.label} className={`text-center px-3 py-1.5 rounded-lg border ${s.urgent ? "border-red-500/40 bg-red-500/10" : "border-[#30363D] bg-[#161B22]/50"}`}>
              <p className={`text-lg font-bold ${s.urgent ? "text-red-400" : "text-[#E6EDF3]"}`}>{s.icon} {s.value}</p>
              <p className="text-[10px] text-[#7D8590]">{s.label}</p>
            </div>
          ))}
          <button onClick={() => load(true)} disabled={refreshing}
            className="text-xs text-[#58A6FF] border border-[#30363D] rounded-lg px-3 py-1.5 hover:bg-[#161B22] disabled:opacity-50 transition-colors">
            {refreshing ? "…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div className="bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg p-3">
        <p className="text-xs font-semibold text-[#58A6FF] mb-1">✦ Today's #1 Priority</p>
        <p className="text-sm text-[#E6EDF3]">{cmd.aiInsight.topPriority}</p>
        {cmd.aiInsight.closestToBuying && (
          <p className="text-xs text-amber-300 mt-1.5">🏆 Closest to buying: {cmd.aiInsight.closestToBuying}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {leadsToContact.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-2">🔥 Leads to Contact</p>
            <div className="space-y-1.5">
              {leadsToContact.map(l => (
                <button key={l.id} onClick={() => onNavigate?.("lead-finder")}
                  className="w-full flex items-center justify-between bg-[#161B22]/70 hover:bg-[#161B22] rounded-lg px-3 py-1.5 transition-colors text-left group">
                  <div>
                    <p className="text-xs font-medium text-[#E6EDF3]">{l.name}</p>
                    <p className="text-[10px] text-[#7D8590]">{l.company ?? "—"} · {l.stage}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${l.score >= 70 ? "text-red-400" : "text-amber-400"}`}>{l.score}</span>
                    <span className="text-[10px] text-[#30363D] group-hover:text-[#7D8590] transition-colors">→</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {followUpsTodo.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-2">📅 Follow-Ups Due Today</p>
            <div className="space-y-1.5">
              {followUpsTodo.map(f => (
                <button key={f.id} onClick={() => onNavigate?.("follow-ups")}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-1.5 transition-colors text-left group ${f.status === "overdue" ? "bg-red-500/10 border border-red-500/20 hover:bg-red-500/15" : "bg-[#161B22]/70 hover:bg-[#161B22]"}`}>
                  <div>
                    <p className="text-xs font-medium text-[#E6EDF3]">{f.leadName ?? "Unknown"}</p>
                    <p className="text-[10px] text-[#7D8590]">{f.channel} · {f.subject ?? "No subject"}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {f.status === "overdue" && <span className="text-[10px] text-red-400 font-semibold">OVERDUE</span>}
                    <span className="text-[10px] text-[#30363D] group-hover:text-[#7D8590] transition-colors">→</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {cmd.offerToPush && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-emerald-400 mb-0.5">🎁 Offer to Push</p>
              <p className="text-xs text-[#E6EDF3] font-medium">{cmd.offerToPush.name}</p>
              <p className="text-[10px] text-[#7D8590]">{cmd.offerToPush.goal}</p>
            </div>
          )}
          {cmd.campaignAction && (
            <button onClick={() => onNavigate?.("campaigns")}
              className="w-full bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/15 rounded-lg px-3 py-2 text-left transition-colors">
              <p className="text-[10px] font-semibold text-purple-400 mb-0.5">🚀 Campaign Needs Attention →</p>
              <p className="text-xs text-[#E6EDF3] font-medium">{cmd.campaignAction.name}</p>
              <p className="text-[10px] text-[#7D8590]">{cmd.campaignAction.leadsGenerated} leads · ${parseFloat(cmd.campaignAction.revenueAttributed).toLocaleString()} rev</p>
            </button>
          )}
          {cmd.contentSuggestion && (
            <button onClick={() => onNavigate?.("content")}
              className="w-full bg-teal-500/10 border border-teal-500/20 hover:bg-teal-500/15 rounded-lg px-3 py-2 text-left transition-colors">
              <p className="text-[10px] font-semibold text-teal-400 mb-0.5">📝 1 Content to Publish →</p>
              <p className="text-xs text-[#E6EDF3] font-medium">{cmd.contentSuggestion.title}</p>
              <p className="text-[10px] text-[#7D8590]">{cmd.contentSuggestion.assetType}</p>
            </button>
          )}
          {cmd.aiInsight.revenueOpportunities.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-amber-400 mb-1">💰 Revenue Opportunities</p>
              <ul className="space-y-0.5">
                {cmd.aiInsight.revenueOpportunities.map((o, i) => (
                  <li key={i} className="text-[10px] text-[#E6EDF3] flex items-start gap-1"><span className="text-amber-400">•</span>{o}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-2">⚡ Quick Wins</p>
          <ul className="space-y-1.5">
            {cmd.aiInsight.quickWins.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[#E6EDF3]">
                <span className="text-emerald-400 font-bold mt-0.5 flex-shrink-0">{i + 1}.</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
        {cmd.aiInsight.nextBestActions.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide mb-2">🎯 Next Best Actions</p>
            <ul className="space-y-1.5">
              {cmd.aiInsight.nextBestActions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-[#E6EDF3]">
                  <span className="text-[#58A6FF] font-bold mt-0.5 flex-shrink-0">→</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
        <p className="text-[10px] font-semibold text-emerald-400 mb-0.5">Revenue Insight</p>
        <p className="text-xs text-[#E6EDF3]">{cmd.aiInsight.revenueInsight}</p>
      </div>
    </div>
  );
}

// ─── Section 1: KPI Strip ──────────────────────────────────────────────────────

function KPIStrip({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [hotLeads, setHotLeads] = useState<HotLead[]>([]);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/kpi`).then(r => r.json()).then(d => setKpi(d as KPI)).catch(() => null);
    fetchWithAuth(`${API}/admin/marketing/hot-leads`).then(r => r.json()).then(d => setHotLeads(Array.isArray(d) ? d as HotLead[] : [])).catch(() => null);
  }, [fetchWithAuth]);

  const cards = [
    { label: "Visitors Today", value: kpi?.visitorsToday ?? "—", icon: "👁", color: "blue" },
    { label: "Leads This Week", value: kpi?.leadsThisWeek ?? "—", icon: "🎯", color: "green" },
    { label: "Conversion Rate", value: kpi ? `${kpi.conversionRate}%` : "—", icon: "📈", color: "yellow" },
    { label: "Active Campaigns", value: kpi?.activeCampaigns ?? "—", icon: "🚀", color: "purple" },
    { label: "Hot Leads 🔥", value: kpi?.hotLeadsCount ?? hotLeads.length, icon: "🔥", color: "red" },
    { label: "Intent Signals Today", value: kpi?.intentSignalsToday ?? "—", icon: "⚡", color: "orange" },
    { label: "Follow-Ups Due", value: kpi?.followUpsDue ?? "—", icon: "📅", color: "yellow" },
    { label: "Active Offers", value: kpi?.activeOffers ?? "—", icon: "🎁", color: "purple" },
    { label: "Revenue (Active)", value: kpi ? `$${kpi.revenueThisMonth.toLocaleString()}` : "—", icon: "💰", color: "green" },
    { label: "Revenue Opportunity", value: kpi ? `$${kpi.revenueOpportunity.toLocaleString()}` : "—", icon: "🏆", color: "green" },
    { label: "Offer Conversion", value: kpi ? `${kpi.offerConversionRate}%` : "—", icon: "🎯", color: "blue" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#E6EDF3]">KPI Overview</h2>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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

      {hotLeads.length > 0 && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-[#E6EDF3]">🔥 Hot Lead Scoring</span>
            <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">{hotLeads.length} hot</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#30363D]">
                {["Lead", "Company", "Stage", "Score", "Recent Events"].map(h => (
                  <th key={h} className="px-3 py-1.5 text-left text-[10px] font-semibold text-[#7D8590]">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-[#30363D]">
                {hotLeads.slice(0, 10).map(l => (
                  <tr key={l.id} className="hover:bg-[#1C2128] transition-colors">
                    <td className="px-3 py-2">
                      <p className="text-xs font-medium text-[#E6EDF3]">{l.name}</p>
                      <p className="text-[10px] text-[#7D8590]">{l.email}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-[#7D8590]">{l.company ?? "—"}</td>
                    <td className="px-3 py-2"><Badge text={l.stage} color={l.stage === "SQL" ? "green" : "yellow"} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-16 rounded-full bg-[#21262D] overflow-hidden">
                          <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${l.score}%` }} />
                        </div>
                        <span className={`text-xs font-bold font-mono ${l.score >= 70 ? "text-red-400" : l.score >= 50 ? "text-amber-400" : "text-[#E6EDF3]"}`}>{l.score}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-[#58A6FF]">{l.recentEvents} events</td>
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
  const [intentLeadId, setIntentLeadId] = useState<number | null>(null);

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
          <option value="ai_suggested">AI Suggested</option>
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
                    <td className="px-4 py-2">
                      {lead.score >= 70 ? (
                        <button onClick={() => setIntentLeadId(lead.id)} title="View intent timeline"
                          className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer">🔥 {lead.score}</button>
                      ) : lead.score >= 50 ? (
                        <button onClick={() => setIntentLeadId(lead.id)} title="View intent timeline"
                          className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors cursor-pointer">⚡ {lead.score}</button>
                      ) : (
                        <span className="text-xs font-mono text-[#7D8590]">{lead.score}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "cold_email" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Email</button>
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "linkedin" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">LinkedIn</button>
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "followup" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Follow-Up</button>
                        <button onClick={() => setOutreachModal({ leadId: lead.id, leadName: lead.name, leadEmail: lead.email, type: "cold_call" })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#58A6FF] hover:bg-[#0078D4]/30 transition-colors">Call Script</button>
                        <button onClick={() => setEmailHistoryLead({ id: lead.id, name: lead.name, email: lead.email })} className="text-[10px] px-1.5 py-0.5 rounded bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">History</button>
                        <button onClick={() => setIntentLeadId(lead.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors">Intent ↗</button>
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
      {intentLeadId !== null && (
        <IntentTimelineDrawer leadId={intentLeadId} onClose={() => setIntentLeadId(null)} fetchWithAuth={fetchWithAuth} />
      )}
    </div>
  );
}

// ─── Intent Timeline Drawer ───────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  email_open: "Email Opened",
  link_click: "Link Clicked",
  cta_click: "CTA Clicked",
  site_visit: "Site Visit",
  form_submit: "Form Submit",
  reply: "Replied",
};
const EVENT_WEIGHTS: Record<string, number> = {
  email_open: 1, link_click: 3, cta_click: 5, site_visit: 2, form_submit: 10, reply: 15,
};

function IntentTimelineDrawer({ leadId, onClose, fetchWithAuth }: { leadId: number; onClose: () => void; fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  type IntentEvent = { id: number; eventType: string; metadata?: Record<string, unknown> | null; occurredAt: string; score: number };
  const [events, setEvents] = useState<IntentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [nba, setNba] = useState<{ outreachMethod: string; messageType: string; bestOffer: string; followUpTiming: string; rationale: string } | null>(null);
  const [nbaLoading, setNbaLoading] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logEventType, setLogEventType] = useState("site_visit");
  const [logSource, setLogSource] = useState("");
  const [logging, setLogging] = useState(false);

  const loadEvents = () => {
    fetchWithAuth(`${API}/admin/marketing/leads/${leadId}/intent-events`).then(r => r.json())
      .then(d => setEvents(Array.isArray(d) ? d as IntentEvent[] : [])).catch(() => null).finally(() => setLoading(false));
  };

  useEffect(() => { loadEvents(); }, [leadId, fetchWithAuth]);

  const generateNba = async () => {
    setNbaLoading(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/leads/${leadId}/next-best-action`, { method: "POST" });
      setNba(await r.json() as typeof nba);
    } finally { setNbaLoading(false); }
  };

  const logEvent = async () => {
    setLogging(true);
    try {
      await fetchWithAuth(`${API}/admin/marketing/intent-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, eventType: logEventType, metadata: logSource ? { source: logSource } : undefined }),
      });
      setLogSource("");
      setShowLogForm(false);
      setLoading(true);
      loadEvents();
    } finally { setLogging(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-[#0D1117] border-l border-[#30363D] h-full overflow-y-auto p-5 space-y-4 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Intent Timeline</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLogForm(f => !f)}
              className="text-xs px-2 py-1 rounded-lg border border-purple-500/40 text-purple-400 hover:bg-purple-500/10 transition-colors">
              + Log Event
            </button>
            <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] text-lg">✕</button>
          </div>
        </div>

        {showLogForm && (
          <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-3 space-y-2">
            <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Log Intent Event</p>
            <select value={logEventType} onChange={e => setLogEventType(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]">
              {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v} (+{EVENT_WEIGHTS[k] ?? 1} pts)</option>)}
            </select>
            <input value={logSource} onChange={e => setLogSource(e.target.value)} placeholder="Source (e.g. LinkedIn, Email)" type="text"
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-md px-2 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4] placeholder-[#484F58]" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowLogForm(false)} className="text-xs text-[#7D8590] hover:text-[#E6EDF3] px-3 py-1.5 rounded border border-[#30363D] transition-colors">Cancel</button>
              <button onClick={() => { void logEvent(); }} disabled={logging}
                className="text-xs text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-1.5 rounded transition-colors font-medium">
                {logging ? "Saving…" : "Log Event"}
              </button>
            </div>
          </div>
        )}

        {loading ? <div className="animate-pulse space-y-2"><div className="h-12 bg-[#161B22] rounded" /><div className="h-12 bg-[#161B22] rounded" /></div> : (
          events.length === 0 ? (
            <p className="text-sm text-[#7D8590]">No intent events recorded yet. Use "+ Log Event" to add one manually.</p>
          ) : (
            <div className="space-y-2">
              {events.map(e => (
                <div key={e.id} className="flex items-start gap-3 bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-2">
                  <div className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 flex-shrink-0 mt-0.5">+{EVENT_WEIGHTS[e.eventType] ?? 1}</div>
                  <div>
                    <p className="text-xs font-medium text-[#E6EDF3]">{EVENT_LABELS[e.eventType] ?? e.eventType}</p>
                    {!!e.metadata?.source && <p className="text-[10px] text-[#7D8590]">{String(e.metadata.source)}</p>}
                    <p className="text-[10px] text-[#484F58]">{new Date(e.occurredAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        <div className="border-t border-[#30363D] pt-3">
          <button onClick={() => { void generateNba(); }} disabled={nbaLoading}
            className="w-full text-xs px-3 py-2 rounded-lg border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center justify-center gap-1">
            {nbaLoading ? <><div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Generating…</> : "✦ Next Best Action"}
          </button>
          {nba && (
            <div className="mt-3 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-[#58A6FF]">Recommended Action</p>
              <p className="text-xs text-[#E6EDF3]"><span className="text-[#7D8590]">Method:</span> {nba.outreachMethod}</p>
              <p className="text-xs text-[#E6EDF3]"><span className="text-[#7D8590]">Message:</span> {nba.messageType}</p>
              <p className="text-xs text-[#E6EDF3]"><span className="text-[#7D8590]">Best Offer:</span> {nba.bestOffer}</p>
              <p className="text-xs text-[#E6EDF3]"><span className="text-[#7D8590]">Timing:</span> {nba.followUpTiming}</p>
              <p className="text-xs text-[#7D8590] italic mt-1">{nba.rationale}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section 3: Outreach Automation ───────────────────────────────────────────

function OutreachAutomationSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>; }) {
  const [activeTab, setActiveTab] = useState<"cold_email" | "linkedin" | "followup" | "cold_call">("cold_email");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
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
  const [addToLeadsReady, setAddToLeadsReady] = useState(false);
  const [addingLead, setAddingLead] = useState(false);
  const [leadAdded, setLeadAdded] = useState(false);
  const [addLeadError, setAddLeadError] = useState<string | null>(null);

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

  const suggestProspect = async () => {
    setSuggesting(true);
    setAddToLeadsReady(false);
    setLeadAdded(false);
    setAddLeadError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/outreach-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateType: activeTab }),
      });
      const data = await r.json() as { name: string; company: string; role: string; industry: string };
      if (data.name) setName(data.name);
      if (data.company) setCompany(data.company);
      if (data.role) setRole(data.role);
      if (data.industry) setIndustry(data.industry);
      if (data.name || data.company) setAddToLeadsReady(true);
    } finally { setSuggesting(false); }
  };

  const addToLeads = async () => {
    setAddingLead(true);
    setAddLeadError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, role, industry }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        setAddLeadError(err.error ?? "Failed to save lead");
      } else {
        setLeadAdded(true);
        setAddToLeadsReady(false);
      }
    } catch {
      setAddLeadError("Network error — please try again");
    } finally { setAddingLead(false); }
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
            <button onClick={() => { void suggestProspect(); }} disabled={suggesting}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
              {suggesting ? <><div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Suggesting…</> : "✦ Suggest"}
            </button>
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
                <input value={val} onChange={e => { setter(e.target.value); setLeadAdded(false); setAddLeadError(null); }} placeholder={`Lead ${label.toLowerCase()}…`}
                  className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
              </div>
            ))}
          </div>
          {(addToLeadsReady || leadAdded || addLeadError) && (
            <div className="flex items-center gap-2 flex-wrap">
              {leadAdded ? (
                <span className="text-xs text-emerald-400 flex items-center gap-1">✓ Added to Lead Finder</span>
              ) : (
                <button onClick={() => { void addToLeads(); }} disabled={addingLead || !name.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors flex items-center gap-1">
                  {addingLead ? <><div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />Adding…</> : "＋ Add to Leads"}
                </button>
              )}
              {addLeadError && <span className="text-xs text-red-400">{addLeadError}</span>}
            </div>
          )}
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
  const [activeTab, setActiveTab] = useState<"blog_post" | "linkedin_post" | "newsletter" | "social_post" | "seo_keywords" | "lead_magnet">("blog_post");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [keywords, setKeywords] = useState("");
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
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

  const suggestContentIdea = async () => {
    setSuggesting(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/content-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: activeTab }),
      });
      const data = await r.json() as { topic: string; tone: string; keywords: string };
      if (data.topic) setTopic(data.topic);
      if (data.tone) setTone(data.tone);
      if (data.keywords) setKeywords(data.keywords);
    } finally { setSuggesting(false); }
  };

  const deleteAsset = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/campaign-assets/${id}`, { method: "DELETE" });
    setSavedAssets(prev => prev.filter(a => a.id !== id));
  };

  const generate = async () => {
    if (!topic.trim()) return;
    setGenerating(true); setContent("");
    try {
      if (activeTab === "lead_magnet") {
        const r = await fetchWithAuth(`${API}/admin/marketing/generate/lead-magnet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, format: tone || "checklist", audience: keywords || undefined }),
        });
        const data = await r.json() as { title?: string; subtitle?: string; format?: string; items?: string[]; cta?: string; outlineMarkdown?: string; error?: string };
        if (!r.ok) throw new Error(data.error ?? `Server error ${r.status}`);
        const items = Array.isArray(data.items) ? data.items : [];
        const formatted = `# ${data.title ?? ""}\n${data.subtitle ?? ""}\n\n**Format:** ${data.format ?? ""}\n\n## Checklist Items\n${items.map(i => `- ${i}`).join("\n")}\n\n**CTA:** ${data.cta ?? ""}\n\n---\n${data.outlineMarkdown ?? ""}`;
        setContent(formatted);
      } else {
        const r = await fetchWithAuth(`${API}/admin/marketing/generate/content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: activeTab, topic, tone, keywords }),
        });
        const data = await r.json() as { content: string };
        setContent(data.content ?? "");
      }
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
    { id: "lead_magnet" as const, label: "🧲 Lead Magnet" },
  ];

  const TAB_LABEL: Record<string, string> = {
    blog_post: "Blog Post", linkedin_post: "LinkedIn", newsletter: "Newsletter",
    social_post: "Social Post", seo_keywords: "SEO Keywords", lead_magnet: "Lead Magnet",
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Topic *</label>
                <button onClick={() => { void suggestContentIdea(); }} disabled={suggesting}
                  className="text-[10px] px-2 py-0.5 rounded border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
                  {suggesting ? <><div className="w-2.5 h-2.5 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />…</> : "✦ Suggest"}
                </button>
              </div>
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
                    <button onClick={e => { e.stopPropagation(); void deleteAsset(asset.id); }}
                      className="text-[#484F58] hover:text-red-400 transition-colors text-[10px] leading-none">✕</button>
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLeads, setEditLeads] = useState("");
  const [editRevenue, setEditRevenue] = useState("");
  const [saving, setSaving] = useState(false);

  const loadAnalytics = useCallback(async () => {
    const r = await fetchWithAuth(`${API}/admin/marketing/analytics`);
    setAnalytics(await r.json() as AnalyticsData);
  }, [fetchWithAuth]);

  useEffect(() => {
    loadAnalytics().catch(() => null).finally(() => setLoading(false));
  }, [loadAnalytics]);

  const startEdit = (c: CampaignPerf) => {
    setEditingId(c.id);
    setEditLeads(String(c.leadsGenerated));
    setEditRevenue(String(c.revenueAttributed));
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    try {
      await fetchWithAuth(`${API}/admin/marketing/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadsGenerated: Math.max(0, parseInt(editLeads, 10) || 0),
          revenueAttributed: Math.max(0, parseFloat(editRevenue) || 0),
        }),
      });
      await loadAnalytics();
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

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
                  const isEditing = editingId === c.id;
                  return (
                    <div key={c.id} className={`rounded-lg px-3 py-2.5 ${isTop && !isEditing ? "bg-[#0D1117] ring-1 ring-[#0078D4]/50" : "bg-[#0D1117]"}`}>
                      {isEditing ? (
                        <div>
                          <p className="text-sm text-[#E6EDF3] font-medium mb-2 truncate">{c.name}</p>
                          <div className="flex gap-2 mb-2">
                            <div className="flex-1">
                              <label className="text-[10px] text-[#7D8590] uppercase tracking-wider block mb-1">Leads Generated</label>
                              <input
                                type="number"
                                min="0"
                                value={editLeads}
                                onChange={e => setEditLeads(e.target.value)}
                                className="w-full bg-[#21262D] border border-[#30363D] rounded-md px-2 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                                placeholder="0"
                                autoFocus
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-[10px] text-[#7D8590] uppercase tracking-wider block mb-1">Revenue Attributed ($)</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editRevenue}
                                onChange={e => setEditRevenue(e.target.value)}
                                className="w-full bg-[#21262D] border border-[#30363D] rounded-md px-2 py-1.5 text-sm text-[#E6EDF3] focus:outline-none focus:border-[#0078D4]"
                                placeholder="0"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-[#7D8590] hover:text-[#E6EDF3] px-3 py-1.5 rounded-md border border-[#30363D] hover:border-[#484F58] transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void saveEdit(c.id)}
                              disabled={saving}
                              className="text-xs text-white bg-[#0078D4] hover:bg-[#0078D4]/80 disabled:opacity-50 px-3 py-1.5 rounded-md transition-colors font-medium"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-sm text-[#E6EDF3] truncate font-medium">{c.name}</p>
                              {isTop && <span className="text-[10px] font-bold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-full px-2 py-0.5 flex-shrink-0">★ Top</span>}
                              <Badge text={c.status} color={c.status === "active" ? "green" : "gray"} />
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              {c.revenuePerLead !== null
                                ? <span className="text-sm font-bold text-[#E6EDF3]">${c.revenuePerLead.toLocaleString("en-US", { maximumFractionDigits: 0 })}<span className="text-[#7D8590] font-normal text-xs">/lead</span></span>
                                : <span className="text-[#484F58] text-sm">—</span>
                              }
                              <button
                                onClick={() => startEdit(c)}
                                title="Edit leads & revenue"
                                className="text-[#484F58] hover:text-[#7D8590] transition-colors p-0.5 rounded"
                              >
                                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full bg-[#21262D] overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${isTop ? "bg-[#0078D4]" : "bg-[#30363D]"}`} style={{ width: `${barPct}%` }} />
                          </div>
                          <div className="flex gap-3 mt-1.5">
                            <span className="text-[10px] text-[#7D8590]">{c.leadsGenerated} lead{c.leadsGenerated !== 1 ? "s" : ""}</span>
                            <span className="text-[10px] text-[#7D8590]">${c.revenueAttributed.toLocaleString("en-US", { maximumFractionDigits: 0 })} revenue</span>
                          </div>
                        </>
                      )}
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

        <OfferPerformanceCard fetchWithAuth={fetchWithAuth} />
        <LeadSourceRoiCard analytics={analytics} />

        <AiInsightsCard fetchWithAuth={fetchWithAuth} />
      </div>
    </div>
  );
}

function OfferPerformanceCard({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignPerf[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      fetchWithAuth(`${API}/admin/marketing/offers`).then(r => r.json()).then(d => Array.isArray(d) ? d as Offer[] : []),
      fetchWithAuth(`${API}/admin/marketing/analytics`).then(r => r.json()).then((d: AnalyticsData) => d.campaignPerformance ?? []),
    ]).then(([o, c]) => { setOffers(o); setCampaigns(c); }).catch(() => null).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  if (loading) return <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4"><div className="animate-pulse h-40 bg-[#30363D] rounded" /></div>;
  if (offers.length === 0) return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#E6EDF3] mb-2">🎁 Offer Performance</h3>
      <p className="text-sm text-[#7D8590] text-center py-4">No offers created yet. Add offers in Campaigns → Offers.</p>
    </div>
  );

  // Build chart data: correlate offers to their linked campaign revenue
  const campaignMap = new Map(campaigns.map(c => [c.id, c]));
  const chartData = offers.map(o => {
    const camp = o.campaignId ? campaignMap.get(o.campaignId) : undefined;
    const revenue = camp ? camp.revenueAttributed : 0;
    const leads = camp ? camp.leadsGenerated : 0;
    return { name: o.name.length > 20 ? o.name.slice(0, 20) + "…" : o.name, revenue, leads, pricing: o.pricing ?? null };
  });
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#E6EDF3] mb-1">🎁 Offer Performance</h3>
      <p className="text-xs text-[#7D8590] mb-4">Revenue & leads attributed via linked campaigns. Offers without a linked campaign show $0.</p>
      <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 36)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 60, top: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#7D8590", fontSize: 10 }} tickFormatter={v => `$${Number(v).toLocaleString("en-US", { notation: "compact" })}`} />
          <YAxis type="category" dataKey="name" tick={{ fill: "#7D8590", fontSize: 10 }} width={120} />
          <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #30363D", borderRadius: 8 }} labelStyle={{ color: "#E6EDF3" }}
            formatter={(value: number, name: string) => [name === "revenue" ? `$${value.toLocaleString()}` : value, name === "revenue" ? "Revenue" : "Leads"]} />
          <Bar dataKey="revenue" fill="#0078D4" radius={[0, 4, 4, 0]}
            label={{ position: "right", fill: "#7D8590", fontSize: 9, formatter: (v: number) => v > 0 ? `$${v.toLocaleString("en-US", { notation: "compact" })}` : "" }} />
        </BarChart>
      </ResponsiveContainer>
      {chartData.some(d => d.pricing) && (
        <div className="mt-3 border-t border-[#30363D] pt-3 grid grid-cols-2 gap-1.5">
          {offers.filter(o => o.pricing).map(o => (
            <div key={o.id} className="flex items-center justify-between bg-[#0D1117] rounded-lg px-2 py-1">
              <span className="text-[10px] text-[#7D8590] truncate">{o.name}</span>
              <span className="text-[10px] font-bold text-emerald-400 flex-shrink-0 ml-1">{o.pricing}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadSourceRoiCard({ analytics }: { analytics: AnalyticsData | null }) {
  if (!analytics) return null;
  const sources = analytics.trafficSources ?? [];
  const campaigns = analytics.campaignPerformance ?? [];
  const totalRevenue = campaigns.reduce((s, c) => s + (c.revenueAttributed ?? 0), 0);
  const totalSessions = sources.reduce((s, c) => s + c.sessions, 0);
  if (sources.length === 0) return null;
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#E6EDF3] mb-1">📊 Lead Source ROI</h3>
      <p className="text-xs text-[#7D8590] mb-4">Traffic source share vs revenue attribution from linked campaigns.</p>
      <div className="space-y-2">
        {sources.map((s, i) => {
          const sharePct = totalSessions > 0 ? (s.sessions / totalSessions) * 100 : 0;
          const attributedRevenue = totalRevenue > 0 ? totalRevenue * (sharePct / 100) : 0;
          return (
            <div key={i} className="rounded-lg bg-[#0D1117] px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[#E6EDF3]">{s.source}</span>
                <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                  <span className="text-[10px] text-[#7D8590]">{s.sessions} sessions</span>
                  <span className="text-xs font-bold text-emerald-400">${attributedRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-[#21262D] overflow-hidden">
                <div className="h-full rounded-full bg-[#0078D4]" style={{ width: `${sharePct}%` }} />
              </div>
              <p className="text-[10px] text-[#484F58] mt-0.5">{sharePct.toFixed(1)}% of traffic</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI Analytics Insights Card ───────────────────────────────────────────────

function AiInsightsCard({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [insights, setInsights] = useState<{ summary: string; wins: string[]; gaps: string[]; recommendations: Array<{ action: string; impact: string }>; revenueAlert: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/analytics/insights`);
      setInsights(await r.json() as typeof insights);
      setLoaded(true);
    } finally { setLoading(false); }
  };

  return (
    <div className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#E6EDF3]">✦ AI Analytics Insights</h3>
        {!loaded && (
          <button onClick={() => { void load(); }} disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
            {loading ? <><div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Analyzing…</> : "Generate Insights"}
          </button>
        )}
      </div>
      {loading && <div className="animate-pulse space-y-2"><div className="h-4 bg-[#30363D] rounded w-3/4" /><div className="h-4 bg-[#30363D] rounded w-1/2" /></div>}
      {insights && (
        <div className="space-y-3">
          <div className="bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg p-3">
            <p className="text-xs text-[#E6EDF3]">{insights.summary}</p>
          </div>
          {insights.revenueAlert && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-amber-400 mb-0.5">⚠ Revenue Alert</p>
              <p className="text-xs text-[#E6EDF3]">{insights.revenueAlert}</p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold text-emerald-400 mb-1">✓ What's Working</p>
              <ul className="space-y-1">{insights.wins.map((w, i) => <li key={i} className="text-xs text-[#E6EDF3] flex gap-1.5"><span className="text-emerald-400 flex-shrink-0">·</span>{w}</li>)}</ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-red-400 mb-1">✗ Gaps to Close</p>
              <ul className="space-y-1">{insights.gaps.map((g, i) => <li key={i} className="text-xs text-[#E6EDF3] flex gap-1.5"><span className="text-red-400 flex-shrink-0">·</span>{g}</li>)}</ul>
            </div>
          </div>
          {insights.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[#58A6FF] mb-2">Recommendations</p>
              <div className="space-y-1.5">
                {insights.recommendations.map((r, i) => (
                  <div key={i} className="bg-[#0D1117] rounded-lg px-3 py-2 flex items-start gap-2">
                    <span className="text-[#0078D4] font-bold text-xs flex-shrink-0">{i + 1}.</span>
                    <div>
                      <p className="text-xs font-medium text-[#E6EDF3]">{r.action}</p>
                      <p className="text-[10px] text-[#7D8590]">{r.impact}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!loading && !loaded && (
        <p className="text-xs text-[#7D8590] text-center py-4">Click "Generate Insights" for an AI analysis of your marketing performance</p>
      )}
    </div>
  );
}

// ─── Offer Builder Panel ──────────────────────────────────────────────────────

function OfferBuilderPanel({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [pricePoint, setPricePoint] = useState("");
  const [draft, setDraft] = useState<Omit<Offer, "id" | "createdAt"> | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/offers`).then(r => r.json()).then(d => setOffers(Array.isArray(d) ? d as Offer[] : [])).catch(() => null).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const generate = async () => {
    setGenerating(true); setDraft(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/offer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, audience, pricePoint }) });
      setDraft(await r.json() as Omit<Offer, "id" | "createdAt">);
    } finally { setGenerating(false); }
  };

  const saveOffer = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/offers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const saved = await r.json() as Offer;
      setOffers(prev => [saved, ...prev]);
      setDraft(null); setGoal(""); setAudience(""); setPricePoint("");
    } finally { setSaving(false); }
  };

  const deleteOffer = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/offers/${id}`, { method: "DELETE" });
    setOffers(prev => prev.filter(o => o.id !== id));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#E6EDF3]">💡 Offer Builder</h3>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Goal</label>
            <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g. Copilot adoption"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Audience</label>
            <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. IT directors"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Price Point</label>
            <input value={pricePoint} onChange={e => setPricePoint(e.target.value)} placeholder="e.g. $5,000 fixed"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
        </div>
        <button onClick={() => { void generate(); }} disabled={generating}
          className="w-full py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
          {generating ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generating Offer…</> : "✦ Generate Offer"}
        </button>

        {draft && (
          <div className="bg-[#0D1117] rounded-xl p-4 space-y-3 border border-[#0078D4]/20">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold text-[#E6EDF3]">{draft.name}</h4>
                <p className="text-xs text-[#7D8590] mt-0.5">{draft.goal}</p>
              </div>
              {draft.pricing && <span className="text-sm font-bold text-emerald-400 flex-shrink-0">{draft.pricing}</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-semibold text-[#58A6FF] mb-1">Deliverables</p>
                <ul className="space-y-1">{draft.deliverables.map((d, i) => <li key={i} className="text-xs text-[#E6EDF3] flex gap-1.5"><span className="text-[#0078D4]">✓</span>{d}</li>)}</ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-emerald-400 mb-1">Outcomes</p>
                <ul className="space-y-1">{draft.outcomes.map((o, i) => <li key={i} className="text-xs text-[#E6EDF3] flex gap-1.5"><span className="text-emerald-400">→</span>{o}</li>)}</ul>
              </div>
            </div>
            {draft.cta && <p className="text-xs text-amber-400 font-medium">CTA: {draft.cta}</p>}
            <button onClick={() => { void saveOffer(); }} disabled={saving}
              className="w-full py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/30 disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Save Offer"}
            </button>
          </div>
        )}
      </div>

      {loading ? <SkeletonCard /> : offers.length === 0 ? (
        <p className="text-xs text-[#7D8590]">No offers yet — generate your first one above</p>
      ) : (
        <div className="space-y-2">
          {offers.map(o => (
            <div key={o.id} className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
              <button onClick={() => setExpandedId(prev => prev === o.id ? null : o.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#E6EDF3] truncate">{o.name}</p>
                  <p className="text-xs text-[#7D8590]">{o.audience}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {o.pricing && <span className="text-xs text-emerald-400 font-semibold">{o.pricing}</span>}
                  <span className="text-[#484F58] text-xs">{expandedId === o.id ? "▲" : "▼"}</span>
                  <button onClick={e => { e.stopPropagation(); void deleteOffer(o.id); }} className="text-[#484F58] hover:text-red-400 text-xs">✕</button>
                </div>
              </button>
              {expandedId === o.id && (
                <div className="border-t border-[#30363D] px-4 pb-4 pt-3 space-y-3">
                  <p className="text-xs text-[#7D8590]">{o.goal}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-[10px] text-[#58A6FF] font-semibold mb-1">Deliverables</p><ul>{o.deliverables.map((d, i) => <li key={i} className="text-xs text-[#E6EDF3]">✓ {d}</li>)}</ul></div>
                    <div><p className="text-[10px] text-emerald-400 font-semibold mb-1">Outcomes</p><ul>{o.outcomes.map((out, i) => <li key={i} className="text-xs text-[#E6EDF3]">→ {out}</li>)}</ul></div>
                  </div>
                  {o.cta && <p className="text-xs text-amber-400">CTA: {o.cta}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Landing Pages Panel ──────────────────────────────────────────────────────

function LandingPagesPanel({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [cta, setCta] = useState("");
  const [draft, setDraft] = useState<Partial<LandingPage> | null>(null);
  const [slugInput, setSlugInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/landing-pages`).then(r => r.json()).then(d => setPages(Array.isArray(d) ? d as LandingPage[] : [])).catch(() => null).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const generate = async () => {
    setGenerating(true); setDraft(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/landing-page`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, audience, cta }) });
      const data = await r.json() as Partial<LandingPage>;
      setDraft(data);
      if (data.title) setSlugInput(data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50));
    } finally { setGenerating(false); }
  };

  const savePage = async () => {
    if (!draft || !slugInput.trim()) return;
    setSlugError(null);
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/landing-pages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, slug: slugInput.trim(), published: false }),
      });
      if (!r.ok) {
        const err = await r.json() as { error?: string };
        setSlugError(err.error ?? "Failed to save");
        return;
      }
      const saved = await r.json() as LandingPage;
      setPages(prev => [saved, ...prev]);
      setDraft(null); setTopic(""); setAudience(""); setCta(""); setSlugInput("");
    } finally { setSaving(false); }
  };

  const togglePublish = async (page: LandingPage) => {
    const r = await fetchWithAuth(`${API}/admin/marketing/landing-pages/${page.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ published: !page.published }) });
    const updated = await r.json() as LandingPage;
    setPages(prev => prev.map(p => p.id === page.id ? updated : p));
  };

  const deletePage = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/landing-pages/${id}`, { method: "DELETE" });
    setPages(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[#E6EDF3]">🌐 Landing Pages</h3>
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Topic / Offer</label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Microsoft Copilot adoption"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Audience</label>
            <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. Healthcare IT teams"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">CTA</label>
            <input value={cta} onChange={e => setCta(e.target.value)} placeholder="e.g. Book a discovery call"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
        </div>
        <button onClick={() => { void generate(); }} disabled={generating || !topic.trim()}
          className="w-full py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
          {generating ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generating…</> : "✦ Generate Landing Page"}
        </button>

        {draft && (
          <div className="bg-[#0D1117] rounded-xl p-4 space-y-3 border border-[#0078D4]/20">
            <h4 className="font-semibold text-[#E6EDF3]">{draft.headline ?? draft.title}</h4>
            {draft.subheadline && <p className="text-xs text-[#7D8590]">{draft.subheadline}</p>}
            {draft.valuePropBlocks && draft.valuePropBlocks.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {draft.valuePropBlocks.map((b, i) => (
                  <div key={i} className="bg-[#161B22] rounded-lg p-2">
                    {b.icon && <span className="text-lg">{b.icon}</span>}
                    <p className="text-xs font-semibold text-[#E6EDF3] mt-1">{b.heading}</p>
                    <p className="text-[10px] text-[#7D8590]">{b.body}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">URL Slug</label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-[#7D8590] flex-shrink-0">/lp/</span>
                  <input value={slugInput} onChange={e => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="my-page-slug"
                    className="flex-1 bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
                </div>
                {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
              </div>
              <button onClick={() => { void savePage(); }} disabled={saving || !slugInput.trim()}
                className="w-full py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/30 disabled:opacity-40 transition-colors">
                {saving ? "Saving…" : "Save as Draft"}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? <SkeletonCard /> : pages.length === 0 ? (
        <p className="text-xs text-[#7D8590]">No landing pages yet — generate your first one above</p>
      ) : (
        <div className="space-y-2">
          {pages.map(page => (
            <div key={page.id} className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setExpandedId(prev => prev === page.id ? null : page.id)} className="flex-1 text-left">
                  <p className="text-sm font-medium text-[#E6EDF3] truncate">{page.title}</p>
                  <p className="text-xs text-[#7D8590]">/lp/{page.slug}</p>
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => { void togglePublish(page); }}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors ${page.published ? "bg-emerald-500/20 text-emerald-400 hover:bg-red-500/20 hover:text-red-400" : "bg-[#30363D] text-[#7D8590] hover:bg-emerald-500/20 hover:text-emerald-400"}`}>
                    {page.published ? "Published" : "Draft"}
                  </button>
                  {page.published && (
                    <>
                      <a href={`/lp/${page.slug}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#58A6FF] hover:underline">View →</a>
                      <button onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/lp/${page.slug}`); }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors" title="Copy link">🔗 Copy</button>
                    </>
                  )}
                  <button onClick={e => { e.stopPropagation(); void deletePage(page.id); }} className="text-[#484F58] hover:text-red-400 text-xs">✕</button>
                </div>
              </div>
              {expandedId === page.id && page.valuePropBlocks.length > 0 && (
                <div className="border-t border-[#30363D] px-4 pb-4 pt-3 space-y-2">
                  <p className="text-xs text-[#7D8590]">{page.headline}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {page.valuePropBlocks.slice(0, 3).map((b, i) => (
                      <div key={i} className="bg-[#0D1117] rounded-lg p-2">
                        {b.icon && <span>{b.icon}</span>}
                        <p className="text-[10px] font-semibold text-[#E6EDF3]">{b.heading}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Follow-Ups Section ───────────────────────────────────────────────────────

function FollowUpsSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [channel, setChannel] = useState("email");
  const [scheduledAt, setScheduledAt] = useState("");
  const [subject, setSubject] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [generatingCopyId, setGeneratingCopyId] = useState<number | null>(null);

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      const url = status && status !== "all" ? `${API}/admin/marketing/follow-ups?status=${status}` : `${API}/admin/marketing/follow-ups`;
      const r = await fetchWithAuth(url);
      const data = await r.json() as unknown;
      setFollowUps(Array.isArray(data) ? data as FollowUp[] : []);
    } catch { setFollowUps([]); }
    finally { setLoading(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void load(filterStatus); }, [load, filterStatus]);

  const generateDraft = async () => {
    setGeneratingDraft(true); setDraftContent("");
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/follow-up-draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, context: leadQuery }),
      });
      const data = await r.json() as { subject: string; content: string };
      if (data.subject) setSubject(data.subject);
      setDraftContent(data.content ?? "");
    } finally { setGeneratingDraft(false); }
  };

  const saveFollowUp = async () => {
    if (!scheduledAt) return;
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/follow-ups`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt, channel, subject: subject || null, aiDraftContent: draftContent || null }),
      });
      const saved = await r.json() as FollowUp;
      setFollowUps(prev => [saved, ...prev]);
      setShowForm(false); setChannel("email"); setScheduledAt(""); setSubject(""); setDraftContent("");
    } finally { setSaving(false); }
  };

  const completeFollowUp = async (id: number) => {
    const r = await fetchWithAuth(`${API}/admin/marketing/follow-ups/${id}/complete`, { method: "POST" });
    const updated = await r.json() as FollowUp;
    setFollowUps(prev => prev.map(f => f.id === id ? updated : f));
  };

  const rescheduleFollowUp = async (id: number) => {
    const fu = followUps.find(f => f.id === id);
    if (!fu) return;
    const next = new Date(new Date(fu.scheduledAt).getTime() + 86400000).toISOString();
    const r = await fetchWithAuth(`${API}/admin/marketing/follow-ups/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledAt: next, status: "pending" }),
    });
    if (r.ok) { const updated = await r.json() as FollowUp; setFollowUps(prev => prev.map(f => f.id === id ? updated : f)); }
  };

  const generateCopyForFollowUp = async (id: number) => {
    setGeneratingCopyId(id);
    setExpandedId(id);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/follow-ups/${id}/generate-copy`, { method: "POST" });
      if (r.ok) { const data = await r.json() as { followUp: FollowUp }; setFollowUps(prev => prev.map(f => f.id === id ? data.followUp : f)); }
    } finally { setGeneratingCopyId(null); }
  };

  const deleteFollowUp = async (id: number) => {
    await fetchWithAuth(`${API}/admin/marketing/follow-ups/${id}`, { method: "DELETE" });
    setFollowUps(prev => prev.filter(f => f.id !== id));
  };

  const statusColor = (s: string) => s === "completed" ? "green" : s === "overdue" ? "red" : s === "pending" ? "blue" : "gray";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[#E6EDF3]">Follow-Up Automation</h2>
        <button onClick={() => setShowForm(f => !f)} className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/80 transition-colors">+ Schedule</button>
      </div>

      <div className="flex gap-1">
        {(["all", "pending", "overdue", "completed", "skipped"] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${filterStatus === s ? "bg-[#0078D4]/20 border-[#0078D4]/40 text-[#58A6FF]" : "border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3]"}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Schedule Follow-Up</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Channel</label>
              <select value={channel} onChange={e => setChannel(e.target.value)} className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60">
                {["email", "linkedin", "phone", "other"].map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Scheduled Date</label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
                className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60" />
            </div>
            <div>
              <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Subject / Topic</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject or topic…"
                className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#7D8590] uppercase tracking-wide">Context (for AI draft)</label>
            <input value={leadQuery} onChange={e => setLeadQuery(e.target.value)} placeholder="e.g. following up on SharePoint proposal sent last week"
              className="mt-1 w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void generateDraft(); }} disabled={generatingDraft}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
              {generatingDraft ? <><div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Drafting…</> : "✦ Draft Content"}
            </button>
          </div>
          {draftContent && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#7D8590]">AI Draft</span>
                <CopyButton text={draftContent} />
              </div>
              <pre className="text-xs text-[#E6EDF3] whitespace-pre-wrap font-sans bg-[#0D1117] rounded-lg p-3 max-h-40 overflow-y-auto">{draftContent}</pre>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { void saveFollowUp(); }} disabled={saving || !scheduledAt}
              className="px-4 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors">
              {saving ? "Saving…" : "Schedule"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-[#30363D] text-[#7D8590] text-sm hover:text-[#E6EDF3] transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {loading ? <SkeletonCard count={3} /> : followUps.length === 0 ? (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-8 text-center">
          <p className="text-[#7D8590] text-sm">No follow-ups {filterStatus !== "all" ? `with status "${filterStatus}"` : "yet"}</p>
          <p className="text-xs text-[#484F58] mt-1">Schedule a follow-up and optionally draft the content with AI</p>
        </div>
      ) : (
        <div className="space-y-2">
          {followUps.map(fu => (
            <div key={fu.id} className={`bg-[#161B22] border rounded-xl overflow-hidden ${fu.status === "overdue" ? "border-red-500/30" : "border-[#30363D]"}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setExpandedId(prev => prev === fu.id ? null : fu.id)} className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#E6EDF3]">{fu.subject ?? `${fu.channel} follow-up`}</span>
                    <Badge text={fu.status} color={statusColor(fu.status)} />
                    <Badge text={fu.channel} color="blue" />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs text-[#7D8590]">{new Date(fu.scheduledAt).toLocaleString()}</p>
                    {fu.leadName && <p className="text-xs text-[#58A6FF]">→ {fu.leadName}</p>}
                  </div>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {(fu.status === "pending" || fu.status === "overdue") && (
                    <button onClick={() => { void completeFollowUp(fu.id); }} className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors">Done</button>
                  )}
                  <button onClick={() => { void rescheduleFollowUp(fu.id); }} className="text-[10px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors" title="Reschedule +1 day">+1d</button>
                  <button onClick={() => { void generateCopyForFollowUp(fu.id); }} className="text-[10px] px-2 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors" title="Generate AI copy">✦ Copy</button>
                  <button onClick={() => { void deleteFollowUp(fu.id); }} className="text-[#484F58] hover:text-red-400 text-xs ml-1">✕</button>
                </div>
              </div>
              {expandedId === fu.id && (fu.aiDraftContent || generatingCopyId === fu.id) && (
                <div className="border-t border-[#30363D] px-4 pb-3 pt-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#7D8590]">AI Draft</span>
                    {fu.aiDraftContent && <CopyButton text={fu.aiDraftContent} />}
                  </div>
                  {generatingCopyId === fu.id ? (
                    <div className="flex items-center gap-2 text-xs text-[#58A6FF]"><div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Generating copy…</div>
                  ) : fu.aiDraftContent ? (
                    <pre className="text-xs text-[#E6EDF3] whitespace-pre-wrap font-sans bg-[#0D1117] rounded-lg p-3 max-h-40 overflow-y-auto">{fu.aiDraftContent}</pre>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AI Money Tasks Button ────────────────────────────────────────────────────

function AiMoneyTasksButton({ fetchWithAuth, onAdded }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>; onAdded: (tasks: MarketingTask[]) => void }) {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/money-tasks`, { method: "POST" });
      const data = await r.json() as MarketingTask[];
      if (Array.isArray(data)) onAdded(data);
    } finally { setLoading(false); }
  };

  return (
    <button onClick={() => { void generate(); }} disabled={loading}
      className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40 transition-colors flex items-center gap-1">
      {loading ? <><div className="w-3 h-3 border border-amber-300 border-t-transparent rounded-full animate-spin" />Generating…</> : "💰 AI Money Tasks"}
    </button>
  );
}

// ─── Section 6: Marketing Tasks Kanban ────────────────────────────────────────

const KANBAN_COLUMNS: { id: MarketingTask["status"]; label: string; color: string }[] = [
  { id: "money_task", label: "💰 Money Tasks", color: "text-amber-300" },
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
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ title: string; description: string }>>([]);
  const [checkedSuggestions, setCheckedSuggestions] = useState<Set<number>>(new Set());
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);
  const [insertingSuggestions, setInsertingSuggestions] = useState(false);

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

  const aiSuggestTasks = async () => {
    setAiSuggesting(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/task-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const suggestions = await r.json() as Array<{ title: string; description: string }>;
      if (Array.isArray(suggestions) && suggestions.length > 0) {
        setAiSuggestions(suggestions);
        setCheckedSuggestions(new Set(suggestions.map((_, i) => i)));
        setShowSuggestionsModal(true);
      }
    } finally { setAiSuggesting(false); }
  };

  const confirmSuggestions = async () => {
    const selected = aiSuggestions.filter((_, i) => checkedSuggestions.has(i));
    if (selected.length === 0) { setShowSuggestionsModal(false); return; }
    setInsertingSuggestions(true);
    try {
      const inserted = await Promise.all(selected.map(s =>
        fetchWithAuth(`${API}/admin/marketing/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: s.title, description: s.description || null, status: "ideas" }),
        }).then(r => r.json() as Promise<MarketingTask>)
      ));
      setTasks(prev => [...inserted, ...prev]);
      setShowSuggestionsModal(false);
      setAiSuggestions([]);
    } finally { setInsertingSuggestions(false); }
  };

  return (
    <div className="space-y-4">
      {showSuggestionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowSuggestionsModal(false); }}>
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363D]">
              <div>
                <h3 className="text-sm font-semibold text-[#E6EDF3]">✦ AI Suggested Tasks</h3>
                <p className="text-xs text-[#7D8590] mt-0.5">Uncheck tasks you don't want, then add the rest.</p>
              </div>
              <button onClick={() => setShowSuggestionsModal(false)} className="text-[#7D8590] hover:text-[#E6EDF3] text-lg leading-none transition-colors">×</button>
            </div>
            <div className="px-5 py-3 space-y-2 max-h-80 overflow-y-auto">
              {aiSuggestions.map((s, i) => (
                <label key={i} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checkedSuggestions.has(i)}
                    onChange={() => setCheckedSuggestions(prev => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i); else next.add(i);
                      return next;
                    })}
                    className="mt-0.5 accent-[#0078D4] w-4 h-4 shrink-0"
                  />
                  <div className={`transition-opacity ${checkedSuggestions.has(i) ? "opacity-100" : "opacity-40"}`}>
                    <p className="text-sm font-medium text-[#E6EDF3] leading-snug">{s.title}</p>
                    {s.description && <p className="text-xs text-[#7D8590] mt-0.5 leading-snug">{s.description}</p>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-[#30363D]">
              <span className="text-xs text-[#7D8590]">{checkedSuggestions.size} of {aiSuggestions.length} selected</span>
              <div className="flex gap-2">
                <button onClick={() => setShowSuggestionsModal(false)} className="text-xs px-3 py-1.5 rounded-lg border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] transition-colors">Cancel</button>
                <button
                  onClick={() => { void confirmSuggestions(); }}
                  disabled={insertingSuggestions || checkedSuggestions.size === 0}
                  className="text-xs px-4 py-1.5 rounded-lg bg-[#0078D4] text-white font-semibold hover:bg-[#0078D4]/80 disabled:opacity-40 transition-colors flex items-center gap-1.5">
                  {insertingSuggestions ? <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />Adding…</> : `Add ${checkedSuggestions.size} Task${checkedSuggestions.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[#E6EDF3]">Marketing Tasks</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { void aiSuggestTasks(); }} disabled={aiSuggesting}
            className="text-xs px-3 py-1.5 rounded-lg border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
            {aiSuggesting ? <><div className="w-3 h-3 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Generating…</> : "✦ AI Suggest Tasks"}
          </button>
          <AiMoneyTasksButton fetchWithAuth={fetchWithAuth} onAdded={(newTasks: MarketingTask[]) => setTasks(prev => [...newTasks, ...prev])} />
          <button onClick={() => setShowForm(f => !f)} className="text-xs px-3 py-1.5 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/80 transition-colors">+ Add Task</button>
        </div>
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

      {loading ? <div className="grid grid-cols-6 gap-3"><SkeletonCard count={6} /></div> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => { void handleDragEnd(e); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
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

// ─── Campaigns Hub (Campaigns + Offers + Landing Pages) ──────────────────────

function CampaignsHubSection({ fetchWithAuth }: { fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [activeTab, setActiveTab] = useState<"campaigns" | "offers" | "pages">("campaigns");
  const TABS = [
    { id: "campaigns" as const, label: "🚀 Campaigns" },
    { id: "offers" as const, label: "🎁 Offers" },
    { id: "pages" as const, label: "🌐 Landing Pages" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[#30363D] pb-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors ${activeTab === t.id ? "bg-[#0078D4]/20 text-[#58A6FF] border border-[#0078D4]/40" : "text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] border border-transparent"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {activeTab === "campaigns" && <CampaignBuilderWizard fetchWithAuth={fetchWithAuth} />}
      {activeTab === "offers" && <OfferBuilderPanel fetchWithAuth={fetchWithAuth} />}
      {activeTab === "pages" && <LandingPagesPanel fetchWithAuth={fetchWithAuth} />}
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
  const [aiFillingField, setAiFillingField] = useState<"goal" | "audience" | "offer" | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedCampaignId, setSavedCampaignId] = useState<number | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    fetchWithAuth(`${API}/admin/marketing/campaigns`).then(r => r.json()).then(d => setCampaigns(d as Campaign[])).catch(() => null).finally(() => setLoadingCampaigns(false));
  }, [fetchWithAuth]);

  const aiFillField = async (field: "goal" | "audience" | "offer") => {
    setAiFillingField(field);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/generate/campaign-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, name, goal, audience }),
      });
      const data = await r.json() as { value: string };
      if (data.value) {
        if (field === "goal") setGoal(data.value);
        else if (field === "audience") setAudience(data.value);
        else if (field === "offer") setOffer(data.value);
      }
    } finally { setAiFillingField(null); }
  };

  const previewAssetGeneration = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const r = await fetchWithAuth(`${API}/admin/marketing/campaigns/preview-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || `Campaign ${new Date().toLocaleDateString()}`, goal, audience, offer }),
      });
      const data = await r.json() as PreviewAsset[] | { error: string };
      if (!r.ok || !Array.isArray(data)) {
        setPreviewError((data as { error?: string }).error ?? "Failed to generate preview — please try again.");
        return;
      }
      setPreviewAssets(data);
      setStep(4);
    } catch {
      setPreviewError("Network error — check your connection and try again.");
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#E6EDF3]">Campaign Goal *</label>
                  <button onClick={() => { void aiFillField("goal"); }} disabled={aiFillingField !== null}
                    className="text-[10px] px-2 py-0.5 rounded border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
                    {aiFillingField === "goal" ? <><div className="w-2.5 h-2.5 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Filling…</> : "✦ AI Fill"}
                  </button>
                </div>
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#E6EDF3]">Target Audience *</label>
                  <button onClick={() => { void aiFillField("audience"); }} disabled={aiFillingField !== null}
                    className="text-[10px] px-2 py-0.5 rounded border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
                    {aiFillingField === "audience" ? <><div className="w-2.5 h-2.5 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Filling…</> : "✦ AI Fill"}
                  </button>
                </div>
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#E6EDF3]">Your Offer *</label>
                  <button onClick={() => { void aiFillField("offer"); }} disabled={aiFillingField !== null}
                    className="text-[10px] px-2 py-0.5 rounded border border-[#0078D4]/40 text-[#58A6FF] hover:bg-[#0078D4]/10 disabled:opacity-40 transition-colors flex items-center gap-1">
                    {aiFillingField === "offer" ? <><div className="w-2.5 h-2.5 border border-[#58A6FF] border-t-transparent rounded-full animate-spin" />Filling…</> : "✦ AI Fill"}
                  </button>
                </div>
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
              {previewError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{previewError}</p>
              )}
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
  { id: "command", label: "🚀 Command" },
  { id: "recommendations", label: "AI Leads" },
  { id: "kpi", label: "KPIs" },
  { id: "lead-finder", label: "Lead Finder" },
  { id: "outreach", label: "Outreach" },
  { id: "content", label: "Content" },
  { id: "follow-ups", label: "Follow-Ups" },
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
        <DailyCommandPanel fetchWithAuth={fetchWithAuth} onNavigate={setActiveSection} />
        {activeSection === "command" && null}
        {activeSection === "recommendations" && <RecommendedLeadsSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "kpi" && <KPIStrip fetchWithAuth={fetchWithAuth} />}
        {activeSection === "lead-finder" && <LeadFinderSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "outreach" && <OutreachAutomationSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "content" && <ContentHubSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "follow-ups" && <FollowUpsSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "analytics" && <TrafficAnalyticsSection fetchWithAuth={fetchWithAuth} />}
        {activeSection === "tasks" && <MarketingTasksKanban fetchWithAuth={fetchWithAuth} />}
        {activeSection === "campaigns" && <CampaignsHubSection fetchWithAuth={fetchWithAuth} />}
      </div>
    </div>
  );
}

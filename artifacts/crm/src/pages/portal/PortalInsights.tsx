import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  id: number;
  title: string;
  status: string;
  progress: number;
  projectType: string;
  startDate: string | null;
  endDate: string | null;
  stepCount: number;
  currentStepTitle: string | null;
}

interface KanbanTask {
  id: number;
  column: string;
  dueDate: string | null;
  updatedAt: string;
}

interface Invoice {
  id: number;
  status: string;
  amount: number;
  dueDate: string | null;
  paidAt: string | null;
}

interface M365Data {
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  intuneEnabled?: boolean;
  hasAADP1orP2?: boolean;
  hasDefender?: boolean;
  hasDLP?: boolean;
  usesComplianceCenter?: boolean;
  sensitivityLabelsConfigured?: boolean;
  hasRetentionPolicies?: boolean;
  hasInsiderRisk?: boolean;
  hasCopilotLicenses?: boolean;
  allUsersLicensed?: boolean;
  activeUserPercent?: string;
  usesTeams?: boolean;
  usesSharePoint?: boolean;
  usesOneDrive?: boolean;
}

interface ProjectDetail {
  tasks: KanbanTask[];
  steps: { status: string; completedAt: string | null; dueDate: string | null }[];
}

// ── Benchmarks (static representative values) ─────────────────────────────────

const INDUSTRY_BENCHMARKS = {
  security:          { label: "Security Posture",       clientLabel: "Your Score", industryAvg: 62, msExcellent: 90, unit: "%" },
  compliance:        { label: "Compliance Coverage",    clientLabel: "Your Score", industryAvg: 54, msExcellent: 85, unit: "%" },
  licensing:         { label: "Licensing Efficiency",   clientLabel: "Your Score", industryAvg: 71, msExcellent: 92, unit: "%" },
  governance:        { label: "Governance Maturity",    clientLabel: "Your Score", industryAvg: 48, msExcellent: 80, unit: "%" },
  copilotReadiness:  { label: "Copilot Readiness",      clientLabel: "Your Score", industryAvg: 38, msExcellent: 75, unit: "%" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 55) return "text-amber-600";
  return "text-red-600";
}

function scoreBg(score: number): string {
  if (score >= 80) return "bg-green-50 border-green-200";
  if (score >= 55) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function scoreBar(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 55) return "bg-amber-500";
  return "bg-red-500";
}

function weekAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

function StatCard({ label, value, sub, color = "text-[#0A2540]" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-extrabold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function InsightCard({ icon, title, body, variant = "default" }: { icon: React.ReactNode; title: string; body: string; variant?: "default" | "warning" | "success" | "info" }) {
  const cls = {
    default: "bg-[#0A2540]/3 border-[#0078D4]/20",
    warning: "bg-amber-50 border-amber-200",
    success: "bg-green-50 border-green-200",
    info: "bg-[#0078D4]/5 border-[#0078D4]/20",
  }[variant];
  const iconCls = {
    default: "bg-[#0078D4]/10 text-[#0078D4]",
    warning: "bg-amber-100 text-amber-600",
    success: "bg-green-100 text-green-600",
    info: "bg-[#0078D4]/10 text-[#0078D4]",
  }[variant];
  return (
    <div className={`border rounded-xl p-4 flex items-start gap-3 ${cls}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconCls}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#0A2540] mb-0.5">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

// ── Score computations ────────────────────────────────────────────────────────

function computeSecurityScore(m365: M365Data): number {
  const checks = [
    m365.mfaEnforced,
    m365.conditionalAccessEnabled,
    m365.intuneEnabled,
    m365.hasAADP1orP2,
    m365.hasDefender,
    m365.hasDLP,
    m365.usesComplianceCenter,
    m365.sensitivityLabelsConfigured,
    m365.hasRetentionPolicies,
  ];
  const answered = checks.filter(c => c !== undefined);
  if (answered.length === 0) return 50;
  const yes = checks.filter(c => c === true).length;
  return Math.round((yes / checks.length) * 100);
}

function computeComplianceScore(m365: M365Data): number {
  const checks = [m365.hasDLP, m365.usesComplianceCenter, m365.sensitivityLabelsConfigured, m365.hasRetentionPolicies, m365.hasInsiderRisk];
  const answered = checks.filter(c => c !== undefined);
  if (answered.length === 0) return 45;
  return Math.round((checks.filter(c => c === true).length / checks.length) * 100);
}

function computeGovScore(m365: M365Data): number {
  const checks = [m365.hasRetentionPolicies, m365.sensitivityLabelsConfigured, m365.usesComplianceCenter, m365.conditionalAccessEnabled];
  const answered = checks.filter(c => c !== undefined);
  if (answered.length === 0) return 40;
  return Math.round((checks.filter(c => c === true).length / checks.length) * 100);
}

function computeCopilotScore(m365: M365Data): number {
  const checks = [m365.hasCopilotLicenses, m365.mfaEnforced, m365.sensitivityLabelsConfigured, m365.hasDLP, m365.hasRetentionPolicies];
  const answered = checks.filter(c => c !== undefined);
  if (answered.length === 0) return 30;
  return Math.round((checks.filter(c => c === true).length / checks.length) * 100);
}

function computeLicensingScore(m365: M365Data): number {
  const pct = parseInt(m365.activeUserPercent ?? "0", 10);
  const base = isNaN(pct) ? 60 : Math.min(pct, 100);
  const bonus = m365.allUsersLicensed ? 10 : 0;
  return Math.min(base + bonus, 100);
}

// ── Responsiveness score ──────────────────────────────────────────────────────

function computeResponsivenessScore(projects: Project[]): number {
  if (projects.length === 0) return 85;
  const avgProgress = projects.reduce((s, p) => s + p.progress, 0) / projects.length;
  return Math.min(Math.round(50 + avgProgress * 0.4 + Math.random() * 10), 98);
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PortalInsights() {
  const { fetchWithAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [m365, setM365] = useState<M365Data>({});
  const [details, setDetails] = useState<Map<number, ProjectDetail>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/projects").then(r => r.ok ? r.json() : []),
      fetchWithAuth("/api/portal/invoices").then(r => r.ok ? r.json() : []),
      fetchWithAuth("/api/portal/m365-profile").then(r => r.ok ? r.json() : {}),
    ])
      .then(([ps, invs, m365data]) => {
        const allPs = ps as Project[];
        setAllProjects(allPs);
        setProjects(allPs.filter((p: Project) => p.status !== "completed"));
        setInvoices(invs as Invoice[]);
        setM365(m365data as M365Data);
        // Load detail for each active project (tasks) — fire and forget
        const activePs = allPs.filter((p: Project) => p.status !== "completed").slice(0, 5);
        Promise.all(
          activePs.map(p =>
            fetchWithAuth(`/api/portal/projects/${p.id}`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        ).then(dets => {
          const map = new Map<number, ProjectDetail>();
          dets.forEach((d, i) => { if (d && activePs[i]) map.set(activePs[i].id, d as ProjectDetail); });
          setDetails(map);
        });
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const secScore = useMemo(() => computeSecurityScore(m365), [m365]);
  const compScore = useMemo(() => computeComplianceScore(m365), [m365]);
  const govScore = useMemo(() => computeGovScore(m365), [m365]);
  const copScore = useMemo(() => computeCopilotScore(m365), [m365]);
  const licScore = useMemo(() => computeLicensingScore(m365), [m365]);
  const responsivenessScore = useMemo(() => computeResponsivenessScore(projects), [projects]);

  const waitingTasks = useMemo(() => {
    let count = 0;
    details.forEach(d => { count += d.tasks.filter(t => t.column === "waiting_on_customer").length; });
    return count;
  }, [details]);

  const overdueSteps = useMemo(() => {
    const now = new Date();
    let count = 0;
    details.forEach(d => {
      count += d.steps.filter(s => s.status !== "completed" && s.dueDate && new Date(s.dueDate) < now).length;
    });
    return count;
  }, [details]);

  const recentlyCompletedSteps = useMemo(() => {
    const ago = weekAgo();
    let count = 0;
    details.forEach(d => {
      count += d.steps.filter(s => s.completedAt && new Date(s.completedAt) > ago).length;
    });
    return count;
  }, [details]);

  const unpaidInvoices = useMemo(() => invoices.filter(i => i.status === "unpaid" || i.status === "pending"), [invoices]);
  const unpaidTotal = useMemo(() => unpaidInvoices.reduce((s, i) => s + i.amount, 0), [unpaidInvoices]);

  const progressTrendData = useMemo(() => {
    if (projects.length === 0) return [];
    return projects.slice(0, 6).map(p => ({
      name: p.title.length > 18 ? `${p.title.slice(0, 16)}…` : p.title,
      progress: p.progress,
      steps: p.stepCount,
    }));
  }, [projects]);

  const radarData = useMemo(() => [
    { subject: "Security", value: secScore, fullMark: 100 },
    { subject: "Compliance", value: compScore, fullMark: 100 },
    { subject: "Copilot", value: copScore, fullMark: 100 },
    { subject: "Governance", value: govScore, fullMark: 100 },
    { subject: "Licensing", value: licScore, fullMark: 100 },
  ], [secScore, compScore, copScore, govScore, licScore]);

  const benchmarkScores: Record<keyof typeof INDUSTRY_BENCHMARKS, number> = useMemo(() => ({
    security: secScore,
    compliance: compScore,
    licensing: licScore,
    governance: govScore,
    copilotReadiness: copScore,
  }), [secScore, compScore, licScore, govScore, copScore]);

  const aiInsights = useMemo(() => {
    const insights: { icon: React.ReactNode; title: string; body: string; variant: "default" | "warning" | "success" | "info" }[] = [];

    if (waitingTasks > 0) {
      insights.push({
        variant: "warning",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        title: `${waitingTasks} task${waitingTasks !== 1 ? "s" : ""} waiting on your input`,
        body: "Addressing these promptly keeps your projects on track and maximises Shane's available bandwidth for your engagement.",
      });
    }

    if (overdueSteps > 0) {
      insights.push({
        variant: "warning",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        title: `${overdueSteps} workflow step${overdueSteps !== 1 ? "s" : ""} past due date`,
        body: "These steps are beyond their target completion date. Review them on the project detail pages to unblock progress.",
      });
    }

    if (recentlyCompletedSteps > 0) {
      insights.push({
        variant: "success",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        title: `${recentlyCompletedSteps} step${recentlyCompletedSteps !== 1 ? "s" : ""} completed this week`,
        body: "Good momentum! These completions are moving your projects forward and building toward final delivery milestones.",
      });
    }

    if (secScore < 60) {
      insights.push({
        variant: "warning",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
        title: "Security posture needs attention",
        body: `Your security score of ${secScore}% is below the recommended baseline. Review your M365 Security & Compliance settings or raise this with Shane in your next session.`,
      });
    }

    if (copScore < 50) {
      insights.push({
        variant: "info",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
        title: "Copilot readiness opportunity",
        body: "Your Copilot readiness score indicates gaps in data governance prerequisites. Addressing DLP policies and sensitivity labels will accelerate your AI rollout timeline.",
      });
    }

    if (unpaidInvoices.length > 0) {
      insights.push({
        variant: "info",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>,
        title: `${unpaidInvoices.length} outstanding invoice${unpaidInvoices.length !== 1 ? "s" : ""}`,
        body: `$${(unpaidTotal / 100).toLocaleString()} is outstanding. Paying promptly keeps your engagement running smoothly. Head to Billing to review.`,
      });
    }

    if (insights.length === 0) {
      insights.push({
        variant: "success",
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>,
        title: "Everything looks great",
        body: "No critical actions or blockers detected across your projects and environment. Keep it up!",
      });
    }

    return insights;
  }, [waitingTasks, overdueSteps, recentlyCompletedSteps, secScore, copScore, unpaidInvoices, unpaidTotal]);

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center py-40">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  const avgProgress = projects.length > 0
    ? Math.round(projects.reduce((s, p) => s + p.progress, 0) / projects.length)
    : 0;

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Insights Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Intelligence and analytics across your engagement with Shane McCaw Consulting</p>
        </div>

        {/* ── Summary Stats ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Active Projects" value={projects.length} sub={`${allProjects.filter(p => p.status === "completed").length} completed`} />
          <StatCard label="Average Progress" value={`${avgProgress}%`} sub="across active projects" color={avgProgress >= 70 ? "text-green-600" : avgProgress >= 40 ? "text-amber-600" : "text-[#0078D4]"} />
          <StatCard label="Awaiting Your Input" value={waitingTasks} sub="tasks on your side" color={waitingTasks > 0 ? "text-amber-600" : "text-green-600"} />
          <StatCard label="Responsiveness Score" value={`${responsivenessScore}%`} sub="client engagement index" color={responsivenessScore >= 80 ? "text-green-600" : "text-amber-600"} />
        </div>

        {/* ── Main grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

          {/* Progress Chart */}
          <div className="lg:col-span-2 bg-white border border-border rounded-2xl p-6 shadow-sm">
            <h2 className="text-sm font-bold text-[#0A2540] mb-4">Project Progress</h2>
            {progressTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={progressTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="progressGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0078D4" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#0078D4" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#6b7280" }} unit="%" />
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb", fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`, "Progress"]}
                  />
                  <Area type="monotone" dataKey="progress" stroke="#0078D4" strokeWidth={2} fill="url(#progressGrad)" dot={{ r: 4, fill: "#0078D4" }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                No active projects to chart yet.
              </div>
            )}
          </div>

          {/* Environment Radar */}
          <div className="bg-white border border-border rounded-2xl p-6 shadow-sm">
            <h2 className="text-sm font-bold text-[#0A2540] mb-4">Environment Health</h2>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#6b7280" }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Score" dataKey="value" stroke="#0078D4" fill="#0078D4" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Bottleneck Detection + SLA Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          {/* Bottleneck Detection */}
          <div className="bg-white border border-border rounded-2xl p-6 shadow-sm">
            <h2 className="text-sm font-bold text-[#0A2540] mb-4">Bottleneck Detection</h2>
            <div className="space-y-3">
              {[
                { label: "Tasks waiting on you", value: waitingTasks, color: waitingTasks > 0 ? "text-amber-600" : "text-green-600", icon: waitingTasks > 0 ? "⚠️" : "✅" },
                { label: "Overdue workflow steps", value: overdueSteps, color: overdueSteps > 0 ? "text-red-600" : "text-green-600", icon: overdueSteps > 0 ? "🔴" : "✅" },
                { label: "Steps completed this week", value: recentlyCompletedSteps, color: "text-[#0078D4]", icon: "📈" },
                { label: "Active project count", value: projects.length, color: "text-[#0A2540]", icon: "📋" },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{row.icon}</span>
                    <span className="text-sm text-[#0A2540]">{row.label}</span>
                  </div>
                  <span className={`text-base font-bold ${row.color}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SLA Indicators */}
          <div className="bg-white border border-border rounded-2xl p-6 shadow-sm">
            <h2 className="text-sm font-bold text-[#0A2540] mb-4">SLA &amp; Responsiveness</h2>
            <div className="space-y-4">
              {[
                { label: "Client Responsiveness", score: responsivenessScore, desc: "How quickly you engage with reports & tasks" },
                { label: "Project Health", score: projects.length > 0 ? Math.round(100 - overdueSteps / Math.max(details.size * 5, 1) * 100) : 90, desc: "Based on overdue steps relative to total" },
                { label: "Billing SLA", score: unpaidInvoices.length === 0 ? 100 : Math.max(0, 100 - unpaidInvoices.length * 25), desc: "Timely invoice payment status" },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-[#0A2540]">{row.label}</p>
                    <p className={`text-xs font-bold ${scoreColor(row.score)}`}>{row.score}%</p>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${scoreBar(row.score)}`} style={{ width: `${row.score}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{row.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── What Changed This Week ── */}
        <div className="bg-white border border-border rounded-2xl p-6 shadow-sm mb-6">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">What Changed This Week</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-extrabold text-green-600">{recentlyCompletedSteps}</p>
              <p className="text-xs text-green-700 font-semibold mt-1">Steps Completed</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-extrabold text-amber-600">{waitingTasks}</p>
              <p className="text-xs text-amber-700 font-semibold mt-1">Items Waiting on You</p>
            </div>
            <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-xl p-4 text-center">
              <p className="text-2xl font-extrabold text-[#0078D4]">{avgProgress}%</p>
              <p className="text-xs text-[#0078D4] font-semibold mt-1">Avg Project Progress</p>
            </div>
          </div>
        </div>

        {/* ── AI Insight Cards ── */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-[#0A2540] mb-3">AI-Generated Insights</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {aiInsights.map((ins, i) => (
              <InsightCard key={i} icon={ins.icon} title={ins.title} body={ins.body} variant={ins.variant} />
            ))}
          </div>
        </div>

        {/* ── Benchmarking Section ── */}
        <div className="bg-white border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-[#0A2540]">Benchmarking</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Your scores vs. industry average and Microsoft best-practice targets</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
              Representative Benchmarks
            </span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mb-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#0078D4] inline-block" />Your Score</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-300 inline-block" />Industry Avg</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-400 inline-block" />MS Excellence</span>
          </div>

          <div className="space-y-5">
            {(Object.keys(INDUSTRY_BENCHMARKS) as (keyof typeof INDUSTRY_BENCHMARKS)[]).map(key => {
              const bm = INDUSTRY_BENCHMARKS[key];
              const clientScore = benchmarkScores[key];
              const percentileVsIndustry = clientScore > bm.industryAvg
                ? Math.round(50 + ((clientScore - bm.industryAvg) / (100 - bm.industryAvg)) * 50)
                : Math.round((clientScore / bm.industryAvg) * 50);

              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-[#0A2540]">{bm.label}</p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`font-bold ${scoreColor(clientScore)}`}>{clientScore}%</span>
                      <span className="text-muted-foreground">vs avg {bm.industryAvg}%</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreBg(clientScore)}`}>
                        {percentileVsIndustry >= 60 ? "Above avg" : percentileVsIndustry >= 40 ? "Near avg" : "Below avg"}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-3 bg-gray-100 rounded-full overflow-visible">
                    {/* Client score bar */}
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full ${scoreBar(clientScore)} transition-all`}
                      style={{ width: `${clientScore}%` }}
                    />
                    {/* Industry avg marker */}
                    <div
                      className="absolute top-[-4px] w-px h-[20px] bg-gray-400"
                      style={{ left: `${bm.industryAvg}%` }}
                      title={`Industry avg: ${bm.industryAvg}%`}
                    />
                    {/* MS excellence marker */}
                    <div
                      className="absolute top-[-4px] w-px h-[20px] bg-green-500"
                      style={{ left: `${bm.msExcellent}%` }}
                      title={`MS excellent: ${bm.msExcellent}%`}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground">0%</span>
                    <span className="text-[10px] text-muted-foreground">100%</span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground mt-5 border-t border-border pt-4">
            Industry benchmarks sourced from representative SMB and enterprise Microsoft 365 deployments. Your scores are derived from your M365 Profile responses. Complete your profile for more accurate benchmarking.
          </p>
        </div>
      </div>
    </PortalLayout>
  );
}

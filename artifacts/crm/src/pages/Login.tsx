import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useSearch } from "wouter";
import {
  BarChart2, Kanban, FileText, FileDown,
  CheckCircle2, CreditCard, MessageSquare, Loader2,
  Lock, ShieldCheck, Shield, Building2, ArrowRight, Star, Zap,
} from "lucide-react";

const FEATURES = [
  {
    icon: <BarChart2 className="w-5 h-5" />,
    label: "Project Progress Tracking",
    desc: "Real-time status on every active engagement — percentage complete, milestones, and next steps.",
  },
  {
    icon: <Kanban className="w-5 h-5" />,
    label: "Kanban Task Board",
    desc: "See what's in progress, what's queued, and what's done — updated live as work moves forward.",
  },
  {
    icon: <FileText className="w-5 h-5" />,
    label: "Weekly & Monthly Reports",
    desc: "Structured progress updates delivered to your portal automatically — no chasing for status.",
  },
  {
    icon: <FileDown className="w-5 h-5" />,
    label: "Secure Document Library",
    desc: "Assessments, deliverables, SOWs, and architecture diagrams — always available, always yours.",
  },
  {
    icon: <CheckCircle2 className="w-5 h-5" />,
    label: "Service & Package Status",
    desc: "Track every micro-offer and retainer engagement from purchase through to final delivery.",
  },
  {
    icon: <CreditCard className="w-5 h-5" />,
    label: "Invoice History & Payments",
    desc: "View every invoice, confirm payment status, and pay outstanding balances in seconds.",
  },
  {
    icon: <MessageSquare className="w-5 h-5" />,
    label: "Direct Consultant Messaging",
    desc: "Structured communication tied directly to your active projects — no lost email threads.",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    label: "Automated Milestone Alerts",
    desc: "Get notified when a phase completes, a document is uploaded, or action is required from you.",
  },
];

const TRUST_SIGNALS = [
  { icon: <Lock className="w-4 h-4" />,       label: "Encrypted in transit & at rest" },
  { icon: <ShieldCheck className="w-4 h-4" />, label: "MFA required on all accounts" },
  { icon: <Building2 className="w-4 h-4" />,   label: "Regulated-industry compliance — HIPAA, SOC 2, FINRA, CMMC, ITAR" },
  { icon: <Shield className="w-4 h-4" />,      label: "Zero Trust–aligned access controls" },
];

const COMPLIANCE_BADGES = ["HIPAA", "SOC 2", "FINRA", "CMMC", "ITAR", "Zero Trust"];

function DashboardMockup() {
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0d2e4e] shadow-2xl text-[10px] select-none">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0A2540] border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0078D4]" />
          <span className="text-white/60 font-medium tracking-wide text-[8px] uppercase">Command Center</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-[#0078D4]/40 border border-[#0078D4]/60 flex items-center justify-center">
            <span className="text-white text-[6px] font-bold">S</span>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "M365 Migration", pct: 68, color: "#0078D4" },
            { label: "Governance Audit", pct: 40, color: "#00B4D8" },
          ].map(({ label, pct, color }) => (
            <div key={label} className="bg-[#0A2540] rounded-lg px-2.5 py-2 border border-white/10">
              <p className="text-white/50 mb-1 text-[8px]">{label}</p>
              <p className="text-white font-bold text-sm">{pct}%</p>
              <div className="mt-1.5 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          ))}
        </div>

        {/* Kanban */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { col: "In Progress", items: ["Tenant config", "IAM review", "User pilot"], color: "#0078D4" },
            { col: "Done", items: ["Requirements", "Discovery", "Scoping"], color: "#00B4D8" },
          ].map(({ col, items, color }) => (
            <div key={col}>
              <div className="flex items-center gap-1 mb-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-white/40 text-[8px] font-semibold uppercase tracking-wide">{col}</span>
              </div>
              <div className="space-y-1">
                {items.map(item => (
                  <div key={item} className="bg-[#0A2540] border border-white/10 rounded px-2 py-1">
                    <span className="text-white/70">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Doc list */}
        <div className="bg-[#0A2540] rounded-lg border border-white/10 divide-y divide-white/5">
          {["M365 Assessment.pdf", "SOW-2024-001.pdf", "Governance Report.docx"].map(name => (
            <div key={name} className="flex items-center gap-2 px-2.5 py-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-[#0078D4]/30 flex-shrink-0" />
              <span className="text-white/60 truncate">{name}</span>
              <div className="ml-auto w-2.5 h-2.5 rounded text-white/20">↓</div>
            </div>
          ))}
        </div>

        {/* Bar chart stub */}
        <div className="bg-[#0A2540] rounded-lg border border-white/10 px-2.5 py-2">
          <p className="text-white/40 text-[8px] mb-2 uppercase tracking-wide font-semibold">Monthly Reports</p>
          <div className="flex items-end gap-1 h-8">
            {[30, 55, 40, 70, 50, 85, 60].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${h}%`,
                  backgroundColor: i === 5 ? "#0078D4" : "#0078D4" + "40",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"].map(m => (
              <span key={m} className="text-white/20 text-[6px]">{m}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function redirectAfterAuth(role: string, setLocation: (path: string) => void) {
  if (role === "client") {
    const returnTo = sessionStorage.getItem("onboardingReturnTo");
    if (returnTo) {
      sessionStorage.removeItem("onboardingReturnTo");
      setLocation(returnTo);
    } else {
      setLocation("/portal");
    }
  } else {
    setLocation("/dashboard");
  }
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [mode, setMode] = useState<"login" | "register" | "forgot">(
    new URLSearchParams(search).get("register") === "1" ? "register" : "login"
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const switchMode = (next: "login" | "register" | "forgot") => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirmPassword("");
    if (next !== "forgot") setForgotSent(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "forgot") {
      setLoading(true);
      try {
        await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setForgotSent(true);
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const user = await login(email, password);
        redirectAfterAuth(user.role, setLocation);
      } else {
        const user = await register(email, password, name.trim() || undefined);
        redirectAfterAuth(user.role, setLocation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "login" ? "Login failed" : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const isLogin = mode === "login";

  const scrollToLogin = () => {
    document.getElementById("login-form")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC]">

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] px-6 pt-10 pb-0 overflow-hidden">
        <div className="max-w-[1100px] mx-auto">

          {/* Nav bar */}
          <nav className="flex items-center justify-between mb-16">
            <a href="/" className="flex items-center gap-2.5 group w-fit">
              <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                </svg>
              </div>
              <span className="text-white font-bold text-base group-hover:text-white/80 transition-colors">Shane McCaw Consulting</span>
            </a>
            <button
              onClick={scrollToLogin}
              className="text-sm font-semibold px-5 py-2 rounded-lg border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
            >
              Sign In →
            </button>
          </nav>

          {/* Headline + trust badge */}
          <div className="text-center max-w-[780px] mx-auto mb-12">
            <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/30 rounded-full px-4 py-1.5 mb-6">
              <Star className="w-3.5 h-3.5 text-[#00B4D8]" />
              <span className="text-[#00B4D8] text-xs font-semibold tracking-wide">Built by Shane McCaw — Lead Microsoft 365 Architect for NASA</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-[1.08] mb-5 tracking-tight">
              The Customer<br />
              <span className="text-[#0078D4]">Command Center</span>
            </h1>
            <p className="text-white/60 text-lg md:text-xl leading-relaxed max-w-[620px] mx-auto mb-10">
              A secure, enterprise-grade portal giving you a 360° real-time view of your Microsoft 365 consulting engagement — from project progress to invoices to direct messaging.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={scrollToLogin}
                className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#005A9E] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors text-sm shadow-lg shadow-[#0078D4]/30"
              >
                Sign In to Your Portal
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => { switchMode("register"); scrollToLogin(); }}
                className="inline-flex items-center gap-2 border border-white/20 hover:border-white/40 hover:bg-white/5 text-white/80 hover:text-white font-semibold px-7 py-3.5 rounded-xl transition-colors text-sm"
              >
                Create Your Account
              </button>
            </div>
          </div>

          {/* Dashboard mockup — floats at the bottom of the hero */}
          <div className="max-w-[820px] mx-auto relative">
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A2540] via-transparent to-transparent z-10 pointer-events-none" style={{ top: "60%" }} />
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ── FEATURE GRID ─────────────────────────────────────────────────── */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-[0.15em] mb-3">Everything in one place</p>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] mb-4">Your complete engagement, at a glance</h2>
            <p className="text-muted-foreground max-w-[540px] mx-auto text-base leading-relaxed">
              No more chasing status updates over email. Every aspect of your consulting engagement lives in a single, secure portal.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {FEATURES.map(({ icon, label, desc }) => (
              <div key={label} className="bg-[#F7F9FC] border border-border rounded-2xl p-5 hover:border-[#0078D4]/30 hover:shadow-md transition-all duration-200 group">
                <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 border border-[#0078D4]/20 flex items-center justify-center text-[#0078D4] mb-4 group-hover:bg-[#0078D4]/15 transition-colors">
                  {icon}
                </div>
                <h3 className="text-sm font-bold text-[#0A2540] mb-1.5 leading-snug">{label}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DEEP DIVE: Project Progress ───────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20 px-6">
        <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-[0.15em] mb-3">Live engagement tracking</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4 leading-tight">Always know exactly where your project stands</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Every active engagement shows a real-time completion percentage, milestone timeline, and current phase — no more wondering what's happening or when you'll get the deliverable.
            </p>
            <ul className="space-y-3">
              {[
                "Phase-by-phase progress with visual indicators",
                "Milestone completion timestamps with next-step clarity",
                "Colour-coded status: on track, needs attention, complete",
                "Engagement summary always visible on your dashboard",
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-[#0A2540]">
                  <CheckCircle2 className="w-4 h-4 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          {/* Mockup */}
          <div className="bg-white border border-border rounded-2xl shadow-sm p-6 space-y-5 select-none">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Engagements</p>
            {[
              { label: "M365 Architecture & Strategy", pct: 68, phase: "Phase 3 — IAM Design", color: "#0078D4" },
              { label: "Copilot Readiness Assessment", pct: 100, phase: "Complete", color: "#00B4D8" },
              { label: "Governance Foundations", pct: 25, phase: "Phase 1 — Discovery", color: "#0078D4" },
              { label: "SharePoint Intranet Redesign", pct: 45, phase: "Phase 2 — Information Architecture", color: "#00B4D8" },
            ].map(({ label, pct, phase, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-[#0A2540] truncate pr-2">{label}</span>
                  <span className="text-sm font-bold flex-shrink-0" style={{ color }}>{pct}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <p className="text-[11px] text-muted-foreground">{phase}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DEEP DIVE: Kanban Workflow ────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20 px-6">
        <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 gap-12 items-center">
          {/* Mockup */}
          <div className="rounded-2xl bg-[#0d2e4e] border border-white/10 p-5 select-none">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-4">Task Board — M365 Migration</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { col: "To Do", items: ["Teams governance policy", "DLP rule review", "Pilot comms plan"], dot: "#6b7280" },
                { col: "In Progress", items: ["Tenant config", "IAM role assignment", "User pilot wave 1"], dot: "#0078D4" },
                { col: "Done", items: ["Requirements scoping", "Discovery workshop", "Stakeholder sign-off"], dot: "#00B4D8" },
              ].map(({ col, items, dot }) => (
                <div key={col}>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">{col}</span>
                  </div>
                  <div className="space-y-1.5">
                    {items.map(item => (
                      <div key={item} className="bg-[#0A2540] border border-white/10 rounded-lg px-2.5 py-2">
                        <span className="text-white/70 text-[9px] leading-snug">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Copy */}
          <div>
            <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-[0.15em] mb-3">Full task visibility</p>
            <h2 className="text-3xl font-extrabold text-white mb-4 leading-tight">See the work — not just the status</h2>
            <p className="text-white/60 leading-relaxed mb-6">
              Your portal exposes the same kanban board Shane uses internally. You'll see every task, which phase it's in, and what's completed — updated in real time as work progresses.
            </p>
            <ul className="space-y-3">
              {[
                "Three-column view: To Do, In Progress, Done",
                "Task-level granularity — not just high-level milestones",
                "Live updates as items move through the workflow",
                "Tied directly to your active engagement scope",
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-white/80">
                  <CheckCircle2 className="w-4 h-4 text-[#00B4D8] mt-0.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── DEEP DIVE: Documents & Reports ───────────────────────────────── */}
      <section className="bg-white py-20 px-6">
        <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <p className="text-[#0078D4] text-xs font-bold uppercase tracking-[0.15em] mb-3">Deliverables & reporting</p>
            <h2 className="text-3xl font-extrabold text-[#0A2540] mb-4 leading-tight">Your deliverables, always a click away</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Every assessment, SOW, architecture diagram, and governance document is securely stored in your portal. Monthly reports drop in automatically — no need to request them.
            </p>
            <ul className="space-y-3">
              {[
                "Secure document library with instant download",
                "SOWs, assessments, diagrams, and governance artefacts",
                "Automated monthly reports — delivered on schedule",
                "Full report history with month-by-month archive",
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-[#0A2540]">
                  <CheckCircle2 className="w-4 h-4 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          {/* Mockup */}
          <div className="space-y-4 select-none">
            {/* Document list */}
            <div className="bg-[#F7F9FC] border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Document Library</p>
              </div>
              <div className="divide-y divide-border">
                {[
                  { name: "M365 Tenant Assessment.pdf", size: "1.4 MB", date: "Jun 2025" },
                  { name: "SOW-2025-004 — Governance.pdf", size: "980 KB", date: "May 2025" },
                  { name: "IAM Architecture Diagram.vsdx", size: "2.1 MB", date: "Apr 2025" },
                  { name: "SharePoint IA Blueprint.docx", size: "540 KB", date: "Mar 2025" },
                ].map(({ name, size, date }) => (
                  <div key={name} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-7 h-7 rounded-md bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <FileDown className="w-3.5 h-3.5 text-[#0078D4]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#0A2540] truncate">{name}</p>
                      <p className="text-[10px] text-muted-foreground">{size} · {date}</p>
                    </div>
                    <span className="text-[10px] text-[#0078D4] font-semibold flex-shrink-0">↓</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Mini report chart */}
            <div className="bg-[#F7F9FC] border border-border rounded-2xl px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Monthly Reports</p>
              <div className="flex items-end gap-1.5 h-12">
                {[35, 55, 42, 68, 52, 80, 60].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all"
                    style={{ height: `${h}%`, backgroundColor: i === 5 ? "#0078D4" : "#0078D4" + "30" }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1.5">
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"].map(m => (
                  <span key={m} className="text-[9px] text-muted-foreground">{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DEEP DIVE: Billing & Messaging ───────────────────────────────── */}
      <section className="bg-[#0A2540] py-20 px-6">
        <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 gap-12 items-center">
          {/* Mockup */}
          <div className="space-y-4 select-none">
            {/* Invoice list */}
            <div className="bg-[#0d2e4e] border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Invoice History</p>
              </div>
              <div className="divide-y divide-white/5">
                {[
                  { ref: "INV-2025-006", desc: "Retainer — June 2025", amount: "$4,800", status: "Paid", badge: "bg-emerald-900/40 text-emerald-400" },
                  { ref: "INV-2025-005", desc: "Governance Foundations", amount: "$3,200", status: "Paid", badge: "bg-emerald-900/40 text-emerald-400" },
                  { ref: "INV-2025-004", desc: "Tenant Health Audit", amount: "$1,500", status: "Paid", badge: "bg-emerald-900/40 text-emerald-400" },
                  { ref: "INV-2025-007", desc: "Retainer — July 2025", amount: "$4,800", status: "Due Jul 1", badge: "bg-amber-900/40 text-amber-400" },
                ].map(({ ref, desc, amount, status, badge }) => (
                  <div key={ref} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/80 truncate">{desc}</p>
                      <p className="text-[10px] text-white/30">{ref}</p>
                    </div>
                    <span className="text-xs font-bold text-white">{amount}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>{status}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Message thread preview */}
            <div className="bg-[#0d2e4e] border border-white/10 rounded-2xl p-4 space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">Direct Messaging</p>
              {[
                { from: "Shane McCaw", msg: "IAM review completed — moving to Phase 4 pilot tomorrow.", align: "left" },
                { from: "You", msg: "Perfect. Can we schedule a call before the pilot starts?", align: "right" },
                { from: "Shane McCaw", msg: "Absolutely — I'll send a calendar invite for Thursday 10am.", align: "left" },
              ].map(({ from, msg, align }) => (
                <div key={msg} className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 ${align === "right" ? "bg-[#0078D4] text-white" : "bg-[#0A2540] border border-white/10 text-white/70"}`}>
                    <p className={`text-[9px] font-semibold mb-0.5 ${align === "right" ? "text-white/60" : "text-white/40"}`}>{from}</p>
                    <p className="text-[10px] leading-snug">{msg}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Copy */}
          <div>
            <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-[0.15em] mb-3">Billing & direct line</p>
            <h2 className="text-3xl font-extrabold text-white mb-4 leading-tight">Invoices and conversation in one place</h2>
            <p className="text-white/60 leading-relaxed mb-6">
              View your complete billing history, pay outstanding invoices, and communicate directly with Shane — all without leaving your portal. No more chasing emails or digging through inboxes.
            </p>
            <ul className="space-y-3">
              {[
                "Full invoice history with status indicators",
                "One-click online payment for outstanding balances",
                "Structured messaging tied to specific engagements",
                "Conversation history preserved for every project",
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-white/80">
                  <CheckCircle2 className="w-4 h-4 text-[#00B4D8] mt-0.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SECURITY & COMPLIANCE ────────────────────────────────────────── */}
      <section className="bg-[#06192e] py-20 px-6">
        <div className="max-w-[900px] mx-auto text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#0078D4]/20 border border-[#0078D4]/30 flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-6 h-6 text-[#00B4D8]" />
          </div>
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-[0.15em] mb-3">Enterprise-grade protection</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Security built for regulated industries</h2>
          <p className="text-white/50 max-w-[560px] mx-auto mb-10 leading-relaxed">
            The Customer Command Center is architected on the same security principles Shane applies to Microsoft 365 deployments at NASA — Zero Trust, MFA enforcement, end-to-end encryption, and compliance with the regulatory frameworks your industry demands.
          </p>

          {/* Trust signals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10 text-left">
            {TRUST_SIGNALS.map(({ icon, label }) => (
              <div key={label} className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3.5">
                <div className="w-8 h-8 rounded-lg bg-[#0078D4]/20 border border-[#0078D4]/30 flex items-center justify-center flex-shrink-0 text-[#00B4D8] mt-0.5">
                  {icon}
                </div>
                <span className="text-white/70 text-sm leading-snug pt-1.5">{label}</span>
              </div>
            ))}
          </div>

          {/* Compliance badges */}
          <p className="text-white/30 text-xs font-semibold uppercase tracking-wider mb-4">Compliance frameworks</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {COMPLIANCE_BADGES.map(badge => (
              <span key={badge} className="px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-white/60 text-xs font-bold tracking-wide">
                {badge}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BAND ─────────────────────────────────────────────────────── */}
      <section className="bg-[#0078D4] py-20 px-6">
        <div className="max-w-[700px] mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 leading-tight">
            Your portal is ready.<br />Sign in or create an account.
          </h2>
          <p className="text-white/70 text-lg mb-10 leading-relaxed">
            Existing clients can sign in immediately. New clients are provisioned automatically after their first engagement with Shane McCaw Consulting.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={scrollToLogin}
              className="inline-flex items-center gap-2 bg-white text-[#0078D4] font-bold px-8 py-3.5 rounded-xl hover:bg-white/90 transition-colors text-sm shadow-lg"
            >
              Sign In to Your Portal
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => { switchMode("register"); scrollToLogin(); }}
              className="inline-flex items-center gap-2 border border-white/30 hover:border-white/60 hover:bg-white/10 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors text-sm"
            >
              Create Your Account
            </button>
          </div>
        </div>
      </section>

      {/* ── LOGIN FORM ───────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-20 px-6" id="login-form">
        <div className="max-w-sm mx-auto">

          {/* Section intro */}
          <div className="text-center mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 border border-[#0078D4]/20 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-5 h-5 text-[#0078D4]" />
            </div>
            <h2 className="text-2xl font-extrabold text-[#0A2540] mb-1">
              {mode === "forgot"
                ? "Reset your password"
                : mode === "register"
                ? "Create your account"
                : "Sign in to your secure Customer Command Center portal"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {mode === "forgot"
                ? "Enter your email and we'll send you a reset link."
                : mode === "register"
                ? "Set up your client portal in seconds."
                : "Sign in with your email and password."}
            </p>
          </div>

          {/* ── Forgot-password panel ── */}
          {mode === "forgot" ? (
            <>
              <div className="bg-white border border-border rounded-2xl shadow-sm p-6">
                {forgotSent ? (
                  <div className="text-center py-2">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    </div>
                    <h3 className="font-bold text-[#0A2540] mb-1">Check your email</h3>
                    <p className="text-sm text-muted-foreground">
                      If an account exists for <span className="font-semibold text-[#0A2540]">{email}</span>, we've sent a reset link. It expires in 1 hour.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                        data-testid="input-forgot-email"
                      />
                    </div>

                    {error && (
                      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#0078D4] text-white font-semibold rounded-lg py-3 text-sm hover:bg-[#005A9E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      data-testid="button-send-reset"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending…
                        </>
                      ) : (
                        "Send reset link"
                      )}
                    </button>
                  </form>
                )}
              </div>

              <p className="text-center text-sm text-muted-foreground mt-5">
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-[#0078D4] hover:underline font-semibold"
                  data-testid="link-back-to-signin"
                >
                  ← Back to sign in
                </button>
              </p>
            </>
          ) : (
            <>
              {/* Email / Password form */}
              <div className="bg-white border border-border rounded-2xl shadow-sm p-6">
                <form onSubmit={handleSubmit} className="space-y-5">
                  {!isLogin && (
                    <div>
                      <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">
                        Full Name <span className="text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Jane Smith"
                        autoComplete="name"
                        className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                        data-testid="input-name"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                      data-testid="input-email"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-semibold text-[#0A2540]">Password</label>
                      {isLogin && (
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-xs text-[#0078D4] hover:underline font-medium"
                          data-testid="link-forgot-password"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                      data-testid="input-password"
                    />
                    {!isLogin && (
                      <p className="text-xs text-muted-foreground mt-1">Minimum 8 characters</p>
                    )}
                  </div>

                  {!isLogin && (
                    <div>
                      <label className="block text-sm font-semibold text-[#0A2540] mb-1.5">Confirm Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className="w-full border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-shadow"
                        data-testid="input-confirm-password"
                      />
                    </div>
                  )}

                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm" data-testid="login-error">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#0078D4] text-white font-semibold rounded-lg py-3 text-sm hover:bg-[#005A9E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    data-testid="button-login"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {isLogin ? "Signing in…" : "Creating account…"}
                      </>
                    ) : (
                      isLogin ? "Sign In to Your Portal" : "Create Account"
                    )}
                  </button>
                </form>
              </div>

              {/* Mode toggle */}
              <p className="text-center text-sm text-muted-foreground mt-5">
                {isLogin ? (
                  <>
                    Don't have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("register")}
                      className="text-[#0078D4] hover:underline font-semibold"
                      data-testid="link-create-account"
                    >
                      Create one
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("login")}
                      className="text-[#0078D4] hover:underline font-semibold"
                      data-testid="link-sign-in"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>

              {/* New client guidance — register mode only */}
              {!isLogin && (
                <p className="text-center text-xs text-muted-foreground mt-3">
                  New client? Your account is created automatically after your first engagement.
                </p>
              )}

              {/* Troubleshooting — login mode only */}
              {isLogin && (
                <div className="mt-4 bg-white border border-border rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-[#0A2540] mb-2">Having trouble signing in?</p>
                  <ul className="space-y-1.5">
                    {[
                      "Check your inbox for a portal invite email from Shane McCaw Consulting.",
                      "Reset your password using the \"Forgot password?\" link in the form above.",
                    ].map((tip) => (
                      <li key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="text-[#0078D4] font-bold mt-0.5 shrink-0">·</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Support contact trust bar */}
          <div className="mt-4 bg-white border border-border rounded-xl px-4 py-3 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#0078D4]" />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Need help accessing your portal?{" "}
              <a href="mailto:support@shanemccaw.com" className="text-[#0078D4] hover:underline font-medium">
                Contact support@shanemccaw.com
              </a>{" "}
              — Shane's team typically responds within one business day.
            </p>
          </div>

        </div>
      </section>

    </div>
  );
}

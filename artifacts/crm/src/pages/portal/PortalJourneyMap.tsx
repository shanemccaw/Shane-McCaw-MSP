import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Project {
  id: number;
  status: string;
  projectType: string;
}

interface Invoice {
  id: number;
  status: string;
  paidAt?: string | null;
}

interface AppReg {
  status?: string;
}

interface M365Data {
  orgName?: string;
}

interface Closure {
  signedAt?: string | null;
}

interface JourneyStage {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  link: string;
  linkLabel: string;
  status: "complete" | "active" | "upcoming";
  completedNote?: string;
  alwaysShowLink?: boolean;
}

// ── Icons (inline SVG) ───────────────────────────────────────────────────────

const CheckIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

// ── Stage status helpers ──────────────────────────────────────────────────────

function stageStatusClass(status: JourneyStage["status"]): string {
  switch (status) {
    case "complete": return "bg-green-500 text-white";
    case "active":   return "bg-[#0078D4] text-white shadow-lg shadow-[#0078D4]/30";
    case "upcoming": return "bg-gray-100 text-gray-400 border border-gray-200";
  }
}

function stageCardClass(status: JourneyStage["status"]): string {
  switch (status) {
    case "complete": return "border-green-200 bg-white";
    case "active":   return "border-[#0078D4] bg-white ring-2 ring-[#0078D4]/20";
    case "upcoming": return "border-border bg-white/60";
  }
}

function stageLabelClass(status: JourneyStage["status"]): string {
  switch (status) {
    case "complete": return "text-green-600";
    case "active":   return "text-[#0078D4]";
    case "upcoming": return "text-gray-400";
  }
}

function StatusPill({ status }: { status: JourneyStage["status"] }) {
  switch (status) {
    case "complete": return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700">
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
        Complete
      </span>
    );
    case "active": return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#0078D4]/10 text-[#0078D4] animate-pulse">
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg>
        Active
      </span>
    );
    case "upcoming": return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
        Upcoming
      </span>
    );
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PortalJourneyMap() {
  const { fetchWithAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [appReg, setAppReg] = useState<AppReg | null>(null);
  const [m365, setM365] = useState<M365Data>({});
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/projects").then(r => r.ok ? r.json() : []),
      fetchWithAuth("/api/portal/invoices").then(r => r.ok ? r.json() : []),
      fetchWithAuth("/api/portal/app-registration").then(r => r.ok ? r.json() : null),
      fetchWithAuth("/api/portal/m365-profile").then(r => r.ok ? r.json() : {}),
    ])
      .then(async ([ps, invs, ar, m365data]) => {
        setProjects(ps as Project[]);
        setInvoices(invs as Invoice[]);
        setAppReg(ar as AppReg | null);
        setM365(m365data as M365Data);
        // Fetch closures for all completed projects
        const completedIds = (ps as Project[]).filter(p => p.status === "completed").map(p => p.id);
        if (completedIds.length > 0) {
          const results = await Promise.all(
            completedIds.map(id =>
              fetchWithAuth(`/api/portal/projects/${id}/closure`).then(r => r.ok ? r.json() as Promise<Closure> : null)
            )
          );
          setClosures(results.filter((c): c is Closure => c !== null));
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const hasAnyProject = projects.length > 0;
  const hasActiveProject = projects.some(p => p.status === "active" || p.status === "in_progress");
  const hasClosedProject = projects.some(p => p.status === "completed");
  const hasSignedClosure = closures.some(c => !!c.signedAt);
  const hasPaidInvoice = invoices.some(i => i.status === "paid");
  const hasAnyInvoice = invoices.length > 0;
  const automationSetupDone = appReg?.status === "submitted" || appReg?.status === "verified";
  const hasRetainer = projects.some(p => p.projectType === "retainer");
  const m365Complete = !!(m365.orgName && m365.orgName.length > 0);

  const stages: JourneyStage[] = [
    {
      id: "services",
      label: "Active Services",
      description: "Your subscribed Microsoft 365 services and retainer packages are live and in use.",
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
      link: "/portal/services",
      linkLabel: "View Services",
      status: hasPaidInvoice ? "complete" : hasAnyProject ? "active" : "upcoming",
      completedNote: "Services active",
    },
    {
      id: "onboarding",
      label: "Onboarding",
      description: "Account setup, contract signing, M365 profile, and your first engagement kick-off with Shane.",
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
      link: "/portal/m365-profile",
      linkLabel: "View M365 Profile",
      status: m365Complete ? "complete" : "active",
      completedNote: "M365 profile submitted",
    },
    {
      id: "automation",
      label: "Automation Setup",
      description: "Azure tenant connected, PowerShell runbooks authorised, and automation scripts running on your environment.",
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
      link: "/portal/automation-setup",
      linkLabel: "Set Up Automation",
      status: automationSetupDone ? "complete" : "upcoming",
      completedNote: "Azure credentials verified",
      alwaysShowLink: true,
    },
    {
      id: "projects",
      label: "Active Projects",
      description: "Your consulting projects are underway — tracking milestones, workflow steps, and deliverables.",
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
      link: "/portal/projects",
      linkLabel: "View Projects",
      status: !automationSetupDone ? "upcoming" : hasActiveProject ? "active" : hasClosedProject ? "complete" : hasAnyProject ? "active" : "upcoming",
      completedNote: "Projects in flight",
    },
    {
      id: "closeout",
      label: "Project Close Out",
      description: "Deliverables signed off, handover documentation complete, and outcomes reviewed with Shane.",
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>,
      link: "/portal/projects",
      linkLabel: "View Projects",
      status: hasSignedClosure ? "complete" : hasClosedProject ? "active" : "upcoming",
      completedNote: "Customer sign-off received",
    },
    {
      id: "followup",
      label: "Follow Up / Quick Win",
      description: "Engagement review, new quick-win opportunities, and planning for the next phase of your Microsoft 365 journey.",
      icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
      link: "/portal/book-meeting",
      linkLabel: "Book a Call",
      status: hasRetainer ? "active" : "upcoming",
    },
  ];

  const completedCount = stages.filter(s => s.status === "complete").length;
  const totalCount = stages.length;
  const overallProgress = Math.round((completedCount / totalCount) * 100);

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-[#0A2540]">Your Journey Map</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your full engagement lifecycle from onboarding through to renewal</p>
        </div>

        {/* Overall Progress */}
        <div className="bg-gradient-to-br from-[#0A2540] to-[#0A2540]/90 rounded-2xl p-6 text-white mb-8 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1">Engagement Progress</p>
              <p className="text-3xl font-extrabold">{overallProgress}%</p>
              <p className="text-white/70 text-sm mt-1">{completedCount} of {totalCount} stages complete</p>
            </div>
            <div className="flex-1 max-w-xs">
              <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#0078D4] to-[#00B4D8] transition-all"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[10px] text-white/50">
                <span>Active Services</span>
                <span>Follow Up</span>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Desktop: horizontal connector row */}
            <div className="hidden lg:flex items-start gap-0 mb-8 overflow-x-auto pb-2">
              {stages.map((stage, i) => (
                <div key={stage.id} className="flex items-center flex-shrink-0">
                  <div className="flex flex-col items-center w-20">
                    {/* Circle */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${stageStatusClass(stage.status)}`}>
                      {stage.status === "complete" ? <CheckIcon /> : stage.icon}
                    </div>
                    {/* Label */}
                    <p className={`text-[10px] font-bold text-center mt-2 leading-tight ${stageLabelClass(stage.status)}`}>{stage.label}</p>
                  </div>
                  {/* Connector */}
                  {i < stages.length - 1 && (
                    <div className={`h-0.5 w-8 flex-shrink-0 mx-1 ${stage.status === "complete" ? "bg-green-400" : "bg-gray-200"}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Stage Cards (all viewports) */}
            <div className="space-y-4">
              {stages.map((stage, i) => (
                <div key={stage.id} className={`border rounded-2xl p-5 shadow-sm transition-all ${stageCardClass(stage.status)}`}>
                  <div className="flex items-start gap-4">
                    {/* Stage number + icon */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${stageStatusClass(stage.status)}`}>
                        {stage.status === "complete" ? <CheckIcon /> : stage.icon}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-semibold">Step {i + 1}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                        <div>
                          <h3 className={`text-sm font-bold ${stage.status === "upcoming" ? "text-gray-400" : "text-[#0A2540]"}`}>{stage.label}</h3>
                          {stage.status === "complete" && stage.completedNote && (
                            <p className="text-[10px] text-green-600 font-semibold mt-0.5">✓ {stage.completedNote}</p>
                          )}
                        </div>
                        <StatusPill status={stage.status} />
                      </div>
                      <p className={`text-xs leading-relaxed mb-3 ${stage.status === "upcoming" ? "text-gray-400" : "text-muted-foreground"}`}>
                        {stage.description}
                      </p>
                      {(stage.status !== "upcoming" || stage.alwaysShowLink) && (
                        <Link href={stage.link}>
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                            stage.status === "complete"
                              ? "text-green-600 hover:text-green-700"
                              : "text-[#0078D4] hover:text-[#0078D4]/80"
                          }`}>
                            {stage.linkLabel}
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </span>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <p className="text-xs text-muted-foreground text-center mt-8">
              Your journey map is updated automatically as you complete stages. Stages are determined from your project, billing, and automation data.
            </p>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

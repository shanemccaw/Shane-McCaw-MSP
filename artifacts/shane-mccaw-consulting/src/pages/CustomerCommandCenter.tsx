import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { SEOMeta } from "@/components/SEOMeta";
import {
  LayoutDashboard, FolderKanban, FileText, BarChart2, FileSignature,
  CreditCard, MessageSquare, Activity, ShoppingBag, CheckCircle,
  ChevronRight, ArrowRight, Clock, AlertCircle, Paperclip, Send,
  TrendingUp, Star, Download, Eye, Plus,
} from "lucide-react";

const PHASES = [
  { name: "Discovery & Kickoff Call", desc: "Align on goals, access, and project scope in a live session with Shane." },
  { name: "Environment Assessment", desc: "Shane audits your M365 tenant — configuration, security posture, and gaps." },
  { name: "Findings & Gap Analysis", desc: "A structured report mapping every issue found to business risk and priority." },
  { name: "Recommendations Review", desc: "A live walkthrough of the findings deck with time for questions and decisions." },
  { name: "Implementation & Delivery", desc: "Shane executes the agreed remediation, build, or configuration work." },
  { name: "Handoff & Documentation", desc: "You receive full documentation, recorded walkthroughs, and a transition guide." },
];

const KANBAN_COLUMNS = [
  {
    label: "Backlog",
    color: "bg-slate-100 border-slate-200",
    dotColor: "bg-slate-400",
    cards: [
      { title: "Configure sensitivity labels for regulated data", tag: "Governance" },
      { title: "Enable audit log retention policy", tag: "Compliance" },
    ],
  },
  {
    label: "In Progress",
    color: "bg-blue-50 border-[#0078D4]/30",
    dotColor: "bg-[#0078D4]",
    cards: [
      { title: "Deploy Conditional Access baseline policies", tag: "Security" },
      { title: "Migrate distribution lists to M365 Groups", tag: "Migration" },
    ],
  },
  {
    label: "Waiting on You",
    color: "bg-amber-50 border-amber-200",
    dotColor: "bg-amber-400",
    cards: [
      { title: "Review SharePoint permission audit findings", tag: "Governance" },
    ],
  },
  {
    label: "Completed",
    color: "bg-emerald-50 border-emerald-200",
    dotColor: "bg-emerald-500",
    cards: [
      { title: "Establish Teams channel naming convention", tag: "Governance" },
      { title: "Enable MFA for all admin accounts", tag: "Security" },
    ],
  },
];

const DOCUMENTS = [
  { name: "M365 Tenant Health Audit — Acme Corp.pdf", size: "2.4 MB", date: "Jun 18, 2026", type: "pdf" },
  { name: "Governance Policy Framework v2.docx", size: "890 KB", date: "Jun 15, 2026", type: "doc" },
  { name: "Copilot Readiness Assessment — Final.pdf", size: "1.1 MB", date: "Jun 10, 2026", type: "pdf" },
  { name: "SharePoint Architecture Diagram.pptx", size: "3.7 MB", date: "Jun 05, 2026", type: "ppt" },
];

const STATUS_REPORTS = [
  {
    period: "Week of June 16, 2026",
    summary: "Completed the Conditional Access baseline rollout. Identified 12 over-permissioned SharePoint sites — remediation plan shared for client review.",
    health: "On Track",
    healthColor: "text-emerald-700 bg-emerald-100",
    completedItems: ["Conditional Access baseline deployed", "SharePoint oversharing audit complete"],
    nextItems: ["Client review of remediation plan", "Sensitivity label pilot launch"],
  },
  {
    period: "Week of June 9, 2026",
    summary: "Environment assessment concluded. Findings deck drafted and scheduled for review call on June 12.",
    health: "On Track",
    healthColor: "text-emerald-700 bg-emerald-100",
    completedItems: ["Full tenant health audit complete", "Gap analysis report drafted"],
    nextItems: ["Recommendations review call", "Kick off implementation phase"],
  },
];

const CONTRACTS = [
  { name: "Fractional Architect Retainer — June 2026", status: "Active", statusColor: "text-emerald-700 bg-emerald-100", date: "Jun 1, 2026", amount: "$3,500/mo" },
  { name: "M365 Tenant Health Audit — Statement of Work", status: "Signed", statusColor: "text-[#0078D4] bg-[#0078D4]/10", date: "May 15, 2026", amount: "$4,200" },
  { name: "Governance Foundations Package — SOW", status: "Signed", statusColor: "text-[#0078D4] bg-[#0078D4]/10", date: "Apr 28, 2026", amount: "$6,500" },
];

const INVOICES = [
  { label: "Retainer — June 2026", amount: "$3,500.00", date: "Jun 1, 2026", status: "Paid", statusColor: "text-emerald-700 bg-emerald-100" },
  { label: "Retainer — May 2026", amount: "$3,500.00", date: "May 1, 2026", status: "Paid", statusColor: "text-emerald-700 bg-emerald-100" },
  { label: "Governance Foundations Package", amount: "$6,500.00", date: "May 3, 2026", status: "Paid", statusColor: "text-emerald-700 bg-emerald-100" },
  { label: "M365 Tenant Health Audit", amount: "$4,200.00", date: "Apr 30, 2026", status: "Outstanding", statusColor: "text-amber-700 bg-amber-100" },
];

const MESSAGES = [
  { from: "Shane McCaw", initials: "SM", time: "Today 9:14 AM", isShane: true, body: "Governance audit is complete — I've uploaded the findings PDF. The top priority items are the three over-sharing SharePoint sites. I'd suggest we discuss before I start remediation so you can flag any exceptions." },
  { from: "You", initials: "YO", time: "Today 9:41 AM", isShane: false, body: "Thanks Shane — reviewed the report. Happy to proceed with the top 3. Can we schedule a 30-minute call this week?" },
  { from: "Shane McCaw", initials: "SM", time: "Today 9:55 AM", isShane: true, body: "Absolutely. I've added a booking link to your portal dashboard. Thursday 2PM ET works well if that suits you." },
];

const ACTIVITY = [
  { icon: FileText, color: "text-[#0078D4] bg-[#0078D4]/10", label: "Shane uploaded", detail: "M365 Tenant Health Audit — Acme Corp.pdf", time: "2 hours ago" },
  { icon: CheckCircle, color: "text-emerald-700 bg-emerald-100", label: "Task completed", detail: "Conditional Access baseline deployed", time: "Yesterday" },
  { icon: MessageSquare, color: "text-[#00B4D8] bg-[#00B4D8]/10", label: "New message from Shane", detail: "Governance audit notes & next steps", time: "Yesterday" },
  { icon: FileSignature, color: "text-purple-700 bg-purple-100", label: "Contract signed", detail: "Fractional Architect Retainer — June 2026", time: "Jun 1, 2026" },
  { icon: CreditCard, color: "text-emerald-700 bg-emerald-100", label: "Payment received", detail: "Retainer — May 2026 · $3,500.00", time: "May 1, 2026" },
];

const MARKETPLACE_SERVICES = [
  { name: "M365 Tenant Health Audit", price: "$4,200", tag: "Quick Win", tagColor: "text-emerald-700 bg-emerald-100", desc: "A comprehensive audit of your tenant health, security posture, and governance gaps — delivered in 5 days." },
  { name: "Copilot Readiness Assessment", price: "$3,500", tag: "Quick Win", tagColor: "text-emerald-700 bg-emerald-100", desc: "Evaluate whether your M365 environment is safe and ready for Copilot deployment." },
  { name: "Governance Foundations Package", price: "$7,500", tag: "Core", tagColor: "text-[#0078D4] bg-[#0078D4]/10", desc: "Establish the policies, labeling, and controls that form the backbone of a compliant tenant." },
  { name: "Architect Essentials Retainer", price: "$3,500/mo", tag: "Retainer", tagColor: "text-purple-700 bg-purple-100", desc: "10 hours of senior M365 architecture per month — direct access to Shane, no handoffs." },
];

function SectionHeader({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="text-center mb-14">
      <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">{eyebrow}</p>
      <h2 className="text-3xl md:text-4xl font-extrabold text-[#0A2540] leading-tight">{title}</h2>
      {desc && <p className="text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">{desc}</p>}
    </div>
  );
}

function FeatureTag({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-border rounded-xl px-5 py-3 shadow-sm">
      <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-[#0078D4]" />
      </div>
      <span className="text-sm font-semibold text-[#0A2540]">{label}</span>
    </div>
  );
}

export default function CustomerCommandCenter() {
  return (
    <Layout>
      <SEOMeta
        title="Customer Command Center — Client Portal | Shane McCaw Consulting"
        description="See exactly what you get as a Shane McCaw Consulting client — a full-featured project portal with dashboards, Kanban boards, secure document sharing, billing, messaging, and more."
      />

      {/* HERO */}
      <section className="relative bg-[#0A2540] pt-[172px] pb-24 overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(#0078D4 1px, transparent 1px), linear-gradient(90deg, #0078D4 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: "radial-gradient(ellipse 70% 60% at 50% 40%, #0078D4, transparent)" }}
        />
        <div className="relative z-10 max-w-[1100px] mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/15 border border-[#0078D4]/40 rounded-full px-5 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#00B4D8] animate-pulse" />
            <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.1em]">Included with Every Engagement</p>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold text-white leading-[1.1] mb-6 max-w-4xl mx-auto">
            Your Customer Command Center
          </h1>
          <p className="text-lg md:text-xl text-white/75 max-w-3xl mx-auto mb-10 leading-relaxed">
            Every client gets a private project portal from day one — purpose-built for professional M365 engagements. Track progress, share documents, review reports, sign contracts, manage invoices, and message Shane directly. No spreadsheets, no email chains. One place for everything.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="#dashboard-overview"
              className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-semibold text-base px-8 py-4 rounded hover:bg-[#005A9E] transition-colors"
            >
              See How It Works <ChevronRight className="w-4 h-4" />
            </a>
            <CTAButton href="/book" className="text-base px-8 py-4 bg-white/10 border border-white/30 hover:bg-white/20 text-white">
              Start a Project
            </CTAButton>
          </div>
          <div className="mt-14 pt-10 border-t border-white/10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/50 text-sm font-medium">
            {["Live progress tracking", "Secure document vault", "In-portal messaging", "E-signature contracts", "Stripe billing"].map((item, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0" />
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#F7F9FC] to-transparent" />
      </section>

      {/* DASHBOARD OVERVIEW */}
      <section id="dashboard-overview" className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Dashboard"
            title="Everything at a Glance"
            desc="Your portal opens to a clean summary dashboard — active project status, recent activity, outstanding invoices, and quick links to every section."
          />
          <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            {/* Fake portal chrome */}
            <div className="bg-[#0A2540] px-6 py-4 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-400/70" />
                <div className="w-3 h-3 rounded-full bg-green-400/70" />
              </div>
              <div className="flex-1 bg-white/10 rounded px-4 py-1 text-white/50 text-xs font-mono">portal.shanemccaw.com</div>
            </div>
            <div className="p-6 md:p-8">
              <div className="mb-6">
                <h3 className="text-lg font-extrabold text-[#0A2540] mb-1">Good morning, Alex.</h3>
                <p className="text-muted-foreground text-sm">Your M365 Governance Retainer is <span className="font-semibold text-emerald-600">active</span> · Week 3 of implementation phase.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { label: "Active Projects", value: "1", icon: FolderKanban, color: "text-[#0078D4]" },
                  { label: "Open Tasks", value: "7", icon: CheckCircle, color: "text-amber-500" },
                  { label: "Documents", value: "14", icon: FileText, color: "text-[#00B4D8]" },
                  { label: "Outstanding", value: "$4,200", icon: CreditCard, color: "text-purple-500" },
                ].map((stat, i) => {
                  const Icon = stat.icon;
                  return (
                    <div key={i} className="bg-[#F7F9FC] border border-border rounded-xl p-4 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-white border border-border flex items-center justify-center flex-shrink-0">
                        <Icon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                      <div>
                        <p className="text-xl font-extrabold text-[#0A2540] leading-none">{stat.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Project Health</p>
                  <div className="space-y-2.5">
                    {[
                      { label: "Scope", status: "On Track", color: "bg-emerald-500" },
                      { label: "Timeline", status: "On Track", color: "bg-emerald-500" },
                      { label: "Budget", status: "On Track", color: "bg-emerald-500" },
                      { label: "Client Actions", status: "1 Pending", color: "bg-amber-400" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-[#0A2540] font-medium">{item.label}</span>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${item.color}`} />
                          <span className="text-muted-foreground">{item.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Recent Activity</p>
                  <div className="space-y-2.5">
                    {ACTIVITY.slice(0, 3).map((a, i) => {
                      const Icon = a.icon;
                      return (
                        <div key={i} className="flex items-start gap-3 text-sm">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${a.color}`}>
                            <Icon className="w-3 h-3" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[#0A2540] font-medium truncate">{a.detail}</p>
                            <p className="text-muted-foreground text-xs">{a.time}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROJECT LIFECYCLE */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Project Lifecycle"
            title="See Exactly Where You Are"
            desc="Every project moves through six clearly defined phases. Your portal shows the current phase in real time — so you always know what's happening and what comes next."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {PHASES.map((phase, i) => (
              <div
                key={i}
                className={`rounded-xl border p-6 flex flex-col gap-3 relative ${i === 4 ? "bg-[#0A2540] border-[#0078D4]/50" : "bg-[#F7F9FC] border-border"}`}
              >
                {i === 4 && (
                  <div className="absolute -top-3 left-4">
                    <span className="bg-[#0078D4] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">Current Phase</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-extrabold border-2 ${i < 4 ? "border-emerald-400 bg-emerald-50 text-emerald-700" : i === 4 ? "border-[#0078D4] bg-white/10 text-white" : "border-border bg-white text-muted-foreground"}`}>
                    {i < 4 ? <CheckCircle className="w-4 h-4" /> : i + 1}
                  </div>
                  <h3 className={`font-bold text-sm leading-snug ${i === 4 ? "text-white" : "text-[#0A2540]"}`}>{phase.name}</h3>
                </div>
                <p className={`text-sm leading-relaxed pl-11 ${i === 4 ? "text-white/70" : "text-muted-foreground"}`}>{phase.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* KANBAN BOARD */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Task Board"
            title="Your Kanban Board"
            desc="Every task Shane is working on — and every action waiting for you — is tracked on a shared Kanban board. Full visibility, zero guesswork."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {KANBAN_COLUMNS.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-3">
                <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${col.color}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${col.dotColor}`} />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#0A2540]">{col.label}</span>
                  <span className="ml-auto text-xs font-semibold text-muted-foreground">{col.cards.length}</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {col.cards.map((card, ki) => (
                    <div key={ki} className="bg-white border border-border rounded-lg p-4 shadow-sm">
                      <p className="text-sm font-medium text-[#0A2540] leading-snug mb-2">{card.title}</p>
                      <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-[#0078D4] bg-[#0078D4]/8 border border-[#0078D4]/20 px-2 py-0.5 rounded-full">
                        {card.tag}
                      </span>
                    </div>
                  ))}
                  {col.cards.length === 0 && (
                    <div className="border-2 border-dashed border-border rounded-lg p-4 text-center text-xs text-muted-foreground">Empty</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DOCUMENTS */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Document Vault"
            title="Secure Document Sharing"
            desc="All deliverables, audit reports, architecture diagrams, and reference materials are stored in your private document vault. Download anytime. No expiring links."
          />
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#F7F9FC] border border-border rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <p className="font-semibold text-[#0A2540]">Project Documents</p>
                <span className="text-xs text-muted-foreground">{DOCUMENTS.length} files</span>
              </div>
              <div className="divide-y divide-border">
                {DOCUMENTS.map((doc, i) => (
                  <div key={i} className="px-6 py-4 flex items-center gap-4 hover:bg-white/70 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-[#0078D4]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0A2540] truncate">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">{doc.size} · {doc.date}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-[#0078D4] hover:border-[#0078D4]/30 transition-colors">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-[#0078D4] hover:border-[#0078D4]/30 transition-colors">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-border">
                <button className="inline-flex items-center gap-2 text-sm text-[#0078D4] font-semibold hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Upload a document
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATUS REPORTS */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Status Reports"
            title="Weekly Progress Reports"
            desc="Every week, Shane posts a written project update to your portal — what was completed, what's next, and any items waiting on you. Always in writing, always on record."
          />
          <div className="max-w-3xl mx-auto space-y-5">
            {STATUS_REPORTS.map((report, i) => (
              <div key={i} className="bg-white border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{report.period}</p>
                    <p className="text-sm leading-relaxed text-foreground">{report.summary}</p>
                  </div>
                  <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0 ${report.healthColor}`}>{report.health}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Completed</p>
                    <ul className="space-y-1.5">
                      {report.completedItems.map((item, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-foreground">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Up Next</p>
                    <ul className="space-y-1.5">
                      {report.nextItems.map((item, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-foreground">
                          <ArrowRight className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTRACTS */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Contracts"
            title="E-Sign Right in the Portal"
            desc="Statements of work and retainer agreements are sent for signature inside your portal. No third-party tools to log into — sign with one click, and your signed copies are stored here forever."
          />
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#F7F9FC] border border-border rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border">
                <p className="font-semibold text-[#0A2540]">Your Agreements</p>
              </div>
              <div className="divide-y divide-border">
                {CONTRACTS.map((contract, i) => (
                  <div key={i} className="px-6 py-4 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <FileSignature className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0A2540] truncate">{contract.name}</p>
                      <p className="text-xs text-muted-foreground">{contract.date} · {contract.amount}</p>
                    </div>
                    <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0 ${contract.statusColor}`}>
                      {contract.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BILLING */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Billing"
            title="Invoices & Payment History"
            desc="View all invoices, pay outstanding balances with a card, and download receipts — all from one billing screen. Your full payment history is always available."
          />
          <div className="max-w-3xl mx-auto">
            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <p className="font-semibold text-[#0A2540]">Invoices</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  1 outstanding
                </div>
              </div>
              <div className="divide-y divide-border">
                {INVOICES.map((inv, i) => (
                  <div key={i} className="px-6 py-4 flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-4 h-4 text-[#0078D4]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0A2540] truncate">{inv.label}</p>
                      <p className="text-xs text-muted-foreground">{inv.date}</p>
                    </div>
                    <p className="text-sm font-extrabold text-[#0A2540] flex-shrink-0">{inv.amount}</p>
                    <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0 ${inv.statusColor}`}>
                      {inv.status}
                    </span>
                    {inv.status === "Outstanding" && (
                      <button className="flex-shrink-0 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded hover:bg-[#005A9E] transition-colors">
                        Pay Now
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MESSAGING */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Messaging"
            title="Message Shane Directly"
            desc="All project communication lives in the portal — not in scattered email threads. Ask questions, respond to Shane's updates, and keep a clean paper trail for every engagement."
          />
          <div className="max-w-2xl mx-auto">
            <div className="bg-[#F7F9FC] border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-border flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">SM</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0A2540]">Shane McCaw</p>
                  <p className="text-xs text-emerald-600 font-medium flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> Online</p>
                </div>
              </div>
              <div className="p-6 space-y-4 max-h-80 overflow-y-auto">
                {MESSAGES.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.isShane ? "" : "flex-row-reverse"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${msg.isShane ? "bg-[#0078D4] text-white" : "bg-[#0A2540] text-white"}`}>
                      {msg.initials}
                    </div>
                    <div className={`max-w-[75%] ${msg.isShane ? "" : "items-end"}`}>
                      <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.isShane ? "bg-white border border-border text-foreground rounded-tl-sm" : "bg-[#0078D4] text-white rounded-tr-sm"}`}>
                        {msg.body}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 px-1">{msg.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-border flex items-center gap-3">
                <div className="flex-1 bg-white border border-border rounded-lg px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
                  <span>Type a message…</span>
                </div>
                <button className="w-9 h-9 rounded-lg bg-[#0078D4] flex items-center justify-center hover:bg-[#005A9E] transition-colors flex-shrink-0">
                  <Send className="w-4 h-4 text-white" />
                </button>
                <button className="w-9 h-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-[#0078D4] transition-colors flex-shrink-0">
                  <Paperclip className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ACTIVITY FEED */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Activity Feed"
            title="A Complete Audit Trail"
            desc="Every upload, message, payment, signature, and task update is logged chronologically. You always know exactly what happened and when."
          />
          <div className="max-w-2xl mx-auto">
            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm divide-y divide-border">
              {ACTIVITY.map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="px-6 py-4 flex items-start gap-4">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${item.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{item.label}</p>
                      <p className="text-sm font-medium text-[#0A2540]">{item.detail}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {item.time}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES MARKETPLACE */}
      <section className="bg-white py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <SectionHeader
            eyebrow="Services Marketplace"
            title="Add More Services When You're Ready"
            desc="As your engagement grows, you can browse and activate additional services directly from your portal — no sales call required. Pick a package, confirm the scope, and Shane gets to work."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {MARKETPLACE_SERVICES.map((svc, i) => (
              <div key={i} className="bg-[#F7F9FC] border border-border rounded-xl p-6 flex flex-col gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className="flex items-start justify-between">
                  <div className="w-9 h-9 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <ShoppingBag className="w-4 h-4 text-[#0078D4]" />
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${svc.tagColor}`}>{svc.tag}</span>
                </div>
                <div>
                  <p className="text-[#0078D4] text-lg font-extrabold">{svc.price}</p>
                  <h3 className="font-bold text-[#0A2540] text-sm leading-snug mt-0.5">{svc.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">{svc.desc}</p>
                <button className="w-full text-sm font-semibold border border-[#0078D4] text-[#0078D4] rounded py-2 hover:bg-[#0078D4] hover:text-white transition-colors mt-auto">
                  Add to Portal
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURE SUMMARY */}
      <section className="bg-[#F7F9FC] py-16 border-y border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-8">Everything included from day one</p>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { icon: LayoutDashboard, label: "Live Dashboard" },
              { icon: TrendingUp, label: "Phase Tracking" },
              { icon: FolderKanban, label: "Kanban Board" },
              { icon: FileText, label: "Document Vault" },
              { icon: BarChart2, label: "Status Reports" },
              { icon: FileSignature, label: "E-Signature" },
              { icon: CreditCard, label: "Billing & Invoices" },
              { icon: MessageSquare, label: "Direct Messaging" },
              { icon: Activity, label: "Activity Feed" },
              { icon: ShoppingBag, label: "Services Marketplace" },
              { icon: Star, label: "NPS Surveys" },
              { icon: CheckCircle, label: "Secure by Design" },
            ].map((feat, i) => (
              <FeatureTag key={i} icon={feat.icon} label={feat.label} />
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-[#0A2540] py-24">
        <div className="max-w-[800px] mx-auto px-6 text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.15em] mb-5">Ready to Get Started?</p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-6">
            Your Command Center Opens the Day We Start.
          </h2>
          <p className="text-white/70 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Every engagement — from a one-time audit to an ongoing retainer — includes full access to the portal from day one. Book a consultation to discuss scope, and your portal will be ready before the kickoff call.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <CTAButton href="/book" className="text-base px-10 py-4 shadow-lg shadow-[#0078D4]/30">
              Book a Consultation
            </CTAButton>
            <a
              href="/pricing"
              className="inline-flex items-center gap-2 text-white/80 font-semibold text-base hover:text-white transition-colors"
            >
              View Pricing <ArrowRight className="w-4 h-4" />
            </a>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/40 text-sm">
            {["No pitch, no obligation", "Direct access to Shane", "Portal ready at kickoff"].map((item, i) => (
              <span key={i} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#0078D4]" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}

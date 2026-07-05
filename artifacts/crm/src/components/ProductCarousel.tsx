import { useState, useEffect } from "react";
import {
  ShieldCheck, BarChart3, FileText, Layers, Zap,
  CheckCircle2, AlertTriangle, Clock, TrendingUp, Users,
} from "lucide-react";

interface SlideProps {
  visible: boolean;
}

function DashboardSlide({ visible }: SlideProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col gap-3 p-5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 500ms ease" }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "#0078D4" }} />
          <span className="text-xs font-bold text-white/70 uppercase tracking-widest">M365 Dashboard</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-white/40">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Secure Score", value: "84%", color: "#22c55e", icon: ShieldCheck },
          { label: "Copilot Ready", value: "91%", color: "#0078D4", icon: Zap },
          { label: "Compliance", value: "88%", color: "#00B4D8", icon: CheckCircle2 },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
            <Icon className="w-3.5 h-3.5 mb-2" style={{ color }} />
            <div className="text-base font-black text-white leading-none mb-0.5">{value}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40">{label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-3 flex-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="text-[9px] font-bold uppercase tracking-widest text-white/35 mb-2">Weekly Trend</div>
        <div className="flex items-end gap-1 h-12">
          {[55, 62, 58, 70, 68, 78, 84].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: `rgba(0,120,212,${0.3 + i * 0.1})` }} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,180,216,0.08)", border: "1px solid rgba(0,180,216,0.18)" }}>
        <TrendingUp className="w-3 h-3 text-[#00B4D8] flex-shrink-0" />
        <span className="text-[10px] text-white/55">Secure Score up +7 pts this week</span>
      </div>
    </div>
  );
}

function ProjectBoardSlide({ visible }: SlideProps) {
  const columns = [
    { label: "Planned", color: "#6b7280", cards: ["Identity Review", "M365 Audit"] },
    { label: "In Progress", color: "#0078D4", cards: ["Copilot Deploy", "DLP Policies"] },
    { label: "Done", color: "#22c55e", cards: ["MFA Rollout", "Intune Setup"] },
  ];

  return (
    <div
      className="absolute inset-0 flex flex-col gap-3 p-5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 500ms ease" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Layers className="w-4 h-4" style={{ color: "#00B4D8" }} />
        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Project Board</span>
      </div>

      <div className="grid grid-cols-3 gap-2 flex-1">
        {columns.map(({ label, color, cards }) => (
          <div key={label} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.40)" }}>{label}</span>
            </div>
            {cards.map(c => (
              <div key={c} className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] font-semibold text-white/70 leading-snug">{c}</div>
                <div className="mt-1.5 flex gap-1">
                  <div className="h-1 rounded-full flex-1" style={{ background: color, opacity: 0.5 }} />
                  <div className="h-1 rounded-full w-3" style={{ background: "rgba(255,255,255,0.1)" }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Users className="w-3 h-3 text-white/30" />
        <span className="text-[10px] text-white/35">6 tasks active across 3 workstreams</span>
      </div>
    </div>
  );
}

function SowGeneratorSlide({ visible }: SlideProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col gap-3 p-5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 500ms ease" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-4 h-4" style={{ color: "#0078D4" }} />
        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">SOW Generator</span>
      </div>

      <div className="rounded-xl p-3.5 flex-1 flex flex-col gap-2.5" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/35 mb-1">Engagement Type</div>
            <div className="text-[11px] font-semibold text-white/65">M365 Copilot Deployment</div>
          </div>
          <div className="px-2 py-0.5 rounded-full text-[8px] font-bold uppercase" style={{ background: "rgba(0,120,212,0.15)", color: "#0078D4" }}>Draft</div>
        </div>

        {["Scope of Work", "Deliverables", "Timeline", "Pricing"].map((section, i) => (
          <div key={section} className="flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: i < 3 ? "#22c55e" : "#0078D4" }} />
            <div className="text-[10px] text-white/55">{section}</div>
            {i === 3 && <div className="ml-auto text-[9px] text-[#0078D4]/70">Generating…</div>}
          </div>
        ))}

        <div className="mt-auto">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full" style={{ width: "75%", background: "linear-gradient(90deg, #0078D4, #00B4D8)" }} />
          </div>
          <div className="text-[9px] text-white/30 mt-1">75% complete — estimated 2 min</div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)" }}>
        <Zap className="w-3 h-3 text-emerald-400 flex-shrink-0" />
        <span className="text-[10px] text-white/55">AI-drafted SOW ready in minutes, not days</span>
      </div>
    </div>
  );
}

function ReportsSlide({ visible }: SlideProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col gap-3 p-5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 500ms ease" }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" style={{ color: "#00B4D8" }} />
          <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Security Report</span>
        </div>
        <span className="text-[9px] text-white/30">July 2026</span>
      </div>

      {[
        { label: "Identity Risks Resolved", val: 14, total: 14, color: "#22c55e" },
        { label: "Conditional Access Rules", val: 22, total: 25, color: "#0078D4" },
        { label: "DLP Incidents (7d)", val: 3, total: 10, color: "#f59e0b" },
        { label: "Intune Compliance", val: 98, total: 100, color: "#00B4D8" },
      ].map(({ label, val, total, color }) => (
        <div key={label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-white/50">{label}</span>
            <span className="text-[10px] font-bold" style={{ color }}>{val}/{total}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
            <div className="h-full rounded-full" style={{ width: `${(val / total) * 100}%`, background: color, opacity: 0.8 }} />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 mt-auto rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.15)" }}>
        <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
        <span className="text-[10px] text-white/55">3 DLP incidents require review</span>
      </div>
    </div>
  );
}

function GanttSlide({ visible }: SlideProps) {
  const tasks = [
    { name: "Discovery", start: 0, width: 25, color: "#0078D4" },
    { name: "M365 Config", start: 20, width: 35, color: "#00B4D8" },
    { name: "Copilot Deploy", start: 45, width: 30, color: "#22c55e" },
    { name: "Training", start: 65, width: 25, color: "#6b7280" },
    { name: "Handover", start: 80, width: 20, color: "#f59e0b" },
  ];

  return (
    <div
      className="absolute inset-0 flex flex-col gap-3 p-5"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 500ms ease" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4" style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Engagement Timeline</span>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {tasks.map(({ name, start, width, color }) => (
          <div key={name} className="flex items-center gap-3">
            <div className="text-[9px] font-semibold text-white/45 w-20 flex-shrink-0 text-right">{name}</div>
            <div className="flex-1 h-5 rounded relative" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div
                className="absolute top-0 h-full rounded"
                style={{ left: `${start}%`, width: `${width}%`, background: color, opacity: 0.75 }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
        <span className="text-[9px] text-white/25">12-week engagement</span>
        <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
      </div>
    </div>
  );
}

const SLIDES = [
  { id: "dashboard", label: "Dashboard", component: DashboardSlide },
  { id: "projects", label: "Projects", component: ProjectBoardSlide },
  { id: "sow", label: "SOW Generator", component: SowGeneratorSlide },
  { id: "reports", label: "Reports", component: ReportsSlide },
  { id: "timeline", label: "Timeline", component: GanttSlide },
];

export default function ProductCarousel() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive(i => (i + 1) % SLIDES.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
        <span className="text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: "rgba(255,255,255,0.28)" }}>
          Live product preview
        </span>
        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
      </div>

      <div
        className="relative w-full overflow-hidden"
        style={{
          height: 240,
          borderRadius: "1rem",
          background: "linear-gradient(145deg, rgba(0,120,212,0.12) 0%, rgba(0,30,60,0.55) 100%)",
          border: "1px solid rgba(0,120,212,0.22)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {SLIDES.map(({ id, component: Slide }, i) => (
          <Slide key={id} visible={i === active} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-2">
        {SLIDES.map(({ id, label }, i) => (
          <button
            key={id}
            onClick={() => setActive(i)}
            className="flex items-center gap-1 group"
            title={label}
          >
            <div
              className="rounded-full transition-all duration-300"
              style={{
                width: i === active ? 20 : 6,
                height: 6,
                background: i === active ? "#0078D4" : "rgba(255,255,255,0.20)",
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

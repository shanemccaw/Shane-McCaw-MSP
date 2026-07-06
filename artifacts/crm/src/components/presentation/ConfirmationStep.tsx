import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfetti } from "@/hooks/useConfetti";

interface SowPhase {
  id: string;
  title: string;
  price: number;
  deliveryDate?: string | null;
}

interface Props {
  clientName: string | null;
  projectTitle: string | null;
  onClose: () => void;
  presentationId: number;
  totalPrice: number;
  sowPhases: SowPhase[];
  projectId: number | null;
  shareToken?: string | null;
}

// ─── Build-status steps (static placeholders) ─────────────────────────────────

const BUILD_STEPS = [
  { label: "Initializing project",                 status: "completed"   },
  { label: "Provisioning workspace",               status: "in_progress" },
  { label: "Generating reports",                   status: "pending"     },
  { label: "Building governance & security plans", status: "pending"     },
  { label: "Finalizing environment",               status: "pending"     },
  { label: "Preparing your dashboard",             status: "pending"     },
];

const INCLUDED_ITEMS = [
  "Full Copilot Readiness Snapshot",
  "Governance Maturity Report",
  "Security Posture Report",
  "License Optimization Analysis",
  "Data Exposure Risk Report",
  "Architecture Hardening Plan",
  "Copilot Enablement Roadmap",
  "Remediation Plan",
  "Kickoff call scheduled within 1 day",
  "Workspace provisioning within 1 day",
];

// ─── Badge component ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
        ✓ Completed
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      Pending
    </span>
  );
}

// ─── Animated checkmark SVG ───────────────────────────────────────────────────

function AnimatedCheckmark() {
  return (
    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-200">
      <svg
        className="w-8 h-8 text-emerald-500"
        viewBox="0 0 52 52"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="26" cy="26" r="24" stroke="currentColor" strokeWidth={3} opacity={0.2} />
        <path
          d="M14 27l9 9 16-18"
          style={{
            strokeDasharray: 40,
            strokeDashoffset: 0,
            animation: "checkDraw 0.5s ease-out 0.15s both",
          }}
        />
      </svg>
      <style>{`
        @keyframes checkDraw {
          from { stroke-dashoffset: 40; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConfirmationStep({
  clientName,
  projectTitle,
  onClose,
  presentationId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  totalPrice: _totalPrice,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sowPhases: _sowPhases,
  projectId: initialProjectId,
  shareToken,
}: Props) {
  const { accessToken } = useAuth();
  const [, navigate] = useLocation();
  const { fireSidecannons } = useConfetti();

  const [projectId, setProjectId] = useState<number | null>(initialProjectId);
  const [ctaReady, setCtaReady] = useState(initialProjectId !== null);

  const firstName = clientName ? clientName.split(" ")[0] : null;

  // ── Confetti burst on mount ──────────────────────────────────────────────
  useEffect(() => {
    fireSidecannons();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── SSE: listen for project_ready ────────────────────────────────────────
  const openSSE = useCallback(() => {
    if (ctaReady) return;
    const params = new URLSearchParams();
    if (accessToken) params.set("jwt", accessToken);
    else if (shareToken) params.set("token", shareToken);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const es = new EventSource(`/api/portal/presentations/${presentationId}/scope-events${qs}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type?: string; projectId?: number };
        if (msg.type === "project_ready" && msg.projectId) {
          setProjectId(msg.projectId);
          setCtaReady(true);
          es.close();
        }
      } catch { /* keepalive ping — ignore */ }
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [presentationId, accessToken, ctaReady]);

  useEffect(() => {
    const cleanup = openSSE();
    return cleanup;
  }, [openSSE]);

  // ── Poll once on mount in case project was created before the page loaded ──
  useEffect(() => {
    if (ctaReady || !accessToken) return;
    fetch(`/api/portal/presentations/${presentationId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { projectId?: number | null } | null) => {
        if (d?.projectId) {
          setProjectId(d.projectId);
          setCtaReady(true);
        }
      })
      .catch(() => { /* non-fatal */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoToProject = () => {
    if (!projectId) return;
    navigate(`/portal/projects/${projectId}`);
    onClose();
  };

  return (
    <div
      className="flex-1 flex flex-col items-center overflow-y-auto px-4 py-12 gap-8"
      style={{ backgroundColor: "#F7F9FC" }}
    >
      {/* ── Section 1: Confirmation header ───────────────────────────────── */}
      <div className="flex flex-col items-center text-center gap-3 max-w-lg w-full">
        <AnimatedCheckmark />

        <div className="space-y-1 mt-2">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#0078D4" }}>
            Payment Confirmed
          </p>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight" style={{ color: "#0A2540" }}>
            Your Copilot Readiness Snapshot is being generated.
          </h1>
        </div>

        {firstName && (
          <p className="text-xl font-semibold" style={{ color: "#0078D4" }}>
            Let's go, {firstName}. Your environment transformation starts now.
          </p>
        )}

        {projectTitle && (
          <p className="text-sm font-medium" style={{ color: "#475569" }}>
            {projectTitle}
          </p>
        )}

        <p
          className="text-sm font-bold tracking-widest mt-1 select-none"
          style={{ color: "#00B4D8", letterSpacing: "0.2em" }}
        >
          YES! • BOOM • LFG • LET'S GO
        </p>
      </div>

      {/* ── Section 2: Project build status ──────────────────────────────── */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "#0078D4" }}>
            Your Project Is Being Built
          </p>
          <p className="text-xs" style={{ color: "#475569" }}>
            We're initializing your dedicated workspace, generating your custom reports, and preparing everything
            you need to hit the ground running.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {BUILD_STEPS.map((step, i) => (
            <li key={i} className="px-5 py-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium" style={{ color: "#0A2540" }}>
                {step.label}
              </span>
              <StatusBadge status={step.status} />
            </li>
          ))}
        </ul>
      </div>

      {/* ── Section 3: CTA button ─────────────────────────────────────────── */}
      <div className="w-full max-w-md flex flex-col items-center gap-3">
        {ctaReady ? (
          <button
            onClick={handleGoToProject}
            className="w-full py-4 rounded-2xl font-bold text-base text-white transition-all active:scale-95"
            style={{
              background: "linear-gradient(135deg, #0078D4 0%, #00B4D8 100%)",
              boxShadow: "0 0 40px 8px rgba(0,120,212,0.35)",
              animation: "ctaGlow 2s ease-in-out infinite",
            }}
          >
            Go to Your Project →
          </button>
        ) : (
          <button
            disabled
            className="w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 cursor-not-allowed border border-slate-200"
            style={{ background: "#F1F5F9", color: "#94A3B8" }}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0 bg-blue-400"
              style={{ animation: "ctaPulse 1.4s ease-in-out infinite" }}
            />
            Generating your project…
          </button>
        )}
        {!ctaReady && (
          <p className="text-[11px] text-center" style={{ color: "#94A3B8" }}>
            The button activates automatically once your workspace is ready — usually within seconds.
          </p>
        )}
      </div>

      {/* ── Section 4: What's Included ────────────────────────────────────── */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0078D4" }}>
            What's Included
          </p>
        </div>
        <ul className="px-5 py-4 space-y-2.5">
          {INCLUDED_ITEMS.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 text-[10px] font-bold"
                style={{ background: "rgba(0,180,216,0.1)", color: "#00B4D8" }}
              >
                ✓
              </span>
              <span className="text-sm" style={{ color: "#0A2540" }}>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Section 5: Momentum ───────────────────────────────────────────── */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-6 text-center space-y-3">
        <h2 className="text-xl font-bold" style={{ color: "#0A2540" }}>
          You Just Changed Everything
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "#475569" }}>
          Most organisations are still guessing at their Microsoft 365 maturity. You just commissioned
          a full diagnostic, governance blueprint, and Copilot enablement roadmap — in one move.
          Shane will be in touch within one business day to kick things off. In the meantime,
          your workspace is being provisioned and your reports are being generated.
          The transformation starts today.
        </p>
      </div>

      {/* ── Section 6: Footer ─────────────────────────────────────────────── */}
      <div className="w-full max-w-md border-t border-slate-200 pt-6 flex flex-col items-center gap-1 pb-4">
        <p className="text-xs font-semibold" style={{ color: "#0A2540" }}>
          Shane McCaw Consulting
        </p>
        <a
          href="/contact"
          className="text-xs hover:underline transition-colors"
          style={{ color: "#0078D4" }}
        >
          Need help? Contact support →
        </a>
      </div>

      <style>{`
        @keyframes ctaPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.6); }
          50%       { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
        }
        @keyframes ctaGlow {
          0%, 100% { box-shadow: 0 0 30px 4px rgba(0,120,212,0.3); }
          50%       { box-shadow: 0 0 50px 12px rgba(0,180,216,0.45); }
        }
      `}</style>
    </div>
  );
}

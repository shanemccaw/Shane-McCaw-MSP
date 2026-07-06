import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

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
}

// ─── Confetti canvas ─────────────────────────────────────────────────────────

const TAGS = ["LFG!", "BOOM", "✓", "🔥", "YES!", "🚀", "LET'S GO", "✨"];
const COLORS = ["#0078D4", "#00B4D8", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#ec4899", "#0ea5e9"];

function launchConfetti(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  interface Particle {
    x: number; y: number;
    vx: number; vy: number;
    rot: number; rotV: number;
    color: string; tag: string;
    fontSize: number; alpha: number;
    life: number; maxLife: number;
  }

  const particles: Particle[] = [];
  for (let i = 0; i < 130; i++) {
    const maxLife = 180 + Math.random() * 80;
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 140,
      vx: (Math.random() - 0.5) * 4.5,
      vy: 2.5 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.18,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      tag: TAGS[Math.floor(Math.random() * TAGS.length)],
      fontSize: 12 + Math.floor(Math.random() * 18),
      alpha: 1, life: 0, maxLife,
    });
  }

  let raf: number;
  function draw() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    for (const p of particles) {
      p.life++; p.x += p.vx; p.y += p.vy;
      p.vy += 0.07; p.vx *= 0.994; p.rot += p.rotV;
      p.alpha = p.life < 20
        ? p.life / 20
        : Math.max(0, 1 - (p.life - p.maxLife * 0.6) / (p.maxLife * 0.4));
      if (p.alpha > 0) alive++;
      ctx!.save();
      ctx!.globalAlpha = p.alpha;
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rot);
      ctx!.fillStyle = p.color;
      ctx!.font = `bold ${p.fontSize}px system-ui, sans-serif`;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.fillText(p.tag, 0, 0);
      ctx!.restore();
    }
    if (alive > 0) raf = requestAnimationFrame(draw);
    else ctx!.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
  return () => cancelAnimationFrame(raf);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDollars(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(raw: string | null | undefined) {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const NEXT_STEPS = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    label: "Kickoff call scheduled",
    detail: "Shane will reach out within 1 business day to confirm a time.",
    badge: "≤ 1 day",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
    ),
    label: "SharePoint & Teams provisioning",
    detail: "Your dedicated client workspace is spun up automatically.",
    badge: "Day 1",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: "First deliverable per SOW",
    detail: "Work begins per the timeline in your Statement of Work.",
    badge: "Per SOW",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    label: "Ongoing check-ins",
    detail: "Regular progress reviews per your retainer cadence.",
    badge: "Ongoing",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConfirmationStep({
  clientName,
  projectTitle,
  onClose,
  presentationId,
  totalPrice,
  sowPhases,
  projectId: initialProjectId,
}: Props) {
  const { accessToken } = useAuth();
  const [, navigate] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [projectId, setProjectId] = useState<number | null>(initialProjectId);
  const [ctaReady, setCtaReady] = useState(initialProjectId !== null);

  const firstName = clientName ? clientName.split(" ")[0] : null;

  // ── Confetti burst on mount ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cancel = launchConfetti(canvas);
    return cancel;
  }, []);

  // ── SSE: listen for project_ready ────────────────────────────────────────
  const openSSE = useCallback(() => {
    if (ctaReady) return;
    const qs = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
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
      className="relative flex-1 flex flex-col items-center overflow-y-auto px-4 py-12 gap-8"
      style={{ backgroundColor: "#070F1C" }}
    >
      {/* Confetti overlay — pointer-events:none so scrolling still works */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 50 }}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center text-center gap-3 max-w-lg w-full">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "#0078D4" }}>
          Payment confirmed
        </p>
        <h1
          className="text-5xl sm:text-6xl font-black tracking-tight leading-none"
          style={{ color: "#F7F9FC" }}
        >
          You're locked&nbsp;in.
        </h1>
        {firstName && (
          <p className="text-2xl font-semibold" style={{ color: "#00B4D8" }}>
            Let's go, {firstName}.
          </p>
        )}
        {projectTitle && (
          <p className="text-sm font-medium mt-1" style={{ color: "#64748B" }}>
            {projectTitle}
          </p>
        )}
        <p className="text-sm leading-relaxed max-w-sm mt-1" style={{ color: "#475569" }}>
          Your agreement is signed, payment is confirmed, and Shane is spinning up your workspace right now.
        </p>
      </div>

      {/* ── Your Investment card ──────────────────────────────────────────── */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: "#0D1B2A", border: "1px solid #1E3A5F" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "#1E3A5F" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#0078D4" }}>
            Your Investment
          </p>
          <p className="text-4xl font-black" style={{ color: "#F7F9FC" }}>
            {formatDollars(totalPrice)}
          </p>
        </div>

        {sowPhases.length > 0 ? (
          <ul className="divide-y" style={{ borderColor: "#1E3A5F" }}>
            {sowPhases.map((phase) => (
              <li key={phase.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#CBD5E1" }}>
                    {phase.title}
                  </p>
                  {phase.deliveryDate && (
                    <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                      {formatDate(phase.deliveryDate)}
                    </p>
                  )}
                </div>
                <span className="flex-shrink-0 text-sm font-bold tabular-nums" style={{ color: "#00B4D8" }}>
                  {formatDollars(phase.price)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-3">
            <p className="text-xs" style={{ color: "#475569" }}>Fixed-price engagement</p>
          </div>
        )}
      </div>

      {/* ── What to Expect card ───────────────────────────────────────────── */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: "#0D1B2A", border: "1px solid #1E3A5F" }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: "#1E3A5F" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#0078D4" }}>
            What to Expect
          </p>
        </div>
        <ul>
          {NEXT_STEPS.map((step, i) => (
            <li
              key={i}
              className="px-5 py-3.5 flex items-start gap-3"
              style={{ borderTop: i > 0 ? "1px solid #1E3A5F" : undefined }}
            >
              <span
                className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
                style={{ background: "rgba(0,120,212,0.15)", color: "#0078D4" }}
              >
                {step.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold" style={{ color: "#CBD5E1" }}>
                    {step.label}
                  </p>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(0,120,212,0.2)", color: "#60A5FA" }}
                  >
                    {step.badge}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Portal CTA ───────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-3 pb-8">
        {ctaReady ? (
          <button
            onClick={handleGoToProject}
            className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-95"
            style={{
              background: "linear-gradient(135deg, #0078D4 0%, #00B4D8 100%)",
              color: "#fff",
              boxShadow: "0 0 40px 8px rgba(0,120,212,0.45)",
              transform: "scale(1.02)",
            }}
          >
            Go to Your Project →
          </button>
        ) : (
          <button
            disabled
            className="w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 cursor-not-allowed"
            style={{
              background: "#0D1B2A",
              color: "#475569",
              border: "1px solid #1E3A5F",
            }}
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: "#0078D4", animation: "ctaPulse 1.4s ease-in-out infinite" }} />
            Spinning up your project…
          </button>
        )}
        {!ctaReady && (
          <p className="text-[11px] text-center" style={{ color: "#334155" }}>
            The button lights up automatically once your workspace is ready — usually within seconds.
          </p>
        )}
      </div>

      <style>{`
        @keyframes ctaPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,120,212,0.7); }
          50%       { box-shadow: 0 0 0 8px rgba(0,120,212,0); }
        }
      `}</style>
    </div>
  );
}

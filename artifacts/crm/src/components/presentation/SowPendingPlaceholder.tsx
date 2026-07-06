import { useEffect, useRef } from "react";
import AnimatedBackground from "@/components/quickwin/AnimatedBackground";
import CopilotAura from "@/components/wizard/CopilotAura";

const STALL_POLL_MS = 60 * 1000;

interface SowPendingPlaceholderProps {
  projectTitle: string | null;
  clientName: string | null;
  presentationId: number;
  shareToken?: string | null;
  fetchFn: (url: string, opts?: RequestInit) => Promise<Response>;
  onClose: () => void;
}

export default function SowPendingPlaceholder({ projectTitle, clientName, presentationId, shareToken, fetchFn, onClose }: SowPendingPlaceholderProps) {
  const firedRef = useRef(false);

  useEffect(() => {
    const fireStall = () => {
      firedRef.current = true;
      const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
      void fetchFn(`/api/portal/presentations/${presentationId}/sow-stall-check${tokenParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    };

    fireStall();
    const interval = setInterval(fireStall, STALL_POLL_MS);
    return () => clearInterval(interval);
  }, [presentationId, shareToken, fetchFn]);

  return (
    <div className="fixed inset-0 bg-[#060E1A] z-50 overflow-hidden">
      {/* Three.js torus-knot animation — fills the full viewport */}
      <AnimatedBackground fullScreen />

      {/* Screen-edge aurora glow */}
      <CopilotAura />

      {/* Centered content — above both the background and the aura */}
      <div className="relative z-20 flex flex-col items-center justify-center h-full px-6 text-center">

        {/* Breathing / pulse indicator */}
        <div className="mb-8 flex items-center justify-center">
          <span className="relative flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0078D4] opacity-40" />
            <span className="relative inline-flex rounded-full h-5 w-5 bg-[#0078D4]/70" />
          </span>
        </div>

        {/* Frosted-glass card */}
        <div
          className="max-w-md w-full rounded-2xl px-8 py-10 shadow-2xl border border-white/10"
          style={{
            background: "rgba(10, 20, 40, 0.72)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          {/* Electric Blue accent line */}
          <div className="w-10 h-0.5 bg-[#0078D4] mx-auto mb-6 rounded-full" />

          {clientName && (
            <p className="text-xs font-semibold text-[#0078D4] uppercase tracking-widest mb-3">
              Hi, {clientName}
            </p>
          )}

          <h1 className="text-2xl font-extrabold text-white leading-tight mb-3">
            Your Statement of Work<br />is being prepared
          </h1>

          {projectTitle && (
            <p className="text-sm font-semibold text-[#00B4D8] mb-4">{projectTitle}</p>
          )}

          <p className="text-sm text-white/60 leading-relaxed mb-8">
            Shane is crafting a tailored proposal for your project. This page will refresh automatically the moment it's ready to review and sign.
          </p>

          {/* Animated progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-8">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#0078D4]/60 animate-pulse"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
            ))}
          </div>

          <button
            onClick={onClose}
            className="text-xs font-semibold text-white/40 hover:text-white/70 transition-colors underline underline-offset-2"
          >
            Return to portal
          </button>
        </div>
      </div>
    </div>
  );
}

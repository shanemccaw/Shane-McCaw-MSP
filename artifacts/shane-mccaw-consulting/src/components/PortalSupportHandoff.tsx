import { MessageSquare, ArrowRight } from "lucide-react";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

interface PortalSupportHandoffProps {
  portalUrl: string;
  /** Surface name for analytics — distinguishes the full Contact page from the bubble popup. */
  surface: string;
  /** Tighter padding/copy for the small bubble popup vs. the full Contact page panel. */
  compact?: boolean;
}

/**
 * Assessment-tier Portal handoff (website-rebuild-reference-v2.md §3, Stage 4b): a
 * recognized, logged-in visitor with a real Portal account gets routed straight into
 * msp-portal's real AI support chat (support-chat.tsx, route /support, requireAuth-gated
 * POST /api/msp/support/chat) instead of the generic contact-chat form — that AI already
 * has real tenant context and can propose real remediations, this one can't. Shared between
 * Contact.tsx and PersistentChatBubble.tsx so an assessment-tier visitor gets the same
 * routing decision no matter which surface they open.
 */
export function PortalSupportHandoff({ portalUrl, surface, compact = false }: PortalSupportHandoffProps) {
  return (
    <GlassPanel
      className={cn("flex flex-col items-center justify-center text-center", compact ? "px-5 py-8" : "px-8 py-12")}
      style={compact ? undefined : { minHeight: "520px" }}
    >
      <div className={cn("rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue flex-shrink-0", compact ? "w-11 h-11 mb-4" : "w-14 h-14 mb-5")}>
        <MessageSquare className={compact ? "w-5 h-5" : "w-6 h-6"} />
      </div>
      <h3 className={cn("font-display font-bold text-text-primary", compact ? "text-sm mb-1.5" : "text-lg mb-2")}>
        Skip the form — go straight to your Portal
      </h3>
      <p className={cn("text-text-secondary", compact ? "text-xs max-w-[240px] mb-4" : "text-sm max-w-sm mb-6")}>
        You already have an account. Your Portal's AI assistant knows your real tenant data and
        can propose actual fixes — not just gather details for a follow-up.
      </p>
      <a
        href={`${portalUrl}/support`}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl text-white font-semibold transition-opacity hover:opacity-90",
          compact ? "px-4 py-2.5 text-xs" : "px-6 py-3 text-sm",
        )}
        style={GRADIENT_BG}
        data-track="cta"
        data-testid="contact-portal-support-link"
        onClick={() => trackEvent("personalization_nudge_click", { tier: "assessment", surface })}
      >
        Open Portal Support Chat <ArrowRight className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </a>
      <p className={cn("text-text-secondary", compact ? "text-[11px] mt-3" : "text-xs mt-4")}>
        Prefer this form instead?{" "}
        <a href="mailto:info@shanemccaw.com" className="text-accent-blue hover:underline">
          Email Shane directly
        </a>
        .
      </p>
    </GlassPanel>
  );
}

import { Link } from "wouter";
import { CalendarDays } from "lucide-react";
import { ChatCTA } from "@/components/ChatCTA";

export function AuthorBio() {
  return (
    <div className="mt-16 rounded-2xl border border-white/[0.08] bg-white/[0.04] overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start gap-6 p-8">
        <div
          className="flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-extrabold select-none"
          style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
        >
          SM
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-accent-blue uppercase tracking-widest mb-1">
            About the Author
          </p>
          <h3 className="text-xl font-extrabold text-text-primary leading-snug">
            Shane McCaw
          </h3>
          <p className="text-sm font-medium text-accent-blue mb-3">
            Lead Microsoft 365 Architect · NASA
          </p>
          <p className="text-text-secondary leading-relaxed text-sm mb-5">
            Shane McCaw is a 30-year Microsoft ecosystem veteran and the Lead
            M365 Architect at NASA, where he designs and governs enterprise-scale
            Microsoft 365 environments trusted by thousands of engineers and
            scientists. He brings that same depth of expertise to private-sector
            clients — cutting through complexity to deliver clear, actionable
            Microsoft 365, Copilot AI, and SharePoint guidance without junior
            hand-offs or account-manager layers.
          </p>

          <ChatCTA
            className="inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
          >
            <CalendarDays className="w-4 h-4" />
            Book a Free Discovery Call
          </ChatCTA>
        </div>
      </div>
    </div>
  );
}

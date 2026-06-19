import { Link } from "wouter";
import { CalendarDays } from "lucide-react";

export function AuthorBio() {
  return (
    <div className="mt-16 rounded-2xl border border-[#0078D4]/20 bg-[#F0F7FF] overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start gap-6 p-8">
        <div className="flex-shrink-0 w-16 h-16 rounded-full bg-[#0A2540] flex items-center justify-center text-white text-2xl font-extrabold select-none">
          SM
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#0078D4] uppercase tracking-widest mb-1">
            About the Author
          </p>
          <h3 className="text-xl font-extrabold text-[#0A2540] leading-snug">
            Shane McCaw
          </h3>
          <p className="text-sm font-medium text-[#0078D4] mb-3">
            Lead Microsoft 365 Architect · NASA
          </p>
          <p className="text-[#374151] leading-relaxed text-sm mb-5">
            Shane McCaw is a 30-year Microsoft ecosystem veteran and the Lead
            M365 Architect at NASA, where he designs and governs enterprise-scale
            Microsoft 365 environments trusted by thousands of engineers and
            scientists. He brings that same depth of expertise to private-sector
            clients — cutting through complexity to deliver clear, actionable
            Microsoft 365, Copilot AI, and SharePoint guidance without junior
            hand-offs or account-manager layers.
          </p>

          <Link
            href="/book"
            className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#005A9E] text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            <CalendarDays className="w-4 h-4" />
            Book a Free Discovery Call
          </Link>
        </div>
      </div>
    </div>
  );
}

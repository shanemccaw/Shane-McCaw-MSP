import { CalendarDays } from "lucide-react";
import { ChatCTA } from "@/components/ChatCTA";

// Author bio card — Design/fractional_architecture/README.md §6 "Article".
// Bio paragraph copy is verbatim; only the visual treatment changes here.
export function AuthorBio() {
  return (
    <div className="mt-14 flex flex-wrap items-start gap-[26px] rounded-[20px] border border-[rgba(30,41,59,0.9)] bg-[rgba(15,23,42,0.5)] p-[clamp(22px,4vw,32px)]">
      <span
        className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[18px] text-[22px] font-extrabold tracking-[-1px] text-white"
        style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
      >
        SM
      </span>

      <div className="min-w-0 flex-1 basis-80">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
          About the Author
        </div>
        <h3 className="mt-2 mb-0.5 text-[21px] font-extrabold leading-[1.25] tracking-[-0.018em] text-[#f8fafc]">
          Shane McCaw
        </h3>
        <div className="mb-3 text-sm font-semibold text-[#00B4D8]">
          Lead Microsoft 365 Architect · NASA
        </div>
        <p className="mb-5 text-[14.5px] leading-[1.65] text-[#94a3b8] text-pretty">
          Shane McCaw is a 30-year Microsoft ecosystem veteran and the Lead
          M365 Architect at NASA, where he designs and governs enterprise-scale
          Microsoft 365 environments trusted by thousands of engineers and
          scientists. He brings that same depth of expertise to private-sector
          clients — cutting through complexity to deliver clear, actionable
          Microsoft 365, Copilot AI, and SharePoint guidance without junior
          hand-offs or account-manager layers.
        </p>

        <ChatCTA
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" }}
        >
          <CalendarDays className="h-4 w-4" />
          Book a Free Discovery Call
        </ChatCTA>
      </div>
    </div>
  );
}

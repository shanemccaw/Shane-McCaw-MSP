import { Bell, ChevronDown, ChevronRight, Eye, ListChecks, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export interface Breadcrumb {
  readonly parent?: string;
  readonly current: string;
}

const HAIRLINE = "rgba(255,255,255,.10)";

/**
 * Impersonation banner (README "Layout" §1) — conditional, real
 * `useAuth().isImpersonating` / `returnToAdmin()` state, not a design
 * placeholder. Sits above the top bar and pushes its popover offset from
 * 64px to 100px, per the README.
 */
function ImpersonationBanner() {
  const { isImpersonating, returnToAdmin } = useAuth();
  if (!isImpersonating) return null;

  return (
    <div
      className="flex flex-none items-center gap-[10px] px-4"
      style={{ height: 36, background: "#0078D4" }}
    >
      <Eye size={14} color="#fff" />
      <span className="text-[12.5px] font-semibold text-white">Impersonation active</span>
      <span className="text-xs" style={{ color: "rgba(255,255,255,.75)" }}>
        An MSP operator is viewing this portal as the customer
      </span>
      <button
        type="button"
        onClick={() => void returnToAdmin()}
        className="ml-auto rounded-full px-3 py-[3px] text-[11.5px] font-semibold text-white"
        style={{ border: "1px solid rgba(255,255,255,.55)" }}
      >
        End session
      </button>
    </div>
  );
}

/**
 * The top bar (README "Layout" §2). The right-cluster three triggers are
 * real, focusable, `data-testid`-tagged mount points — their popovers are
 * #1820 (account), #1821 (alerts) and #1822 (SOP runs), which is why none of
 * them carries an unread/run-count badge yet: that count is real data those
 * builds own, and a badge with no real number behind it would be exactly the
 * fabricated-data case CLAUDE.md forbids.
 */
export function TopBar({ breadcrumb }: { breadcrumb: Breadcrumb }) {
  return (
    <>
      <ImpersonationBanner />
      <div
        className="flex flex-none items-center gap-[14px] border-b"
        style={{ height: 56, padding: "0 16px 0 20px", borderColor: HAIRLINE }}
      >
        <div className="flex items-center gap-[10px]">
          <div
            className="flex size-[28px] items-center justify-center rounded-md text-[13px] font-bold text-white"
            style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)" }}
          >
            S
          </div>
          <div className="flex flex-col gap-px">
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">Shane McCaw</span>
            <span className="text-[10px] uppercase text-[#64748b]" style={{ letterSpacing: ".08em" }}>
              Customer portal
            </span>
          </div>
        </div>
        <div className="h-5 w-px" style={{ background: HAIRLINE }} />
        <div className="flex items-center gap-2">
          {breadcrumb.parent ? (
            <>
              <span className="text-[12.5px] text-[#64748b]">{breadcrumb.parent}</span>
              <ChevronRight size={12} color="#334155" />
            </>
          ) : null}
          <span className="text-sm font-semibold text-[#f8fafc]">{breadcrumb.current}</span>
        </div>
        <div className="ml-auto flex items-center gap-[6px]">
          <button
            type="button"
            data-testid="topbar-sop-trigger"
            aria-label="SOP runs"
            className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
          >
            <ListChecks size={17} strokeWidth={1.75} color="#94a3b8" />
          </button>
          <button
            type="button"
            data-testid="topbar-alerts-trigger"
            aria-label="Alerts"
            className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
          >
            <Bell size={17} strokeWidth={1.75} color="#94a3b8" />
          </button>
          <div className="mx-[6px] h-5 w-px" style={{ background: HAIRLINE }} />
          <button
            type="button"
            data-testid="topbar-user-trigger"
            aria-label="Account menu"
            className="flex items-center gap-[6px] rounded-full py-[3px] pl-[3px] pr-[6px] transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
          >
            <div
              className="flex size-7 items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)" }}
            >
              <User size={14} strokeWidth={1.75} color="#cbd5e1" />
            </div>
            <ChevronDown size={13} color="#64748b" />
          </button>
        </div>
      </div>
    </>
  );
}

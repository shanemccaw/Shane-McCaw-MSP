import { useState } from "react";
import { Bell, ChevronDown, ChevronRight, Eye, ListChecks, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { SopTray } from "./SopTray";
import { useSopRunsShell } from "./useSopRuns";
import { UserMenu } from "./UserMenu";

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
 * #1820 (account), #1821 (alerts) and #1822 (SOP runs). The account and
 * alerts triggers still carry no badge (that count is real data those builds
 * own, and a badge with no real number behind it would be exactly the
 * fabricated-data case CLAUDE.md forbids) — the SOP trigger's badge below is
 * real: `useSopRunsShell`'s own live queue count.
 */
export function TopBar({ breadcrumb }: { breadcrumb: Breadcrumb }) {
  // README "State" §`openPopover`: `null | "user" | "alerts" | "sop"`, mutually
  // exclusive. Alerts stays inert (its popover is #1821's own scope).
  const [openPopover, setOpenPopover] = useState<null | "user" | "sop">(null);
  const { user, logout } = useAuth();
  const { queue, loading } = useSopRunsShell();
  const sopCount = queue.length;

  return (
    <>
      <ImpersonationBanner />
      {openPopover ? (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpenPopover(null)}
          aria-hidden="true"
        />
      ) : null}
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
          <div className="relative">
            <button
              type="button"
              data-testid="topbar-sop-trigger"
              aria-label="SOP runs"
              aria-haspopup="true"
              aria-expanded={openPopover === "sop"}
              onClick={() => setOpenPopover((p) => (p === "sop" ? null : "sop"))}
              className="relative z-50 flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
              style={{ background: openPopover === "sop" ? "rgba(255,255,255,.06)" : undefined }}
            >
              <ListChecks size={17} strokeWidth={1.75} color="#94a3b8" />
              {sopCount > 0 ? (
                <span
                  data-testid="sop-tray-badge"
                  className="absolute flex min-w-[15px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
                  style={{ top: -3, right: -3, height: 15, background: "#00B4D8", color: "#020617" }}
                >
                  {sopCount}
                </span>
              ) : null}
            </button>
            {openPopover === "sop" ? (
              <SopTray onClose={() => setOpenPopover(null)} queue={queue} loading={loading} />
            ) : null}
          </div>
          <button
            type="button"
            data-testid="topbar-alerts-trigger"
            aria-label="Alerts"
            className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
          >
            <Bell size={17} strokeWidth={1.75} color="#94a3b8" />
          </button>
          <div className="mx-[6px] h-5 w-px" style={{ background: HAIRLINE }} />
          <div className="relative">
            <button
              type="button"
              data-testid="topbar-user-trigger"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={openPopover === "user"}
              onClick={() => setOpenPopover((p) => (p === "user" ? null : "user"))}
              className="relative z-50 flex items-center gap-[6px] rounded-full py-[3px] pl-[3px] pr-[6px] transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
              style={{ background: openPopover === "user" ? "rgba(255,255,255,.06)" : undefined }}
            >
              <div
                className="flex size-7 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)" }}
              >
                <User size={14} strokeWidth={1.75} color="#cbd5e1" />
              </div>
              <ChevronDown size={13} color="#64748b" />
            </button>
            {openPopover === "user" && user ? (
              <UserMenu
                user={user}
                onClose={() => setOpenPopover(null)}
                onSignOut={() => {
                  setOpenPopover(null);
                  void logout();
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

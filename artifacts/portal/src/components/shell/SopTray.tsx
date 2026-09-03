import { ListChecks } from "lucide-react";
import { Link } from "wouter";
import { comingSoonHref } from "./moduleNav";
import type { SopQueueItemWire } from "./useSopRuns";

const HAIRLINE = "rgba(255,255,255,.08)";

/** The design's two chip tones for a queue row — `Running` teal, `Queued` grey. */
const STATE_CHIP: Readonly<Record<SopQueueItemWire["state"], { ink: string; border: string; bg: string }>> = {
  Running: { ink: "#00B4D8", border: "rgba(0,180,216,.45)", bg: "rgba(0,180,216,.10)" },
  Queued: { ink: "#94a3b8", border: "rgba(148,163,184,.35)", bg: "transparent" },
};

function SopRow({ item }: { item: SopQueueItemWire }) {
  const chip = STATE_CHIP[item.state];
  return (
    <div
      className="rounded-[10px] border"
      style={{
        borderColor: "rgba(255,255,255,.08)",
        background: "rgba(255,255,255,.02)",
        padding: "11px 12px 12px",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-[#f8fafc]">{item.title}</span>
        <span
          className="ml-auto flex-none rounded-full px-[9px] py-[2px] text-[10px] font-semibold"
          style={{ color: chip.ink, border: `1px solid ${chip.border}`, background: chip.bg }}
        >
          {item.state}
        </span>
      </div>
      <div className="flex items-center gap-[6px]" style={{ padding: "6px 0 7px" }}>
        <span
          className="rounded-full px-2 py-[2px] text-[10px] text-[#64748b]"
          style={{ border: "1px solid rgba(255,255,255,.10)" }}
        >
          {item.mode}
        </span>
        <span
          className="rounded-full px-2 py-[2px] text-[10px] text-[#64748b]"
          style={{ border: "1px solid rgba(255,255,255,.10)" }}
        >
          CR · {item.cr}
        </span>
      </div>
      <div className="pb-2 text-[11.5px] text-[#94a3b8]">{item.step}</div>
      <div className="h-[3px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${item.pct}%`, background: "linear-gradient(90deg,#0078D4,#00B4D8)" }}
        />
      </div>
      <div className="pt-2 text-[10.5px] text-[#64748b]">
        {item.started} · run by {item.who}
      </div>
    </div>
  );
}

/**
 * The SOP runs popover (README "Popovers (top right)" — "SOP runs"; the
 * empty/full detail markup at Design/portal/design_handoff_ui_shell/
 * Shell.dc.html:624-674). Reads `GET /api/portal/sop-runs`'s real `queue`
 * (artifacts/api-server/src/routes/portal-sops.ts:537-584) via
 * `useSopRunsShell` — an empty queue here is the module's real current
 * state (#1493's backend children are all closed; nothing invented to fill
 * a gap), never a fabricated row.
 *
 * Positioned the same way #1820's `UserMenu` anchors itself: `absolute
 * right-0` off a `relative` wrapper around just the trigger button, rather
 * than the design's raw viewport-offset pixels — self-contained regardless
 * of the impersonation banner or sibling trigger widths. The mutually
 * exclusive open/close state and the shared full-viewport click-catching
 * overlay both live in `TopBar`, same as the user menu.
 */
export function SopTray({
  onClose,
  queue,
  loading,
}: {
  onClose: () => void;
  queue: readonly SopQueueItemWire[];
  loading: boolean;
}) {
  const isEmpty = queue.length === 0;

  return (
    <div
      data-testid="sop-tray-popover"
      className="absolute right-0 z-50 w-[380px] overflow-hidden rounded-[14px] border"
      style={{
        top: "calc(100% + 8px)",
        background: "rgba(11,17,32,.98)",
        borderColor: "rgba(255,255,255,.10)",
        boxShadow: "0 18px 48px rgba(0,0,0,.55)",
      }}
    >
      {isEmpty ? (
        <>
          <div
            className="flex items-center gap-2 border-b"
            style={{ borderColor: HAIRLINE, padding: "13px 14px 11px" }}
          >
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">SOP activity</span>
            <span className="ml-auto text-[11px] text-[#64748b]">{loading ? "Loading…" : "Idle"}</span>
          </div>
          <div
            className="flex flex-col items-center gap-[10px] text-center"
            style={{ padding: "30px 24px 26px" }}
          >
            <div
              className="flex size-10 items-center justify-center rounded-[11px] border"
              style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.08)" }}
            >
              <ListChecks size={18} strokeWidth={1.75} color="#475569" />
            </div>
            <span className="text-[13px] font-semibold text-[#cbd5e1]">Nothing running right now</span>
            <span className="max-w-[250px] text-xs leading-[1.5] text-[#64748b]">
              When your MSP executes a procedure against your tenant, its live progress appears here.
            </span>
            <Link
              href={comingSoonHref("SOPs", "module")}
              data-testid="sop-tray-view-library"
              className="text-xs font-semibold text-[#60a5fa]"
              onClick={onClose}
            >
              View SOP library
            </Link>
          </div>
        </>
      ) : (
        <>
          <div
            className="flex items-center gap-2 border-b"
            style={{ borderColor: HAIRLINE, padding: "13px 14px 11px" }}
          >
            <span className="size-[7px] flex-none rounded-full" style={{ background: "#00B4D8" }} />
            <span className="text-[13.5px] font-semibold text-[#f8fafc]">SOP activity</span>
            <span className="ml-auto text-[11px] text-[#64748b]">{queue.length} in queue</span>
          </div>
          <div className="flex flex-col gap-[10px]" style={{ padding: "12px 12px 4px" }}>
            {queue.map((item) => (
              <SopRow key={item.code} item={item} />
            ))}
          </div>
          <div className="flex items-center" style={{ padding: "9px 14px 12px" }}>
            <span className="text-[11px] text-[#64748b]">Steps continue even if you close this</span>
            <Link
              href={comingSoonHref("Runbooks", "module")}
              data-testid="sop-tray-open-runbooks"
              className="ml-auto text-xs font-semibold text-[#60a5fa]"
              onClick={onClose}
            >
              Open Runbooks
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

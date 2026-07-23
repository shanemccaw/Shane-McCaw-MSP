/**
 * scan-status-indicator.tsx
 *
 * Shell-wide, always-visible indicator of a customer's monitoring scan state.
 * Rendered from app-shell.tsx (both the desktop sidebar brand block and the
 * mobile top-bar brand block) so it is genuinely present on every portal page,
 * not just one. Reads from ScanStatusContext (lib/scan-status-context.tsx) —
 * the shared poller for GET /api/portal/scan-status — so a click on
 * ScanTriggerButton visibly drives this same indicator instead of the two
 * components running disconnected fetches.
 *
 * Four states, rendered inside a fixed-height container so switching between
 * them (a scan can fire as often as every 5 minutes via the Live Activity
 * Monitor workflow, or on demand via the testbed trigger button) never
 * causes a layout jump in the shell:
 *   - trigger request failed   → red error pill (distinct wording from "no scan")
 *   - active scan running      → progress bar + progress text
 *   - idle, has scanned        → real relative "Last scan: …" time
 *   - idle, never scanned      → red "NO SCAN" pill
 */

import { useScanStatus, type ScanStatusPayload } from "@/lib/scan-status-context";

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ScanStatusIndicator({ collapsed = false }: { collapsed?: boolean }) {
  const { data, triggerError } = useScanStatus();

  if (collapsed) return null;

  // Fixed-height container — every branch below renders inside this same
  // height so the progress-bar / timestamp / pill states never reflow the
  // shell around them.
  return (
    <div className="h-8 flex items-center" title="Monitoring scan status">
      {triggerError ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-status-red/40 bg-status-red/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-red truncate"
          title={triggerError}
        >
          Scan trigger failed
        </span>
      ) : !data ? (
        <div className="h-1.5 w-full rounded-full bg-muted/40 animate-pulse" />
      ) : data.active ? (
        <ActiveScanProgress active={data.active} />
      ) : data.everScanned ? (
        <span className="text-[11px] text-muted-foreground truncate">
          Last scan: {data.lastScanAt ? timeAgo(data.lastScanAt) : "unknown"}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-status-red/40 bg-status-red/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-red">
          No scan
        </span>
      )}
    </div>
  );
}

function ActiveScanProgress({ active }: { active: NonNullable<ScanStatusPayload["active"]> }) {
  const evaluated = active.checksOk + active.checksError + active.checksLicenseGap;
  const pct = active.checksTotal > 0 ? Math.min(100, Math.round((evaluated / active.checksTotal) * 100)) : null;

  return (
    <div className="w-full flex flex-col gap-0.5">
      <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
        <div
          className={pct == null ? "h-full w-1/3 rounded-full bg-primary animate-pulse" : "h-full rounded-full bg-primary transition-all duration-500"}
          style={pct == null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground truncate">
        Scanning… {pct != null ? `${pct}% (${evaluated}/${active.checksTotal})` : "in progress"}
      </span>
    </div>
  );
}

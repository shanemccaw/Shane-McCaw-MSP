/**
 * scan-status-indicator.tsx
 *
 * Shell-wide, always-visible indicator of a customer's monitoring scan state.
 * Rendered from app-shell.tsx (both the desktop sidebar brand block and the
 * mobile top-bar brand block) so it is genuinely present on every portal page,
 * not just one. Polls the lightweight GET /api/portal/scan-status endpoint —
 * deliberately NOT the full /api/portal/assessment/status payload, which is
 * too heavy to poll from every page.
 *
 * Three states, rendered inside a fixed-height container so switching between
 * them (a scan can fire as often as every 5 minutes via the Live Activity
 * Monitor workflow) never causes a layout jump in the shell:
 *   - active scan running   → progress bar + progress text
 *   - idle, has scanned     → real relative "Last scan: …" time
 *   - idle, never scanned   → red "NO SCAN" pill
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

interface ScanStatusPayload {
  everScanned: boolean;
  lastScanAt: string | null;
  active: {
    status: string;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    checksTotal: number;
    startedAt: string;
  } | null;
  isTestbed: boolean;
}

const POLL_INTERVAL_MS = 45_000;

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
  const { accessToken, fetchWithAuth } = useAuth();
  const [data, setData] = useState<ScanStatusPayload | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetchWithAuth("/api/portal/scan-status", undefined, { silent: true });
      if (res.ok) setData((await res.json()) as ScanStatusPayload);
    } catch {
      // best-effort — keep showing the last known state rather than clearing it
    }
  }, [accessToken, fetchWithAuth]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (collapsed) return null;

  // Fixed-height container — every branch below renders inside this same
  // height so the progress-bar / timestamp / pill states never reflow the
  // shell around them.
  return (
    <div className="h-8 flex items-center" title="Monitoring scan status">
      {!data ? (
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

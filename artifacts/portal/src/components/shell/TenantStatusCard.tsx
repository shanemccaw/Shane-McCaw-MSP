import { Sparkles } from "lucide-react";
import type { Severity } from "@workspace/copilot-scan-scene/journeyTokens";
import { SEVERITY_LABEL, SEVERITY_ON_DARK } from "@workspace/copilot-scan-scene/journeyTokens";
import { SEVERITY_INK, type ScanState } from "./useScanState";
import type { ScanPhase } from "./scanTypes";

const NEVER_SCANNED_INK = "#475569";

const SCAN_CHIP: Readonly<Record<ScanPhase, string>> = {
  running: "Live",
  "late-join": "Live · late",
  complete: "Complete",
  partial: "Partial",
  failed: "Failed",
  disconnected: "No stream",
  "cache-cleared": "Summary",
  none: "No run",
};

function cardLine(phase: ScanPhase, everScanned: boolean): string {
  switch (phase) {
    case "running":
      return everScanned ? "Scan in progress" : "First scan in progress";
    case "late-join":
      return "Scan in progress";
    case "complete":
      return "Latest scan complete";
    case "partial":
      return "Latest scan finished with failures";
    case "failed":
      return "Latest scan failed";
    case "disconnected":
      return "Live progress lost";
    case "cache-cleared":
      return "Latest scan complete";
    case "none":
    default:
      return "First scan establishes your baseline";
  }
}

/**
 * The Tenant Status card (README "Tenant Status card", bottom of sidebar).
 * Mounts into `SidebarNav`'s `footerSlot` (reserved for this by #1819).
 * Every number here comes from `useScanState` — the real combined
 * poll+plan+SSE source, never a wall-clock timer.
 */
export function TenantStatusCard({
  scan,
  overallScore,
  overallSeverity,
  onOpenLog,
}: {
  scan: ScanState;
  overallScore: number | null;
  overallSeverity: Severity | "none";
  onOpenLog: () => void;
}) {
  const { phase } = scan;

  const scoreText = overallScore === null ? "—" : String(overallScore);
  const scoreInk = overallSeverity === "none" ? NEVER_SCANNED_INK : "#f8fafc";
  const sevColor = overallSeverity === "none" ? NEVER_SCANNED_INK : SEVERITY_ON_DARK[overallSeverity];
  const sevLabel = overallSeverity === "none" ? "Not scanned yet" : SEVERITY_LABEL[overallSeverity];

  const barShow = phase === "running" || phase === "late-join" || phase === "disconnected";
  const determinate = phase === "running" || phase === "late-join";
  const outcomeShow = phase === "complete" || phase === "partial" || phase === "failed" || phase === "disconnected" || phase === "cache-cleared";
  const showCta = scan.isTestbed && phase !== "running" && phase !== "late-join" && phase !== "disconnected";
  const ctaLabel = overallSeverity === "none" ? "Run first scan" : "Run a new scan";

  const pct = scan.total > 0 ? Math.round((scan.index / scan.total) * 100) : 0;
  const countLine =
    phase === "disconnected"
      ? `Last seen at check ${scan.index} of ${scan.total || "?"}`
      : `Check ${scan.index} of ${scan.total || "?"}${phase === "late-join" ? " · joined mid-scan" : ""}`;

  let outcomeHead = "";
  let outcomeBody = "";
  let outcomeInk = "#94a3b8";
  let outcomeFill = "transparent";
  let outcomeStyle: "solid" | "dashed" = "solid";

  if (phase === "complete" || phase === "partial") {
    const partial = phase === "partial";
    outcomeHead = partial ? "Finished partially" : "Scan complete";
    outcomeBody =
      `${scan.total} checks` +
      (scan.findings !== null ? ` · ${scan.findings} findings` : "") +
      (partial ? ` · ${scan.checksError} checks failed` : "");
    outcomeInk = partial ? "#c2a63d" : "#34d399";
    outcomeFill = partial ? "transparent" : "#34d399";
  } else if (phase === "failed") {
    outcomeHead = "Scan failed";
    outcomeBody = scan.errorMessage ?? "The run did not report why it stopped.";
    outcomeInk = "#f87171";
    outcomeFill = "#f87171";
  } else if (phase === "disconnected") {
    outcomeHead = "Live progress stream disconnected";
    outcomeBody = "The scan may still be running. Progress falls back to the status poll until the stream comes back.";
    outcomeInk = "#c2a63d";
    outcomeFill = "transparent";
  } else if (phase === "cache-cleared") {
    outcomeHead = "That run finished before this page opened";
    outcomeBody = `Showing its stored summary: ${scan.total} checks · ${scan.checksOk} passed · ${scan.checksError} errored${scan.checksLicenseGap > 0 ? ` · ${scan.checksLicenseGap} license gaps` : ""}. The live log for it is gone.`;
    outcomeInk = "#60a5fa";
    outcomeFill = "transparent";
    outcomeStyle = "dashed";
  }

  return (
    <div
      className="rounded-[14px] border p-[14px] pb-3"
      style={{
        borderColor: "rgba(255,255,255,.10)",
        background: "linear-gradient(135deg, rgba(0,120,212,.12), rgba(139,92,246,.10))",
      }}
    >
      <button
        type="button"
        onClick={onOpenLog}
        data-testid="tenant-status-header"
        className="flex w-full items-center gap-[7px] pb-2 text-left"
      >
        <Sparkles size={13} fill="#00B4D8" stroke="none" />
        <span className="whitespace-nowrap text-[10px] font-semibold" style={{ color: "#64748b", letterSpacing: ".13em" }}>
          TENANT STATUS
        </span>
        <span className="ml-auto whitespace-nowrap text-[9.5px] font-semibold" style={{ color: "#475569" }}>
          {SCAN_CHIP[phase]}
        </span>
      </button>

      <div className="flex items-baseline gap-[5px]">
        <span
          className="text-[30px] font-extrabold leading-none"
          style={{ color: scoreInk, fontVariantNumeric: "tabular-nums" }}
          data-testid="tenant-status-score"
        >
          {scoreText}
        </span>
        {overallSeverity !== "none" ? <span className="text-[13px]" style={{ color: "#475569" }}>/ 100</span> : null}
      </div>

      <div className="pb-[2px] pt-[5px] text-[12.5px] font-semibold" style={{ color: sevColor }}>
        {sevLabel}
      </div>
      <div className="text-[11.5px]" style={{ color: "#64748b", lineHeight: 1.45 }}>
        {cardLine(phase, scan.everScanned)}
      </div>

      {barShow ? (
        <button type="button" onClick={onOpenLog} className="mt-[9px] flex w-full flex-col gap-[6px] text-left">
          <div className="relative h-[3px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.08)" }}>
            {determinate ? (
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: "linear-gradient(90deg,#0078D4,#00B4D8)",
                  transition: "width 400ms ease",
                }}
              />
            ) : (
              <div
                className="absolute left-0 top-0 h-full w-[34%] rounded-full"
                style={{ background: "linear-gradient(90deg,#0078D4,#00B4D8)", animation: "scanSlide 1.8s ease-in-out infinite" }}
              />
            )}
          </div>
          <div className="flex items-baseline gap-[6px]">
            <span className="text-[11px] font-semibold" style={{ color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
              {countLine}
            </span>
            <span className="ml-auto text-[10px]" style={{ color: "#475569" }}>
              Open log
            </span>
          </div>
          {scan.lastFinding ? (
            <div
              className="pl-2 text-[11px]"
              style={{
                color: "#cbd5e1",
                borderLeft: `2px solid ${scan.lastFinding.severityMatched ? (SEVERITY_INK[scan.lastFinding.severityMatched] ?? "#c2a63d") : "#c2a63d"}`,
              }}
            >
              {scan.lastFinding.severityLabel}
            </div>
          ) : null}
        </button>
      ) : null}

      {outcomeShow ? (
        <div className="mt-[9px] border-t pt-[9px]" style={{ borderColor: "rgba(255,255,255,.07)" }}>
          <div className="flex items-center gap-[6px]">
            <span
              className="size-[6px] rounded-full"
              style={{
                background: outcomeFill,
                border: outcomeStyle === "dashed" ? `1px dashed ${outcomeInk}` : outcomeFill === "transparent" ? `1px solid ${outcomeInk}` : "none",
              }}
            />
            <span className="text-[11.5px] font-semibold" style={{ color: outcomeInk }}>
              {outcomeHead}
            </span>
          </div>
          <div className="pt-[3px] text-[11px]" style={{ color: "#64748b" }}>
            {outcomeBody}
          </div>
        </div>
      ) : null}

      {showCta ? (
        <button
          type="button"
          data-testid="tenant-status-cta"
          disabled={scan.triggering}
          onClick={() => void scan.triggerScan()}
          className="mt-[9px] w-full rounded-md py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#005A9E] disabled:opacity-60"
          style={{ background: "#0078D4" }}
        >
          {scan.triggering ? "Starting…" : ctaLabel}
        </button>
      ) : null}
      {scan.triggerError ? (
        <div className="pt-1 text-[10.5px]" style={{ color: "#f87171" }}>
          {scan.triggerError}
        </div>
      ) : null}
    </div>
  );
}

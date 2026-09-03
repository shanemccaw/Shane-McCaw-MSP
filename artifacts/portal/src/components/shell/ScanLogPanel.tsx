import { X } from "lucide-react";
import { CHECK_STATUS_LABEL, SEVERITY_INK, type ScanState } from "./useScanState";
import type { ScanPhase } from "./scanTypes";

interface PanelRow {
  readonly k: string;
  readonly v: string;
}

/**
 * The scan log body — README "Right-slide detail panel" / "Scan states"
 * table. Every row is built from real `ScanState` fields; nothing here is
 * canned copy standing in for data (see #1824's own useScanState.ts doc for
 * why "complete"/"partial" require a live-witnessed SSE terminal event and
 * "cache-cleared" honestly doesn't have a findings count or per-check log).
 */
function panelFor(scan: ScanState): { state: string; rows: PanelRow[]; note: string; foot: string } {
  const runRow: PanelRow = { k: "Run", v: scan.runId ?? "—" };
  const planRow: PanelRow = {
    k: `Checks in this run · ${scan.total}`,
    v: "The plan comes from the same ordered list the executor iterates, so it can never drift from what the live events report. It is read once per run — the plan for a run never changes.",
  };
  const passed = scan.log.filter((e) => e.status === "ok").length;
  const errored = scan.log.filter((e) => e.status === "error").length;
  const needsScript = scan.log.filter((e) => e.requiresCustomerScript).length;
  const liveFindings = scan.log.filter((e) => e.severityMatched).length;

  switch (scan.phase) {
    case "running":
    case "late-join": {
      const late = scan.phase === "late-join";
      return {
        state: `Live · check ${scan.index} of ${scan.total || "?"}`,
        rows: [
          runRow,
          planRow,
          { k: "Reported so far", v: `${passed} passed · ${errored} findings · ${needsScript} need a script you run` },
          {
            k: "Live findings",
            v: `${liveFindings} check${liveFindings === 1 ? "" : "s"} matched a real finding sentence as they resolved. A check can pass and still match one — that is why the sentence is shown rather than a pass or fail.`,
          },
          late
            ? {
                k: "Joined mid-scan",
                v: `Only the most recent event is replayed on connect, so checks before ${scan.index} are not listed here. The run's own totals still come through when it finishes.`,
              }
            : { k: "Stream", v: "Connected · a heartbeat every 25 seconds keeps the connection open through proxies." },
        ],
        note: "Findings are counted as they resolve. Nothing here is persisted until the run reaches its own terminal state.",
        foot: "This log is the live stream. The status poll beside it is what supplies the run to watch, and the summary once the run is over.",
      };
    }
    case "complete":
    case "partial": {
      const partial = scan.phase === "partial";
      return {
        state: `${partial ? "Partial" : "Completed"} · ${scan.total} checks`,
        rows: [
          runRow,
          {
            k: "Outcome",
            v: partial
              ? "Partial — the run finished, and some checks failed on the way. Individual checks failing is normal and does not kill a run."
              : "Completed — every check reported and the run persisted its findings.",
          },
          { k: "Counts", v: `${passed} passed · ${errored} findings · ${needsScript} need a script you run` },
          { k: "Findings persisted", v: String(scan.findings ?? 0) },
          planRow,
        ],
        note: "These are the run's own final numbers, not a running tally.",
        foot: "Your pillar pages read the persisted findings. This log is what the run said as it happened.",
      };
    }
    case "failed":
      return {
        state: "Failed · the run died",
        rows: [
          runRow,
          {
            k: "What the run reported",
            v: scan.errorMessage ?? "The run did not report why it stopped.",
          },
          {
            k: "This is not a failed check",
            v: "Individual checks failing is normal and still lets a run finish. This is the whole run dying, which is a different state and is reported separately.",
          },
          planRow,
        ],
        note: "The message shown is the run's own, truncated as stored. Nothing is paraphrased.",
        foot: "Connect a tenant and run again. Your last successful scan, if there was one, still stands.",
      };
    case "disconnected":
      return {
        state: `Disconnected · last seen at check ${scan.index}`,
        rows: [
          runRow,
          {
            k: "What happened",
            v: "The connection dropped — a proxy, a network blip or a restart. This is shown the same way as a failure the run reported itself, because from here the two are indistinguishable.",
          },
          {
            k: "Why it is not a failed scan",
            v: "The run is not known to have died. It may have finished successfully while the stream was down, which is why the status poll is what decides the outcome.",
          },
          {
            k: "Not shown after a success",
            v: "A drop after the run already completed is ignored rather than replacing a real success with a false error.",
          },
          planRow,
        ],
        note: "Reported checks below are the ones that arrived before the drop.",
        foot: "The status poll continues every few seconds while a run is live, and carries the terminal summary once it is over.",
      };
    case "cache-cleared":
      return {
        state: "From the stored summary · no live log",
        rows: [
          runRow,
          {
            k: "Why there is no log",
            v: "A run's live replay is dropped the moment it ends, so a page opened afterwards receives nothing at all from the stream — not even the outcome.",
          },
          {
            k: "Where this came from",
            v: "The status poll keeps the last run's summary permanently, precisely because the live stream cannot answer for a run that is already over.",
          },
          {
            k: "Summary",
            v: `${scan.total} checks · ${scan.checksOk} passed · ${scan.checksError} errored${scan.checksLicenseGap > 0 ? ` · ${scan.checksLicenseGap} license gaps` : ""}`,
          },
          planRow,
        ],
        note: "This panel deliberately shows no per-check log — inventing one from the summary would be a fabrication.",
        foot: "The next run you start will stream check by check from the beginning.",
      };
    case "none":
    default:
      return {
        state: "Never scanned",
        rows: [
          { k: "No run yet", v: "This tenant has never been scanned, so there is no run to watch and no plan to show. That is a real state, not an error." },
          {
            k: "What a scan does",
            v: "It works through an ordered list of checks against your tenant and reports each one as it resolves. You will see the count, and the finding sentence for any check that matches one.",
          },
        ],
        note: "Nothing is claimed about your tenant until a real run reports.",
        foot: "Run your first scan from the button on this card.",
      };
  }
}

const STEPS_PHASES = new Set<ScanPhase>(["running", "late-join", "complete", "partial", "failed", "disconnected"]);

export function ScanLogPanel({ scan, narrow, onClose }: { scan: ScanState; narrow: boolean; onClose: () => void }) {
  const panel = panelFor(scan);
  const steps = STEPS_PHASES.has(scan.phase) ? [...scan.log].sort((a, b) => b.index - a.index) : [];

  return (
    <>
      <div
        className="absolute inset-0 z-40"
        style={{ background: `rgba(0,0,0,${narrow ? ".55" : ".35"})` }}
        onClick={onClose}
        data-testid="scan-log-overlay"
      />
      <div
        className="absolute z-50 flex flex-col"
        style={{
          top: narrow ? "auto" : 0,
          right: 0,
          left: narrow ? 0 : "auto",
          bottom: narrow ? 0 : "auto",
          width: narrow ? "auto" : 384,
          height: narrow ? "auto" : "100%",
          maxHeight: narrow ? "84%" : "100%",
          borderRadius: narrow ? "16px 16px 0 0" : 0,
          background: "#0b1220",
          border: "1px solid rgba(255,255,255,.10)",
        }}
        data-testid="scan-log-panel"
      >
        <div className="flex items-start justify-between px-[18px] pt-4 pb-3">
          <div>
            <div className="text-[15px] font-semibold" style={{ color: "#f8fafc" }}>
              Scan progress
            </div>
            <div className="text-[11.5px]" style={{ color: "#64748b" }}>
              {panel.state}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="scan-log-close">
            <X size={16} color="#94a3b8" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[18px] pb-5">
          {steps.length > 0 ? (
            <div className="flex flex-col gap-2">
              {steps.map((s) => (
                <div key={s.checkKey} className="flex items-start gap-[10px]">
                  <div
                    className="flex size-5 flex-none items-center justify-center rounded-full text-[10px]"
                    style={{
                      border: "1px solid rgba(52,211,153,.45)",
                      background: "rgba(52,211,153,.12)",
                      color: "#34d399",
                    }}
                  >
                    {"✓"}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px]" style={{ color: "#e2e8f0" }}>
                      {s.checkLabel}
                    </div>
                    <div className="text-[11px]" style={{ color: s.severityMatched ? (SEVERITY_INK[s.severityMatched] ?? "#94a3b8") : "#94a3b8" }}>
                      {CHECK_STATUS_LABEL[s.status]}
                      {s.severityLabel ? ` · ${s.severityLabel}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-[10px]">
            {panel.rows.map((row) => (
              <div key={row.k} className="flex flex-col gap-[2px]">
                <div className="text-[11px] font-semibold" style={{ color: "#cbd5e1" }}>
                  {row.k}
                </div>
                <div className="text-[12px]" style={{ color: "#94a3b8" }}>
                  {row.v}
                </div>
              </div>
            ))}
          </div>

          <div className="text-[11px]" style={{ color: "#c2a63d" }}>
            {panel.note}
          </div>
        </div>

        <div className="border-t px-[18px] py-3 text-[10.5px]" style={{ borderColor: "rgba(255,255,255,.08)", color: "#475569" }}>
          {panel.foot}
        </div>
      </div>
    </>
  );
}

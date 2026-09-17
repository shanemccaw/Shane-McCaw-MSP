import { useState } from "react";
import { Loader2, Download } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useScanState } from "@/components/shell/useScanState";
import { useDiagnosticsPage, useScriptDownload } from "@/components/diagnostics/useDiagnosticsPage";
import {
  SEVERITY_TOKENS,
  checkStatusInk,
  checkStatusLabel,
  formatScanDate,
  pillarBarColor,
} from "@/components/diagnostics/diagnosticsDisplay";
import { HEALTH_PILLAR_LABELS } from "@/components/diagnostics/types";
import type { DiagnosticFindingSeverity } from "@/components/diagnostics/types";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const AMBER = "#fbbf24";
const RED = "#f87171";
const MUTED = "#475569";

const RUN_STATUS_BADGE: Record<string, { label: string; ink: string; bg: string; bd: string }> = {
  completed: { label: "Completed", ink: GRN, bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" },
  partial: { label: "Partial — some checks could not run", ink: AMBER, bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" },
};

const SEVERITY_FILTERS: readonly { key: DiagnosticFindingSeverity | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
  { key: "ok", label: "OK" },
];

/**
 * Diagnostics and Scripts (#3999, Feature #1660, portal epic #1485) — recreated
 * from `Design/portal/design_handoff_full_site/screens/Diagnostics and
 * Scripts.dc.html` per that package's own instruction to rebuild with this
 * codebase's patterns, not ship the HTML reference. The design's own
 * `renderVals()` numbers/findings are its demo fixture; every number here
 * comes from `GET /api/portal/diagnostics/latest` + `GET /api/portal/
 * health-benchmark` (`useDiagnosticsPage`) and the shell's own real scan
 * status (`useScanState`, already polled for the Tenant Status card).
 *
 * The design's "Scripts for you to run" panel is static copy describing
 * today's real, verified truth (§6 of the contract pack: zero checks are
 * flagged `requires_customer_script` anywhere on the platform, so the
 * download path can never succeed today). If a live `requires_script`
 * finding ever appears, this page lists it with a real download button
 * against `GET /api/portal/scripts/:checkKey/download` instead of the
 * static explanation — a real backend capability the design had no live
 * data to draw, not an invented state.
 */
export default function CustomerDiagnosticsPage() {
  const { user } = useAuth();
  const { latest, benchmark, loading, error } = useDiagnosticsPage();
  const scan = useScanState();
  const { downloading, download } = useScriptDownload();
  const [filter, setFilter] = useState<DiagnosticFindingSeverity | "all">("all");

  const noContext = user?.customerId == null;
  const run = latest?.run ?? null;
  const findings = latest?.findings ?? [];
  const scanning = !noContext && (scan.phase === "running" || scan.phase === "late-join" || scan.phase === "disconnected");
  const neverScanned = !noContext && !scanning && run == null && !loading;
  const hasRun = !noContext && run != null;

  const stateLine = noContext
    ? "No organisation on this sign-in"
    : loading
      ? "Reading your diagnostics"
      : error
        ? "Couldn't load — showing what we have"
        : scanning
          ? "Live — a scan is in progress"
          : run
            ? `Live — latest scan ${formatScanDate(run.completedAt ?? run.startedAt)}, ${run.checksTotal} checks`
            : "Live — no scan on record";
  const stateDot = noContext ? RED : error ? RED : neverScanned ? MUTED : GRN;

  const filteredFindings = filter === "all" ? findings : findings.filter((f) => f.severity === filter);
  const requiresScriptFindings = findings.filter((f) => f.checkStatus === "requires_script");

  const runBadge = run ? RUN_STATUS_BADGE[run.status] : null;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }} data-testid="diagnostics-page">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Diagnostics
        </span>
        <span
          title="What the last scan of your tenant found, check by check. Scans are started by your provider against the monitoring package you hold; this page reads the results and never starts one."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)", cursor: "help" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px]" style={{ color: error || noContext ? RED : "#64748b" }} data-testid="diagnostics-state-line">
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
        </span>
      </div>

      {loading && !latest ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {scanning ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl p-3"
              style={{ border: "1px solid rgba(96,165,250,.3)", background: "rgba(96,165,250,.06)" }}
              data-testid="diagnostics-scanning-banner"
            >
              <span className="size-2 flex-none animate-pulse rounded-full" style={{ background: "#60a5fa" }} />
              <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-[#f8fafc]">
                  A scan is running now
                  {scan.startedAt ? ` — started ${formatScanDate(scan.startedAt)}` : ""}
                  {scan.total > 0 ? `, ${scan.index} of ${scan.total} checks done` : ""}
                </span>
                <span className="text-[11px] leading-[1.5] text-[#94a3b8]">
                  Results below are still from the previous scan. This page only picks up a scan once it has finished or
                  finished in part.
                </span>
              </div>
            </div>
          ) : null}

          {neverScanned ? (
            <div className="flex flex-col gap-2 rounded-[14px] p-5" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} data-testid="diagnostics-never-scanned">
              <span className="text-[13.5px] font-semibold text-[#f8fafc]">Your tenant has not been scanned yet</span>
              <span className="max-w-[660px] text-[12px] leading-[1.6] text-[#94a3b8]">
                This is a real read of your organisation's scan history and it holds no runs. There are no findings to
                show because nothing has looked yet — not because your tenant is clean. Scans are started by your
                provider; ask them when the first one is scheduled.
              </span>
            </div>
          ) : null}

          {noContext ? (
            <div className="flex gap-[10px] rounded-xl p-4" style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }} data-testid="diagnostics-no-context">
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-[#f8fafc]">This sign-in is not attached to an organisation</span>
                <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
                  Diagnostics are read per organisation, and your session carries none. That is a property of the
                  login, not a missing scan — a staff or unscoped account lands here. Nothing below can be read until
                  the sign-in is linked to a tenant.
                </span>
              </div>
            </div>
          ) : null}

          {hasRun && run ? (
            <>
              <div className="flex flex-col gap-3 rounded-[14px] p-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} data-testid="diagnostics-latest-scan">
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span className="text-[13.5px] font-semibold text-[#f8fafc]">Latest scan</span>
                  {runBadge ? (
                    <span
                      className="rounded-full px-[9px] py-[3px] text-[10px] font-semibold"
                      style={{ color: runBadge.ink, background: runBadge.bg, border: `1px solid ${runBadge.bd}` }}
                    >
                      {runBadge.label}
                    </span>
                  ) : null}
                  <span className="ml-auto font-mono text-[10.5px] text-[#64748b]">
                    {run.packageKey} · {formatScanDate(run.completedAt ?? run.startedAt)}
                  </span>
                </div>
                <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
                  {[
                    { label: "CHECKS", n: run.checksTotal, ink: "#f8fafc", note: "in the security baseline package" },
                    { label: "PASSED", n: run.checksOk, ink: GRN, note: "ran and returned a result" },
                    { label: "LICENCE-BLOCKED", n: run.checksLicenseGap, ink: AMBER, note: "need a licence your tenant lacks" },
                    { label: "ERRORS", n: run.checksError, ink: RED, note: "a technical failure, not your setup" },
                    { label: "NEED A SCRIPT", n: run.checksRequiresScript, ink: "#94a3b8", note: "flagged on the platform today" },
                  ].map((c) => (
                    <div key={c.label} className="flex flex-col gap-[3px] rounded-[10px] p-[11px_13px]" style={{ border: `1px solid rgba(255,255,255,.07)`, background: "rgba(255,255,255,.015)" }}>
                      <span className="text-[9px] font-bold uppercase tracking-[.09em]" style={{ color: MUTED }}>
                        {c.label}
                      </span>
                      <span className="text-[20px] font-bold" style={{ color: c.ink, fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em" }}>
                        {c.n}
                      </span>
                      <span className="text-[10.5px] leading-[1.4] text-[#64748b]">{c.note}</span>
                    </div>
                  ))}
                </div>
                {run.status === "partial" ? (
                  <span className="max-w-[680px] text-[11px] leading-[1.55]" style={{ color: MUTED }}>
                    "Partial" means the scan finished but some checks were blocked — most by licences your tenant does
                    not hold, which is counted apart from technical errors so it never reads as a failure of your
                    setup.
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 rounded-[14px] p-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} data-testid="diagnostics-findings">
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span className="text-[13.5px] font-semibold text-[#f8fafc]">Findings</span>
                  <span className="text-[11px] text-[#64748b]">
                    {filteredFindings.length} of {findings.length} shown · newest scan only
                  </span>
                  <div className="ml-auto flex flex-wrap gap-[6px]">
                    {SEVERITY_FILTERS.map((f) => {
                      const on = filter === f.key;
                      const tokens = f.key === "all"
                        ? { ink: "#cbd5e1", bg: "rgba(255,255,255,.06)", bd: "rgba(255,255,255,.18)" }
                        : SEVERITY_TOKENS[f.key];
                      return (
                        <span
                          key={f.key}
                          role="button"
                          onClick={() => setFilter(f.key)}
                          className="cursor-pointer whitespace-nowrap rounded-full px-[10px] py-[3px] text-[10.5px] font-semibold"
                          style={{
                            color: on ? tokens.ink : "#64748b",
                            background: on ? tokens.bg : "transparent",
                            border: `1px solid ${on ? tokens.bd : "rgba(255,255,255,.1)"}`,
                          }}
                          data-testid={`diagnostics-filter-${f.key}`}
                        >
                          {f.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {filteredFindings.length === 0 ? (
                  <span className="text-[12px] text-[#64748b]">No findings match this filter.</span>
                ) : (
                  filteredFindings.map((fd) => {
                    const sev = SEVERITY_TOKENS[fd.severity];
                    const needsScript = fd.checkStatus === "requires_script";
                    return (
                      <div
                        key={fd.findingId}
                        className="flex items-start gap-3 py-[11px]"
                        style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}
                        data-testid={`diagnostics-finding-${fd.checkKey}`}
                      >
                        <span className="mt-px w-[66px] flex-none">
                          <span
                            className="block w-[66px] rounded-full py-[3px] text-center text-[10px] font-semibold"
                            style={{ color: sev.ink, background: sev.bg, border: `1px solid ${sev.bd}` }}
                          >
                            {fd.severity}
                          </span>
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <span className="text-[12.5px] leading-[1.4] text-[#e2e8f0]">{fd.title}</span>
                          {fd.description ? (
                            <span className="text-[11.5px] leading-[1.5] text-[#94a3b8]">{fd.description}</span>
                          ) : null}
                          <span className="font-mono text-[10.5px] text-[#64748b]">{fd.checkLabel}</span>
                        </div>
                        <div className="flex flex-none flex-col items-end gap-1 text-right">
                          <span className="max-w-[150px] whitespace-normal text-[10.5px] leading-[1.5]" style={{ color: checkStatusInk(fd.checkStatus) }}>
                            {checkStatusLabel(fd.checkStatus)}
                          </span>
                          {needsScript ? (
                            <button
                              type="button"
                              onClick={() => void download(fd.checkKey, `${fd.checkKey}.ps1`)}
                              disabled={downloading === fd.checkKey}
                              className="inline-flex items-center gap-1 rounded-full px-[9px] py-[3px] text-[10px] font-semibold"
                              style={{ color: "#60a5fa", background: "rgba(96,165,250,.10)", border: "1px solid rgba(96,165,250,.3)" }}
                              data-testid={`diagnostics-download-${fd.checkKey}`}
                            >
                              {downloading === fd.checkKey ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Download className="size-3" />
                              )}
                              Download script
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
                <span className="block pt-[10px] text-[10.5px] leading-[1.55] text-[#475569]" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                  Each finding carries its title, description and the check it came from. The raw data pulled from
                  Microsoft behind a finding, and the provider's remediation notes, are not part of what this page is
                  given.
                </span>
              </div>

              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
                <div className="flex flex-col gap-3 rounded-[14px] p-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} data-testid="diagnostics-pillar-health">
                  <div className="flex flex-wrap items-center gap-[10px]">
                    <span className="text-[13.5px] font-semibold text-[#f8fafc]">Architecture health by pillar</span>
                    <span className="text-[11px] text-[#64748b]">your tenant, from the latest scan</span>
                  </div>
                  <div className="flex flex-col gap-[9px]">
                    {(benchmark?.pillars ?? []).map((p) => {
                      const label = HEALTH_PILLAR_LABELS[p.pillar] ?? p.pillar;
                      const scored = p.displayScore != null;
                      return (
                        <div key={p.pillar} className="flex flex-col gap-1">
                          <div className="flex items-baseline gap-[10px]">
                            <span className="flex-1 text-[12px] text-[#e2e8f0]">{label}</span>
                            <span className="text-[12px] font-semibold" style={{ color: scored ? "#f8fafc" : MUTED, fontVariantNumeric: "tabular-nums" }}>
                              {scored ? p.displayScore : "—"}
                            </span>
                          </div>
                          <div className="h-[5px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.06)" }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: scored ? `${p.displayScore}%` : "0%", background: scored ? pillarBarColor(p.displayScore!) : MUTED }}
                            />
                          </div>
                          {!scored ? <span className="text-[10.5px] text-[#64748b]">Not enough signals yet</span> : null}
                        </div>
                      );
                    })}
                  </div>
                  {benchmark?.asOfDate == null ? (
                    <span className="pt-[10px] text-[11px] leading-[1.55] text-[#475569]" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                      No industry comparison is shown. The reference set it would come from holds no rows yet, so every
                      "industry average" would be blank — the bars are yours alone, and say so.
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-[11px] rounded-[14px] p-4" style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }} data-testid="diagnostics-scripts">
                  <div className="flex flex-wrap items-center gap-[10px]">
                    <span className="text-[13.5px] font-semibold text-[#f8fafc]">Scripts for you to run</span>
                    <span
                      className="rounded-full px-[9px] py-[3px] text-[10px] font-semibold"
                      style={{ color: "#94a3b8", background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.22)" }}
                    >
                      {requiresScriptFindings.length === 0 ? "None" : requiresScriptFindings.length}
                    </span>
                  </div>
                  <span className="text-[12px] leading-[1.6] text-[#94a3b8]">
                    Some checks can only be completed by a PowerShell script run inside your tenant. When a scan marks
                    a check that way, its script downloads from here, scoped to the checks your own scan surfaced.
                  </span>
                  {requiresScriptFindings.length === 0 ? (
                    <>
                      <span className="text-[12px] leading-[1.6] text-[#cbd5e1]">
                        No check in your scan needs one, and no check on the platform is flagged that way today. This
                        section is empty because nothing exists to fill it.
                      </span>
                      <span className="pt-[10px] text-[10.5px] leading-[1.5] text-[#475569]" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
                        Attaching a script to a check is done from the provider side. Until one is, this list stays
                        honest and empty.
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {requiresScriptFindings.map((fd) => (
                        <div key={fd.findingId} className="flex items-center gap-2 rounded-[10px] p-2" style={{ border: `1px solid ${HAIRLINE}` }}>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-[#e2e8f0]">{fd.checkLabel}</span>
                          <button
                            type="button"
                            onClick={() => void download(fd.checkKey, `${fd.checkKey}.ps1`)}
                            disabled={downloading === fd.checkKey}
                            className="inline-flex flex-none items-center gap-1 rounded-full px-[9px] py-[3px] text-[10px] font-semibold"
                            style={{ color: "#60a5fa", background: "rgba(96,165,250,.10)", border: "1px solid rgba(96,165,250,.3)" }}
                            data-testid={`diagnostics-scripts-download-${fd.checkKey}`}
                          >
                            {downloading === fd.checkKey ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                            Download
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

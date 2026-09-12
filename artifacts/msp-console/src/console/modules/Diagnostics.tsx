/**
 * Diagnostics — MSP Console module page (Git #2653, Feature #2571). Mounts
 * into the shell's `ScreenSlot` at `/tenants/:id/diag`
 * (`Design/MSP_Console/design_handoff_msp_console/Diagnostics.dc.html`,
 * README screen 5). Four tabs, faithful to the design's own logic class:
 *
 *   Runs      — diagnostics run history for this customer.
 *   Findings  — the selected run's structured findings, severity-ranked by the
 *               server (#3388's fix — msp-diagnostics.ts's findingSeverityRank
 *               — so this tab never re-sorts client-side; the API is already
 *               the single source of truth for order).
 *   Scripts   — requires_script findings on the latest run, with a real
 *               download where a script package is actually assigned.
 *   Packages  — the real monitoring-package catalogue an operator can trigger
 *               a run against.
 *
 * Every row comes from `src/api/diagnostics-api.ts`'s live hooks — no
 * fixture, no fabricated row. Per-item acknowledge (#3399/#3366) calls the
 * one real mechanism that exists for it: the cross-tenant Alerts feed's
 * `POST /api/msp/alerts/finding-<id>/acknowledge` — see that hook's own
 * comment for why `msp_diagnostic_findings` has no route of its own.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  useAcknowledgeFinding,
  useDiagnosticRunDetail,
  useDiagnosticRuns,
  useDiagnosticScripts,
  useDownloadScript,
  useMonitoringPackages,
  useResolvedMonitoringPackage,
  useTriggerDiagnosticsRun,
  type DiagnosticFinding,
  type DiagnosticFindingSeverity,
  type DiagnosticRun,
} from "@/api/diagnostics-api";

type Tab = "runs" | "findings" | "scripts" | "packages";

const TONE: Record<string, { strong: string; text: string; tint: string; border: string }> = {
  green: signal.ok,
  amber: signal.warning,
  red: signal.critical,
  blue: signal.info,
  violet: { strong: signal.notice.strong, text: "#ddd6fe", tint: signal.notice.tint, border: signal.notice.border },
  slate: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};

const SEVERITY_TONE: Record<DiagnosticFindingSeverity, keyof typeof TONE> = {
  critical: "red", warning: "amber", info: "blue", ok: "green",
};
const RUN_STATUS_TONE: Record<string, keyof typeof TONE> = {
  completed: "green", partial: "amber", failed: "red", running: "blue", pending: "slate",
};
const NARRATIVE_TONE: Record<string, keyof typeof TONE> = {
  ready: "green", generating: "violet", failed: "red", not_started: "slate",
};
const CHECK_STATUS_COLOR: Record<string, string> = {
  ok: signal.ok.text, license_gap: "#c4b5fd", service_not_configured: text.muted,
  error: signal.critical.text, partial: signal.warning.text, requires_script: signal.info.text,
};

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}

function pill(t: { strong: string; text: string; tint: string; border: string }, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}

function emptyState(icon: string, tone: keyof typeof TONE, title: string, body: string) {
  const t = TONE[tone];
  return (
    <div style={cardStyle({ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: t.tint, border: `1px solid ${t.border}`, padding: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={t.strong} />
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 460, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

function formatRunCounts(r: DiagnosticRun): string {
  const total = r.checksTotal ?? 0;
  const ok = r.checksOk ?? 0;
  const gap = r.checksLicenseGap ?? 0;
  const err = r.checksError ?? 0;
  if (total === 0) return "0 checks ran";
  return `${total} checks · ${ok} ok · ${gap} license gap · ${err} error`;
}

export function Diagnostics({ customerId }: { customerId: number }) {
  const [tab, setTab] = useState<Tab>("runs");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [pickKey, setPickKey] = useState<string | null>(null);

  const packages = useMonitoringPackages();
  const resolved = useResolvedMonitoringPackage(customerId);
  const resolvedKey = resolved.data?.packageKey ?? "core:security-baseline";

  const runsQuery = useDiagnosticRuns(customerId, {
    // Poll while any run for this tenant hasn't reached a terminal state, so a
    // just-triggered run's status moves off "pending"/"running" without a
    // manual refresh — real polling, not a fabricated progress percentage.
    refetchIntervalMs: 4000,
  });
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const hasInFlightRun = runs.some((r) => r.status === "pending" || r.status === "running");

  // Default the findings-tab selection to the most recent run once runs load.
  useEffect(() => {
    if (selectedRunId === null && runs.length > 0) setSelectedRunId(runs[0]!.runId);
  }, [runs, selectedRunId]);

  const runDetail = useDiagnosticRunDetail(customerId, tab === "findings" ? selectedRunId : null);
  const scripts = useDiagnosticScripts(customerId);
  const trigger = useTriggerDiagnosticsRun(customerId);
  const download = useDownloadScript(customerId);
  const acknowledge = useAcknowledgeFinding(customerId, selectedRunId);

  const selectedRun = runs.find((r) => r.runId === selectedRunId) ?? null;
  const findings = runDetail.data?.findings ?? [];

  const tabDefs: { id: Tab; label: string; count: string }[] = [
    { id: "runs", label: "Runs", count: String(runs.length) },
    { id: "findings", label: "Findings", count: tab === "findings" ? String(findings.length) : "—" },
    { id: "scripts", label: "Scripts", count: String(scripts.data?.scripts.length ?? 0) },
    { id: "packages", label: "Packages", count: String(packages.data?.packages.length ?? 0) },
  ];

  const effectivePick = pickKey ?? resolvedKey;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => setRunOpen((v) => !v)}
          disabled={trigger.isPending}
          style={{
            display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8,
            border: `1px solid ${action.base}`, background: action.base, color: "#fff", fontSize: 12.5, fontWeight: 600,
            cursor: trigger.isPending ? "wait" : "pointer", whiteSpace: "nowrap",
          }}
        >
          <Icon name="scan-line" size={14} />
          Run diagnostics
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 9, height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.5)", minWidth: 0 }}>
          <Icon name="package" size={13} color={text.label} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: resolved.data?.packageKey ? signal.info.text : text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {resolved.data?.packageKey ?? "no active subscription"}
            </span>
            <span style={{ fontSize: 10, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {resolved.data?.packageKey
                ? `${resolved.data.serviceName ?? "monitoring subscription"} · service ${resolved.data.serviceId}`
                : "Falls back to core:security-baseline on trigger"}
            </span>
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{runs.length} runs</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabDefs.map((t) => {
          const activeTab = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${activeTab ? "rgba(96,165,250,.3)" : border.card}`,
                background: activeTab ? "rgba(37,99,235,.18)" : "transparent",
                color: activeTab ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: activeTab ? signal.info.strong : text.faint }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {runOpen && (
        <div style={{ border: `1px solid ${signal.info.border}`, borderRadius: 12, background: "rgba(37,99,235,.06)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>TRIGGER A RUN</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>Their own package is preselected. Any other bundle can be run instead.</span>
          </div>
          {packages.isLoading && <span style={{ fontSize: 11.5, color: text.muted }}>Loading packages…</span>}
          {packages.isError && <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load monitoring packages.</span>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(232px,1fr))", gap: 9 }}>
            {(packages.data?.packages ?? []).map((p) => {
              const active = effectivePick === p.key;
              const isDefault = p.key === resolvedKey;
              const t = active ? TONE.blue : isDefault ? TONE.amber : TONE.slate;
              return (
                <button
                  key={p.key}
                  onClick={() => setPickKey(p.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9,
                    border: `1px solid ${active ? t.border : border.card}`,
                    background: active ? "rgba(37,99,235,.16)" : "rgba(2,6,23,.4)",
                    cursor: "pointer", textAlign: "left", minWidth: 0,
                  }}
                >
                  <Icon name={active ? "circle-check-big" : isDefault ? "star" : "circle"} size={14} color={active ? signal.info.strong : isDefault ? signal.warning.strong : text.faint} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.key}
                    </span>
                    <span style={{ fontSize: 10.5, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isDefault ? `${p.label} · resolved default` : p.label}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: text.muted, whiteSpace: "nowrap" }}>{p.checkCount} checks</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                trigger.mutate(effectivePick === resolvedKey ? undefined : effectivePick, {
                  onSuccess: () => { setRunOpen(false); setTab("runs"); toast.success("Diagnostics run started"); },
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start diagnostics run"),
                });
              }}
              disabled={trigger.isPending}
              style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8, border: `1px solid ${action.base}`, background: action.base, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: trigger.isPending ? "wait" : "pointer" }}
            >
              <Icon name={trigger.isPending ? "loader" : "play"} size={13} className={trigger.isPending ? "smc-spin" : undefined} />
              {trigger.isPending ? "Starting…" : `Start ${effectivePick}`}
            </button>
            <button onClick={() => setRunOpen(false)} style={{ height: 34, padding: "0 13px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12.5, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {hasInFlightRun && (
        <div style={{ border: `1px solid ${signal.info.border}`, borderRadius: 12, background: signal.info.tint, padding: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="radar" size={15} color={signal.info.strong} />
          <span style={{ fontSize: 12, color: text.body }}>A run is in progress for this tenant — this list refreshes automatically.</span>
        </div>
      )}

      {tab === "runs" && (
        runsQuery.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading runs…</span> :
        runsQuery.isError ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load diagnostics runs.</span> :
        runs.length === 0 ? emptyState("stethoscope", "blue", "Never scanned", "Start a run and it uses this customer's own monitoring package, or the security baseline if they aren't subscribed to one.") :
        <RunsTable runs={runs} onOpen={(runId) => { setSelectedRunId(runId); setTab("findings"); }} />
      )}

      {tab === "findings" && (
        <FindingsTab
          runs={runs}
          selectedRunId={selectedRunId}
          selectedRun={selectedRun}
          onSelectRun={setSelectedRunId}
          findings={findings}
          loading={runDetail.isLoading}
          error={runDetail.isError}
          onAcknowledge={(findingId) => acknowledge.mutate(findingId, {
            onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to acknowledge finding"),
          })}
          acknowledging={acknowledge.isPending ? acknowledge.variables ?? null : null}
        />
      )}

      {tab === "scripts" && (
        scripts.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading scripts…</span> :
        scripts.isError ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load scripts.</span> :
        (scripts.data?.scripts.length ?? 0) === 0
          ? emptyState("file-code", "violet", "No scripts to hand over", "Some checks can't be fixed from this console — those hand back a script for the customer's own admin to run. Nothing in this estate has produced one yet.")
          : <ScriptsTable scripts={scripts.data!.scripts} onDownload={(checkKey) => download.mutate(checkKey, {
              onError: (err) => toast.error(err instanceof Error ? err.message : "Download failed"),
            })} downloading={download.isPending ? download.variables ?? null : null} />
      )}

      {tab === "packages" && (
        packages.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading packages…</span> :
        packages.isError ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load monitoring packages.</span> :
        <PackagesTable packages={packages.data?.packages ?? []} resolvedKey={resolvedKey} />
      )}
    </div>
  );
}

// ── Runs tab ──────────────────────────────────────────────────────────────────

function RunsTable({ runs, onOpen }: { runs: DiagnosticRun[]; onOpen: (runId: string) => void }) {
  return (
    <div style={cardStyle({ overflowX: "auto" })}>
      <div style={{ minWidth: 1060 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr .9fr 2.2fr 1.1fr 1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>RUN</span><span>PACKAGE</span><span>STATUS</span><span>CHECKS</span><span>STARTED</span><span>CIO NARRATIVE</span>
        </div>
        {runs.map((r) => {
          const st = TONE[RUN_STATUS_TONE[r.status] ?? "slate"];
          const na = TONE[NARRATIVE_TONE[r.cioNarrativeStatus] ?? "slate"];
          return (
            <div
              key={r.runId}
              onClick={() => onOpen(r.runId)}
              style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr .9fr 2.2fr 1.1fr 1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer" }}
            >
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: signal.info.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.runId}</span>
                <span style={{ fontSize: 11, color: text.label }}>{r.triggeredByUserId ? "operator" : "scheduled"}</span>
              </span>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.packageKey}</span>
              <span style={pill(st, { justifySelf: "start" })}>{r.status}</span>
              <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatRunCounts(r)}</span>
              <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString()}</span>
              <span style={pill(na, { justifySelf: "start" })}>{r.cioNarrativeStatus}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Findings tab ──────────────────────────────────────────────────────────────

function FindingsTab({
  runs, selectedRunId, selectedRun, onSelectRun, findings, loading, error, onAcknowledge, acknowledging,
}: {
  runs: DiagnosticRun[]; selectedRunId: string | null; selectedRun: DiagnosticRun | null;
  onSelectRun: (runId: string) => void; findings: DiagnosticFinding[]; loading: boolean; error: boolean;
  onAcknowledge: (findingId: string) => void; acknowledging: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {runs.map((r) => {
          const active = selectedRunId === r.runId;
          return (
            <button
              key={r.runId}
              onClick={() => onSelectRun(r.runId)}
              style={{
                height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontFamily: "Menlo, monospace", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {r.runId}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Ordered most severe first — server-ranked (#3388), not re-sorted here.</span>
      </div>

      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading findings…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load findings.</span> :
       findings.length === 0 ? emptyState(
          "stethoscope", "blue",
          selectedRun ? "This run recorded no findings" : "No run selected",
          selectedRun?.status === "failed"
            ? "The run failed before it could read anything, so it produced no findings at all — not a clean result."
            : "Findings only exist once a run has executed against a connected tenant.",
        ) :
       <div style={cardStyle({ overflowX: "auto" })}>
        <div style={{ minWidth: 1260 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.4fr .9fr 1.2fr 2fr 1.5fr 1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
            <span>CHECK</span><span>LABEL</span><span>SEVERITY</span><span>CHECK STATUS</span><span>FINDING</span><span>CLASSIFICATION</span><span style={{ textAlign: "right" }}>ACTION</span>
          </div>
          {findings.map((f) => {
            const sv = TONE[SEVERITY_TONE[f.severity]];
            const canAcknowledge = (f.severity === "warning" || f.severity === "critical") && !f.acknowledgedAt;
            return (
              <div key={f.findingId} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.4fr .9fr 1.2fr 2fr 1.5fr 1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.checkKey}</span>
                <span style={{ fontSize: 12, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.checkLabel}</span>
                <span style={pill(sv, { justifySelf: "start" })}>{f.severity}</span>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: CHECK_STATUS_COLOR[f.checkStatus ?? "ok"] ?? text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.checkStatus ?? "—"}</span>
                <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{f.title}</span>
                <span style={{ fontSize: 11.5, color: f.classification ? "#c4b5fd" : text.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.classification ? f.classification.label : "—"}
                </span>
                <span style={{ justifySelf: "end" }}>
                  {f.acknowledgedAt ? (
                    <span style={pill(TONE.slate)}>
                      <Icon name="circle-check-big" size={11} />
                      acknowledged
                    </span>
                  ) : canAcknowledge ? (
                    <button
                      onClick={() => onAcknowledge(f.findingId)}
                      disabled={acknowledging === f.findingId}
                      style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: acknowledging === f.findingId ? "wait" : "pointer", whiteSpace: "nowrap" }}
                    >
                      {acknowledging === f.findingId ? "Acknowledging…" : "Acknowledge"}
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: text.faint }}>—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>}
    </div>
  );
}

// ── Scripts tab ───────────────────────────────────────────────────────────────

function ScriptsTable({
  scripts, onDownload, downloading,
}: { scripts: { findingId: string; checkKey: string; checkLabel: string; severity: DiagnosticFindingSeverity; title: string; filename: string | null; available: boolean }[]; onDownload: (checkKey: string) => void; downloading: string | null }) {
  return (
    <div style={cardStyle({ overflowX: "auto" })}>
      <div style={{ minWidth: 900 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.4fr .9fr 2fr 1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>CHECK</span><span>LABEL</span><span>SEVERITY</span><span>FINDING</span><span style={{ textAlign: "right" }}>SCRIPT</span>
        </div>
        {scripts.map((s) => {
          const sv = TONE[SEVERITY_TONE[s.severity]];
          return (
            <div key={s.findingId} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.4fr .9fr 2fr 1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.checkKey}</span>
              <span style={{ fontSize: 12, color: text.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.checkLabel}</span>
              <span style={pill(sv, { justifySelf: "start" })}>{s.severity}</span>
              <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{s.title}</span>
              <span style={{ justifySelf: "end" }}>
                {s.available ? (
                  <button
                    onClick={() => onDownload(s.checkKey)}
                    disabled={downloading === s.checkKey}
                    style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${signal.notice.border}`, background: signal.notice.tint, color: "#ddd6fe", fontSize: 11.5, fontWeight: 600, cursor: downloading === s.checkKey ? "wait" : "pointer", whiteSpace: "nowrap" }}
                  >
                    <Icon name="download" size={12} />
                    {downloading === s.checkKey ? "Downloading…" : (s.filename ?? "Download")}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: text.faint }}>no script assigned yet</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Packages tab ──────────────────────────────────────────────────────────────

function PackagesTable({ packages, resolvedKey }: { packages: { key: string; label: string; checkCount: number }[]; resolvedKey: string }) {
  return (
    <div style={cardStyle({ overflowX: "auto" })}>
      <div style={{ minWidth: 720 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 2.2fr .9fr 1.1fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.sidebar}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
          <span>KEY</span><span>LABEL</span><span style={{ textAlign: "right" }}>CHECKS</span><span>USE</span>
        </div>
        {packages.map((p) => {
          const isDefault = p.key === resolvedKey;
          const t = isDefault ? TONE.blue : TONE.slate;
          return (
            <div key={p.key} style={{ display: "grid", gridTemplateColumns: "2fr 2.2fr .9fr 1.1fr", gap: 12, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${border.faint}` }}>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.key}</span>
              <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.body, textAlign: "right" }}>{p.checkCount}</span>
              <span style={pill(t, { justifySelf: "start" })}>{isDefault ? "resolved default" : "selectable"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

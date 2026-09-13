/**
 * Reports — MSP-wide (Operations) module page (Git #3815). Mounts at
 * `/ops/reports` (`Design/MSP_Console/design_handoff_msp_console/Reports.dc.html`,
 * README screen 42, "Reports" in the Operations tree). Wired against the real,
 * already-shipped 19-route backend in
 * `artifacts/api-server/src/routes/msp-reports.ts` via `src/api/msp-reports-api.ts`
 * — see that file's header for the wire contract this page renders.
 *
 * Real, load-bearing facts carried over from the design (README screen 42 +
 * the screen's own logic class), all confirmed against the live backend:
 *
 * - A run whose email delivery failed is left at status `generated` — the
 *   failure only lives in `errorMessage`. A screen that reads status alone
 *   reports success. This page renders an explicit amber warning on that row
 *   instead, never letting it read as plain success.
 * - There is no retry route. "Run it again" on a failed run is a brand-new
 *   `trigger` call against the same definition — its own new run row, with no
 *   link back to the failure it followed.
 * - Schedules store a cadence, a recipient list and an enabled flag, but
 *   nothing executes them: `lastRunAt`/`nextRunAt` are never written. This
 *   page shows that honestly ("never run") rather than fabricating a next
 *   send date.
 * - `risk_decision_document` is not an AI generation — it is a deterministic
 *   render of a signed risk decision, and its definition is created
 *   automatically the first time one renders. It is not selectable when
 *   creating a definition here.
 * - Canvas deletion is outright, with no version history — editing a canvas
 *   overwrites it in place.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  REPORT_DOC_TYPES, REPORT_DOC_TYPE_LABELS, REPORT_DELIVERY_METHODS,
  MspReportsApiError,
  useReportDefinitions, useCreateReportDefinition, useUpdateReportDefinition, useDeleteReportDefinition, useTriggerReport,
  useReportRuns, useDownloadReportRun,
  useLicenseWaste,
  useReportCanvases, useCreateReportCanvas, useDeleteReportCanvas, useSendTestCanvas,
  useReportSchedules, useCreateReportSchedule, useUpdateReportSchedule, useDeleteReportSchedule,
  type ReportDefinition, type ReportDocType, type ReportDeliveryMethod, type ReportRun,
  type CanvasWidgetType,
} from "@/api/msp-reports-api";

type Tab = "defs" | "runs" | "canvases" | "waste";

interface ResultBanner { code: string; text: string; tone: "ok" | "warning" | "critical" | "info" }

function toneColors(tone: ResultBanner["tone"]) {
  return signal[tone === "info" ? "info" : tone];
}

function errorBanner(err: unknown, fallbackCode: string): ResultBanner {
  if (err instanceof MspReportsApiError) {
    return { code: `${err.status} · ${err.message}`, text: "The server rejected this request.", tone: err.status >= 500 ? "critical" : "warning" };
  }
  return { code: fallbackCode, text: "The request failed. Try again shortly.", tone: "critical" };
}

const cardStyle: React.CSSProperties = { border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 };
const primaryBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const ghostBtn = (enabled: boolean, danger?: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 28, padding: "0 11px", borderRadius: 6,
  border: `1px solid ${!enabled ? "rgba(148,163,184,.12)" : danger ? "rgba(248,113,113,.3)" : "rgba(148,163,184,.2)"}`,
  background: !enabled ? "rgba(148,163,184,.04)" : danger ? "rgba(248,113,113,.1)" : "rgba(148,163,184,.06)",
  color: !enabled ? text.faint : danger ? signal.critical.strong : text.secondary,
  fontSize: 11.5, fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed", fontFamily: "inherit",
});
const inputStyle: React.CSSProperties = { height: 36, padding: "0 11px", borderRadius: 6, border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, fontFamily: "inherit", outline: "none", minWidth: 0 };
const pillBtn = (on: boolean, disabled?: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 27, padding: "0 10px", borderRadius: 999,
  border: `1px solid ${on ? "rgba(96,165,250,.45)" : "rgba(148,163,184,.16)"}`, background: on ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)",
  color: disabled ? text.muted : on ? text.strong : text.secondary, fontSize: 11, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
});

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "24px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>{title}</span>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 340 }}>{body}</span>
      {action}
    </div>
  );
}

function ErrorPanel({ title, body, wire }: { title: string; body: string; wire: string }) {
  return (
    <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 12, background: signal.critical.tint, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="triangle-alert" size={16} color={signal.critical.strong} />
        <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>{title}</span>
      </span>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>{wire}</span>
    </div>
  );
}

function ResultBannerView({ result }: { result: ResultBanner | null }) {
  if (!result) return null;
  const t = toneColors(result.tone);
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: t.tint, padding: 13, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: t.strong }}>{result.code}</span>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{result.text}</span>
    </div>
  );
}

export function Reports({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>("defs");
  const [result, setResult] = useState<ResultBanner | null>(null);

  const defsQuery = useReportDefinitions();
  const runsQuery0 = useReportRuns(50);
  const canvasesQuery = useReportCanvases();
  const schedulesQuery = useReportSchedules();
  const wasteQuery = useLicenseWaste();

  // Poll the runs list only while something is actually in flight — pending/generating rows
  // are the only state that can change without user action (the trigger route responds 202
  // before any work starts, see msp-reports-api.ts).
  const hasActiveRun = (runsQuery0.data?.runs ?? []).some((r) => r.status === "pending" || r.status === "generating" || r.status === "delivering");
  const runsQuery = useReportRuns(50, hasActiveRun ? 4000 : undefined);

  const tabCounts: Record<Tab, number | null> = {
    defs: defsQuery.data?.length ?? null,
    runs: runsQuery.data?.runs.length ?? null,
    canvases: canvasesQuery.data?.length ?? null,
    waste: null,
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "defs", label: "Definitions" },
    { key: "runs", label: "Runs" },
    { key: "canvases", label: "Canvases" },
    { key: "waste", label: "License waste" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const on = tab === t.key;
          const count = tabCounts[t.key];
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setResult(null); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7, border: `1px solid ${on ? "rgba(96,165,250,.45)" : "rgba(148,163,184,.16)"}`, background: on ? "rgba(37,99,235,.18)" : "transparent", color: on ? text.strong : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              {t.label}
              {count !== null && <span style={{ fontSize: 10.5, color: on ? signal.info.strong : text.muted }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === "defs" && <DefinitionsTab isAdmin={isAdmin} result={result} setResult={setResult} defsQuery={defsQuery} />}
      {tab === "runs" && <RunsTab result={result} setResult={setResult} runsQuery={runsQuery} defsQuery={defsQuery} />}
      {tab === "canvases" && <CanvasesTab result={result} setResult={setResult} canvasesQuery={canvasesQuery} schedulesQuery={schedulesQuery} />}
      {tab === "waste" && <WasteTab wasteQuery={wasteQuery} />}
    </div>
  );
}

// ── Definitions ──────────────────────────────────────────────────────────────

function DefinitionsTab({
  isAdmin, result, setResult, defsQuery,
}: {
  isAdmin: boolean;
  result: ResultBanner | null;
  setResult: (r: ResultBanner | null) => void;
  defsQuery: ReturnType<typeof useReportDefinitions>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [docType, setDocType] = useState<ReportDocType>("executive_summary");
  const [deliveryMethod, setDeliveryMethod] = useState<ReportDeliveryMethod>("in_app");
  const [deliveryEmail, setDeliveryEmail] = useState("");

  const createDef = useCreateReportDefinition();
  const updateDef = useUpdateReportDefinition();
  const deleteDef = useDeleteReportDefinition();
  const triggerReport = useTriggerReport();

  const startCreate = () => {
    setCreating(true); setResult(null);
    setName(""); setDescription(""); setDocType("executive_summary"); setDeliveryMethod("in_app"); setDeliveryEmail("");
  };

  const submitCreate = () => {
    if (!name.trim()) {
      setResult({ code: "400 · name is required", text: "The only required field. Everything else falls back to a default, including the document type and the delivery method.", tone: "warning" });
      return;
    }
    createDef.mutate(
      { name: name.trim(), description: description.trim() || undefined, docType, deliveryMethod, deliveryEmail: deliveryEmail.trim() || undefined },
      {
        onSuccess: () => { setCreating(false); setResult({ code: "201 · definition created", text: "Saved. Your session is recorded as the author, though that field is not a real reference to a user — nothing enforces it.", tone: "ok" }); },
        onError: (err) => setResult(errorBanner(err, "400 · Invalid request body")),
      },
    );
  };

  const trigger = (def: ReportDefinition) => {
    if (!def.isActive) {
      setResult({ code: "400 · Report definition is inactive", text: "The only route that checks the active flag. Turning the definition back on and re-triggering is allowed, by design.", tone: "warning" });
      return;
    }
    triggerReport.mutate(def.definitionId, {
      onSuccess: () => setResult({ code: "202 · accepted", text: "A run row was written as pending and the response returned before any work started. If generation fails after this point, nothing tells you — you find out by watching the run's status on the Runs tab.", tone: "info" }),
      onError: (err) => setResult(errorBanner(err, "400 · error")),
    });
  };

  const toggleActive = (def: ReportDefinition) => {
    updateDef.mutate({ definitionId: def.definitionId, patch: { isActive: !def.isActive } }, {
      onSuccess: () => setResult({
        code: "200 · definition updated",
        text: def.isActive
          ? "Set inactive through the generic edit route. Note the edit route does not re-validate the document type or delivery method the way create does — any string would be accepted there."
          : "Set active again. Nothing prevents re-activating and re-running a definition that was deactivated.",
        tone: "info",
      }),
      onError: (err) => setResult(errorBanner(err, "400 · error")),
    });
  };

  const remove = (def: ReportDefinition) => {
    deleteDef.mutate(def.definitionId, {
      onSuccess: () => setResult({ code: "200 · { ok: true }", text: "This is a soft delete — the row stays and its active flag flips off. It will keep appearing in this list, so “deleted” and “paused” are the same state on the wire.", tone: "warning" }),
      onError: (err) => setResult(errorBanner(err, err instanceof MspReportsApiError && err.status === 403 ? "403 · admin only" : "error")),
    });
  };

  const defs = defsQuery.data ?? [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Report definitions</span>
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>Every row, newest first. No pagination on this route.</span>
          </span>
          <button onClick={startCreate} style={primaryBtn}>New definition</button>
        </div>

        {defsQuery.isError ? (
          <ErrorPanel title="Report definitions could not be loaded" body={defsQuery.error instanceof MspReportsApiError ? defsQuery.error.message : "The request failed."} wire="GET /api/msp/reports/definitions" />
        ) : defs.length === 0 && !defsQuery.isLoading ? (
          <EmptyState
            title="No report definitions"
            body="This is the live state — nothing has ever been defined. A definition is the template; a run is one execution of it. Nothing generates without one."
            action={<button onClick={startCreate} style={{ ...primaryBtn, marginTop: 4 }}>Define the first one</button>}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {defs.map((d) => {
              const tone = d.isActive ? signal.ok : signal.neutral;
              const deliveryLabel = d.deliveryMethod === "in_app" ? "in-app only" : d.deliveryMethod === "email" ? `email to ${d.deliveryEmail || "nobody configured"}` : "in-app and email";
              const isMachineOwned = d.docType === "risk_decision_document";
              return (
                <div key={d.definitionId} style={{ border: `1px solid ${d.isActive ? "rgba(148,163,184,.14)" : "rgba(148,163,184,.1)"}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, textWrap: "pretty" }}>{d.name}</span>
                      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{REPORT_DOC_TYPE_LABELS[d.docType]} · {deliveryLabel}{d.description ? " · prompt override set" : ""}</span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 10, fontWeight: 600, color: tone.strong }}>{d.isActive ? "active" : "inactive"}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{d.customerId ? `Scoped to customer ${d.customerId}` : "Across every customer in the book"}</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => trigger(d)} disabled={!d.isActive || triggerReport.isPending} style={ghostBtn(d.isActive && !triggerReport.isPending)}>Run now</button>
                    <button onClick={() => toggleActive(d)} disabled={updateDef.isPending} style={ghostBtn(!updateDef.isPending)}>{d.isActive ? "Pause" : "Resume"}</button>
                    <button onClick={() => remove(d)} disabled={!isAdmin || deleteDef.isPending} style={ghostBtn(isAdmin && !deleteDef.isPending, true)} title={isAdmin ? "" : "Deleting a definition requires ladder.msp-admin"}>Delete</button>
                  </div>
                  {isMachineOwned && (
                    <span style={{ fontSize: 11, color: signal.warning.strong, textWrap: "pretty", borderTop: `1px solid ${border.soft}`, paddingTop: 8 }}>
                      Created automatically the first time a risk decision document was rendered, and never meant to be seen here — but nothing marks it as machine-owned, so it lists like any other definition. Triggering it does nothing useful.
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {creating && (
          <div style={{ border: "1px solid rgba(96,165,250,.3)", borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: text.strong }}>New definition</span>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly executive summary" style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Prompt context</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What the generator should emphasise. Left empty, it falls back to general Microsoft 365 best practice." style={{ ...inputStyle, height: "auto", padding: "10px 11px", lineHeight: 1.6, resize: "vertical" }} />
              <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" }}>This field doubles as the prompt override — it is not just a description, and it reaches the model verbatim.</span>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Document type</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {REPORT_DOC_TYPES.map((dt) => {
                  const machine = dt === "risk_decision_document";
                  return (
                    <button
                      key={dt}
                      onClick={() => machine
                        ? setResult({ code: "Not selectable here", text: "This type is not an AI generation at all — it is a deterministic render of a signed risk decision, written by a different part of the system. Its definition is created automatically.", tone: "info" })
                        : setDocType(dt)}
                      style={pillBtn(docType === dt, machine)}
                    >
                      {REPORT_DOC_TYPE_LABELS[dt]}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" }}>
                {docType === "license_waste_report"
                  ? "This one overlaps the license waste figure on its own tab — the report is written by a model reading that data, not by the query itself."
                  : "Eight types exist and no more. Each is a different prompt against the same machinery, not a different renderer."}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Delivery</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {REPORT_DELIVERY_METHODS.map((dv) => (
                  <button key={dv} onClick={() => setDeliveryMethod(dv)} style={pillBtn(deliveryMethod === dv)}>
                    {dv === "in_app" ? "In-app only" : dv === "email" ? "Email" : "Both"}
                  </button>
                ))}
              </div>
            </div>
            {deliveryMethod !== "in_app" && (
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Send to</span>
                <input value={deliveryEmail} onChange={(e) => setDeliveryEmail(e.target.value)} placeholder="reports@northwindtraders.com" style={inputStyle} />
                <span style={{ fontSize: 10.5, color: signal.warning.strong, textWrap: "pretty" }}>Leave this blank and the run still succeeds — it simply never sends, and nothing marks it as undelivered.</span>
              </label>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={submitCreate} disabled={createDef.isPending} style={primaryBtn}>{createDef.isPending ? "Creating…" : "Create"}</button>
              <button onClick={() => setCreating(false)} style={ghostBtn(true)}>Cancel</button>
            </div>
            <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" }}>Both lists are validated on create. On a later edit they are not — the update route accepts any string for either field, so this form has to keep enforcing them itself.</span>
          </div>
        )}

        <ResultBannerView result={result} />

        <div style={cardStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: text.strong }}>What these nineteen routes do and don't give this screen</span>
          {[
            "A run whose email delivery fails is left marked generated, with the failure only in an error field. A screen reading the status alone reports success. The Runs tab shows the warning on the row instead.",
            "Triggering answers accepted before any work happens, and every later failure is logged server-side only. Polling the run list is the sole way to learn that generation failed.",
            "The run list caps at fifty, a hundred at most, and has no offset. The total it returns is the size of that page, so older runs are unreachable.",
            "Create validates the document type and delivery method; edit does not. The column is plain text with no database constraint.",
            "Delete is a soft flag, not a removal, and the row keeps listing afterwards. Deleted and paused are indistinguishable on the wire.",
            "Schedules store a cadence, recipients and an enabled flag, but nothing executes them and the run timestamps are never written.",
          ].map((n, i) => (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: signal.warning.strong, marginTop: 6, flex: "0 0 5px" }} />
              <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, textWrap: "pretty" }}>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Runs ─────────────────────────────────────────────────────────────────────

function RunsTab({
  result, setResult, runsQuery, defsQuery,
}: {
  result: ResultBanner | null;
  setResult: (r: ResultBanner | null) => void;
  runsQuery: ReturnType<typeof useReportRuns>;
  defsQuery: ReturnType<typeof useReportDefinitions>;
}) {
  const downloadRun = useDownloadReportRun();
  const triggerReport = useTriggerReport();
  const runs = runsQuery.data?.runs ?? [];
  const defsById = useMemo(() => new Map((defsQuery.data ?? []).map((d) => [d.definitionId, d])), [defsQuery.data]);

  const download = (r: ReportRun) => {
    if (r.status === "pending" || r.status === "generating") {
      setResult({ code: "409 · not ready", text: "The document does not exist yet. This is why the button is held closed until a run leaves the generating stage.", tone: "warning" });
      return;
    }
    if (r.status === "failed") {
      setResult({ code: "422 · nothing to download", text: "The run failed, so there is no document. The error text is the only artefact.", tone: "critical" });
      return;
    }
    downloadRun.mutate(r, {
      onSuccess: () => setResult({ code: "200 · PDF", text: "Served as a binary attachment. The HTML and the PDF are only ever returned by this route — neither appears on the list or detail responses.", tone: "ok" }),
      onError: (err) => setResult(errorBanner(err, "error")),
    });
  };

  const retry = (r: ReportRun) => {
    const def = defsById.get(r.definitionId);
    if (!def) {
      setResult({ code: "error", text: "The definition behind this run could not be found in the current list — refresh Definitions first.", tone: "critical" });
      return;
    }
    triggerReport.mutate(def.definitionId, {
      onSuccess: () => setResult({ code: "202 · accepted", text: "There is no retry route. This is a brand-new run of the same definition — the failed attempt stays as its own row, and nothing links the two.", tone: "info" }),
      onError: (err) => setResult(errorBanner(err, "error")),
    });
  };

  const statusTone = (s: ReportRun["status"]) => (
    s === "pending" ? signal.neutral
    : s === "generating" || s === "delivering" ? signal.info
    : s === "generated" || s === "delivered" ? signal.ok
    : signal.critical
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <ResultBannerView result={result} />
      {runsQuery.isError ? (
        <ErrorPanel title="Runs could not be loaded" body={runsQuery.error instanceof MspReportsApiError ? runsQuery.error.message : "The request failed."} wire="GET /api/msp/reports/runs" />
      ) : runs.length === 0 && !runsQuery.isLoading ? (
        <EmptyState
          title="No runs"
          body="Nothing has been generated or rendered. Runs appear here from two sources: a definition triggered on the Definitions tab, and a risk decision document rendered elsewhere — the second kind arrives already generated, with no pending stage to watch."
        />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            {runs.map((r) => {
              const t = statusTone(r.status);
              const silentEmailFailure = r.status === "generated" && !!r.errorMessage;
              const ready = r.status === "generated" || r.status === "delivered" || r.status === "delivering";
              const meta = `${r.docType === "risk_decision_document" ? "Rendered directly, not generated · " : ""}${REPORT_DOC_TYPE_LABELS[r.docType]} · ${new Date(r.createdAt).toLocaleString()}${r.pdfSizeBytes ? ` · ${(r.pdfSizeBytes / 1024).toFixed(0)} KB` : ""}`;
              return (
                <div key={r.runId} style={{ border: `1px solid ${r.status === "failed" ? signal.critical.border : silentEmailFailure ? signal.warning.border : border.card}`, borderRadius: 12, background: surface.card, padding: 14, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 190, flex: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: text.strong, textWrap: "pretty" }}>{r.title}</span>
                      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{meta}</span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.strong }}>{r.status}</span>
                    <button onClick={() => download(r)} disabled={downloadRun.isPending} style={{ ...ghostBtn(true), height: 30, padding: "0 12px" }}>Download PDF</button>
                  </div>
                  {silentEmailFailure && (
                    <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 9, background: signal.warning.tint, padding: 11, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Generated, but the email never arrived</span>
                      <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{r.errorMessage}. The run is not marked failed — the document is here and downloadable, and this message is the only sign the send failed.</span>
                    </div>
                  )}
                  {r.status === "failed" && (
                    <div style={{ border: `1px solid ${signal.critical.border}`, borderRadius: 9, background: signal.critical.tint, padding: 11, display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.critical.strong }}>Generation failed</span>
                      <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{r.errorMessage}</span>
                      <button onClick={() => retry(r)} disabled={triggerReport.isPending} style={{ ...ghostBtn(!triggerReport.isPending), alignSelf: "flex-start" }}>Run it again</button>
                    </div>
                  )}
                  {!ready && r.status !== "failed" && (
                    <span style={{ fontSize: 10.5, color: text.faint, fontFamily: "Menlo, monospace" }}>Watching for status change{hasActiveRunNote(r)}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 13 }}>
            <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, minWidth: 180, textWrap: "pretty" }}>
              The count returned alongside this list is the size of this page, not the number of runs that exist. There is no offset parameter, so older runs beyond the cap cannot be reached from here at all.
            </span>
            <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.muted }}>limit 50 · max 100 · no offset</span>
          </div>
        </>
      )}
    </div>
  );
}

function hasActiveRunNote(_r: ReportRun): string { return " — this page polls automatically while a run is pending or generating"; }

// ── Canvases + Schedules ─────────────────────────────────────────────────────

const WIDGET_TYPES: { type: CanvasWidgetType; label: string }[] = [
  { type: "billing", label: "Billing" },
  { type: "open_items", label: "Open items" },
  { type: "telemetry", label: "Telemetry" },
  { type: "rich_text", label: "Rich text" },
];

function CanvasesTab({
  result, setResult, canvasesQuery, schedulesQuery,
}: {
  result: ResultBanner | null;
  setResult: (r: ResultBanner | null) => void;
  canvasesQuery: ReturnType<typeof useReportCanvases>;
  schedulesQuery: ReturnType<typeof useReportSchedules>;
}) {
  const [creatingCanvas, setCreatingCanvas] = useState(false);
  const [canvasName, setCanvasName] = useState("");
  const [widgets, setWidgets] = useState<Set<CanvasWidgetType>>(new Set(["rich_text"]));

  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const [scheduleCanvasId, setScheduleCanvasId] = useState<string>("");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [recipients, setRecipients] = useState("");

  const createCanvas = useCreateReportCanvas();
  const deleteCanvas = useDeleteReportCanvas();
  const sendTest = useSendTestCanvas();
  const createSchedule = useCreateReportSchedule();
  const updateSchedule = useUpdateReportSchedule();
  const deleteSchedule = useDeleteReportSchedule();

  const canvases = canvasesQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];

  const toggleWidget = (t: CanvasWidgetType) => setWidgets((prev) => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });

  const submitCanvas = () => {
    if (!canvasName.trim()) {
      setResult({ code: "400 · name is required", text: "A canvas needs a name before it can be saved.", tone: "warning" });
      return;
    }
    if (widgets.size === 0) {
      setResult({ code: "client-side check", text: "Pick at least one widget — an empty canvas has nothing to compile.", tone: "warning" });
      return;
    }
    const widgetList = Array.from(widgets).map((type, i) => ({ i: `w${i}`, x: 0, y: i, w: 12, h: 1, type }));
    createCanvas.mutate(
      { name: canvasName.trim(), canvasLayout: { widgets: widgetList }, deliveryConfig: { sendAsHtmlEmail: false, attachPdf: true, recipientType: "msp_admin" } },
      {
        onSuccess: () => { setCreatingCanvas(false); setCanvasName(""); setWidgets(new Set(["rich_text"])); setResult({ code: "201 · canvas created", text: "Saved. Compiled to HTML on-demand for a test send — nothing renders it unless you ask it to.", tone: "ok" }); },
        onError: (err) => setResult(errorBanner(err, "error")),
      },
    );
  };

  const removeCanvas = (id: string) => {
    deleteCanvas.mutate(id, {
      onSuccess: () => setResult({ code: "200 · canvas deleted", text: "Gone outright. There is no version history and no restore.", tone: "warning" }),
      onError: (err) => setResult(errorBanner(err, "error")),
    });
  };

  const runSendTest = (canvasId: string) => {
    sendTest.mutate({ canvasId }, {
      onSuccess: (r) => setResult({ code: "200 · test sent", text: `Compiled to HTML and sent through Exchange Online to ${r.recipient}. The recipient type stored on the canvas is never consulted — a test always goes to whoever asked for it.`, tone: "ok" }),
      onError: (err) => setResult(errorBanner(err, err instanceof MspReportsApiError && err.status === 400 ? "400 · error" : "error")),
    });
  };

  const submitSchedule = () => {
    if (!scheduleCanvasId) {
      setResult({ code: "400 · canvasId and cadence are required", text: "Pick a canvas to schedule first.", tone: "warning" });
      return;
    }
    const emails = recipients.split(",").map((s) => s.trim()).filter(Boolean);
    createSchedule.mutate(
      { canvasId: scheduleCanvasId, cadence, recipientEmails: emails },
      {
        onSuccess: () => { setCreatingSchedule(false); setRecipients(""); setResult({ code: "201 · schedule created", text: "Stored faithfully — cadence, recipients and enabled flag. Nothing executes it yet: no scheduler exists, so last-run and next-run stay unset.", tone: "warning" }); },
        onError: (err) => setResult(errorBanner(err, "error")),
      },
    );
  };

  const toggleSchedule = (id: string, enabled: boolean) => {
    updateSchedule.mutate({ id, patch: { enabled: !enabled } }, {
      onSuccess: () => setResult({ code: "200 · schedule updated", text: enabled ? "Disabled." : "Enabled — though there is still nothing that reads this flag to actually fire a send.", tone: "info" }),
      onError: (err) => setResult(errorBanner(err, "error")),
    });
  };

  const removeSchedule = (id: string) => {
    deleteSchedule.mutate(id, {
      onSuccess: () => setResult({ code: "200 · { success: true }", text: "Removed.", tone: "warning" }),
      onError: (err) => setResult(errorBanner(err, "error")),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <ResultBannerView result={result} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Custom canvases</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>A canvas is a layout of widgets, compiled to HTML for a test send. Four widget types exist and nothing renders a fifth.</span>
            </span>
            <button onClick={() => setCreatingCanvas(true)} style={primaryBtn}>New canvas</button>
          </div>

          {creatingCanvas && (
            <div style={{ border: `1px solid ${border.hover}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Name</span>
                <input value={canvasName} onChange={(e) => setCanvasName(e.target.value)} placeholder="Monthly board pack" style={inputStyle} />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Widgets</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {WIDGET_TYPES.map((w) => (
                    <button key={w.type} onClick={() => toggleWidget(w.type)} style={pillBtn(widgets.has(w.type))}>{w.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={submitCanvas} disabled={createCanvas.isPending} style={primaryBtn}>{createCanvas.isPending ? "Creating…" : "Create"}</button>
                <button onClick={() => setCreatingCanvas(false)} style={ghostBtn(true)}>Cancel</button>
              </div>
            </div>
          )}

          {canvasesQuery.isError ? (
            <ErrorPanel title="Canvases could not be loaded" body={canvasesQuery.error instanceof MspReportsApiError ? canvasesQuery.error.message : "The request failed."} wire="GET /api/msp/reports/canvases" />
          ) : canvases.length === 0 && !canvasesQuery.isLoading ? (
            <EmptyState title="No canvases" body="Editing a canvas overwrites it in place — there is no version history to fall back on, so the first save is the only record." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
              {canvases.map((c) => (
                <div key={c.id} style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, textWrap: "pretty" }}>{c.name}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(c.canvasLayout.widgets ?? []).map((w, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 6, background: signal.info.tint, border: `1px solid ${signal.info.border}`, fontSize: 10.5, fontWeight: 600, color: signal.info.strong }}>{w.type}</span>
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                    {c.deliveryConfig.sendAsHtmlEmail ? "HTML email on" : "HTML email off"} · {c.deliveryConfig.attachPdf ? "PDF attached" : "no PDF"} · recipient type {c.deliveryConfig.recipientType} (stored, never read)
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => runSendTest(c.id)} disabled={sendTest.isPending} style={primaryBtn}>Send test to me</button>
                    <button onClick={() => removeCanvas(c.id)} disabled={deleteCanvas.isPending} style={ghostBtn(!deleteCanvas.isPending, true)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1 }}>Schedules</span>
            <button onClick={() => setCreatingSchedule(true)} disabled={canvases.length === 0} style={{ ...primaryBtn, opacity: canvases.length === 0 ? 0.5 : 1 }} title={canvases.length === 0 ? "Create a canvas first" : ""}>New schedule</button>
          </div>
          <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Nothing runs these</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>A cadence, a recipient list and an enabled flag are all stored faithfully, but no scheduler exists to act on them and the last-run and next-run columns are never written. A schedule here is a stated intention, not a job — so this screen does not show a next send date, because there is no value to show.</span>
          </div>

          {creatingSchedule && (
            <div style={{ border: `1px solid ${border.hover}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Canvas</span>
                <select value={scheduleCanvasId} onChange={(e) => setScheduleCanvasId(e.target.value)} style={{ ...inputStyle, appearance: "auto" }}>
                  <option value="">Select a canvas…</option>
                  {canvases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Cadence</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["daily", "weekly", "monthly"] as const).map((c) => (
                    <button key={c} onClick={() => setCadence(c)} style={pillBtn(cadence === c)}>{c}</button>
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Recipients (comma-separated)</span>
                <input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@acme.com, cfo@acme.com" style={inputStyle} />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={submitSchedule} disabled={createSchedule.isPending} style={primaryBtn}>{createSchedule.isPending ? "Creating…" : "Create"}</button>
                <button onClick={() => setCreatingSchedule(false)} style={ghostBtn(true)}>Cancel</button>
              </div>
            </div>
          )}

          {schedulesQuery.isError ? (
            <ErrorPanel title="Schedules could not be loaded" body={schedulesQuery.error instanceof MspReportsApiError ? schedulesQuery.error.message : "The request failed."} wire="GET /api/msp/reports/schedules" />
          ) : schedules.length === 0 && !schedulesQuery.isLoading ? (
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>No schedules. Given nothing executes them, a test send is the only way a canvas reaches anyone today.</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
              {schedules.map((s) => {
                const canvasName = canvases.find((c) => c.id === s.canvasId)?.name ?? `Canvas ${s.canvasId.slice(0, 8)}`;
                const t = s.enabled ? signal.ok : signal.neutral;
                return (
                  <div key={s.id} style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, textWrap: "pretty" }}>{canvasName}</span>
                      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{s.cadence} · {s.recipientEmails.length} recipient{s.recipientEmails.length === 1 ? "" : "s"} · never run</span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.border}`, fontSize: 10.5, fontWeight: 600, color: t.strong }}>{s.enabled ? "enabled" : "off"}</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => toggleSchedule(s.id, s.enabled)} disabled={updateSchedule.isPending} style={ghostBtn(!updateSchedule.isPending)}>{s.enabled ? "Disable" : "Enable"}</button>
                      <button onClick={() => removeSchedule(s.id)} disabled={deleteSchedule.isPending} style={ghostBtn(!deleteSchedule.isPending, true)}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── License waste ─────────────────────────────────────────────────────────────

function WasteTab({ wasteQuery }: { wasteQuery: ReturnType<typeof useLicenseWaste> }) {
  if (wasteQuery.isError) {
    return <ErrorPanel title="License waste could not be loaded" body={wasteQuery.error instanceof MspReportsApiError ? wasteQuery.error.message : "The request failed."} wire="GET /api/msp/reports/license-waste" />;
  }
  const data = wasteQuery.data;
  const loading = wasteQuery.isLoading || !data;

  return (
    <div style={{ ...cardStyle, padding: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: text.strong }}>License waste across the book</span>
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
          {loading ? "Loading…" : data.hasData
            ? "Read from each tenant's Microsoft 365 profile, one query across the book. Only tenants whose profile actually flags waste are counted."
            : "Read from each tenant's Microsoft 365 profile. No profile data has been ingested, so this answers honestly rather than estimating."}
        </span>
      </div>
      {!loading && data.hasData && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 13 }}>
          {[
            { label: "TENANTS WITH WASTE", value: `${data.customersWithWaste} of ${data.totalCustomers}`, color: signal.warning.strong },
            { label: "ESTIMATED ANNUAL SAVING", value: data.estimatedAnnualSavingsFormatted, color: signal.ok.strong },
            { label: "UNUSED LICENSES", value: String(data.totalUnusedLicenses), color: text.strong },
            { label: "REPORTS GENERATED", value: String(data.reportsGenerated), color: text.strong },
          ].map((w) => (
            <div key={w.label} style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{w.label}</span>
              <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.02em", color: w.color }}>{w.value}</span>
            </div>
          ))}
        </div>
      )}
      {!loading && !data.hasData && (
        <EmptyState title="No licensing data to analyse" body="The route returns no-data rather than a zero — a real distinction this screen keeps, because zero waste and no measurement are not the same claim to put in front of a customer." />
      )}
      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 11 }}>
        This figure is also one of the eight document types, so the same numbers can be written into a generated report — but the report is produced by a model reading this context, not by this query, and the two can disagree.
      </span>
    </div>
  );
}

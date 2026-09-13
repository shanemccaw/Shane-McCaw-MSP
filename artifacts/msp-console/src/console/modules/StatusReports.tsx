/**
 * StatusReports — MSP Console module page (Git #3765, Feature #3434 phase 4 of
 * 4). Mounts into the shell's `ScreenSlot` at `/tenants/:id/status-reports`
 * (`Design/MSP_Console/design_handoff_msp_console/Status Reports.dc.html`,
 * README screen 40), wiring the real, just-shipped backend documented in
 * `docs/msp-console/status-reports-msp-console-contract-pack.md`.
 *
 * Real, load-bearing rules carried over from the design (README #40 + the
 * screen's own logic class):
 *   - Draft -> published is one-way. There is no unpublish and no edit after
 *     publish (PATCH answers 409 once state is published), so Publish routes
 *     through a real confirm step before the irreversible call fires.
 *   - `authoredByName` is genuinely nullable on the wire with no fallback —
 *     rendered as "Unknown operator", not invented.
 *   - Zero rows exist for any tenant today; the empty state is this feature's
 *     true current state, not a fixture waiting to be swapped.
 *   - An empty PATCH is rejected (400) rather than silently succeeding, and a
 *     second publish is rejected (409) rather than restamping — real server
 *     responses are shown verbatim, not paraphrased.
 *
 * One real, honest departure from the design's mock: the design always shows
 * a "Save with nothing changed" control (its logic class hard-codes the same
 * 400 message regardless of mode). That control only corresponds to a real
 * backend action when editing an existing draft — PATCH is the only route an
 * empty body can be sent to; POST create has no such route. This module fires
 * a real empty PATCH and shows the real response when editing, and omits the
 * control while creating rather than fake a response for a call that cannot
 * be made yet.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  StatusReportsApiError,
  useCreateStatusReport,
  usePublishStatusReport,
  useStatusReportsList,
  useUpdateStatusReport,
  type StatusReport,
} from "@/api/status-reports-api";

const LIMIT = 50;

type Mode = { kind: "none" } | { kind: "creating" } | { kind: "editing"; id: number } | { kind: "viewing"; id: number };

interface ResultBanner {
  code: string;
  text: string;
  tone: "ok" | "warning" | "critical";
}

function toneColors(tone: ResultBanner["tone"]) {
  return signal[tone === "ok" ? "ok" : tone === "warning" ? "warning" : "critical"];
}

function fieldErrorSummary(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const fieldErrors = (details as { fieldErrors?: Record<string, string[]> }).fieldErrors;
  if (!fieldErrors) return null;
  const parts = Object.entries(fieldErrors)
    .filter(([, msgs]) => msgs && msgs.length > 0)
    .map(([field, msgs]) => `${field}: ${msgs[0]}`);
  return parts.length ? parts.join(" · ") : null;
}

function stateBadge(state: StatusReport["state"]) {
  return state === "published" ? signal.ok : signal.neutral;
}

export function StatusReports({ customerId }: { customerId: number }) {
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [periodLabel, setPeriodLabel] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [content, setContent] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ResultBanner | null>(null);

  const listQuery = useStatusReportsList(customerId, LIMIT, offset);
  const createReport = useCreateStatusReport(customerId);
  const updateReport = useUpdateStatusReport(customerId);
  const publishReport = usePublishStatusReport(customerId);

  const reports = listQuery.data?.reports ?? [];
  const open = mode.kind === "viewing" || mode.kind === "editing" ? reports.find((r) => r.id === mode.id) ?? null : null;
  const canEdit = !!open && open.state === "draft";

  const startCreate = () => {
    setMode({ kind: "creating" });
    setPeriodLabel("");
    setAsOfDate("");
    setContent("");
    setConfirming(false);
    setResult(null);
  };

  const selectReport = (r: StatusReport) => {
    setMode({ kind: "viewing", id: r.id });
    setConfirming(false);
    setResult(null);
  };

  const startEdit = () => {
    if (!open) return;
    if (open.state === "published") return; // guarded client-side; the server would also 409 this
    setMode({ kind: "editing", id: open.id });
    setPeriodLabel(open.periodLabel);
    setAsOfDate(open.asOfDate);
    setContent(open.content);
    setResult(null);
  };

  const cancelEdit = () => {
    if (mode.kind === "editing") setMode({ kind: "viewing", id: mode.id });
    else setMode({ kind: "none" });
    setResult(null);
  };

  const errorBanner = (err: unknown, fallbackCode: string): ResultBanner => {
    if (err instanceof StatusReportsApiError) {
      const summary = fieldErrorSummary(err.details);
      return {
        code: `${err.status} · ${err.message}`,
        text: summary ?? "The server rejected this request.",
        tone: err.status >= 500 ? "critical" : "warning",
      };
    }
    return { code: fallbackCode, text: "The request failed. Try again shortly.", tone: "critical" };
  };

  const save = () => {
    const period = periodLabel.trim();
    const body = content.trim();

    if (mode.kind === "creating") {
      if (!period || !body || !asOfDate.trim()) {
        setResult({ code: "400 · Invalid request body", text: "Period, as-of date and content are all required.", tone: "warning" });
        return;
      }
      createReport.mutate(
        { periodLabel: period, asOfDate: asOfDate.trim(), content: body },
        {
          onSuccess: ({ report }) => {
            setMode({ kind: "viewing", id: report.id });
            setResult({ code: "201 · report created", text: "Saved as a draft. The author is taken from your session.", tone: "ok" });
          },
          onError: (err) => setResult(errorBanner(err, "400 · Invalid request body")),
        },
      );
      return;
    }

    if (mode.kind === "editing") {
      if (!period || !body) {
        setResult({ code: "400 · Invalid request body", text: "Period and content cannot be blanked out.", tone: "warning" });
        return;
      }
      updateReport.mutate(
        { id: mode.id, input: { periodLabel: period, asOfDate: asOfDate.trim(), content: body } },
        {
          onSuccess: ({ report }) => {
            setMode({ kind: "viewing", id: report.id });
            setResult({ code: "200 · report updated", text: "Only the fields you sent were written; state is untouched.", tone: "ok" });
          },
          onError: (err) => setResult(errorBanner(err, "400 · Invalid request body")),
        },
      );
    }
  };

  const saveEmpty = () => {
    if (mode.kind !== "editing") return;
    updateReport.mutate(
      { id: mode.id, input: {} },
      {
        onSuccess: () => setResult({ code: "200 · report updated", text: "Unexpected — an empty patch should be rejected.", tone: "warning" }),
        onError: (err) => setResult(errorBanner(err, "400 · No fields to update")),
      },
    );
  };

  const requestPublish = () => {
    if (!open || open.state === "published") return;
    setConfirming(true);
    setResult(null);
  };

  const confirmPublish = () => {
    if (!open) return;
    publishReport.mutate(open.id, {
      onSuccess: () => {
        setConfirming(false);
        setResult({ code: "200 · report published", text: "State moved to published. There is no route back.", tone: "ok" });
      },
      onError: (err) => {
        setConfirming(false);
        setResult(errorBanner(err, "409 · Status report is already published"));
      },
    });
  };

  const listCaption = useMemo(() => {
    if (listQuery.isLoading) return "Loading…";
    return reports.length === 0
      ? "Newest period first, by the period covered rather than the date written."
      : `${reports.length} report${reports.length === 1 ? "" : "s"} · newest period first, by the period covered`;
  }, [reports.length, listQuery.isLoading]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
      {/* List — GET /api/msp/customers/:customerId/status-reports */}
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Reports for this tenant</span>
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{listCaption}</span>
          </span>
          <button onClick={startCreate} style={primaryBtnStyle}>New draft</button>
        </div>

        {listQuery.isError ? (
          <StatePanel
            tone={signal.critical}
            title="Status reports could not be loaded"
            body={listQuery.error instanceof StatusReportsApiError ? listQuery.error.message : "The request failed."}
            wire={`GET /api/msp/customers/${customerId}/status-reports`}
          />
        ) : reports.length === 0 && !listQuery.isLoading ? (
          <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: "24px 18px", display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>No status reports yet</span>
            <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", maxWidth: 340 }}>
              This is the live state: the table holds zero rows for every tenant, because nothing has ever called these routes. The first report on this tenant will be one you write here.
            </span>
            <button onClick={startCreate} style={{ ...primaryBtnStyle, marginTop: 4 }}>Write the first one</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {reports.map((r) => {
              const tone = stateBadge(r.state);
              const isOpen = (mode.kind === "viewing" || mode.kind === "editing") && mode.id === r.id;
              const meta = `As of ${r.asOfDate.slice(0, 10)} · ${r.authoredByName ?? `Unknown operator (id ${r.authoredByUserId})`}`;
              const preview = r.content.split("\n")[0].slice(0, 88) + (r.content.length > 88 ? "…" : "");
              return (
                <button
                  key={r.id}
                  onClick={() => selectReport(r)}
                  style={{
                    display: "flex", flexDirection: "column", gap: 6, textAlign: "left",
                    border: `1px solid ${isOpen ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`,
                    borderRadius: 10, background: isOpen ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)",
                    padding: 12, cursor: "pointer", minWidth: 0,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 120, textWrap: "pretty" }}>{r.periodLabel}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 10, fontWeight: 600, color: tone.strong }}>{r.state}</span>
                  </span>
                  <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{meta}</span>
                  <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{preview}</span>
                </button>
              );
            })}
          </div>
        )}

        {reports.length > 0 && (
          <div style={{ borderTop: `1px solid ${border.soft}`, paddingTop: 11, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: text.label, flex: 1, minWidth: 140, textWrap: "pretty" }}>
              One page holds up to 200. A bad page value silently falls back to the default rather than erroring.
            </span>
            <button onClick={() => setOffset((o) => Math.max(0, o - LIMIT))} disabled={offset === 0} style={pageBtnStyle(offset === 0)}>Prev</button>
            <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.faint }}>limit {LIMIT} · offset {offset}</span>
            <button onClick={() => setOffset((o) => o + LIMIT)} disabled={reports.length < LIMIT} style={pageBtnStyle(reports.length < LIMIT)}>Next</button>
          </div>
        )}
      </div>

      {/* Detail / editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {(mode.kind === "creating" || mode.kind === "editing") && (
          <div style={{ border: "1px solid rgba(96,165,250,.3)", borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: text.strong }}>{mode.kind === "creating" ? "New status report" : "Editing a draft"}</span>
                <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                  {mode.kind === "creating" ? "Saved straight to draft. Your session is recorded as the author." : "Published reports cannot be edited, so this form only ever opens on a draft."}
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", fontSize: 10.5, fontWeight: 600, color: text.muted }}>Draft</span>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Period this report covers</span>
              <input
                value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)}
                placeholder="August 2026 · monthly service review"
                style={inputStyle}
              />
              <span style={{ fontSize: 10.5, color: text.faint }}>Free text, 1 to 200 characters, trimmed. Nothing parses it, so it is the only thing a reader has to recognise the period by.</span>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>As of</span>
              <input
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                placeholder="2026-08-31T23:59:00+01:00"
                style={{ ...inputStyle, fontFamily: "Menlo, monospace" }}
              />
              <span style={{ fontSize: 10.5, color: text.faint }}>Must carry an offset — a bare local datetime is rejected. This is also the sort key for the list, so a late-entered report still files under the period it covers.</span>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>The report</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={9}
                placeholder="What we did, what changed, what needs the customer's attention."
                style={{ ...inputStyle, height: "auto", padding: "10px 11px", lineHeight: 1.6, resize: "vertical" }}
              />
              <span style={{ fontSize: 10.5, color: text.faint }}>One text field, no length cap, no structure and no formatting on the wire. Whatever shape the report has, you are writing it in prose.</span>
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={save} disabled={createReport.isPending || updateReport.isPending} style={primaryBtnTall}>
                {createReport.isPending || updateReport.isPending ? "Saving…" : mode.kind === "creating" ? "Save draft" : "Save changes"}
              </button>
              {mode.kind === "editing" && (
                <button onClick={saveEmpty} disabled={updateReport.isPending} style={secondaryBtnTall}>Save with nothing changed</button>
              )}
              <button onClick={cancelEdit} style={secondaryBtnTall}>Cancel</button>
            </div>
          </div>
        )}

        {mode.kind === "viewing" && open && (
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-.01em", color: text.strong, textWrap: "pretty" }}>{open.periodLabel}</span>
                <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                  Report {open.id} · {open.authoredByName ?? "Unknown operator — the author's name is unset and no fallback exists on the wire"}
                </span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: stateBadge(open.state).tint, border: `1px solid ${stateBadge(open.state).border}`, fontSize: 10.5, fontWeight: 600, color: stateBadge(open.state).strong }}>{open.state}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
              {[
                { label: "AS OF", value: open.asOfDate },
                { label: "CREATED", value: open.createdAt.slice(0, 10) },
                { label: "LAST EDIT", value: open.updatedAt.slice(0, 10) },
                { label: "PUBLISHED", value: open.publishedAt ? open.publishedAt.slice(0, 10) : "— still a draft", ok: !!open.publishedAt },
              ].map((f) => (
                <span key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>{f.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: f.ok ? signal.ok.strong : text.strong, textWrap: "pretty" }}>{f.value}</span>
                </span>
              ))}
            </div>

            <div style={{ borderTop: `1px solid ${border.soft}`, paddingTop: 13, fontSize: 13, lineHeight: 1.7, color: text.secondary, whiteSpace: "pre-wrap", textWrap: "pretty", minWidth: 0 }}>{open.content}</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
              <button onClick={startEdit} disabled={!canEdit} style={ghostBtnStyle(canEdit)}>Edit</button>
              <button onClick={requestPublish} disabled={!canEdit} style={canEdit ? primaryBtnStyle : ghostBtnStyle(false)}>
                {open.state === "published" ? "Published" : "Publish"}
              </button>
            </div>

            {open.state === "published" && (
              <span style={{ fontSize: 11.5, color: signal.warning.strong, textWrap: "pretty" }}>
                Published, and that is final. Edits are refused before the request body is even read, and no route anywhere can move it back to draft or restamp it. A correction has to be a new report.
              </span>
            )}

            {confirming && (
              <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: signal.warning.strong }}>Publish this report?</span>
                <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                  There is no unpublish and no edit after this. Read the period label and the as-of date once more — those are the two things a reader uses to place the report, and neither can be corrected afterwards.
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={confirmPublish} disabled={publishReport.isPending} style={primaryBtnStyle}>{publishReport.isPending ? "Publishing…" : "Publish"}</button>
                  <button onClick={() => setConfirming(false)} style={secondaryBtnTall}>Keep it a draft</button>
                </div>
              </div>
            )}
          </div>
        )}

        {mode.kind === "none" && (
          <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Nothing open</span>
            <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", maxWidth: 330 }}>Pick a report to read it, or start a draft. Drafts stay editable; published ones never change.</span>
          </div>
        )}

        {result && (
          <div style={{ border: `1px solid ${toneColors(result.tone).border}`, borderRadius: 12, background: toneColors(result.tone).tint, padding: 13, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: toneColors(result.tone).strong }}>{result.code}</span>
            <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{result.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatePanel({ tone, title, body, wire }: { tone: { strong: string; text: string; tint: string; border: string }; title: string; body: string; wire: string }) {
  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 12, background: tone.tint, padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="triangle-alert" size={16} color={tone.strong} />
        <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>{title}</span>
      </span>
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>{wire}</span>
    </div>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb",
  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const primaryBtnTall: React.CSSProperties = { ...primaryBtnStyle, height: 34, padding: "0 13px", fontSize: 12.5 };

const secondaryBtnTall: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  height: 34, padding: "0 13px", borderRadius: 6, border: "1px solid rgba(148,163,184,.2)",
  background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

function ghostBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
    height: 32, padding: "0 13px", borderRadius: 6,
    border: `1px solid ${enabled ? "rgba(148,163,184,.2)" : "rgba(148,163,184,.12)"}`,
    background: enabled ? "rgba(148,163,184,.06)" : "rgba(148,163,184,.04)",
    color: enabled ? text.secondary : text.faint, fontSize: 12, fontWeight: 600,
    cursor: enabled ? "pointer" : "not-allowed", fontFamily: "inherit",
  };
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 26, padding: "0 10px", borderRadius: 6, border: `1px solid ${border.card}`,
    background: "transparent", color: disabled ? text.faint : text.secondary, fontSize: 11.5,
    fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
  };
}

const inputStyle: React.CSSProperties = {
  height: 36, padding: "0 11px", borderRadius: 6, border: "1px solid rgba(148,163,184,.22)",
  background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, fontFamily: "inherit", outline: "none", minWidth: 0,
};

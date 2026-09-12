/**
 * Change Control — Executions (screen 12). `GET /api/msp/change-control/executions`,
 * `.../:id/attest`, `.../change-requests/:id/rollback`,
 * `.../:id/evidence` (`msp-change-executions.ts`, `msp-evidence-attachments.ts`).
 *
 * "Record PIR" is not a button in the design's own mock — the PIRs tab there
 * is pure read. It is added here anyway: `msp-change-pir.ts`'s POST is a real,
 * fully-built write with no UI path to reach it in the design at all, and per
 * CLAUDE.md's HARD RULE a working write action does not stay unreachable
 * because the mock never drew a button for it. Styled with the same action-
 * button language as the two buttons the design does draw in this row.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { DirectoryCustomer } from "@/api/console-api";
import { Icon } from "@/console/icons";
import { Badge, Button, Card, DataState, Drawer, Fact } from "./shared";
import type { Tone } from "./shared";
import {
  filterByTenant, tenantKeyOf, useAttestExecution, useCaptureExecutionEvidence,
  useExecutions, useExecutionsEvidence, usePirs, useRaiseRollback, useRecordPir,
  type CrPirCloseCode, type WireCrExecution,
} from "./api";

const OUTCOME_TONE: Record<string, Tone> = { succeeded: "green", failed: "red", pending: "amber" };
const KIND_LABEL: Record<string, string> = { runbook_run: "Runbook run", write_action: "Direct write", human_action: "Human action" };
const KIND_ICON: Record<string, string> = { runbook_run: "workflow", write_action: "zap", human_action: "user-round" };

export function Executions({ customer }: { customer: DirectoryCustomer | undefined }) {
  const tenantKey = tenantKeyOf(customer);
  const query = useExecutions();
  const pirsQuery = usePirs();
  const rows = useMemo(() => filterByTenant(query.data?.executions ?? [], tenantKey), [query.data, tenantKey]);
  const evidenceResults = useExecutionsEvidence(rows.map((r) => r.id));

  const attest = useAttestExecution();
  const rollback = useRaiseRollback();
  const [evidenceFor, setEvidenceFor] = useState<WireCrExecution | null>(null);
  const [pirFor, setPirFor] = useState<WireCrExecution | null>(null);

  const pirByExecution = new Map((pirsQuery.data?.pirs ?? []).map((p) => [p.executionId, p] as const));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <DataState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={!query.isLoading && !query.error && rows.length === 0}
        route="GET /api/msp/change-control/executions"
        emptyTitle="No executions recorded for this tenant"
        emptyNote="Nothing authorized against this tenant has executed yet."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((e, i) => {
            const outcomeTone = OUTCOME_TONE[e.outcome];
            const confirmedTone: Tone = e.confirmed ? "green" : "amber";
            const evidenceCount = evidenceResults[i]?.data?.attachments.length ?? null;
            const pir = pirByExecution.get(e.id);
            const settled = e.outcome === "succeeded" || e.outcome === "failed";
            return (
              <Card key={e.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
                  <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={KIND_ICON[e.executorKind] as never} size={14} />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 180, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#f1f5f9" }}>{e.changeCode} · {KIND_LABEL[e.executorKind]}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{e.tenantId}</span>
                  </span>
                  <Badge label={e.outcome} tone={outcomeTone} />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: confirmedTone === "green" ? "rgba(52,211,153,.1)" : "rgba(251,191,36,.1)", border: `1px solid ${confirmedTone === "green" ? "rgba(52,211,153,.26)" : "rgba(251,191,36,.26)"}`, fontSize: 11, fontWeight: 600, color: confirmedTone === "green" ? "#34d399" : "#fbbf24" }}>
                    <Icon name={e.confirmed ? "circle-check-big" : "circle-dashed"} size={11} />
                    {e.confirmed ? "confirmed" : "unconfirmed"}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
                  <Fact label="EXECUTOR" value={e.implementer ?? "unassigned"} />
                  <Fact label="PLAN MATCHED" value={e.planMatched === null ? "not compared yet" : e.planMatched ? "yes" : "no — diff recorded"} color={e.planMatched === null ? "#64748b" : e.planMatched ? "#6ee7b7" : "#fcd34d"} />
                  <Fact label="ATTESTATION" value={e.attestedBy ? `${e.attestedBy}${e.attestedAt ? " · " + new Date(e.attestedAt).toLocaleString() : ""}` : "none"} />
                  <Fact label="EXECUTED" value={e.executedAt ? new Date(e.executedAt).toLocaleString() : "not yet"} color="#94a3b8" />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 11, borderTop: "1px solid rgba(148,163,184,.12)" }}>
                  {e.executorKind === "human_action" && !e.confirmed && (
                    <Button label="Attest this was done" icon="signature" tone="primary" title="An unattested human action is indistinguishable from unexplained drift"
                      onClick={() => attest.mutate({ id: e.id }, { onError: (err) => toast.error(err.message) })} />
                  )}
                  {e.outcome === "succeeded" && (
                    <Button label="Raise the reverse change" icon="undo-2" title="Raises an inverse change for approval — it does not revert the tenant"
                      onClick={() => rollback.mutate(e.changeRequestId, { onError: (err) => toast.error(err.message) })} />
                  )}
                  <Button label="Capture evidence" icon="camera" onClick={() => setEvidenceFor(e)} />
                  <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#64748b" }}>
                    <Icon name="image" size={13} />
                    {evidenceCount === null ? "…" : evidenceCount === 0 ? "none captured" : `${evidenceCount} screenshot${evidenceCount === 1 ? "" : "s"}`}
                  </span>
                  <div style={{ flex: 1 }} />
                  {pir ? (
                    <span style={{ fontSize: 11.5, color: "#c4b5fd" }}>reviewed · {pir.closeCode.replace(/_/g, " ")}</span>
                  ) : settled ? (
                    <Button label="Record PIR" icon="clipboard-check" onClick={() => setPirFor(e)} />
                  ) : (
                    <span style={{ fontSize: 11.5, color: "#64748b" }}>no review yet</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </DataState>

      {evidenceFor && <EvidenceDrawer execution={evidenceFor} onClose={() => setEvidenceFor(null)} />}
      {pirFor && <PirDrawer execution={pirFor} onClose={() => setPirFor(null)} />}
    </div>
  );
}

function EvidenceDrawer({ execution, onClose }: { execution: WireCrExecution; onClose: () => void }) {
  const evidence = useExecutionsEvidence([execution.id])[0];
  const capture = useCaptureExecutionEvidence();
  const [caption, setCaption] = useState("");

  return (
    <Drawer open eyebrow={execution.changeCode} title="Execution evidence" onClose={onClose}>
      <span style={{ fontSize: 12, color: "#94a3b8" }}>Image only, up to 20 MB — the same limit the desktop screenshot tool uses.</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {evidence?.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>Loading…</span>}
        {evidence?.data?.attachments.length === 0 && <span style={{ fontSize: 12, color: "#64748b" }}>No evidence captured yet.</span>}
        {evidence?.data?.attachments.map((a) => (
          <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,.14)" }}>
            <span style={{ fontSize: 12.5, color: "#93c5fd" }}>{a.originalFilename ?? `attachment ${a.id}`}</span>
            {a.caption && <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{a.caption}</span>}
            <span style={{ fontSize: 11, color: "#64748b" }}>{new Date(a.createdAt).toLocaleString()}</span>
          </a>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid rgba(148,163,184,.12)" }}>
        <input
          value={caption}
          onChange={(ev) => setCaption(ev.target.value)}
          placeholder="Caption (optional)"
          style={{ height: 34, padding: "0 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 12.5, outline: "none" }}
        />
        <input
          type="file"
          accept="image/*"
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            capture.mutate({ executionId: execution.id, file, caption: caption || undefined }, {
              onSuccess: () => setCaption(""),
              onError: (err) => toast.error(err.message),
            });
            ev.target.value = "";
          }}
        />
      </div>
    </Drawer>
  );
}

const CLOSE_CODES: CrPirCloseCode[] = ["successful", "successful_with_issues", "failed", "rolled_back"];

function PirDrawer({ execution, onClose }: { execution: WireCrExecution; onClose: () => void }) {
  const record = useRecordPir();
  const [closeCode, setCloseCode] = useState<CrPirCloseCode>("successful");
  const [summary, setSummary] = useState("");
  const [issues, setIssues] = useState("");
  const canSubmit = summary.trim().length > 0;

  return (
    <Drawer open eyebrow={execution.changeCode} title="Record Post-Implementation Review" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>Close code</span>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {CLOSE_CODES.map((c) => (
            <button
              key={c}
              onClick={() => setCloseCode(c)}
              style={{
                height: 30, padding: "0 11px", borderRadius: 7,
                border: `1px solid ${closeCode === c ? "rgba(96,165,250,.32)" : "rgba(148,163,184,.18)"}`,
                background: closeCode === c ? "rgba(37,99,235,.18)" : "transparent",
                color: closeCode === c ? "#bfdbfe" : "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {c.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>Summary</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          placeholder="What actually happened"
          style={{ padding: 11, borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 13, outline: "none", resize: "vertical" }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>Issues noted (optional)</span>
        <textarea
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
          rows={2}
          style={{ padding: 11, borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 13, outline: "none", resize: "vertical" }}
        />
      </div>
      <span style={{ fontSize: 11, color: "#64748b" }}>
        A drift re-scan runs automatically when this change's category has one (Conditional Access only today) — every other category is honestly recorded not applicable.
      </span>
      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: "1px solid rgba(148,163,184,.12)" }}>
        <Button
          label="Record review" tone="primary" disabled={!canSubmit || record.isPending}
          onClick={() => record.mutate(
            { executionId: execution.id, closeCode, summary: summary.trim(), issuesNoted: issues.trim() || undefined },
            { onSuccess: onClose, onError: (err) => toast.error(err.message) },
          )}
        />
        <Button label="Cancel" onClick={onClose} />
      </div>
    </Drawer>
  );
}

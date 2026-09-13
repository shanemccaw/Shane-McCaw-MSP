/**
 * Dead Letter Queue — MSP Console module page (Git #3816, screen 43).
 * Mounts into the shell's `ScreenSlot` at `/ops/dlq` (Operations, MSP-wide —
 * `console/nav.ts`), wiring the real four-route surface from `msp-dlq.ts`
 * documented in full at `docs/msp-console/dlq-msp-console-contract-pack.md`
 * (`Design/MSP_Console/design_handoff_msp_console/DLQ.dc.html`, README
 * screen 43): list, single replay, bulk replay, discard/handled-by-hand,
 * and payload edit.
 *
 * **Replay and Bulk Replay are real, working actions here, not held-closed
 * UI.** The design's own copy describes Replay as permanently failing
 * ("every live row fails that way (#3446)") and Bulk Replay as disabled
 * ("registered one path level too deep and 404s (#3445)"). Both were fixed
 * and closed completed on 2026-09-11, a day before this design was
 * generated — confirmed again directly against `msp-dlq.ts` on `main` in
 * this build: both replay routes now precheck `payload.workflowKey` via a
 * real `isReplayable()` guard and return a clean 400 instead of a bare 500,
 * `GET /api/msp/dlq` returns a real `replayable` boolean per row, and the
 * bulk-replay route answers at its documented path. This page gates its
 * Replay controls on that real `replayable` field rather than recomputing
 * its own guess, and sends the bulk call to the real route.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { border, signal, surface, text } from "@/console/tokens";
import {
  DlqApiError,
  useBulkReplayDlqItems,
  useDlqItems,
  useReplayDlqItem,
  useResolveDlqItem,
  useSaveDlqPayload,
  type DlqItem,
} from "@/api/dlq-api";

type Tone = { strong: string; text?: string; tint: string; border: string };

type Filter = "all" | "stuck" | "replayable" | "resolved";

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "stuck", label: "Cannot be replayed" },
  { key: "replayable", label: "Replayable" },
  { key: "resolved", label: "Closed" },
];

function toneFor(item: DlqItem): Tone {
  if (item.resolution) return signal.neutral;
  return item.replayable ? signal.info : signal.critical;
}

function tagFor(item: DlqItem): string {
  if (item.resolution) return item.resolution;
  return item.replayable ? "replayable" : "no workflow key";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
      height: 20, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`,
      fontSize: 10.5, fontWeight: 600, color: tone.text ?? tone.strong,
    }}>
      {label}
    </span>
  );
}

interface LastResult { code: string; text: string; tone: Tone }

const NOTES: ReadonlyArray<{ dot: string; text: string }> = [
  {
    dot: signal.info.strong,
    text: "Replay only works for items written by the workflow engine, because it recreates a workflow run from the workflowKey in the payload. Items from the job drainers carry no such key — the replayable flag on each row (computed server-side, Git #3446) tells you which is which before you click.",
  },
  {
    dot: signal.warning.strong,
    text: "Replaying creates a brand-new workflow run rather than retrying the failed one in place. The original run is not re-executed, and the attempt count on this row is never incremented by anything.",
  },
  {
    dot: signal.warning.strong,
    text: "Editing a payload replaces it whole, not merged, and there is no fix-and-replay in one step — the save and the replay are two separate calls with nothing holding the row still between them.",
  },
  {
    dot: signal.ok.strong,
    text: "Resolution is write-once and a person can only write discarded or handled-by-hand. Replayed is reserved for the replay route itself, so the record can't claim a re-run that never happened.",
  },
  {
    dot: signal.neutral.strong,
    text: "The list route takes no parameters — no filter, no page, no cap — and returns every row for this MSP in one response. The filters above are this screen narrowing what it already holds, not a fetch.",
  },
];

export function Dlq() {
  const itemsQuery = useDlqItems();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftPayload, setDraftPayload] = useState("");
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [selectedForBulk, setSelectedForBulk] = useState<ReadonlySet<string>>(new Set());

  const replayMutation = useReplayDlqItem();
  const bulkReplayMutation = useBulkReplayDlqItems();
  const resolveMutation = useResolveDlqItem();
  const saveMutation = useSaveDlqPayload();

  const items = itemsQuery.data ?? [];
  const open = openId ? items.find((i) => i.dlqId === openId) ?? null : null;

  const counts = useMemo(() => ({
    all: items.length,
    replayable: items.filter((i) => i.replayable && !i.resolution).length,
    stuck: items.filter((i) => !i.replayable && !i.resolution).length,
    resolved: items.filter((i) => i.resolution).length,
  }), [items]);

  const rows = useMemo(() => items.filter((i) => {
    if (filter === "replayable") return i.replayable && !i.resolution;
    if (filter === "stuck") return !i.replayable && !i.resolution;
    if (filter === "resolved") return !!i.resolution;
    return true;
  }), [items, filter]);

  const allStuck = counts.all > 0 && counts.replayable === 0;
  const stuckCount = counts.stuck;

  const onError = (err: unknown) => {
    const apiErr = err instanceof DlqApiError ? err : null;
    setLastResult({ code: apiErr ? String(apiErr.status) : "error", text: apiErr?.message ?? "Request failed", tone: signal.critical });
    toast.error(apiErr?.message ?? "Request failed");
  };

  const selectItem = (dlqId: string) => {
    setOpenId(dlqId);
    setEditing(false);
    setLastResult(null);
  };

  const doReplay = () => {
    if (!open) return;
    replayMutation.mutate(open.dlqId, {
      onSuccess: (data) => {
        setLastResult({ code: "200", text: `${data.message} (new run ${data.newRunId})`, tone: signal.ok });
        toast.success(data.message);
      },
      onError,
    });
  };

  const doBulkReplay = () => {
    const ids = Array.from(selectedForBulk);
    if (ids.length === 0) return;
    bulkReplayMutation.mutate(ids, {
      onSuccess: (data) => {
        const failed = data.results.filter((r) => !r.success).length;
        setLastResult({
          code: "200",
          text: `Replayed ${data.replayedCount} of ${ids.length}${failed > 0 ? `, ${failed} failed` : ""}.`,
          tone: failed > 0 ? signal.warning : signal.ok,
        });
        toast.success(`Replayed ${data.replayedCount} of ${ids.length} selected item${ids.length === 1 ? "" : "s"}.`);
        setSelectedForBulk(new Set());
      },
      onError,
    });
  };

  const doResolve = (resolution: "discarded" | "manual") => {
    if (!open) return;
    resolveMutation.mutate({ dlqId: open.dlqId, resolution }, {
      onSuccess: (data) => {
        setLastResult({
          code: "200",
          text: resolution === "discarded"
            ? "Closed as discarded. The row stays in the table with its payload and error intact — this is bookkeeping, not a delete."
            : "Closed as handled by hand. The queue stops showing it as outstanding.",
          tone: signal.warning,
        });
        toast.success(data.message);
      },
      onError,
    });
  };

  const startEdit = () => {
    if (!open) return;
    setDraftPayload(JSON.stringify(open.payload, null, 2));
    setEditing(true);
    setLastResult(null);
  };

  const doSavePayload = () => {
    if (!open) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(draftPayload);
    } catch {
      setLastResult({ code: "400", text: "Invalid JSON — the route validates that the payload is an object, so malformed text is refused before anything is written.", tone: signal.warning });
      return;
    }
    saveMutation.mutate({ dlqId: open.dlqId, payload: parsed }, {
      onSuccess: (data) => {
        setEditing(false);
        setLastResult({ code: "200", text: `${data.message}. Replay re-reads whatever is stored at the moment it runs — save then replay is two calls with a gap in between.`, tone: signal.neutral });
      },
      onError,
    });
  };

  const toggleBulkSelect = (dlqId: string) => {
    setSelectedForBulk((prev) => {
      const next = new Set(prev);
      if (next.has(dlqId)) next.delete(dlqId); else next.add(dlqId);
      return next;
    });
  };

  const anyMutating = replayMutation.isPending || bulkReplayMutation.isPending || resolveMutation.isPending || saveMutation.isPending;
  const bulkCount = selectedForBulk.size;

  if (itemsQuery.isError) {
    const status = itemsQuery.error instanceof DlqApiError ? itemsQuery.error.status : null;
    return (
      <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>
          {status === 403 ? "MSP context required" : "The dead letter queue could not be loaded"}
        </span>
        <span style={{ fontSize: 13, color: text.muted }}>{itemsQuery.error.message}</span>
        <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint }}>GET /api/msp/dlq · {status ?? "error"}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        <Pill label="MSPOperator or above" tone={signal.warning} />
      </div>

      <div style={{ border: `1px solid ${itemsQuery.isLoading || counts.all === 0 ? border.card : allStuck ? signal.critical.border : stuckCount > 0 ? signal.warning.border : signal.ok.border}`, borderRadius: 12, background: itemsQuery.isLoading || counts.all === 0 ? surface.card : allStuck ? signal.critical.tint : stuckCount > 0 ? signal.warning.tint : signal.ok.tint, padding: 14, display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: counts.all === 0 ? text.muted : allStuck ? signal.critical.strong : stuckCount > 0 ? signal.warning.strong : signal.ok.strong }}>
          {itemsQuery.isLoading ? "Loading the queue…" : counts.all === 0 ? "Nothing parked" : allStuck ? "Every item here is unreplayable" : stuckCount > 0 ? `${stuckCount} of these cannot be replayed` : "All items can be replayed"}
        </span>
        <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty" }}>
          {counts.all === 0
            ? "An empty queue means no job has exhausted its retries. It does not mean integrations are healthy — a job still retrying, or one whose producer never enqueued it, never appears here at all."
            : "Replay works for items written by the workflow engine, which recreates a run from the workflowKey in the payload. Items from the job drainers carry no such key — the replayable flag on each row (Git #3446) shows which is which."}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          const count = counts[f.key];
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", gap: 7,
                height: 30, padding: "0 12px", borderRadius: 7,
                border: `1px solid ${on ? "rgba(96,165,250,.45)" : border.soft}`,
                background: on ? "rgba(37,99,235,.18)" : "transparent",
                color: on ? text.title : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit",
              }}
            >
              {f.label}<span style={{ fontSize: 10.5, color: on ? "#60a5fa" : text.muted }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>

        {/* Parked items */}
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Parked items</span>
              <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                {itemsQuery.isLoading ? "Loading…" : `${items.length} items, newest first · ${counts.resolved} closed${bulkCount > 0 ? ` · ${bulkCount} selected` : ""}`}
              </span>
            </span>
            <button
              onClick={doBulkReplay}
              disabled={bulkCount === 0 || anyMutating}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
                height: 30, padding: "0 12px", borderRadius: 6,
                border: `1px solid ${bulkCount === 0 ? border.soft : "#2563eb"}`,
                background: bulkCount === 0 ? "rgba(148,163,184,.04)" : anyMutating ? "rgba(148,163,184,.06)" : "#2563eb",
                color: bulkCount === 0 ? text.faint : "#fff", fontSize: 12, fontWeight: 600,
                cursor: bulkCount === 0 || anyMutating ? "not-allowed" : "pointer", font: "inherit",
              }}
            >
              {bulkReplayMutation.isPending ? "Working…" : bulkCount > 0 ? `Bulk replay (${bulkCount})` : "Bulk replay"}
            </button>
          </div>

          {itemsQuery.isLoading ? (
            <div style={{ fontSize: 11.5, color: text.muted }}>Loading parked items…</div>
          ) : rows.length === 0 ? (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: 24, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>
                {counts.all === 0 ? "The queue is clear" : "Nothing matches that filter"}
              </span>
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", maxWidth: 340 }}>
                {counts.all === 0
                  ? "No job has run out of retries. Rows land here from four separate writers — the workflow engine, the generic job queue and two integration drainers — none of which knows about the others."
                  : "Try another filter. The route returns everything in one response, so this is only a view, not a fetch."}
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              {rows.map((i) => {
                const tone = toneFor(i);
                const on = i.dlqId === openId;
                const canBulk = i.replayable && !i.resolution;
                return (
                  <div
                    key={i.dlqId}
                    style={{
                      display: "flex", gap: 8, alignItems: "flex-start",
                      border: `1px solid ${on ? "rgba(96,165,250,.4)" : tone.border}`, borderRadius: 10,
                      background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, minWidth: 0,
                    }}
                  >
                    {canBulk && (
                      <input
                        type="checkbox"
                        checked={selectedForBulk.has(i.dlqId)}
                        onChange={() => toggleBulkSelect(i.dlqId)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginTop: 3, flex: "none" }}
                      />
                    )}
                    <button
                      onClick={() => selectItem(i.dlqId)}
                      style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer", font: "inherit", minWidth: 0, flex: 1 }}
                    >
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                        <span style={{ fontSize: 11.5, fontFamily: "Menlo, monospace", color: text.title, flex: 1, minWidth: 130, wordBreak: "break-all" }}>{i.eventType}</span>
                        <Pill label={tagFor(i)} tone={tone} />
                      </span>
                      <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{i.errorMessage}</span>
                      <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                        {formatWhen(i.lastAttemptAt)} · {i.attemptCount} attempts · {i.tenantName ?? "no customer attached"}{i.mspId == null ? " · no MSP on the row" : ""}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
            The route takes no parameters at all — no filter, no page, no resolved flag. Everything above is this screen narrowing a list it already holds in full.
          </span>
        </div>

        {/* Detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {open ? (
            <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontFamily: "Menlo, monospace", fontWeight: 700, color: text.title, wordBreak: "break-all" }}>{open.eventType}</span>
                  <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                    id {open.dlqId} · {formatWhen(open.lastAttemptAt)}{open.tenantName ? ` · ${open.tenantName}` : " · no customer on the row"}
                  </span>
                </span>
                <Pill label={tagFor(open)} tone={toneFor(open)} />
              </div>

              <div style={{ border: "1px solid rgba(248,113,113,.22)", borderRadius: 10, background: "rgba(248,113,113,.07)", padding: 12, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: "#f87171" }}>WHY IT STOPPED</span>
                <span style={{ fontSize: 12.5, color: text.title, textWrap: "pretty" }}>{open.errorMessage}</span>
                {open.errorStack ? (
                  <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.muted, whiteSpace: "pre-wrap", wordBreak: "break-all", borderTop: "1px solid rgba(248,113,113,.18)", paddingTop: 8, marginTop: 3 }}>{open.errorStack}</span>
                ) : (
                  <span style={{ fontSize: 10.5, color: text.muted, borderTop: "1px solid rgba(248,113,113,.18)", paddingTop: 8, marginTop: 3 }}>No stack was captured on this row, so the message above is the whole diagnosis.</span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>ATTEMPTS</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: text.title }}>{open.attemptCount} · the ceiling</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>LAST TRIED</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: text.title }}>{formatWhen(open.lastAttemptAt)}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>CUSTOMER</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: open.tenantName ? text.title : text.muted }}>{open.tenantName ?? "none on the row"}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>STATE</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: open.resolution ? text.muted : signal.warning.strong }}>{open.resolution ?? "open"}</span>
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted, flex: 1, minWidth: 100 }}>THE PAYLOAD</span>
                  <button
                    onClick={editing ? () => setEditing(false) : startEdit}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 11, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                  >
                    {editing ? "Stop editing" : "Edit payload"}
                  </button>
                </div>
                {editing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                    <textarea
                      value={draftPayload}
                      onChange={(e) => setDraftPayload(e.target.value)}
                      rows={8}
                      style={{ padding: "10px 11px", borderRadius: 8, border: "1px solid rgba(96,165,250,.35)", background: "rgba(2,6,23,.7)", color: text.title, fontSize: 11.5, lineHeight: 1.6, fontFamily: "Menlo, monospace", outline: "none", resize: "vertical", minWidth: 0 }}
                    />
                    <span style={{ fontSize: 11, color: signal.warning.strong, textWrap: "pretty" }}>
                      Saving replaces the stored payload outright — it is not merged, so anything you drop here is gone. There is also no fix-and-replay in one step: the save and the replay are two separate calls.
                    </span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={doSavePayload}
                        disabled={saveMutation.isPending}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: saveMutation.isPending ? "not-allowed" : "pointer", font: "inherit" }}
                      >
                        {saveMutation.isPending ? "Saving…" : "Save payload"}
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <span style={{ fontSize: 11.5, fontFamily: "Menlo, monospace", color: text.secondary, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "rgba(2,6,23,.5)", border: `1px solid ${border.faint}`, borderRadius: 8, padding: 11, minWidth: 0 }}>
                    {JSON.stringify(open.payload, null, 2)}
                  </span>
                )}
              </div>

              <div style={{ border: `1px solid ${open.resolution ? border.soft : open.replayable ? signal.info.border : signal.critical.border}`, borderRadius: 10, background: open.resolution ? "rgba(148,163,184,.04)" : open.replayable ? signal.info.tint : signal.critical.tint, padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: open.resolution ? text.muted : open.replayable ? signal.info.strong : signal.critical.strong }}>
                  {open.resolution === "replayed" ? "Already replayed" : open.replayable ? "This one can be replayed" : "Replay will not work on this item"}
                </span>
                <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                  {open.resolution === "replayed"
                    ? "A new run was created from this row and the row was closed. Replaying again is refused."
                    : open.resolution
                      ? "This row is closed, so replay is refused regardless of what it holds."
                      : open.replayable
                        ? "The payload carries a workflow key, so the engine can build a fresh run from it. That is a new run, not a retry of the original — the failed run stays as it was."
                        : "The payload has no workflow key, because a job drainer wrote this row rather than the workflow engine. There is nothing for the engine to rebuild. Close it out below, or fix the underlying job at its source."}
                </span>
                <button
                  onClick={doReplay}
                  disabled={!open.replayable || !!open.resolution || replayMutation.isPending}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", alignSelf: "flex-start",
                    height: 32, padding: "0 13px", borderRadius: 6,
                    border: `1px solid ${open.replayable && !open.resolution ? "#2563eb" : border.soft}`,
                    background: open.replayable && !open.resolution ? "#2563eb" : "rgba(148,163,184,.04)",
                    color: open.replayable && !open.resolution ? "#fff" : text.muted,
                    fontSize: 12, fontWeight: 600, cursor: open.replayable && !open.resolution && !replayMutation.isPending ? "pointer" : "not-allowed", font: "inherit",
                  }}
                >
                  {replayMutation.isPending ? "Working…" : open.resolution === "replayed" ? "Replayed" : "Replay"}
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${border.faint}`, paddingTop: 13 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>CLOSE IT OUT INSTEAD</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => doResolve("discarded")}
                    disabled={!!open.resolution || resolveMutation.isPending}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(148,163,184,.06)", color: open.resolution ? text.muted : text.secondary, fontSize: 12, fontWeight: 600, cursor: open.resolution ? "not-allowed" : "pointer", font: "inherit" }}
                  >
                    Discard
                  </button>
                  <button
                    onClick={() => doResolve("manual")}
                    disabled={!!open.resolution || resolveMutation.isPending}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(148,163,184,.06)", color: open.resolution ? text.muted : text.secondary, fontSize: 12, fontWeight: 600, cursor: open.resolution ? "not-allowed" : "pointer", font: "inherit" }}
                  >
                    Handled by hand
                  </button>
                </div>
                <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                  These two are the only resolutions a person can write. Replayed is reserved for the replay route itself, so nobody can claim a job was re-run when it wasn't.
                </span>
              </div>
            </div>
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick an item</span>
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", maxWidth: 330 }}>Each row carries its own error, payload and attempt count. Whether it can be replayed at all depends on what wrote it.</span>
            </div>
          )}

          {lastResult && (
            <div style={{ border: `1px solid ${lastResult.tone.border}`, borderRadius: 12, background: lastResult.tone.tint, padding: 13, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: lastResult.tone.text ?? lastResult.tone.strong }}>{lastResult.code}</span>
              <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{lastResult.text}</span>
            </div>
          )}

          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.strong }}>What these four routes do and don't give this screen</span>
            {NOTES.map((n) => (
              <div key={n.text} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
                <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty", minWidth: 0 }}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

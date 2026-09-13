/**
 * Retention Queue module page (Git #3817), mounted by `ConsoleShell` at
 * `/ops/retention`. Design: `Design/MSP_Console/design_handoff_msp_console/
 * Retention Queue.dc.html`, screen 44. Backend contract:
 * `docs/msp-console/retention-queue-msp-console-contract-pack.md`.
 *
 * The design's own "isLive" copy was written against a premise that has since
 * gone stale: at design time, no module had registered a retention record
 * class and nothing called `softDelete()`/`requestAcceleration()`, so the
 * queue was *structurally* unreachable. Git #3451 (POA&M soft delete) landed
 * after that and registers `msp_poams` (`lib/retention/wiring/msp-poams.ts`),
 * and both `msp-poams.ts` and `portal-poams.ts` now call those functions.
 * `record_deletions` is still 0 rows in local Postgres today (confirmed live),
 * so the empty state itself is real — but "nothing can ever reach this queue"
 * is no longer true, and rendering that specific claim verbatim would be
 * inventing a fact the live code no longer supports. Filed as its own finding,
 * #3909 (sibling under #1571) — the design/contract pack need their own
 * refresh pass. This build renders an honest, real empty/populated state
 * instead of that stale claim, and keeps the design's own explicitly-labelled
 * "not live data" shape preview untouched (it never claimed to be live).
 */
import { useMemo, useState } from "react";
import { border, signal, surface, text } from "@/console/tokens";
import {
  useDecideAcceleration, useDiscussRestore, useRetentionQueue,
  type AccelerationQueueItem,
} from "@/api/retention-api";
import { AMBER, BLUE, GREEN, GREY, RED, formatDateTime, type Tone } from "./format";

type View = "live" | "shape";

interface ShapeRow {
  id: number;
  recordType: string;
  recordId: string;
  label: string;
  tenant: string;
  stage: "soft" | "semi_hard";
  deletedAt: string;
  deletedBy: string;
  side: "customer" | "operator" | "system";
  deleteReason: string;
  requestedAt: string;
  requestedBy: string;
  reasonKind: "superseded_by" | "no_longer_needed";
  reason: string;
  supersededType: string | null;
  supersededId: string | null;
}

/** The design's own illustrative fixture — clearly labelled "not live data" in
 * the UI, never rendered as if it were real (screen 44's own SEED). */
const SHAPE_SEED: ShapeRow[] = [
  {
    id: 214, recordType: "msp_risk_decisions", recordId: "RBD-2026-041",
    label: "Accepted risk: legacy authentication on finance service accounts",
    tenant: "Northwind Traders", stage: "soft",
    deletedAt: "2026-09-04", deletedBy: "Dana Whitfield", side: "customer",
    deleteReason: "Superseded by the new conditional access policy signed on 1 September.",
    requestedAt: "2026-09-10", requestedBy: "Dana Whitfield",
    reasonKind: "superseded_by", reason: "The replacement decision is signed and in force; keeping both is confusing our auditors.",
    supersededType: "msp_risk_decisions", supersededId: "RBD-2026-058",
  },
  {
    id: 209, recordType: "msp_risk_decisions", recordId: "RBD-2026-033",
    label: "Accepted risk: guest accounts without expiry",
    tenant: "Contoso Ltd", stage: "semi_hard",
    deletedAt: "2026-08-19", deletedBy: "Priya Raman", side: "customer",
    deleteReason: "We do not agree with this finding.",
    requestedAt: "2026-09-08", requestedBy: "Priya Raman",
    reasonKind: "no_longer_needed", reason: "Please remove it entirely rather than leaving it on our record.",
    supersededType: null, supersededId: null,
  },
];

function reasonKindLabel(k: "superseded_by" | "no_longer_needed"): string {
  return k === "superseded_by" ? "Says it is superseded by a newer decision" : "Says it is no longer needed at all";
}

function stageLabel(s: "soft" | "semi_hard"): string {
  return s === "soft" ? "soft — early in the hold" : "semi-hard — late in the hold";
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 24, display: "flex", flexDirection: "column", gap: 16, minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone: Tone }) {
  return (
    <div style={{ border: "1px solid rgba(148,163,184,.14)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: tone[2] }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.title, textWrap: "pretty" as const }}>{value}</span>
      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>{note}</span>
    </div>
  );
}

function QueueClearPanel() {
  return (
    <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>Queue clear</span>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const, maxWidth: 320 }}>
        Zero pending requests. That says nothing about deletions in general — only this one state is counted, so records quietly working through their holding period are invisible here.
      </span>
    </div>
  );
}

export function RetentionQueue() {
  const [view, setView] = useState<View>("live");
  const queueQuery = useRetentionQueue();
  const decide = useDecideAcceleration();
  const discuss = useDiscussRestore();

  const [openLiveId, setOpenLiveId] = useState<number | null>(null);
  const [openShapeId, setOpenShapeId] = useState<number | null>(SHAPE_SEED[0].id);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [shapeSettled, setShapeSettled] = useState<Record<number, "approved" | "declined" | "restored">>({});
  const [shapeResult, setShapeResult] = useState<[string, string, Tone] | null>(null);

  const liveRows = queueQuery.data?.queue ?? [];
  const openLive = liveRows.find((r) => r.deletionId === openLiveId) ?? null;

  const openShapeRow = SHAPE_SEED.find((r) => r.id === openShapeId) ?? null;
  const shapeSettledOf = (id: number) => shapeSettled[id] ?? null;

  const selectLive = (r: AccelerationQueueItem) => {
    setOpenLiveId(r.deletionId);
    setNote(""); setReason("");
    decide.reset(); discuss.reset();
  };

  const approveLive = () => {
    if (!openLive) return;
    decide.mutate({ deletionId: openLive.deletionId, approve: true });
  };
  const declineLive = () => {
    if (!openLive) return;
    decide.mutate({ deletionId: openLive.deletionId, approve: false, note: note.trim() || undefined });
  };
  const discussLive = () => {
    if (!openLive) return;
    discuss.mutate({ deletionId: openLive.deletionId, reason });
  };

  const approveShape = () => {
    if (!openShapeRow) return;
    const id = openShapeRow.id;
    setShapeSettled((s) => ({ ...s, [id]: "approved" }));
    setShapeResult(["200 · purged", "Approved and destroyed in the same request. The ledger row survives as the record of what was deleted and why — the record itself does not.", RED]);
  };
  const declineShape = () => {
    if (!openShapeRow) return;
    const id = openShapeRow.id;
    setShapeSettled((s) => ({ ...s, [id]: "declined" }));
    setShapeResult(["200 · declined", "Request closed and the holding period resumed. Nothing was lost.", GREY]);
  };
  const discussShape = () => {
    if (!openShapeRow) return;
    if (!reason.trim()) {
      setShapeResult(["400 · A restore reason is required", "The restore is refused without one.", AMBER]);
      return;
    }
    const id = openShapeRow.id;
    setShapeSettled((s) => ({ ...s, [id]: "restored" }));
    setShapeResult(["200 · restored", "Declined and fully restored in one call, and the customer was notified (best-effort).", GREEN]);
  };

  const notes = useMemo(() => ([
    { dot: RED[2], text: "Approving purges inside the same request. There is no staged approval, no undo and no confirmation step in the route, so whatever guard exists has to be in the screen." },
    { dot: AMBER[2], text: "The approval field is read strictly: anything other than the exact boolean true is treated as a decline, with no validation error. A malformed approval silently becomes the opposite decision." },
    { dot: AMBER[2], text: "Restore requires a reason, but a missing one arrives as an empty string and is only caught deeper in, so the refusal surfaces as a late error rather than a form validation." },
    { dot: AMBER[2], text: "Restoring attaches a fixed, hardcoded note to the record rather than the operator's own words. The reason typed here goes to the restore, not to the declined request." },
    { dot: BLUE_DOT, text: "The two reasons are deliberately separate fields: why the record was deleted, and why it should go early. A design that showed only one would erase the distinction the data model exists to preserve." },
    { dot: BLUE_DOT, text: "A request on a customer outside your assigned set answers not-found rather than forbidden, so a scoped operator cannot even learn it exists. Staff scoping currently has no rows anywhere, so everyone sees the whole book." },
    { dot: text.muted, text: "Every operator collapses to one audit identity regardless of their real role, so the trail cannot distinguish an operator's decision from an admin's." },
    { dot: text.muted, text: "The claimed replacement record is free text with no lookup behind it — nothing verifies it exists, so checking the claim is manual." },
    { dot: text.muted, text: "There is no paging and no parameters, and the count returned is the size of the list. It counts pending requests only, so it says nothing about records quietly working through their holding period." },
  ]), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => { setView((v) => (v === "live" ? "shape" : "live")); setShapeResult(null); }}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 26, padding: "0 10px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.2)", fontSize: 11, fontWeight: 600, color: text.muted, cursor: "pointer" }}
        >
          {view === "live" ? "Show the queue shape" : "Back to the real state"}
        </button>
      </div>

      {view === "live" && (
        <>
          {queueQuery.isLoading && (
            <Panel><span style={{ fontSize: 12.5, color: text.muted }}>Loading the queue…</span></Panel>
          )}
          {queueQuery.isError && (
            <Panel>
              <span style={{ fontSize: 13, fontWeight: 700, color: signal.warning.strong }}>Couldn't load the queue</span>
              <span style={{ fontSize: 12, color: text.muted }}>{queueQuery.error.message}</span>
            </Panel>
          )}
          {queueQuery.isSuccess && liveRows.length === 0 && (
            <Panel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
                <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", color: text.title }}>Queue clear — zero pending accelerated-delete requests</span>
                <span style={{ fontSize: 12.5, color: text.secondary, lineHeight: 1.65, textWrap: "pretty" as const }}>
                  The queue answers with an empty list and a count of zero right now, confirmed against this MSP's own live data. That is not the same claim as "nothing can ever reach this queue" — POA&amp;M soft delete (Git #3451) registers a real record class and calls the soft-delete / request-acceleration functions this queue reads, so a pending row can genuinely appear here once a customer asks to accelerate a deleted POA&amp;M's purge. It just hasn't happened yet in this environment.
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
                <Tile label="RECORD CLASSES REGISTERED" value="msp_poams" note="Registered by Git #3451's retention wiring. Other modules have not yet plugged in." tone={BLUE} />
                <Tile label="CALLERS OF SOFT DELETE" value="msp-poams.ts · portal-poams.ts" note="Both the MSP-console and customer-portal POA&M delete routes call it." tone={BLUE} />
                <Tile label="CALLERS OF THE REQUEST" value="portal-poams.ts" note="The customer-portal 'request early purge' route is the real producer for this queue." tone={BLUE} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>WHAT THIS SCREEN IS FOR</span>
                <span style={{ fontSize: 12, color: text.secondary, lineHeight: 1.6, textWrap: "pretty" as const }}>
                  A customer deletes a record and it enters a holding period rather than disappearing. If they ask for it gone sooner, that request lands here for an operator to approve, decline, or talk about and restore instead. The queue is the operator's half of that loop.
                </span>
              </div>
            </Panel>
          )}
          {queueQuery.isSuccess && liveRows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
              <Panel style={{ padding: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Awaiting review</span>
                  <span style={{ fontSize: 11, color: text.muted }}>{liveRows.length} pending of {queueQuery.data!.total} shown</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                  {liveRows.map((r) => {
                    const on = r.deletionId === openLiveId;
                    return (
                      <button
                        key={r.deletionId}
                        onClick={() => selectLive(r)}
                        style={{
                          display: "flex", flexDirection: "column", gap: 6, textAlign: "left",
                          border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10,
                          background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, cursor: "pointer", minWidth: 0,
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1, minWidth: 130, textWrap: "pretty" as const }}>
                            {r.recordLabel ?? `${r.recordType} · ${r.recordId}`}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 20, padding: "0 8px", borderRadius: 999, background: AMBER[0], border: `1px solid ${AMBER[1]}`, fontSize: 10, fontWeight: 600, color: AMBER[2] }}>pending</span>
                        </span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>{reasonKindLabel(r.accelerationReasonKind)}</span>
                        <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>{r.tenantName ?? `Tenant ${r.tenantId}`} · deleted {formatDateTime(r.deletedAt)} · asked {formatDateTime(r.accelerationRequestedAt)}</span>
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 10 }}>
                  Newest request first. No paging and no parameters — the whole pending set comes back at once, and the count returned is the size of that list, not a total of anything else.
                </span>
              </Panel>

              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                {!openLive && (
                  <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick a request</span>
                    <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const, maxWidth: 320 }}>Each one carries two separate reasons: why the record was deleted, and why they now want it gone early.</span>
                  </div>
                )}
                {openLive && (
                  <Panel style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: text.title, textWrap: "pretty" as const }}>
                          {openLive.recordLabel ?? `${openLive.recordType} · ${openLive.recordId}`}
                        </span>
                        <span style={{ fontSize: 11, color: text.muted }}>{openLive.recordType} · {openLive.recordId} · {openLive.tenantName ?? `Tenant ${openLive.tenantId}`} · holding stage {stageLabel(openLive.stage === "soft" ? "soft" : "semi_hard")}</span>
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 22, padding: "0 9px", borderRadius: 999, background: AMBER[0], border: `1px solid ${AMBER[1]}`, fontSize: 10.5, fontWeight: 600, color: AMBER[2] }}>pending</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 13, minWidth: 0 }}>
                      <Tile label="WHY IT WAS DELETED" value={openLive.deleteReason} note={`Deleted ${formatDateTime(openLive.deletedAt)} by ${openLive.deletedBy}, on the ${openLive.deletedBySide} side`} tone={GREY} />
                      <Tile label="WHY THEY WANT IT GONE NOW" value={openLive.accelerationReason} note={`Asked ${formatDateTime(openLive.accelerationRequestedAt)} by ${openLive.accelerationRequestedBy}`} tone={BLUE} />
                    </div>
                    <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>Those two reasons are kept apart on purpose. "Superseded by the new policy" and "we disagree with this finding" deserve different answers, and a single reason field would have collapsed them.</span>

                    {openLive.supersededByRecordId && (
                      <Tile label="CLAIMED REPLACEMENT" value={`${openLive.supersededByRecordType} · ${openLive.supersededByRecordId}`} note="Recorded as free text with no lookup behind it. Nothing checks the replacement exists." tone={GREY} />
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 11, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 14, minWidth: 0 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: text.title }}>Three ways this ends</span>

                      <div style={{ border: `1px solid ${RED[1]}`, borderRadius: 10, background: RED[0], padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: RED[2] }}>Approve — the record is destroyed in this request</span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>There is no approve-then-purge-later. Saying yes here runs the purge immediately and nothing can bring the record back afterwards.</span>
                        <button onClick={approveLive} disabled={decide.isPending} style={btnStyle(RED[2], "rgba(248,113,113,.14)", "rgba(248,113,113,.4)")}>
                          {decide.isPending ? "Approving…" : "Approve and purge now"}
                        </button>
                      </div>

                      <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: text.secondary }}>Decline — the clock simply resumes</span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>Nothing is lost. The record keeps working through its normal holding period and the request is closed as declined.</span>
                        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Note for the record (optional)</span>
                          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why you are holding it to the normal period." style={taStyle} />
                        </label>
                        <button onClick={declineLive} disabled={decide.isPending} style={btnStyle(text.secondary, "rgba(148,163,184,.06)", "rgba(148,163,184,.2)")}>
                          Decline the request
                        </button>
                      </div>

                      <div style={{ border: `1px solid ${GREEN[1]}`, borderRadius: 10, background: GREEN[0], padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: GREEN[2] }}>Talk it through and restore instead</span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>Declines the request and brings the record fully back in one call, then tells the customer. A reason is required — the restore is refused without one — and the decline note attached to the record is a fixed sentence, not yours.</span>
                        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Restore reason (required)</span>
                          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What you agreed with the customer." style={taStyle} />
                        </label>
                        <button onClick={discussLive} disabled={discuss.isPending} style={{ ...btnStyle("#fff", "#2563eb", "#2563eb") }}>
                          {discuss.isPending ? "Restoring…" : "Restore the record"}
                        </button>
                      </div>
                    </div>

                    {(decide.isError || discuss.isError) && (
                      <div style={{ border: `1px solid ${RED[1]}`, borderRadius: 12, background: RED[0], padding: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: RED[2] }}>
                          {(decide.error as (Error & { status?: number }) | null)?.status ?? (discuss.error as (Error & { status?: number }) | null)?.status ?? "error"}
                        </span>
                        <span style={{ fontSize: 12, color: text.secondary }}>{decide.error?.message ?? discuss.error?.message}</span>
                      </div>
                    )}
                    {decide.isSuccess && (
                      <div style={{ border: `1px solid ${GREEN[1]}`, borderRadius: 12, background: GREEN[0], padding: 13 }}>
                        <span style={{ fontSize: 12, color: text.secondary }}>Decision recorded.</span>
                      </div>
                    )}
                    {discuss.isSuccess && (
                      <div style={{ border: `1px solid ${GREEN[1]}`, borderRadius: 12, background: GREEN[0], padding: 13 }}>
                        <span style={{ fontSize: 12, color: text.secondary }}>Restore recorded.</span>
                      </div>
                    )}
                  </Panel>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {view === "shape" && (
        <>
          <div style={{ border: "1px solid rgba(251,191,36,.3)", borderRadius: 12, background: "rgba(251,191,36,.07)", padding: 13, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fbbf24" }}>Not live data</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>
              Every row below is drawn from the shape the routes return, with a record class borrowed from the test fixture. This view exists so the page is ready when more of the queue's real traffic starts flowing.
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
            <Panel style={{ padding: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Awaiting review</span>
                <span style={{ fontSize: 11, color: text.muted }}>
                  {SHAPE_SEED.filter((r) => !shapeSettledOf(r.id)).length} pending of {SHAPE_SEED.length} shown
                </span>
              </div>
              {SHAPE_SEED.length === 0 ? <QueueClearPanel /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                  {SHAPE_SEED.map((r) => {
                    const s = shapeSettledOf(r.id);
                    const t = s === "approved" ? RED : s === "restored" ? GREEN : s ? GREY : AMBER;
                    const on = r.id === openShapeId;
                    return (
                      <button key={r.id} onClick={() => { setOpenShapeId(r.id); setShapeResult(null); setNote(""); setReason(""); }}
                        style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left", border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10, background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12, cursor: "pointer", minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1, minWidth: 130, textWrap: "pretty" as const }}>{r.label}</span>
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 20, padding: "0 8px", borderRadius: 999, background: t[0], border: `1px solid ${t[1]}`, fontSize: 10, fontWeight: 600, color: t[2] }}>{s ?? "pending"}</span>
                        </span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>{reasonKindLabel(r.reasonKind)}</span>
                        <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>{r.tenant} · deleted {r.deletedAt} · asked {r.requestedAt}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 10 }}>
                Newest request first. No paging and no parameters — the whole pending set comes back at once, and the count returned is the size of that list, not a total of anything else.
              </span>
            </Panel>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {!openShapeRow && (
                <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick a request</span>
                  <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" as const, maxWidth: 320 }}>Each one carries two separate reasons: why the record was deleted, and why they now want it gone early.</span>
                </div>
              )}
              {openShapeRow && (() => {
                const r = openShapeRow;
                const s = shapeSettledOf(r.id);
                const t = s === "approved" ? RED : s === "restored" ? GREEN : s ? GREY : AMBER;
                return (
                  <Panel style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: text.title, textWrap: "pretty" as const }}>{r.label}</span>
                        <span style={{ fontSize: 11, color: text.muted }}>{r.recordType} · {r.recordId} · {r.tenant} · holding stage {stageLabel(r.stage)}</span>
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", height: 22, padding: "0 9px", borderRadius: 999, background: t[0], border: `1px solid ${t[1]}`, fontSize: 10.5, fontWeight: 600, color: t[2] }}>{s ?? "pending"}</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 13, minWidth: 0 }}>
                      <Tile label="WHY IT WAS DELETED" value={r.deleteReason} note={`Deleted ${r.deletedAt} by ${r.deletedBy}, on the ${r.side} side`} tone={GREY} />
                      <Tile label="WHY THEY WANT IT GONE NOW" value={r.reason} note={`Asked ${r.requestedAt} by ${r.requestedBy}`} tone={BLUE} />
                    </div>
                    <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" as const }}>Those two reasons are kept apart on purpose. "Superseded by the new policy" and "we disagree with this finding" deserve different answers, and a single reason field would have collapsed them.</span>

                    {r.supersededId && (
                      <Tile label="CLAIMED REPLACEMENT" value={`${r.supersededType} · ${r.supersededId}`} note="Recorded as free text with no lookup behind it. Nothing checks the replacement exists, so verifying the claim is manual work." tone={GREY} />
                    )}

                    {!s && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 11, borderTop: "1px solid rgba(148,163,184,.12)", paddingTop: 14, minWidth: 0 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: text.title }}>Three ways this ends</span>

                        <div style={{ border: `1px solid ${RED[1]}`, borderRadius: 10, background: RED[0], padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: RED[2] }}>Approve — the record is destroyed in this request</span>
                          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>There is no approve-then-purge-later. Saying yes here runs the purge immediately and nothing can bring the record back afterwards. Against the live system this call would instead fail at the record-class lookup for any record type other than <code>msp_poams</code>.</span>
                          <button onClick={approveShape} style={btnStyle(RED[2], "rgba(248,113,113,.14)", "rgba(248,113,113,.4)")}>Approve and purge now</button>
                        </div>

                        <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: text.secondary }}>Decline — the clock simply resumes</span>
                          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>Nothing is lost. The record keeps working through its normal holding period and the request is closed as declined.</span>
                          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Note for the record (optional)</span>
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why you are holding it to the normal period." style={taStyle} />
                          </label>
                          <button onClick={declineShape} style={btnStyle(text.secondary, "rgba(148,163,184,.06)", "rgba(148,163,184,.2)")}>Decline the request</button>
                        </div>

                        <div style={{ border: `1px solid ${GREEN[1]}`, borderRadius: 10, background: GREEN[0], padding: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: GREEN[2] }}>Talk it through and restore instead</span>
                          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>Declines the request and brings the record fully back in one call, then tells the customer. A reason is required — the restore is refused without one — and the decline note attached to the record is a fixed sentence, not yours.</span>
                          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Restore reason (required)</span>
                            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What you agreed with the customer." style={taStyle} />
                          </label>
                          <button onClick={discussShape} style={btnStyle("#fff", "#2563eb", "#2563eb")}>Restore the record</button>
                        </div>
                      </div>
                    )}

                    {s && (
                      <div style={{ border: `1px solid ${t[1]}`, borderRadius: 10, background: t[0], padding: 13, display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid rgba(148,163,184,.12)" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: t[2] }}>{s === "approved" ? "Approved and purged" : s === "restored" ? "Restored" : "Declined"}</span>
                        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" as const }}>
                          {s === "approved" ? "The record is gone. This ledger row is all that remains of it, and it cannot be undone from here or anywhere else."
                            : s === "restored" ? "The record is back in place and its holding state cleared. The customer was told, best-effort."
                              : "The request is closed and the record is back on its normal clock. It can be requested again later."}
                        </span>
                      </div>
                    )}

                    {shapeResult && (
                      <div style={{ border: `1px solid ${shapeResult[2][1]}`, borderRadius: 12, background: shapeResult[2][0], padding: 13, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "Menlo, monospace", color: shapeResult[2][2] }}>{shapeResult[0]}</span>
                        <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" as const }}>{shapeResult[1]}</span>
                      </div>
                    )}
                  </Panel>
                );
              })()}
            </div>
          </div>
        </>
      )}

      <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>What these three routes do and don't give this screen</span>
        {notes.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
            <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty" as const, minWidth: 0 }}>{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BLUE_DOT = "#60a5fa";

function btnStyle(color: string, background: string, borderColor: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", alignSelf: "flex-start",
    height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${borderColor}`, background, color,
    fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
}

const taStyle: React.CSSProperties = {
  padding: "9px 11px", borderRadius: 6, border: "1px solid rgba(148,163,184,.22)", background: "rgba(2,6,23,.6)",
  color: text.title, fontSize: 12.5, lineHeight: 1.55, fontFamily: "inherit", outline: "none", resize: "vertical", minWidth: 0,
};

/**
 * AdOuAssignmentPage — the MSP Console's AD OU Assignment module (#3818),
 * wiring `msp-active-directory.ts`'s real routes.
 *
 * Design: `Design/MSP_Console/design_handoff_msp_console/AD OU Assignment.dc.html`
 * (README screen 46, per-tenant → Access & identity). Mounts into `ScreenSlot`'s
 * `children` for `sel.page === "ou"`.
 *
 * Two real, load-bearing asymmetries this page must not "fix":
 *   - Placing an object re-verifies it against the real Graph directory first
 *     (a typo is refused, nothing is written). Moving an already-placed object
 *     does NOT re-verify — the identity captured at first placement carries
 *     across untouched, so someone who has since left the directory moves just
 *     as easily as anyone else.
 *   - A manual placement always beats the department-name guess for policy
 *     evaluation; clearing one is a hard delete with no history — the object
 *     falls straight back to the guess, which may put it right back where it
 *     was, invisibly.
 * A request naming a unit that does not exist (`requestedOuId === null`)
 * approves as a no-op write — nothing is placed, only the status changes — so
 * the Approve button reads "Approve (writes nothing)" in that state.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { border, text } from "@/console/tokens";
import {
  useOus, useOuAssignments, useAssignObject, useMoveAssignment, useClearAssignment,
  useOuAssignmentRequests, useResolveOuAssignmentRequest,
  AdOuApiError,
  type OrgUnit, type OuAssignment, type OuAssignmentRequest, type OuAssignmentRequestStatus,
} from "@/api/ad-ou-api";

const CARD_LINE = border.card;
const CARD_BG = "rgba(15,23,42,.6)";

const STATUS_TONE: Record<OuAssignmentRequestStatus, { color: string; tint: string; line: string }> = {
  pending: { color: "#fbbf24", tint: "rgba(251,191,36,.1)", line: "rgba(251,191,36,.26)" },
  approved: { color: "#34d399", tint: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.26)" },
  fulfilled: { color: "#34d399", tint: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.26)" },
  rejected: { color: "#94a3b8", tint: "rgba(148,163,184,.08)", line: "rgba(148,163,184,.2)" },
};

const STATUS_FILTERS: { id: "all" | OuAssignmentRequestStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Waiting" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "fulfilled", label: "Fulfilled" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function AdOuAssignmentPage({
  customerId,
  embedded = true,
  forceEmpty = false,
}: {
  customerId: number;
  /** Suppresses this page's own header when true (the default) — the shell
   * already renders eyebrow/title/note from the tree node's own metadata. */
  embedded?: boolean;
  /** Design mount contract passthrough — this console does not ship the
   * design's own STATE chip prototype toggle, so nothing drives this true in
   * practice, but the prop exists so the contract is honored either way. */
  forceEmpty?: boolean;
}) {
  const [tab, setTab] = useState<"assign" | "requests">("assign");
  const [ouId, setOuId] = useState<number | null>(null);
  const [upn, setUpn] = useState("");
  const [moveTarget, setMoveTarget] = useState<Record<number, number | "">>({});
  const [statusFilter, setStatusFilter] = useState<"all" | OuAssignmentRequestStatus>("all");
  const [reqId, setReqId] = useState<number | null>(null);
  const [reply, setReply] = useState("");

  const ousQuery = useOus(customerId);
  const ous: OrgUnit[] = forceEmpty ? [] : (ousQuery.data?.ous ?? []);

  const assignmentsQuery = useOuAssignments(ouId);
  const assignments: OuAssignment[] = forceEmpty ? [] : (assignmentsQuery.data ?? []);

  const requestsQuery = useOuAssignmentRequests();
  const allRequests: OuAssignmentRequest[] = forceEmpty ? [] : (requestsQuery.data ?? []).filter((r) => r.customerId === customerId);

  const assignObject = useAssignObject(customerId);
  const moveAssignment = useMoveAssignment();
  const clearAssignment = useClearAssignment();
  const resolveRequest = useResolveOuAssignmentRequest();

  // Select the first OU once the list loads, if nothing is selected yet.
  useEffect(() => {
    if (ouId === null && ous.length > 0) setOuId(ous[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ous.length]);

  const ouById = useMemo(() => new Map(ous.map((o) => [o.id, o])), [ous]);
  const selectedOu = ouId !== null ? (ouById.get(ouId) ?? null) : null;

  const pendingCount = allRequests.filter((r) => r.status === "pending").length;

  const filteredRequests = allRequests
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const selectedRequest = reqId !== null ? (allRequests.find((r) => r.id === reqId) ?? null) : null;

  const submitAssign = () => {
    if (ouId === null || !upn.trim()) return;
    assignObject.mutate(
      { ouId, objectUpn: upn.trim() },
      {
        onSuccess: () => {
          setUpn("");
          toast.success("Verified in the directory and placed here.");
        },
        onError: (err) => {
          toast.error(err instanceof AdOuApiError ? err.message : "Could not place that address.");
        },
      },
    );
  };

  const submitMove = (assignment: OuAssignment) => {
    const target = moveTarget[assignment.id];
    if (!target) return;
    moveAssignment.mutate(
      { assignmentId: assignment.id, ouId: target },
      {
        onSuccess: () => {
          const targetName = ouById.get(target)?.name ?? `unit ${target}`;
          toast.success(`Moved to ${targetName}. The directory identity captured at first placement was carried across untouched.`);
        },
        onError: (err) => toast.error(err instanceof AdOuApiError ? err.message : "Could not move that placement."),
      },
    );
  };

  const submitClear = (assignment: OuAssignment) => {
    clearAssignment.mutate(
      { assignmentId: assignment.id },
      {
        onSuccess: () => toast.success("Placement cleared. They now fall back to the department-name guess."),
        onError: (err) => toast.error(err instanceof AdOuApiError ? err.message : "Could not clear that placement."),
      },
    );
  };

  const submitResolve = (status: "approved" | "rejected" | "fulfilled") => {
    if (selectedRequest === null) return;
    resolveRequest.mutate(
      { requestId: selectedRequest.id, status, resolutionNote: reply.trim() || undefined },
      {
        onSuccess: (res) => {
          setReply("");
          toast.success(
            res.appliedAssignment
              ? `${status[0].toUpperCase()}${status.slice(1)} — the real placement was written.`
              : `${status[0].toUpperCase()}${status.slice(1)}. No unit existed to place them in, so nothing was written.`,
          );
        },
        onError: (err) => toast.error(err instanceof AdOuApiError ? err.message : "Could not resolve that request."),
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {!embedded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#60a5fa" }}>ACTIVE DIRECTORY · OU ASSIGNMENT</span>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", color: text.title }}>Who sits in which unit</span>
        </div>
      )}

      {/* Load-bearing note: manual beats guess */}
      <div style={{ border: "1px solid rgba(96,165,250,.26)", borderRadius: 12, background: "rgba(96,165,250,.07)", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa" }}>A manual placement beats the automatic guess</span>
        <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty" }}>
          Policy evaluation works out who is in a unit two ways: anyone placed here by hand, plus anyone whose directory department happens to match the unit's name and who has not been placed by hand anywhere else. So a placement is not decoration — it removes that person from every other unit's guess. Clearing one hands them straight back to it.
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            { id: "assign" as const, label: "Placements", count: assignments.length },
            { id: "requests" as const, label: "Requests", count: pendingCount },
          ]
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.45)" : border.sidebar}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#f1f5f9" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t.label}
              <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {tab === "assign" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
          {/* OU list */}
          <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Organisational units</span>
            {ousQuery.isLoading ? (
              <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
            ) : ous.length === 0 ? (
              <EmptyPanel title="No units on this book" body="This is the live state: units, placements and requests are all empty. Units are created on the platform side, so there is nothing to place anyone into from here yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                {ous.map((o) => {
                  const on = o.id === ouId;
                  return (
                    <button
                      key={o.id}
                      onClick={() => { setOuId(o.id); setUpn(""); }}
                      style={{
                        display: "flex", flexDirection: "column", gap: 5, textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0,
                        border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10,
                        background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>{o.name}</span>
                      <span style={{ fontSize: 11, color: text.muted }}>unit {o.id}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
              A unit with no customer behind it cannot be opened from this surface at all. There is no column tying such a unit to one MSP, so it could be shared with another MSP's customer — only the platform side can read into it.
            </span>
          </div>

          {/* Detail: members + assign form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {selectedOu && (
              <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title }}>{selectedOu.name}</span>
                    <span style={{ fontSize: 11, color: text.muted }}>unit {selectedOu.id}</span>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: `1px solid ${border.sidebar}`, fontSize: 10.5, fontWeight: 600, color: text.muted }}>
                    {assignments.length} placed by hand
                  </span>
                </div>

                {assignmentsQuery.isLoading ? (
                  <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
                ) : assignments.length === 0 ? (
                  <EmptyPanel title="Nobody placed here by hand" body="That does not mean the unit is empty for policy purposes — anyone whose department matches its name still counts. This list only ever shows deliberate placements, and the automatic ones are not readable from here." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                    {assignments.map((m) => {
                      const otherOus = ous.filter((o) => o.id !== selectedOu.id);
                      return (
                        <div key={m.id} style={{ border: `1px solid ${border.faint}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 9, flexWrap: "wrap" }}>
                            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>{m.objectDisplayName ?? "No display name recorded"}</span>
                              <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: text.muted, wordBreak: "break-all" }}>{m.objectUpn}</span>
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: "rgba(52,211,153,.1)", border: "1px solid rgba(52,211,153,.26)", fontSize: 10, fontWeight: 600, color: "#34d399" }}>placed by hand</span>
                          </div>
                          <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.muted, wordBreak: "break-all" }}>directory id {m.objectId}</span>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <select
                              value={moveTarget[m.id] ?? ""}
                              onChange={(e) => setMoveTarget((prev) => ({ ...prev, [m.id]: e.target.value ? Number(e.target.value) : "" }))}
                              disabled={otherOus.length === 0}
                              style={{ height: 28, borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.body, fontSize: 11.5, padding: "0 6px" }}
                            >
                              <option value="">Move to…</option>
                              {otherOus.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                            <button
                              onClick={() => submitMove(m)}
                              disabled={!moveTarget[m.id] || moveAssignment.isPending}
                              style={{ height: 28, padding: "0 11px", borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: moveTarget[m.id] ? "pointer" : "not-allowed", opacity: moveTarget[m.id] ? 1 : 0.6 }}
                            >
                              Move to another unit
                            </button>
                            <button
                              onClick={() => submitClear(m)}
                              disabled={clearAssignment.isPending}
                              style={{ height: 28, padding: "0 11px", borderRadius: 6, border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.1)", color: "#f87171", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                            >
                              Clear placement
                            </button>
                          </div>
                          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 8 }}>
                            {m.objectDisplayName
                              ? "The display name is a convenience captured at placement time and never refreshed; the directory id beside it is the only identity that counts."
                              : "This row has no display name at all — a real, normal state, so the address is the only thing to show."}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${border.faint}`, paddingTop: 13, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: text.title }}>Place someone here</span>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Their sign-in address</span>
                    <input
                      value={upn}
                      onChange={(e) => setUpn(e.target.value)}
                      placeholder="dana.whitfield@northwindtraders.com"
                      style={{ height: 36, padding: "0 11px", borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.title, fontSize: 13, fontFamily: "Menlo, monospace", outline: "none", minWidth: 0 }}
                    />
                  </label>
                  <button
                    onClick={submitAssign}
                    disabled={!upn.trim() || assignObject.isPending}
                    style={{ alignSelf: "flex-start", height: 32, padding: "0 13px", borderRadius: 6, border: "1px solid #2563eb", background: upn.trim() ? "#2563eb" : "rgba(37,99,235,.4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: upn.trim() ? "pointer" : "not-allowed" }}
                  >
                    {assignObject.isPending ? "Verifying…" : "Verify and place"}
                  </button>
                  <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                    The address is looked up in the real directory before anything is written, so a typo is refused rather than stored. If that person is already placed in another unit, this moves them — one object only ever sits in one unit, and no second row is created.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
          <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Raised by this customer</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>Newest first. Customers can ask; only this surface can answer — without it a request would be a write nobody ever reads.</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUS_FILTERS.map((s) => {
                const on = statusFilter === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setStatusFilter(s.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", height: 26, padding: "0 10px", borderRadius: 999,
                      border: `1px solid ${on ? "rgba(96,165,250,.45)" : border.sidebar}`,
                      background: on ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)",
                      color: on ? "#f1f5f9" : text.muted, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            {requestsQuery.isLoading ? (
              <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
            ) : filteredRequests.length === 0 ? (
              <EmptyPanel title="Nothing to answer" body="No customer has asked for a placement change. A mistyped filter value here is ignored rather than refused, so an empty list is worth a second look at the filter." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                {filteredRequests.map((r) => {
                  const t = STATUS_TONE[r.status];
                  const on = r.id === reqId;
                  const targetOu = r.requestedOuId !== null ? ouById.get(r.requestedOuId) : null;
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setReqId(r.id); setReply(""); }}
                      style={{
                        display: "flex", flexDirection: "column", gap: 6, textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0,
                        border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10,
                        background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: text.title, flex: 1, minWidth: 120, textWrap: "pretty" }}>{r.objectDisplayName ?? r.objectUpn}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10, fontWeight: 600, color: t.color }}>{r.status}</span>
                      </span>
                      <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                        {r.requestedOuId ? `Wants moving to ${targetOu?.name ?? `unit ${r.requestedOuId}`}` : `Wants a unit called ${r.requestedOuName}, which does not exist`}
                      </span>
                      <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>asked {formatDate(r.createdAt)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {selectedRequest && (
              <RequestDetail
                request={selectedRequest}
                ouById={ouById}
                reply={reply}
                onReply={setReply}
                onResolve={submitResolve}
                pending={resolveRequest.isPending}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RequestDetail({
  request, ouById, reply, onReply, onResolve, pending,
}: {
  request: OuAssignmentRequest;
  ouById: Map<number, OrgUnit>;
  reply: string;
  onReply: (v: string) => void;
  onResolve: (status: "approved" | "rejected" | "fulfilled") => void;
  pending: boolean;
}) {
  const t = STATUS_TONE[request.status];
  const targetOu = request.requestedOuId !== null ? ouById.get(request.requestedOuId) : null;
  const currentOu = request.currentOuId !== null ? ouById.get(request.currentOuId) : null;
  const nameOnly = request.requestedOuId === null && !!request.requestedOuName;
  const isPending = request.status === "pending";
  const isSettled = !isPending;

  return (
    <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title, textWrap: "pretty" }}>{request.objectDisplayName ?? request.objectUpn}</span>
          <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: text.muted, wordBreak: "break-all" }}>{request.objectUpn}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10.5, fontWeight: 600, color: t.color }}>{request.status}</span>
      </div>

      <div style={{ border: `1px solid ${border.faint}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>WHAT THEY ASKED FOR, AND WHY</span>
        <span style={{ fontSize: 12.5, color: text.title, textWrap: "pretty" }}>
          {request.requestedOuId ? `Move to ${targetOu?.name ?? `unit ${request.requestedOuId}`}` : `Create and move to "${request.requestedOuName}"`}
        </span>
        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>&ldquo;{request.note}&rdquo;</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        <Fact label="UNIT AT THE TIME" value={currentOu ? `${currentOu.name} — a snapshot, never rechecked` : "none recorded"} color={currentOu ? "#fbbf24" : text.muted} />
        <Fact label="ASKED" value={formatDate(request.createdAt)} color={text.title} />
      </div>

      {nameOnly && (
        <div style={{ border: "1px solid rgba(251,191,36,.3)", borderRadius: 10, background: "rgba(251,191,36,.08)", padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fbbf24" }}>They named a unit that does not exist</span>
          <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>Approving this changes nothing but the status — there is no real unit to place anyone in, so no placement is written. Create the unit and place them on the other tab first, then answer this.</span>
        </div>
      )}

      {isPending && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${border.faint}`, paddingTop: 13, minWidth: 0 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Your reply to them (optional)</span>
            <textarea
              value={reply}
              onChange={(e) => onReply(e.target.value)}
              rows={2}
              placeholder="What you did, or why not."
              style={{ padding: "9px 11px", borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(2,6,23,.6)", color: text.title, fontSize: 12.5, lineHeight: 1.55, fontFamily: "inherit", outline: "none", resize: "vertical", minWidth: 0 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => onResolve("approved")}
              disabled={pending}
              style={{ height: 32, padding: "0 13px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              {request.requestedOuId ? "Approve and place them" : "Approve (writes nothing)"}
            </button>
            <button
              onClick={() => onResolve("fulfilled")}
              disabled={pending}
              style={{ height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Mark fulfilled
            </button>
            <button
              onClick={() => onResolve("rejected")}
              disabled={pending}
              style={{ height: 32, padding: "0 13px", borderRadius: 6, border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.1)", color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Reject
            </button>
          </div>
          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
            Approved and fulfilled behave identically — both write the real placement when a real unit was named. The difference is only what the customer reads, and neither can be taken back: once answered, a request can never return to waiting.
          </span>
        </div>
      )}

      {isSettled && (
        <div style={{ borderTop: `1px solid ${border.faint}`, paddingTop: 12 }}>
          <div style={{ border: `1px solid ${t.line}`, borderRadius: 10, background: t.tint, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: t.color }}>{request.status === "rejected" ? "Rejected" : "Answered"}</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
              {request.status === "rejected"
                ? "No placement was changed. The customer can raise another request, but this one is closed for good."
                : "Closed. If a real unit was named, the placement was written at the same moment — the status and the reality cannot drift apart on this path."}
            </span>
            {request.resolutionNote && <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>&ldquo;{request.resolutionNote}&rdquo;</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.muted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color, textWrap: "pretty" }}>{value}</span>
    </span>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ border: `1px dashed ${border.hover}`, borderRadius: 10, padding: 22, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>{title}</span>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty", maxWidth: 330 }}>{body}</span>
    </div>
  );
}

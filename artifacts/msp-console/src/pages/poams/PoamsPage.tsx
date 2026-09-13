/**
 * PoamsPage — the MSP Console's POA&Ms module (#3897, README screen 41),
 * wiring `msp-poams.ts`'s real routes.
 *
 * Design: `Design/MSP_Console/design_handoff_msp_console/POA&Ms.dc.html`
 * (README screen 41, per-tenant → Governance). Mounts into `ScreenSlot`'s
 * `children` for `sel.page === "poams"`.
 *
 * Real, confirmed-current backend state (checked against `main`, not assumed
 * from the design's own mock, which predates the fix):
 *   - #3452 and #3635 are BOTH fixed and closed. The generic edit route
 *     (`PATCH /msp/poams/:poamId`) now refuses `cancelled` and
 *     `converted_to_risk_acceptance` as incoming values with a 409, and
 *     refuses ANY edit once a row is already `cancelled`, `completed` or
 *     `converted_to_risk_acceptance`. There is no longer an operator-floor
 *     bypass of the dedicated, admin-gated cancel/convert routes to simulate
 *     — so, per the design's own role pill being "a design-review affordance
 *     that must not ship", this page carries no role toggle at all. It takes
 *     a real `isAdmin` boolean computed once from the caller's own session
 *     profile (the same pattern `Reports`/`Sales` already use for their own
 *     `ladder.msp-admin`-gated actions) and disables the admin-only buttons
 *     client-side; the server remains the sole real gate either way.
 * Two real gaps the design's notes correctly still call out, unchanged by the
 * above and preserved here rather than "fixed" in the UI:
 *   - `completed` is reachable ONLY through the same generic edit route, at
 *     the operator floor, with no dedicated route and no condition on open
 *     milestones — a plan can be marked complete with every milestone still
 *     pending.
 *   - A completed milestone is frozen against edits (the PATCH route refuses
 *     any change), but the DELETE route on that same milestone has no status
 *     check at all — it can still be removed outright, with no trace left on
 *     the plan.
 * `overdue` and `signed` are derived client-side (below) because these routes
 * return the bare row with no derived fields.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { border, text } from "@/console/tokens";
import {
  usePoams, usePoamDetail, useCreatePoam, useUpdatePoam, useCancelPoam,
  useConvertToRiskAcceptance, useDeletePoam, useAddMilestone, useCompleteMilestone,
  useDeleteMilestone, PoamApiError,
  type Poam, type PoamMilestone,
} from "@/api/poams-api";

const CARD_LINE = border.card;
const CARD_BG = "rgba(15,23,42,.6)";

const STATUS_TONE: Record<string, { color: string; tint: string; line: string }> = {
  draft: { color: "#94a3b8", tint: "rgba(148,163,184,.08)", line: "rgba(148,163,184,.2)" },
  pending_signature: { color: "#fbbf24", tint: "rgba(251,191,36,.1)", line: "rgba(251,191,36,.26)" },
  active: { color: "#34d399", tint: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.26)" },
  completed: { color: "#60a5fa", tint: "rgba(96,165,250,.1)", line: "rgba(96,165,250,.24)" },
  cancelled: { color: "#f87171", tint: "rgba(248,113,113,.1)", line: "rgba(248,113,113,.28)" },
  converted_to_risk_acceptance: { color: "#a78bfa", tint: "rgba(167,139,250,.08)", line: "rgba(167,139,250,.24)" },
};

const RAW_CHOICES = ["critical", "high", "medium"] as const;
const RESIDUAL_CHOICES = ["high", "medium", "low"] as const;
const FRAMEWORK_CHOICES = ["CIS v8", "HIPAA Security Rule", "SOC 2 CC6.1", "customer authority"];

function representativeScore(level: string): number {
  switch (level) {
    case "critical": return 95;
    case "high": return 78;
    case "medium": return 52;
    case "low": return 22;
    default: return 50;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function isOverdue(p: Poam): boolean {
  return p.scheduledCompletionDate < todayIso() && p.status !== "completed" && p.status !== "cancelled" && p.status !== "converted_to_risk_acceptance";
}

function isTerminal(status: string): boolean {
  return status === "cancelled" || status === "completed" || status === "converted_to_risk_acceptance";
}

const inputStyle: React.CSSProperties = {
  height: 36, padding: "0 11px", borderRadius: 6, border: `1px solid ${border.sidebar}`,
  background: "rgba(2,6,23,.6)", color: text.title, fontSize: 13, fontFamily: "inherit", outline: "none", minWidth: 0,
};

export function PoamsPage({
  customer,
  isAdmin,
  embedded = true,
  forceEmpty = false,
}: {
  /** Only used to prefill the create form's free-text tenant fields — this
   * route has no `customerId` and cannot scope its list to one tenant. See
   * the header and the on-screen note for why. */
  customer?: { name: string; tenantId: string | null; domain: string | null };
  /** Whether the caller's own session carries `ladder.msp-admin`. Computed
   * once by `ConsoleShell`, same pattern `Reports`/`Sales` already use. The
   * server is the real gate regardless of this value. */
  isAdmin: boolean;
  embedded?: boolean;
  forceEmpty?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [openPoamId, setOpenPoamId] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");

  const [fTitle, setFTitle] = useState("");
  const [fWeakness, setFWeakness] = useState("");
  const [fTenant, setFTenant] = useState(customer?.name ?? "");
  const [fDue, setFDue] = useState("");
  const [fControl, setFControl] = useState("");
  const [fResources, setFResources] = useState("");
  const [fStartState, setFStartState] = useState<"draft" | "pending_signature">("draft");

  const [msTitle, setMsTitle] = useState("");
  const [msDue, setMsDue] = useState("");

  const listQuery = usePoams();
  const plans: Poam[] = forceEmpty ? [] : (listQuery.data ?? []);
  const sortedPlans = useMemo(() => [...plans].sort((a, b) => b.id - a.id), [plans]);

  const detailQuery = usePoamDetail(forceEmpty ? null : openPoamId);
  const milestones: PoamMilestone[] = forceEmpty ? [] : (detailQuery.data?.milestones ?? []);
  const openPlan = forceEmpty ? undefined : (detailQuery.data ?? sortedPlans.find((p) => p.poamId === openPoamId));

  const createPoam = useCreatePoam();
  const updatePoam = useUpdatePoam();
  const cancelPoam = useCancelPoam();
  const convertToRisk = useConvertToRiskAcceptance();
  const deletePoam = useDeletePoam();
  const addMilestone = useAddMilestone();
  const completeMilestone = useCompleteMilestone();
  const deleteMilestone = useDeleteMilestone();

  useEffect(() => {
    if (openPoamId === null && sortedPlans.length > 0) setOpenPoamId(sortedPlans[0].poamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPlans.length]);

  const resetCreateForm = () => {
    setFTitle(""); setFWeakness(""); setFTenant(customer?.name ?? ""); setFDue("");
    setFControl(""); setFResources(""); setFStartState("draft");
  };

  const submitCreate = () => {
    const fields = [fTitle, fWeakness, fTenant, fDue, fControl, fResources];
    if (fields.some((v) => !v.trim())) {
      toast.error("Six fields are required — title, weakness, tenant, target date, interim control and resources.");
      return;
    }
    createPoam.mutate(
      {
        tenantId: customer?.tenantId ?? fTenant.trim().toLowerCase().replace(/\s+/g, "-"),
        tenantName: fTenant.trim(),
        // The route accepts an empty string here and saves it silently — real,
        // documented behavior (msp-poams.ts createPoamSchema), not fabricated.
        primaryDomain: customer?.domain ?? "",
        title: fTitle.trim(),
        weaknessDescription: fWeakness.trim(),
        scheduledCompletionDate: fDue.trim(),
        interimCompensatingControl: fControl.trim(),
        resourcesRequired: fResources.trim(),
        status: fStartState,
      },
      {
        onSuccess: (res) => {
          toast.success(`${res.poamId} created.`);
          setCreating(false);
          setOpenPoamId(res.poamId);
          resetCreateForm();
        },
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not create that plan."),
      },
    );
  };

  const submitSlip = () => {
    if (!openPlan || !newDueDate.trim()) return;
    updatePoam.mutate(
      { poamId: openPlan.poamId, input: { scheduledCompletionDate: newDueDate.trim() } },
      {
        onSuccess: () => {
          toast.success("Target date moved. The original target date is untouched and there is no reason field on this route, so the slip is visible but unexplained.");
          setNewDueDate("");
        },
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not move the target date."),
      },
    );
  };

  const submitComplete = () => {
    if (!openPlan) return;
    const openCount = milestones.filter((m) => m.status !== "completed").length;
    updatePoam.mutate(
      { poamId: openPlan.poamId, input: { status: "completed" } },
      {
        onSuccess: () =>
          toast.success(
            openCount > 0
              ? `Marked completed with ${openCount} milestone${openCount === 1 ? "" : "s"} still open — nothing checks them.`
              : "Marked completed.",
          ),
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not mark that plan completed."),
      },
    );
  };

  const submitCancel = () => {
    if (!openPlan) return;
    cancelPoam.mutate(openPlan.poamId, {
      onSuccess: () => toast.success("Cancelled through the dedicated route. Only the status changed — the signature and dates are left standing."),
      onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not cancel that plan — MSPAdmin is required."),
    });
  };

  const submitDelete = () => {
    if (!openPlan || !deleteReason.trim()) return;
    deletePoam.mutate(
      { poamId: openPlan.poamId, reason: deleteReason.trim() },
      {
        onSuccess: () => {
          toast.success("Deleted. Recoverable for the tenant's configured retention window, then eligible for review.");
          setConfirmingDelete(false);
          setDeleteReason("");
          setOpenPoamId(null);
        },
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not delete that plan — MSPAdmin is required."),
      },
    );
  };

  const submitAddMilestone = () => {
    if (!openPlan || !msTitle.trim() || !msDue.trim()) return;
    addMilestone.mutate(
      { poamId: openPlan.poamId, title: msTitle.trim(), dueDate: msDue.trim() },
      {
        onSuccess: () => {
          toast.success("Added as pending — the status is set server-side and cannot be supplied any other way.");
          setMsTitle(""); setMsDue("");
        },
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not add that milestone."),
      },
    );
  };

  const submitCompleteMilestone = (m: PoamMilestone) => {
    if (!openPlan) return;
    completeMilestone.mutate(
      { poamId: openPlan.poamId, milestoneId: m.id },
      {
        onSuccess: () => toast.success("Completed and stamped server-side. There is no route to un-complete it."),
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not complete that milestone."),
      },
    );
  };

  const submitDeleteMilestone = (m: PoamMilestone) => {
    if (!openPlan) return;
    deleteMilestone.mutate(
      { poamId: openPlan.poamId, milestoneId: m.id },
      {
        onSuccess: () =>
          toast.success(
            m.status === "completed"
              ? "A completed milestone was deleted. The record that this step was done is now gone — no audit, no trace on the plan."
              : "Removed.",
          ),
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not delete that milestone."),
      },
    );
  };

  const terminal = openPlan ? isTerminal(openPlan.status) : false;
  const signed = openPlan && !!openPlan.signedAt;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {!embedded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#60a5fa" }}>PLANS OF ACTION &amp; MILESTONES</span>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", color: text.title }}>POA&amp;Ms across the book</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        {/* Plans list */}
        <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150, flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Plans</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                {sortedPlans.length === 0 ? "Nothing authored yet" : `${sortedPlans.length} plan${sortedPlans.length === 1 ? "" : "s"} across the book`}
              </span>
            </span>
            <button
              onClick={() => { setCreating(true); setOpenPoamId(null); resetCreateForm(); }}
              style={{ height: 30, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              New plan
            </button>
          </div>

          {listQuery.isLoading ? (
            <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
          ) : sortedPlans.length === 0 ? (
            <EmptyPanel title="No plans on this MSP" body="A POA&M can also be raised from the customer's own portal, so an empty list here does not mean the tenant has none coming — it means none exists yet for this MSP." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              {sortedPlans.map((p) => {
                const t = STATUS_TONE[p.status];
                const on = p.poamId === openPoamId;
                const overdue = isOverdue(p);
                const slipped = p.scheduledCompletionDate !== p.originalScheduledCompletionDate;
                return (
                  <button
                    key={p.poamId}
                    onClick={() => { setOpenPoamId(p.poamId); setCreating(false); }}
                    style={{
                      display: "flex", flexDirection: "column", gap: 6, textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0,
                      border: `1px solid ${on ? "rgba(96,165,250,.4)" : "rgba(148,163,184,.14)"}`, borderRadius: 10,
                      background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 12,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                      <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: "#60a5fa" }}>{p.poamId}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10, fontWeight: 600, color: t.color, marginLeft: "auto" }}>
                        {p.status.replace(/_/g, " ")}
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, textWrap: "pretty" }}>{p.title}</span>
                    <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{p.tenantName}{p.checkKey ? ` · ${p.checkKey}` : " · no check key"}</span>
                    <span style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, color: overdue ? "#f87171" : slipped ? "#fbbf24" : text.label }}>
                        {overdue ? `Overdue since ${p.scheduledCompletionDate}` : `Due ${p.scheduledCompletionDate}${slipped ? ` · moved from ${p.originalScheduledCompletionDate}` : ""}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 10 }}>
            Newest first by row id. There is no filter, no search and no pagination on this route — the whole book comes back in one call, regardless of which tenant node this is opened from.
          </span>
        </div>

        {/* Detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {creating && (
            <div style={{ border: "1px solid rgba(96,165,250,.3)", borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title }}>New POA&amp;M</span>
              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>The reference code is assigned by the server on insert — you cannot choose it, and two people creating at once cannot collide.</span>
              <Field label="Title">
                <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Legacy authentication still enabled on three service accounts" style={inputStyle} />
              </Field>
              <Field label="The weakness">
                <textarea value={fWeakness} onChange={(e) => setFWeakness(e.target.value)} rows={4} placeholder="What is wrong, in the terms the customer will be asked to sign off." style={{ ...inputStyle, height: "auto", padding: "10px 11px", lineHeight: 1.6, resize: "vertical" }} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 11 }}>
                <Field label="Tenant"><input value={fTenant} onChange={(e) => setFTenant(e.target.value)} placeholder="Northwind Traders" style={inputStyle} /></Field>
                <Field label="Target completion"><input type="date" value={fDue} onChange={(e) => setFDue(e.target.value)} style={{ ...inputStyle, fontFamily: "Menlo, monospace" }} /></Field>
              </div>
              <Field label="Interim compensating control">
                <input value={fControl} onChange={(e) => setFControl(e.target.value)} placeholder="What holds the risk down until this is fixed" style={inputStyle} />
              </Field>
              <Field label="Resources required">
                <input value={fResources} onChange={(e) => setFResources(e.target.value)} placeholder="Who and what it takes" style={inputStyle} />
              </Field>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>Start it as</span>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {(["draft", "pending_signature"] as const).map((s) => {
                    const on = fStartState === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setFStartState(s)}
                        style={{ height: 28, padding: "0 11px", borderRadius: 999, border: `1px solid ${on ? "rgba(96,165,250,.45)" : border.sidebar}`, background: on ? "rgba(37,99,235,.18)" : "rgba(148,163,184,.06)", color: on ? "#f1f5f9" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                      >
                        {s === "draft" ? "Draft" : "Pending signature"}
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" }}>Only these two. A plan cannot be created active — that state is reachable only when the customer signs it in their own portal.</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={submitCreate} disabled={createPoam.isPending} style={{ height: 34, padding: "0 13px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  {createPoam.isPending ? "Creating…" : "Create plan"}
                </button>
                <button onClick={() => setCreating(false)} style={{ height: 34, padding: "0 13px", borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!creating && openPlan && (
            <>
              <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 170, flex: 1 }}>
                    <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: "#60a5fa" }}>{openPlan.poamId}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-.01em", color: text.title, textWrap: "pretty" }}>{openPlan.title}</span>
                    <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                      {openPlan.tenantName} · tenant id {openPlan.tenantId} (free text, not a real reference) · {openPlan.sowId ? `SOW ${openPlan.sowId}` : "no SOW attached"}
                    </span>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: STATUS_TONE[openPlan.status].tint, border: `1px solid ${STATUS_TONE[openPlan.status].line}`, fontSize: 10.5, fontWeight: 600, color: STATUS_TONE[openPlan.status].color }}>
                    {openPlan.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div style={{ fontSize: 12.5, lineHeight: 1.65, color: text.secondary, textWrap: "pretty" }}>{openPlan.weaknessDescription}</div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, borderTop: `1px solid ${border.faint}`, paddingTop: 13 }}>
                  <Fact label="TARGET DATE" value={openPlan.scheduledCompletionDate + (openPlan.scheduledCompletionDate !== openPlan.originalScheduledCompletionDate ? " · moved" : "")} color={isOverdue(openPlan) ? "#f87171" : text.title} />
                  <Fact label="ORIGINAL TARGET" value={openPlan.originalScheduledCompletionDate} color={openPlan.scheduledCompletionDate !== openPlan.originalScheduledCompletionDate ? "#fbbf24" : text.muted} />
                  <Fact label="INTERIM CONTROL" value={openPlan.interimCompensatingControl} color={text.title} />
                  <Fact label="RESOURCES" value={openPlan.resourcesRequired} color={text.title} />
                </div>

                <div style={{ border: `1px solid ${signed ? "rgba(52,211,153,.26)" : border.sidebar}`, borderRadius: 10, background: signed ? "rgba(52,211,153,.1)" : "rgba(148,163,184,.06)", padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: signed ? "#34d399" : text.muted }}>{signed ? "Signed by the customer" : "Not signed"}</span>
                  <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                    {signed
                      ? `${openPlan.signedBy?.name ?? "Unknown"} on ${openPlan.signedAt!.slice(0, 10)}. "${openPlan.signedStatement ?? ""}" The signature, the accountable-holder trail and the move to active are all written by the customer's own portal — nothing here can sign, re-sign or undo it.`
                      : "This plan has no signature. Only the customer's portal can add one, and that is also the only thing that makes a plan active — no route on this side can set that status."}
                  </span>
                </div>

                {!terminal && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} style={{ ...inputStyle, height: 32, fontFamily: "Menlo, monospace", width: 150 }} />
                    <button onClick={submitSlip} disabled={!newDueDate.trim() || updatePoam.isPending} style={{ height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${border.sidebar}`, background: "rgba(148,163,184,.06)", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: newDueDate.trim() ? "pointer" : "not-allowed" }}>
                      Move the target date
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${border.faint}`, paddingTop: 13 }}>
                  <button
                    onClick={submitComplete}
                    disabled={terminal || updatePoam.isPending}
                    style={ghostBtn(!terminal)}
                  >
                    Mark completed
                  </button>
                  <button
                    onClick={submitCancel}
                    disabled={terminal || !isAdmin || cancelPoam.isPending}
                    title={!isAdmin ? "Cancelling a POA&M requires ladder.msp-admin" : ""}
                    style={dangerBtn(!terminal && isAdmin)}
                  >
                    Cancel plan
                  </button>
                  {openPlan.status === "active" && (
                    <button
                      onClick={() => setConvertOpen(true)}
                      disabled={!isAdmin}
                      title={!isAdmin ? "Converting to a risk acceptance requires ladder.msp-admin" : ""}
                      style={ghostBtn(isAdmin)}
                    >
                      Convert to risk acceptance
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    disabled={!isAdmin}
                    title={!isAdmin ? "Deleting a POA&M requires ladder.msp-admin" : ""}
                    style={dangerBtn(isAdmin)}
                  >
                    Delete plan
                  </button>
                </div>
                <span style={{ fontSize: 11, color: isAdmin ? text.muted : "#fbbf24", textWrap: "pretty" }}>
                  {isAdmin
                    ? "Cancel, convert and delete all go through their own dedicated routes, which is the intended path for each."
                    : "Cancel, convert and delete all require ladder.msp-admin server-side. Your session doesn't carry it, so those buttons are disabled here — the same gate every MSPAdmin-only route in this console enforces."}
                </span>

                {openPlan.convertedToRiskDecisionId && (
                  <span style={{ fontSize: 11, color: "#a78bfa", textWrap: "pretty" }}>
                    Converted to risk decision #{openPlan.convertedToRiskDecisionId}{openPlan.conversionReason ? ` — "${openPlan.conversionReason}"` : ""}.
                  </span>
                )}

                {confirmingDelete && (
                  <div style={{ border: "1px solid rgba(248,113,113,.3)", borderRadius: 10, background: "rgba(248,113,113,.08)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#f87171" }}>Delete this plan?</span>
                    <span style={{ fontSize: 11, color: text.secondary, textWrap: "pretty" }}>Soft-deleted through the platform retention lifecycle — recoverable for the tenant's configured window, then eligible for review. A reason is required. There is no status check on this route: a completed or cancelled plan can be deleted the same as any other.</span>
                    <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Why this plan is being deleted" style={inputStyle} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={submitDelete} disabled={!deleteReason.trim() || deletePoam.isPending} style={dangerBtn(!!deleteReason.trim())}>Delete</button>
                      <button onClick={() => { setConfirmingDelete(false); setDeleteReason(""); }} style={ghostBtn(true)}>Never mind</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Milestones */}
              <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Milestones</span>
                <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                  {milestones.length > 0
                    ? `${milestones.filter((m) => m.status === "completed").length} of ${milestones.length} complete · ordered by sort order, then id`
                    : "Ordered by sort order, then id"}
                </span>

                {detailQuery.isLoading ? (
                  <span style={{ fontSize: 12, color: text.label }}>Loading…</span>
                ) : milestones.length === 0 ? (
                  <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>No milestones. Nothing requires a plan to have any, and nothing computes the plan's progress from them — a plan with no milestones and one with all of them complete read the same on the wire.</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                    {[...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((m) => {
                      const done = m.status === "completed";
                      const overdueM = !done && m.dueDate < todayIso();
                      const tone = done ? STATUS_TONE.completed : overdueM ? STATUS_TONE.cancelled : STATUS_TONE.draft;
                      return (
                        <div key={m.id} style={{ border: `1px solid ${done ? "rgba(52,211,153,.18)" : border.faint}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 160, flex: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: done ? text.muted : text.title, textWrap: "pretty" }}>{m.title}</span>
                              <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>
                                {done ? `Due ${m.dueDate} · completed ${m.completedAt?.slice(0, 10) ?? ""}` : overdueM ? `Due ${m.dueDate} — past due` : `Due ${m.dueDate}`}
                              </span>
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.line}`, fontSize: 10, fontWeight: 600, color: tone.color }}>{m.status}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => submitCompleteMilestone(m)}
                              disabled={done || completeMilestone.isPending}
                              style={ghostBtn(!done)}
                            >
                              {done ? "Completed" : "Mark complete"}
                            </button>
                            <button onClick={() => submitDeleteMilestone(m)} disabled={deleteMilestone.isPending} style={dangerBtn(true)}>
                              Delete
                            </button>
                          </div>
                          {done && (
                            <span style={{ fontSize: 11, color: "#fbbf24", textWrap: "pretty", borderTop: `1px solid ${border.faint}`, paddingTop: 8 }}>
                              Frozen against edits, but delete has no such guard — this row can still be removed outright.
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${border.faint}`, paddingTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: text.muted }}>New milestone</span>
                    <input value={msTitle} onChange={(e) => setMsTitle(e.target.value)} placeholder="Title" style={inputStyle} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: text.muted }}>Due</span>
                    <input type="date" value={msDue} onChange={(e) => setMsDue(e.target.value)} style={{ ...inputStyle, fontFamily: "Menlo, monospace" }} />
                  </label>
                  <button onClick={submitAddMilestone} disabled={!msTitle.trim() || !msDue.trim() || addMilestone.isPending} style={ghostBtn(!!msTitle.trim() && !!msDue.trim())}>
                    Add
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ border: `1px solid ${CARD_LINE}`, borderRadius: 14, background: CARD_BG, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>What these eight routes do and don't give this screen</span>
            {NOTES.map((n, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
                <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty", minWidth: 0 }}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {convertOpen && openPlan && (
        <ConvertDrawer
          plan={openPlan}
          onClose={() => setConvertOpen(false)}
          onConvert={convertToRisk}
        />
      )}
    </div>
  );
}

function ghostBtn(enabled: boolean): React.CSSProperties {
  return {
    height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${enabled ? border.sidebar : "rgba(148,163,184,.12)"}`,
    background: enabled ? "rgba(148,163,184,.06)" : "rgba(148,163,184,.04)", color: enabled ? text.secondary : text.faint,
    fontSize: 12, fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed",
  };
}

function dangerBtn(enabled: boolean): React.CSSProperties {
  return {
    height: 32, padding: "0 13px", borderRadius: 6, border: `1px solid ${enabled ? "rgba(248,113,113,.3)" : "rgba(148,163,184,.12)"}`,
    background: enabled ? "rgba(248,113,113,.1)" : "rgba(148,163,184,.04)", color: enabled ? "#f87171" : text.faint,
    fontSize: 12, fontWeight: 600, cursor: enabled ? "pointer" : "not-allowed",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: text.muted }}>{label}</span>
      {children}
    </label>
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

const NOTES: { dot: string; text: string }[] = [
  { dot: "#60a5fa", text: "Cancelling and converting are both ladder.msp-admin-gated on their own dedicated routes — and, since #3452 and #3635 both landed, the generic edit route now refuses the same statuses outright, so there is no operator-floor bypass left. This screen disables those buttons for a non-admin session, but the server was already the real gate." },
  { dot: "#f87171", text: "Completed is reachable only through the generic edit route. There is no dedicated completion route, no elevated role and no condition — a plan can be marked complete with every milestone still open, and nothing anywhere computes progress from the milestones." },
  { dot: "#f87171", text: "A completed milestone is frozen against edits by the PATCH route, yet the DELETE route on that same milestone has no status check at all, so the record of a finished step can be removed outright with no trace on the plan." },
  { dot: "#fbbf24", text: "The routes return the bare database row with no derived fields, so overdue and signed are computed here in the client. The customer's own portal computes both server-side for the same table, which means the two surfaces can disagree about the same plan." },
  { dot: "#fbbf24", text: "Every mutation answers with a bare acknowledgement rather than the updated row, so this screen re-reads the plan after each action rather than trusting an optimistic copy." },
  { dot: "#60a5fa", text: "The original target date is stamped at creation and can never be rewritten, which makes a slip permanently visible — but there is no reason field on the edit route, so the why of a moved date lives nowhere." },
  { dot: "#60a5fa", text: "Signature, the accountable-holder trail and the move to active are written exclusively by the customer's portal. This surface authors the plan and reads the signature back; it can never produce one." },
  { dot: "#94a3b8", text: "The reference code is assigned server-side with a reserved placeholder, so two operators creating at once cannot collide." },
  { dot: "#94a3b8", text: "The tenant is free text with no real reference on this table, and this route takes no customerId — so this list is the whole book, not a filtered view of the tenant node it was opened from, and a plan cannot be reliably linked back to a real tenant record." },
  { dot: "#94a3b8", text: "The list route takes no filter, no search and no pagination, and the create route accepts an empty primary domain silently — both are real, as-built behavior, not gaps this screen papers over." },
];

function ConvertDrawer({
  plan, onClose, onConvert,
}: {
  plan: Poam;
  onClose: () => void;
  onConvert: ReturnType<typeof useConvertToRiskAcceptance>;
}) {
  const [reason, setReason] = useState("");
  const [controlViolated, setControlViolated] = useState("");
  const [raw, setRaw] = useState<(typeof RAW_CHOICES)[number]>("high");
  const [residual, setResidual] = useState<(typeof RESIDUAL_CHOICES)[number]>("medium");
  const [framework, setFramework] = useState(FRAMEWORK_CHOICES[0]);
  const [liability, setLiability] = useState("");
  const [approverName, setApproverName] = useState("");
  const [approverTitle, setApproverTitle] = useState("");
  const [approverEmail, setApproverEmail] = useState("");
  const [expirationDate, setExpirationDate] = useState("");

  const canSubmit =
    reason.trim().length > 0 &&
    controlViolated.trim().length > 0 &&
    approverName.trim().length > 0 &&
    approverEmail.trim().length > 0 &&
    expirationDate.trim().length > 0 &&
    !onConvert.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const liabilityValueUsd = Math.max(0, Math.round(Number(liability.replace(/[^0-9.]/g, "")) || 0));
    onConvert.mutate(
      {
        poamId: plan.poamId,
        input: {
          reason: reason.trim(),
          controlViolated: controlViolated.trim(),
          framework,
          rawRiskLevel: raw,
          residualRiskLevel: residual,
          rawRiskScore: representativeScore(raw),
          residualRiskScore: representativeScore(residual),
          liabilityValueUsd,
          clientApprover: { name: approverName.trim(), title: approverTitle.trim(), email: approverEmail.trim() },
          expirationDate: expirationDate.trim(),
        },
      },
      {
        onSuccess: (res) => {
          toast.success(`${res.registerRef} recorded — this plan is now converted, awaiting the customer's signature on the new decision.`);
          onClose();
        },
        onError: (err) => toast.error(err instanceof PoamApiError ? err.message : "Could not convert this plan."),
      },
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(470px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>CONVERT · POST /api/msp/poams/{plan.poamId}/convert-to-risk-acceptance</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>Convert to a risk acceptance</span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
          The plan's cost or factors turned out too high to execute. This creates a new, signable risk decision (RBD-{plan.poamId}) and marks this plan converted — a real terminal state, distinct from cancelled, because nothing was abandoned.
        </span>

        <Field label="Why this is being converted">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What made fixing this impractical." style={{ ...inputStyle, height: "auto", padding: "10px 11px", lineHeight: 1.6, resize: "vertical" }} />
        </Field>
        <Field label="Control or requirement being violated">
          <input value={controlViolated} onChange={(e) => setControlViolated(e.target.value)} placeholder={plan.interimCompensatingControl} style={inputStyle} />
        </Field>
        <Chooser label="Risk before controls" options={RAW_CHOICES} value={raw} onPick={(v) => setRaw(v)} />
        <Chooser label="Risk after controls" options={RESIDUAL_CHOICES} value={residual} onPick={(v) => setResidual(v)} />
        <Chooser label="Authority" options={FRAMEWORK_CHOICES} value={framework} onPick={setFramework} />
        <Field label="What it would cost if it went wrong">
          <input value={liability} onChange={(e) => setLiability(e.target.value)} placeholder="e.g. 120000" style={inputStyle} />
        </Field>
        <Field label="Who signs for the customer">
          <input value={approverName} onChange={(e) => setApproverName(e.target.value)} placeholder="Name" style={inputStyle} />
        </Field>
        <Field label="Their title">
          <input value={approverTitle} onChange={(e) => setApproverTitle(e.target.value)} placeholder="IT Director" style={inputStyle} />
        </Field>
        <Field label="Their email">
          <input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="name@customerdomain.com" style={inputStyle} />
        </Field>
        <Field label="When this acceptance expires">
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} style={{ ...inputStyle, fontFamily: "Menlo, monospace" }} />
        </Field>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button onClick={submit} disabled={!canSubmit} style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${canSubmit ? "#2563eb" : border.card}`, background: canSubmit ? "#2563eb" : "transparent", color: canSubmit ? "#fff" : text.label, fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed" }}>
            {onConvert.isPending ? "Converting…" : "Convert plan"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Chooser<T extends string>({ label, options, value, onPick }: { label: string; options: readonly T[]; value: T; onPick: (v: T) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>{label}</span>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {options.map((o) => {
          const active = value === o;
          return (
            <button key={o} onClick={() => onPick(o)} style={{ height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${active ? "rgba(96,165,250,.32)" : border.card}`, background: active ? "rgba(37,99,235,.18)" : "transparent", color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

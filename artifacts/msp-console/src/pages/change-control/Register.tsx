/**
 * Change Control — Register (screen 7). `GET/POST/PATCH /api/msp/change-requests`,
 * `.../timeline`, `.../comments` (`msp-changes.ts`).
 */
import { useMemo, useState } from "react";
import type { DirectoryCustomer } from "@/api/console-api";
import { Icon } from "@/console/icons";
import {
  Badge, Button, Card, DataState, Drawer, Fact, HonestNote, TabBar,
  CLASS_TONE, RISK_COLOR, STATUS_LABEL, STATUS_TONE, toneColors,
} from "./shared";
import {
  filterByTenant, tenantKeyOf, useApproveChangeRequest, useChangeRequests, useCreateChangeRequest,
  useCrTimeline, usePatchChangeRequest, usePostCrComment,
  ApiError, type ChangeCategory, type ChangeClass, type ChangeStatus, type RiskLevel, type WireChangeRequest,
} from "./api";

const STATUS_FILTERS: { id: ChangeStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_approval", label: "Pending approval" },
  { id: "scheduled", label: "Scheduled" },
  { id: "completed", label: "Completed" },
  { id: "rejected", label: "Rejected" },
];

const CLASS_OPTIONS: ChangeClass[] = ["standard", "normal", "emergency"];
const RISK_OPTIONS: RiskLevel[] = ["critical", "high", "medium", "low"];
const CATEGORY_OPTIONS: ChangeCategory[] = ["ConditionalAccess", "Exchange", "Identity", "Intune", "Defender", "SharePoint", "Purview", "Teams"];

const EVENT_ICON: Record<string, string> = {
  raised: "file-plus", approved: "circle-check-big", rejected: "circle-x", scheduled: "calendar-clock",
  in_progress: "loader", completed: "circle-check-big", rolled_back: "undo-2", comment: "message-square",
};

export function Register({ customer, onNavigateTab }: { customer: DirectoryCustomer | undefined; onNavigateTab: (tabId: string) => void }) {
  const tenantKey = tenantKeyOf(customer);
  const query = useChangeRequests();
  const all = query.data ?? [];
  const rows = useMemo(() => filterByTenant(all, tenantKey), [all, tenantKey]);

  const [filter, setFilter] = useState<ChangeStatus | "all">("all");
  const [selCode, setSelCode] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const sel = selCode ? rows.find((r) => r.id === selCode) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        <Button label="Raise a change" icon="plus" tone="primary" onClick={() => setCreateOpen(true)} />
      </div>

      <DataState
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={!query.isLoading && !query.error && rows.length === 0}
        route="GET /api/msp/change-requests"
        emptyTitle="No change requests for this tenant"
        emptyNote="Nothing has been raised against this tenant yet. Raise one from the button above."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  height: 28, padding: "0 10px", borderRadius: 7,
                  border: `1px solid ${filter === f.id ? "rgba(96,165,250,.3)" : "rgba(148,163,184,.18)"}`,
                  background: filter === f.id ? "rgba(37,99,235,.18)" : "transparent",
                  color: filter === f.id ? "#bfdbfe" : "#94a3b8", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: "#64748b" }}>{visible.length} of {rows.length} changes</span>
          </div>

          <div style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, background: "rgba(15,23,42,.6)", overflowX: "auto" }}>
            <div style={{ minWidth: 1080 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 2.2fr 1fr .9fr 1.2fr 1.4fr 1.2fr", gap: 12, padding: "11px 16px", borderBottom: "1px solid rgba(148,163,184,.14)", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: "#64748b" }}>
                <span>CODE</span><span>CHANGE</span><span>CLASS</span><span>RISK</span><span>STATUS</span><span>APPROVALS</span><span>WINDOW</span>
              </div>
              {visible.map((r) => {
                const approved = r.approvals.filter((a) => a.decision === "approved").length;
                const rejected = r.approvals.some((a) => a.decision === "rejected");
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelCode(r.id)}
                    style={{
                      display: "grid", gridTemplateColumns: "1.1fr 2.2fr 1fr .9fr 1.2fr 1.4fr 1.2fr", gap: 12, alignItems: "center",
                      padding: "12px 16px", borderBottom: "1px solid rgba(148,163,184,.08)", cursor: "pointer",
                      background: sel?.id === r.id ? "rgba(37,99,235,.1)" : "transparent",
                    }}
                  >
                    <span style={{ fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>{r.id}</span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{r.title}</span>
                      <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.tenantName} · {r.category} · {r.psaTicketId || "no PSA ticket"}
                      </span>
                    </span>
                    <Badge label={r.changeClass} tone={CLASS_TONE[r.changeClass]} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: RISK_COLOR[r.riskLevel] }}>{r.riskLevel}</span>
                    <Badge label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                    <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <span style={{ display: "flex", gap: 3 }}>
                        {r.approvals.map((a, i) => (
                          <span key={i} style={{ width: 7, height: 7, borderRadius: 999, background: a.decision === "approved" ? "#34d399" : a.decision === "rejected" ? "#f87171" : "#475569" }} />
                        ))}
                      </span>
                      <span style={{ fontSize: 11.5, color: rejected ? "#fca5a5" : approved === r.approvals.length && r.approvals.length > 0 ? "#6ee7b7" : "#fcd34d", whiteSpace: "nowrap" }}>
                        {rejected ? "rejected" : `${approved} of ${r.approvals.length} stages`}
                      </span>
                    </span>
                    <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.scheduledFor}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DataState>

      <HonestNote>
        Change control runs end to end on the server — register, catalog, board, windows, executions and reviews are all live endpoints. Fleet change metrics (success rate, lead time, emergency ratio) have no operator endpoint yet and are not shown.
      </HonestNote>

      {sel && (
        <CrDetailDrawer cr={sel} onClose={() => setSelCode(null)} onNavigateTab={onNavigateTab} />
      )}
      {createOpen && customer && (
        <CreateDrawer customer={customer} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

function CrDetailDrawer({ cr, onClose, onNavigateTab }: { cr: WireChangeRequest; onClose: () => void; onNavigateTab: (tabId: string) => void }) {
  const timeline = useCrTimeline(cr.id);
  const patch = usePatchChangeRequest();
  const approve = useApproveChangeRequest();
  const postComment = usePostCrComment();
  const [comment, setComment] = useState("");
  const [rejectArmed, setRejectArmed] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // #3761 — set only when the server refuses a direct approval because the
  // change is already sitting on an open CAB agenda item; that stage's row
  // then falls back to "Decide via Advisory Board" instead of retrying here.
  const [approveCabBlocked, setApproveCabBlocked] = useState(false);

  const pending = cr.approvals.filter((a) => a.decision === "pending").length;
  const rejected = cr.approvals.some((a) => a.decision === "rejected");
  const gated = pending > 0 || rejected;

  const transitions: { id: ChangeStatus; label: string; icon: string }[] = [
    { id: "scheduled", label: "Schedule", icon: "calendar-clock" },
    { id: "in_progress", label: "Start work", icon: "play" },
    { id: "completed", label: "Mark completed", icon: "circle-check-big" },
  ];

  return (
    <Drawer open eyebrow={`${cr.id} · ${cr.tenantName}`} title={cr.title} onClose={onClose} width={520}>
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{cr.description || "No description recorded."}</span>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
        <Fact label="CLASS" value={cr.changeClass} />
        <Fact label="RISK" value={cr.riskLevel} color={RISK_COLOR[cr.riskLevel]} />
        <Fact label="CATEGORY" value={cr.category} />
        <Fact label="STATUS" value={STATUS_LABEL[cr.status]} color={toneColors(STATUS_TONE[cr.status]).color} />
        <Fact label="AUTHORIZED TARGET" value={cr.authorizedTargetKey ?? "general change — no scoped target"} color="#93c5fd" mono={!!cr.authorizedTargetKey} />
        <Fact label="WINDOW" value={cr.scheduledFor} />
        <Fact label="PEOPLE AFFECTED" value={String(cr.impactedUsersCount)} />
        <Fact label="PSA TICKET" value={cr.psaTicketId || "none"} color="#93c5fd" mono={!!cr.psaTicketId} />
        {cr.linkedFinding && <Fact label="RAISED FROM" value={cr.linkedFinding} />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: "#475569" }}>APPROVALS</span>
        {cr.approvals.length === 0 && <span style={{ fontSize: 12, color: "#64748b" }}>No approval stages recorded for this change.</span>}
        {cr.approvals.map((a, i) => {
          const tone = a.decision === "approved" ? "green" : a.decision === "rejected" ? "red" : "slate";
          const { color, tint, line } = toneColors(tone as "green" | "red" | "slate");
          const ROLE_LABEL: Record<string, string> = { customer: "the customer", msp: "us", catalog_inherited: "the catalog", microsoft_forced: "Microsoft" };
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(148,163,184,.14)", background: "rgba(2,6,23,.4)", flexWrap: "wrap" }}>
              <span style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, background: tint, border: `1px solid ${line}`, color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={a.decision === "approved" ? "circle-check-big" : a.decision === "rejected" ? "circle-x" : "circle-dashed"} size={13} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 120 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f1f5f9" }}>Stage {a.stage} · {a.approverRole === "msp" ? "MSP technical review" : a.approverRole === "customer" ? "Customer sign-off" : a.approverRole === "catalog_inherited" ? "Inherited from catalog" : "Microsoft-forced"}</span>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  {(a.decidedAt ? new Date(a.decidedAt).toLocaleString() + " · " : "")}{a.approverName ?? "unassigned"} · authority: {ROLE_LABEL[a.approverRole]}
                </span>
              </span>
              {a.decision === "pending" ? (
                a.approverRole === "msp" ? (
                  approveCabBlocked ? (
                    <Button label="Decide via Advisory Board" onClick={() => onNavigateTab("cc.cab")} title="This change is already on an open CAB agenda — its decision is recorded there." />
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button
                        label="Approve"
                        icon="circle-check-big"
                        tone="primary"
                        disabled={approve.isPending}
                        onClick={() =>
                          approve.mutate(
                            { id: cr.id },
                            { onError: (err) => { if (err instanceof ApiError && err.status === 409) setApproveCabBlocked(true); } },
                          )
                        }
                      />
                      <Button label="Reject" icon="circle-x" tone="danger" onClick={() => setRejectArmed(true)} />
                    </div>
                  )
                ) : (
                  <span style={{ fontSize: 11, color: "#64748b" }}>awaiting {ROLE_LABEL[a.approverRole]}</span>
                )
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color }}>{a.decision.toUpperCase()}</span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: "#475569" }}>MOVE THIS CHANGE</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {transitions.map((t) => {
            const blocked = gated;
            const current = cr.status === t.id;
            return (
              <Button
                key={t.id}
                label={current ? `${t.label} · current` : t.label}
                icon={blocked ? "lock" : t.icon as never}
                tone={blocked || current ? "ghost" : "primary"}
                disabled={blocked || current}
                title={blocked ? "Every approval stage has to clear first" : undefined}
                onClick={() => patch.mutate({ id: cr.id, status: t.id })}
              />
            );
          })}
          {!rejectArmed ? (
            <Button label="Reject" icon="circle-x" tone="danger" onClick={() => setRejectArmed(true)} />
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejecting"
                style={{ flex: 1, height: 30, padding: "0 10px", borderRadius: 7, border: "1px solid rgba(248,113,113,.3)", background: "rgba(2,6,23,.6)", color: "#e2e8f0", fontSize: 12 }}
              />
              <Button
                label="Confirm reject"
                tone="danger"
                onClick={() => { patch.mutate({ id: cr.id, status: "rejected", reason: rejectReason || undefined }); setRejectArmed(false); setRejectReason(""); }}
              />
              <Button label="Cancel" onClick={() => setRejectArmed(false)} />
            </div>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: gated ? "#fcd34d" : "#6ee7b7" }}>
          {rejected
            ? "This change was rejected. Rejecting never needed an approval, so nothing was blocking it."
            : pending > 0
              ? `${pending} approval stage still pending. Scheduling, starting and completing stay locked until it clears.`
              : "All approval stages cleared. This change can be scheduled, started and completed."}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 13, borderTop: "1px solid rgba(148,163,184,.12)" }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: "#475569" }}>TIMELINE</span>
        {timeline.isLoading && <span style={{ fontSize: 12, color: "#64748b" }}>Loading…</span>}
        {timeline.data && [...timeline.data.events].reverse().map((e, i) => (
          <div key={`e${i}`} style={{ display: "flex", gap: 10 }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.26)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 24px" }}>
              <Icon name={(EVENT_ICON[e.eventType] ?? "circle") as never} size={12} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 9 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f1f5f9" }}>{e.eventType.replace(/_/g, " ")}</span>
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{e.reason ?? `${e.fromValue ?? "—"} → ${e.toValue}`}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>{e.actorName ?? e.actorRole} · {new Date(e.occurredAt).toLocaleString()}</span>
            </div>
          </div>
        ))}
        {timeline.data?.comments.map((c, i) => (
          <div key={`c${i}`} style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 9 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "#f1f5f9" }}>{c.authorName} commented</span>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{c.body}</span>
            <span style={{ fontSize: 11, color: "#475569" }}>{new Date(c.createdAt).toLocaleString()}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment"
            style={{ flex: 1, height: 32, padding: "0 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.18)", background: "rgba(2,6,23,.5)", color: "#e2e8f0", fontSize: 12.5, outline: "none" }}
          />
          <Button
            label="Post"
            disabled={!comment.trim()}
            onClick={() => { postComment.mutate({ id: cr.id, body: comment }); setComment(""); }}
          />
        </div>
      </div>
    </Drawer>
  );
}

function CreateDrawer({ customer, onClose }: { customer: DirectoryCustomer; onClose: () => void }) {
  const create = useCreateChangeRequest();
  const [title, setTitle] = useState("");
  const [changeClass, setChangeClass] = useState<ChangeClass>("normal");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium");
  const [category, setCategory] = useState<ChangeCategory>("ConditionalAccess");
  const [freezeJustification, setFreezeJustification] = useState("");
  const [freezeBlocked, setFreezeBlocked] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && (!freezeBlocked || freezeJustification.trim().length > 0);

  const submit = () => {
    if (!canSubmit || !customer.tenantId) return;
    create.mutate(
      {
        tenantId: customer.tenantId,
        tenantName: customer.name,
        primaryDomain: customer.domain ?? "",
        title: title.trim(),
        description: "",
        changeClass, riskLevel, category,
        targetResource: "", psaTicketId: "", scheduledFor: "Not yet scheduled",
        impactedUsersCount: 0, preChangeSnapshot: {}, proposedPayload: {}, rollbackScriptSnippet: "",
        freezeException: freezeBlocked ? { justification: freezeJustification.trim() } : undefined,
      },
      {
        onSuccess: onClose,
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setFreezeBlocked(err.message);
        },
      },
    );
  };

  const chooser = <T extends string>(label: string, options: readonly T[], value: T, onPick: (v: T) => void) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>{label}</span>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onPick(o)}
            style={{
              height: 30, padding: "0 11px", borderRadius: 7,
              border: `1px solid ${value === o ? "rgba(96,165,250,.32)" : "rgba(148,163,184,.18)"}`,
              background: value === o ? "rgba(37,99,235,.18)" : "transparent",
              color: value === o ? "#bfdbfe" : "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Drawer open eyebrow="RAISE A CHANGE" title="New change request" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is changing"
          style={{ height: 36, padding: "0 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 13, outline: "none" }}
        />
      </div>
      {chooser<ChangeClass>("Class", CLASS_OPTIONS, changeClass, setChangeClass)}
      <span style={{ fontSize: 11, color: "#64748b" }}>A standard change inherits its approval from the catalog and skips the board. An emergency change is acted on first and reviewed after.</span>
      {chooser<RiskLevel>("Risk", RISK_OPTIONS, riskLevel, setRiskLevel)}
      {chooser<ChangeCategory>("Category", CATEGORY_OPTIONS, category, setCategory)}

      {freezeBlocked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: 13, borderRadius: 11, border: "1px solid rgba(248,113,113,.3)", background: "rgba(248,113,113,.09)" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Icon name="snowflake" size={15} color="#f87171" style={{ flex: "0 0 15px", marginTop: 2 }} />
            <span style={{ fontSize: 12.5, color: "#cbd5e1" }}>{freezeBlocked}</span>
          </div>
          <input
            value={freezeJustification}
            onChange={(e) => setFreezeJustification(e.target.value)}
            placeholder="Why this cannot wait"
            style={{ height: 34, padding: "0 11px", borderRadius: 8, border: "1px solid rgba(248,113,113,.3)", background: "rgba(2,6,23,.6)", color: "#f1f5f9", fontSize: 12.5, outline: "none" }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: "1px solid rgba(148,163,184,.12)" }}>
        <Button
          label={freezeBlocked ? "Raise with a freeze exception" : "Raise this change"}
          tone="primary"
          disabled={!canSubmit || create.isPending}
          onClick={submit}
        />
        <Button label="Cancel" onClick={onClose} />
      </div>
    </Drawer>
  );
}

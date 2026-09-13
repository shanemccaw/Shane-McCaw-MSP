/**
 * Policy Engine — MSP-wide (Operations) module page (Git #2591, Feature #1685).
 * Mounts at `/ops/policy`
 * (`Design/MSP_Console/design_handoff_msp_console/Policy Engine.dc.html`,
 * README screen 50). See `@/api/policy-api.ts` for the full real route map.
 *
 * Real, load-bearing design note carried over from the dispatch: a customer-
 * signed policy decision and an MSP standing policy are two different real
 * things that can both resolve to the identical enactment ROUTE — reason is
 * always rendered separately from route, never folded into one label.
 *
 * Known, deliberate limitation surfaced on the face of the screen rather than
 * worked around (#3035, settled — not an open finding): there is no MSP-side
 * create/author route for a policy decision. `signedBy` is the customer's own
 * typed confirmation from their own portal; an MSP staffer authoring one here
 * would misattribute a customer's signed compliance position.
 *
 * No fixture module — every row is a real server response or an honest
 * loading/empty/error state.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import { useDirectory, type DirectoryCustomer } from "@/api/console-api";
import {
  useChangeCatalogForPicker, useCreateStandingPolicy, useCustomerOus, useEvaluateStandingPolicy,
  useMspSopsForPicker, useObligationRegister, usePolicyDecisions, usePolicyEngineOptIn,
  useResolvePolicyDecisionClearance, useSetPolicyEngineOptIn, useStandingPolicies,
  useStandingPolicyEnactment, useStandingPolicyEvaluations, useUpdateStandingPolicy,
  type ObligationRegisterEntry, type PolicyEnactmentReason, type PolicyEnactmentRoute,
  type PolicyRegisterEntry, type StandingPolicy, type StandingPolicyInput, type StandingPolicyTargetKind,
} from "@/api/policy-api";

type Tab = "decisions" | "policies";

const TONE: Record<string, { strong: string; text: string; tint: string; border: string }> = {
  green: signal.ok, amber: signal.warning, red: signal.critical, blue: signal.info,
  violet: { strong: signal.notice.strong, text: "#ddd6fe", tint: signal.notice.tint, border: signal.notice.border },
  slate: { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border },
};

const TARGET_KIND_TONE: Record<StandingPolicyTargetKind, keyof typeof TONE> = {
  mailbox_attribute: "blue", group_membership: "green", service_policy: "slate",
};
const TARGET_KIND_LABEL: Record<StandingPolicyTargetKind, string> = {
  mailbox_attribute: "mailbox_attribute", group_membership: "group_membership", service_policy: "service_policy",
};
const ROUTE_TONE: Record<PolicyEnactmentRoute, keyof typeof TONE> = {
  engine_enacts: "green", checklist_item: "amber", not_evaluated: "slate",
};
const REASON_LABEL: Record<PolicyEnactmentReason, string> = {
  policy_inactive: "policy is not active",
  tenant_not_opted_in: "tenant has not opted into the Policy Engine",
  write_consent_granted: "write-back consent is granted",
  write_consent_denied: "write-back consent is denied",
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
    <div style={cardStyle({ padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" })}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: t.tint, border: `1px solid ${t.border}`, padding: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={20} color={t.strong} />
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 460, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}
function primaryBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
    border: `1px solid ${disabled ? border.card : action.base}`, background: disabled ? "transparent" : action.base,
    color: disabled ? text.faint : "#fff", fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}
function ghostBtn(disabled?: boolean): React.CSSProperties {
  return {
    height: 30, padding: "0 12px", borderRadius: 7, border: `1px solid ${border.card}`,
    background: "transparent", color: disabled ? text.faint : text.secondary, fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
  };
}
function labelSpan(): React.CSSProperties { return { fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }; }

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function PolicyEngine() {
  const [tab, setTab] = useState<Tab>("decisions");
  const [customerId, setCustomerId] = useState<number | null>(null);

  const directory = useDirectory();
  const customers = useMemo(() => directory.data?.customers ?? [], [directory.data]);
  const customer = customers.find((c) => c.id === customerId) ?? null;

  const decisionsQuery = usePolicyDecisions(customerId);
  const decisions = decisionsQuery.data?.decisions ?? [];
  const policiesQuery = useStandingPolicies();
  const policies = policiesQuery.data?.policies ?? [];

  const tabDefs: { id: Tab; label: string; count: string }[] = [
    { id: "decisions", label: "Policy decisions", count: customerId != null ? String(decisions.length) : "" },
    { id: "policies", label: "Standing policies", count: String(policies.length) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {tabDefs.map((t) => {
            const activeTab = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
                  border: `1px solid ${activeTab ? "rgba(96,165,250,.45)" : border.card}`,
                  background: activeTab ? "rgba(37,99,235,.18)" : "transparent",
                  color: activeTab ? "#f1f5f9" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {t.label}
                {t.count && <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: activeTab ? signal.info.strong : text.faint }}>{t.count}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap" }}>Customer</span>
          <select
            value={customerId ?? ""}
            onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}
            style={{
              height: 30, padding: "0 9px", borderRadius: 7, border: `1px solid ${border.card}`,
              background: "rgba(2,6,23,.5)", color: text.body, fontSize: 12, outline: "none", minWidth: 180,
            }}
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {tab === "decisions" && (
        <DecisionsTab
          customerId={customerId}
          decisions={decisions}
          loading={decisionsQuery.isLoading}
          error={decisionsQuery.isError}
        />
      )}

      {tab === "policies" && (
        <PoliciesTab
          policies={policies}
          loading={policiesQuery.isLoading}
          error={policiesQuery.isError}
          customer={customer}
          customers={customers}
        />
      )}

      {customer && <PolicyEngineOptInCard customer={customer} />}
    </div>
  );
}

// ── Policy Decisions tab ──────────────────────────────────────────────────────

function DecisionsTab({
  customerId, decisions, loading, error,
}: { customerId: number | null; decisions: PolicyRegisterEntry[]; loading: boolean; error: boolean }) {
  const [resolving, setResolving] = useState<PolicyRegisterEntry | null>(null);
  const obligations = useObligationRegister();
  const [showRegister, setShowRegister] = useState(false);

  if (customerId == null) {
    return emptyState(
      "shield-alert", "blue", "Pick a customer to see their policy decisions",
      "policy_decisions is scoped per customer (GET /api/msp/policy-decisions/:customerId) — select one from the dropdown above.",
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.info.border}`, background: signal.info.tint }}>
        <Icon name="info" size={15} color={signal.info.strong} style={{ flex: "0 0 15px", marginTop: 2 }} />
        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
          There is no MSP-side create route for a policy decision, by design (Git #3035, settled). A row is a signed decision from the moment it exists — <code style={{ fontFamily: "Menlo, monospace" }}>signedBy</code> is the customer's own typed confirmation from their own portal. The one action available here is the manual dependency-clearance resolve below.
        </span>
      </div>

      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading policy decisions…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load policy decisions for this customer.</span> :
       decisions.length === 0 ? emptyState(
          "inbox", "slate", "No policy decisions on this customer",
          "policy_decisions holds zero rows live for every real customer today. Decisions are created and signed by the customer through their own portal.",
        ) :
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {decisions.map((d) => <DecisionCard key={d.id} decision={d} onResolve={() => setResolving(d)} />)}
        </div>}

      <button onClick={() => setShowRegister((v) => !v)} style={{ ...ghostBtn(), alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7 }}>
        <Icon name="book-open" size={12} />
        {showRegister ? "Hide" : "Show"} the obligation register
      </button>
      {showRegister && (
        <ObligationRegisterPanel entries={obligations.data ?? []} loading={obligations.isLoading} error={obligations.isError} />
      )}

      {resolving && customerId != null && (
        <ResolveClearanceDrawer decision={resolving} customerId={customerId} onClose={() => setResolving(null)} />
      )}
    </div>
  );
}

function DecisionCard({ decision: d, onResolve }: { decision: PolicyRegisterEntry; onResolve: () => void }) {
  const dependency = d.clearanceCondition !== null;
  const manual = d.clearanceTriggerType === "manual";
  const canResolve = dependency && manual && !d.isCleared;

  let clockLabel = `Review ${d.reviewCadence ?? ""}`;
  let clockTone: keyof typeof TONE = "blue";
  if (dependency) { clockLabel = d.isCleared ? "Cleared" : "Dependency"; clockTone = d.isCleared ? "green" : "amber"; }
  const ct = TONE[clockTone];

  let note = "Review-cadence row. No clearance condition, so the resolve route 409s.";
  if (dependency && d.isCleared) note = `Resolved ${fmtDate(d.clearanceResolvedAt)} — actionable immediately, no scheduled review to wait for.`;
  else if (dependency && manual) note = `Manual trigger: ${d.clearanceCondition}`;
  else if (dependency) note = `${d.clearanceTriggerType} trigger${d.clearanceTriggerSkuPartNumber ? `, watching ${d.clearanceTriggerSkuPartNumber}` : ""}. Only the platform clears this one.`;

  const facts: { label: string; value: string; color: string }[] = [
    { label: "OWNER", value: d.owner, color: text.strong },
    { label: "SIGNED", value: `${d.signedBy} · ${fmtDate(d.signedAt)}`, color: text.strong },
    { label: "REVIEW DUE", value: d.reviewDueAt ?? "— dependency-based", color: d.reviewDueAt ? text.strong : text.muted },
    { label: "REVIEW STATE", value: d.reviewState ?? "— null for a dependency row", color: d.reviewState ? signal.ok.text : text.muted },
  ];

  return (
    <div style={cardStyle({ padding: 15, display: "flex", flexDirection: "column", gap: 12, borderColor: canResolve ? signal.warning.border : border.card })}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200, flex: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: text.strong, textWrap: "pretty" }}>{d.title}</span>
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>{d.obligation}{d.obligationType ? ` · ${d.obligationType}` : ""}</span>
        </div>
        <span style={pill(ct)}>{clockLabel}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        {facts.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={labelSpan()}>{f.label}</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: f.color, textWrap: "pretty" }}>{f.value}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: `1px solid ${border.soft}`, paddingTop: 11 }}>
        <span style={{ fontSize: 11.5, color: text.muted, flex: 1, minWidth: 180, textWrap: "pretty" }}>{note}</span>
        <button onClick={onResolve} disabled={!canResolve} style={canResolve ? primaryBtn() : { ...ghostBtn(true) }}>
          {d.isCleared ? "Resolved" : "Resolve clearance"}
        </button>
      </div>
    </div>
  );
}

function ResolveClearanceDrawer({
  decision, customerId, onClose,
}: { decision: PolicyRegisterEntry; customerId: number; onClose: () => void }) {
  const [note, setNote] = useState("");
  const resolve = useResolvePolicyDecisionClearance(customerId);

  return (
    <Overlay onClose={onClose} width={440}>
      <DrawerHeader eyebrow="RESOLVE CLEARANCE" eyebrowColor={signal.warning.text} title={decision.title} onClose={onClose} />
      <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>
        Records that the dependency actually resolved: <em>{decision.clearanceCondition}</em>. This calls
        {" "}<code style={{ fontFamily: "Menlo, monospace", fontSize: 11 }}>PATCH /api/msp/policy-decisions/{customerId}/{decision.id}/clearance/resolve</code>, guarded at the DB by a race check — a concurrent second resolve loses the race.
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: text.faint }}>NOTE — HOW THIS WAS CONFIRMED</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          style={{ padding: 10, borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none", resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <button
          onClick={() => resolve.mutate({ id: decision.id, note }, {
            onSuccess: () => { toast.success("Clearance resolved"); onClose(); },
            onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to resolve clearance"),
          })}
          disabled={resolve.isPending || note.trim().length === 0}
          style={{ ...primaryBtn(resolve.isPending || note.trim().length === 0), flex: 1, height: 36 }}
        >
          {resolve.isPending ? "Resolving…" : "Resolve"}
        </button>
        <button onClick={onClose} style={{ ...ghostBtn(), height: 36 }}>Cancel</button>
      </div>
    </Overlay>
  );
}

function ObligationRegisterPanel({
  entries, loading, error,
}: { entries: ObligationRegisterEntry[]; loading: boolean; error: boolean }) {
  return (
    <div style={cardStyle({ padding: 14, display: "flex", flexDirection: "column", gap: 9 })}>
      <span style={labelSpan()}>OBLIGATION REGISTER — GET /api/msp/rbd/available-obligations</span>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
        The full cited-authority catalog (Git #1525): platform-seeded regimes (GDPR, ISO 27001…) plus any authority this MSP has authored for one of its own tenants — one catalog, both kinds tagged below.
      </span>
      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the obligation register.</span> :
       entries.length === 0 ? <span style={{ fontSize: 11.5, color: text.faint }}>No obligations in the register yet.</span> :
       <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
         {entries.map((o) => (
           <div key={o.obligationId} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 11px", borderRadius: 8, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.35)" }}>
             <span style={pill(TONE[o.tenantId === null ? "blue" : "violet"])}>{o.tenantId === null ? "platform" : "MSP-authored"}</span>
             <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
               <span style={{ fontSize: 12, fontWeight: 600, color: text.strong }}>{o.citation} · {o.frameworkName}</span>
               <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{o.requires}</span>
             </div>
             <span style={{ fontSize: 10.5, color: text.faint, whiteSpace: "nowrap" }}>{o.authorityType}</span>
           </div>
         ))}
       </div>}
    </div>
  );
}

// ── Standing policies tab ─────────────────────────────────────────────────────

function PoliciesTab({
  policies, loading, error, customer, customers,
}: { policies: StandingPolicy[]; loading: boolean; error: boolean; customer: DirectoryCustomer | null; customers: DirectoryCustomer[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [authoring, setAuthoring] = useState(false);
  const selected = policies.find((p) => p.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setAuthoring(true)} style={primaryBtn()}>
          <Icon name="plus" size={12} />
          Author a standing policy
        </button>
      </div>

      {loading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading standing policies…</span> :
       error ? <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load standing policies.</span> :
       policies.length === 0 ? emptyState(
          "shield-check", "blue", "No standing policies on this MSP",
          "standing_policies and policy_evaluation_runs both hold zero rows live. The author route is real and mounted — the first row comes from this screen.",
        ) :
        <div style={{ ...cardStyle(), overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1.4fr 1fr 1fr 0.8fr", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>POLICY</span><span>TARGET KIND</span><span>OU</span><span>ENACTMENT</span><span style={{ textAlign: "right" }}>STATE</span>
            </div>
            {policies.map((p) => {
              const kt = TONE[TARGET_KIND_TONE[p.targetKind]];
              const active = p.id === selectedId;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    display: "grid", gridTemplateColumns: "2.2fr 1.4fr 1fr 1fr 0.8fr", gap: 12, alignItems: "center",
                    padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, cursor: "pointer",
                    background: active ? "rgba(96,165,250,.07)" : "transparent",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{p.title}</span>
                    <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      id {p.id} · {p.sopId ?? "no SOP named"}{p.catalogItemId ? ` · catalog ${p.catalogItemId}` : ""}
                    </span>
                  </span>
                  <span style={{ ...pill(kt), justifySelf: "start" }}>{TARGET_KIND_LABEL[p.targetKind]}</span>
                  <span style={{ fontSize: 12, color: text.muted, whiteSpace: "nowrap" }}>OU {p.ouId}</span>
                  <span style={{ fontSize: 12, color: text.faint, whiteSpace: "nowrap" }}>select to preview</span>
                  <span style={{ justifySelf: "end", fontSize: 11.5, fontWeight: 600, color: p.isActive ? signal.ok.text : text.label, whiteSpace: "nowrap" }}>
                    {p.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>}

      {selected && (
        <StandingPolicyDetail
          policy={selected}
          customer={customer}
          onEdit={() => setAuthoring(true)}
        />
      )}

      {authoring && (
        <StandingPolicyDrawer
          editing={selected && authoring ? selected : null}
          customer={customer}
          customers={customers}
          onClose={() => setAuthoring(false)}
        />
      )}
    </div>
  );
}

function StandingPolicyDetail({
  policy, customer, onEdit,
}: { policy: StandingPolicy; customer: DirectoryCustomer | null; onEdit: () => void }) {
  const update = useUpdateStandingPolicy();
  const evaluate = useEvaluateStandingPolicy(policy.id);
  const enactment = useStandingPolicyEnactment(policy.id, customer?.id ?? null);
  const evaluations = useStandingPolicyEvaluations(policy.id);
  const runs = evaluations.data?.evaluations ?? [];

  return (
    <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 14, borderColor: "rgba(96,165,250,.3)" })}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "block", width: 32, height: 32, flex: "0 0 32px", borderRadius: 9, background: signal.info.tint, border: `1px solid ${signal.info.border}`, color: signal.info.strong, padding: 7 }}>
          <Icon name="shield-check" size={18} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 180, flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: text.title, textWrap: "pretty" }}>{policy.title}</span>
          <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
            OU {policy.ouId} · authored by {policy.createdByName ?? "unknown"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button onClick={onEdit} style={ghostBtn()}>Edit</button>
          <button
            onClick={() => customer && evaluate.mutate(customer.id, {
              onSuccess: (r) => toast(r.notEvaluableReason ? `Not evaluable: ${r.notEvaluableReason}` : `Evaluated — ${r.compliant} compliant, ${r.nonCompliant} divergent`),
              onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to evaluate"),
            })}
            disabled={!customer || evaluate.isPending}
            title={!customer ? "Pick a customer above to evaluate against" : ""}
            style={ghostBtn(!customer || evaluate.isPending)}
          >
            {evaluate.isPending ? "Evaluating…" : "Evaluate now"}
          </button>
          <button
            onClick={() => update.mutate({ id: policy.id, isActive: !policy.isActive }, {
              onSuccess: () => toast.success(policy.isActive ? "Deactivated" : "Activated"),
              onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update"),
            })}
            disabled={update.isPending}
            style={policy.isActive
              ? { ...ghostBtn(update.isPending), border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text }
              : primaryBtn(update.isPending)}
          >
            {policy.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={labelSpan()}>TARGET STATE — jsonb, served verbatim</span>
        <pre style={{ fontFamily: "Menlo, ui-monospace, monospace", fontSize: 11.5, color: "#cbd5e1", background: "rgba(2,6,23,.5)", border: `1px solid ${border.soft}`, borderRadius: 8, padding: 11, overflowX: "auto", margin: 0 }}>
          {JSON.stringify(policy.targetState, null, 2)}
        </pre>
        <span style={{ fontSize: 11, color: signal.warning.text, textWrap: "pretty" }}>
          No per-targetKind shape validation exists on the backend, on create or edit — this screen enforces the shape itself when authoring.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
        <span style={labelSpan()}>ENACTMENT ROUTE — PREVIEW ONLY, DETECTS NOTHING</span>
        {!customer ? (
          <span style={{ fontSize: 11.5, color: text.faint }}>Pick a customer above to preview the enactment route for them.</span>
        ) : enactment.isLoading ? (
          <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
        ) : enactment.data ? (
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ ...pill(TONE[ROUTE_TONE[enactment.data.route]]), fontFamily: "Menlo, monospace", fontSize: 12, fontWeight: 700 }}>{enactment.data.route}</span>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 11.5, color: text.muted }}>{REASON_LABEL[enactment.data.reason]}</span>
          </div>
        ) : (
          <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to preview enactment.</span>
        )}
      </div>

      {runs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${border.soft}`, paddingTop: 13 }}>
          <span style={labelSpan()}>EVALUATION HISTORY — LAST 200 RUNS</span>
          {runs.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, fontWeight: 700, color: r.outcome === "divergent" ? signal.warning.text : r.outcome === "compliant" ? signal.ok.text : text.muted, minWidth: 120 }}>{r.outcome}</span>
              <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.label }}>{r.triggerKind}</span>
              <span style={{ fontSize: 11.5, color: text.muted, flex: 1, minWidth: 160, textWrap: "pretty" }}>{r.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 9, padding: "10px 12px", borderRadius: 9, border: `1px solid ${signal.info.border}`, background: signal.info.tint }}>
        <Icon name="info" size={14} color={signal.info.strong} style={{ flex: "0 0 14px", marginTop: 2 }} />
        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
          OU membership is not just <code style={{ fontFamily: "Menlo, monospace" }}>ou_id</code>. A manual per-object assignment (set by the MSP via <code style={{ fontFamily: "Menlo, monospace" }}>/api/msp/active-directory/ou/:id/assignments</code>) is read first, and a department-name guess only second. This screen doesn't manage those assignments — that's the dedicated AD OU Assignment screen (per tenant, Access &amp; identity).
        </span>
      </div>
    </div>
  );
}

const MAILBOX_ATTRIBUTE_TEMPLATE = { attribute: "mailboxSizeMb", operator: "max", value: 150 };
const GROUP_MEMBERSHIP_TEMPLATE = { groupIds: [] as string[] };

function defaultTargetStateFor(kind: StandingPolicyTargetKind): Record<string, unknown> {
  if (kind === "mailbox_attribute") return MAILBOX_ATTRIBUTE_TEMPLATE;
  if (kind === "group_membership") return GROUP_MEMBERSHIP_TEMPLATE;
  return {};
}

function validateTargetState(kind: StandingPolicyTargetKind, value: unknown): string | null {
  if (kind === "service_policy") return null; // no evaluator exists yet — nothing to validate against
  if (typeof value !== "object" || value === null) return "Target state must be a JSON object";
  const v = value as Record<string, unknown>;
  if (kind === "mailbox_attribute") {
    if (v.attribute !== "mailboxSizeMb") return 'attribute must be "mailboxSizeMb"';
    if (v.operator !== "max") return 'operator must be "max"';
    if (typeof v.value !== "number" || !Number.isFinite(v.value) || v.value <= 0) return "value must be a positive number";
    return null;
  }
  if (kind === "group_membership") {
    if (!Array.isArray(v.groupIds) || v.groupIds.length === 0 || !v.groupIds.every((id) => typeof id === "string" && id.length > 0)) {
      return "groupIds must be a non-empty array of Entra group object ids";
    }
    return null;
  }
  return null;
}

function StandingPolicyDrawer({
  editing, customer, customers, onClose,
}: { editing: StandingPolicy | null; customer: DirectoryCustomer | null; customers: DirectoryCustomer[]; onClose: () => void }) {
  const [ouCustomerId, setOuCustomerId] = useState<number | null>(customer?.id ?? null);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [targetKind, setTargetKind] = useState<StandingPolicyTargetKind>(editing?.targetKind ?? "mailbox_attribute");
  const [ouId, setOuId] = useState<number | null>(editing?.ouId ?? null);
  const [targetStateText, setTargetStateText] = useState(() => JSON.stringify(editing?.targetState ?? defaultTargetStateFor(targetKind), null, 2));
  const [catalogItemId, setCatalogItemId] = useState<number | null>(editing?.catalogItemId ?? null);
  const [sopId, setSopId] = useState<string | null>(editing?.sopId ?? null);
  const [isActive, setIsActive] = useState(editing?.isActive ?? false);
  const [shapeError, setShapeError] = useState<string | null>(null);

  const ous = useCustomerOus(ouCustomerId);
  const sops = useMspSopsForPicker();
  const catalog = useChangeCatalogForPicker();
  const create = useCreateStandingPolicy();
  const update = useUpdateStandingPolicy();
  const pending = create.isPending || update.isPending;

  function onTargetKindChange(next: StandingPolicyTargetKind) {
    setTargetKind(next);
    setTargetStateText(JSON.stringify(defaultTargetStateFor(next), null, 2));
    setShapeError(null);
  }

  function submit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(targetStateText);
    } catch {
      setShapeError("Target state is not valid JSON");
      return;
    }
    const shapeIssue = validateTargetState(targetKind, parsed);
    if (shapeIssue) { setShapeError(shapeIssue); return; }
    if (ouId == null) { setShapeError("Pick an OU"); return; }
    if (title.trim().length === 0) { setShapeError("Title is required"); return; }
    setShapeError(null);

    const input: StandingPolicyInput = {
      ouId, title: title.trim(), description: description.trim(), targetKind,
      targetState: parsed as Record<string, unknown>, catalogItemId, sopId, isActive,
    };

    if (editing) {
      update.mutate({ id: editing.id, ...input }, {
        onSuccess: () => { toast.success("Standing policy updated"); onClose(); },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update standing policy"),
      });
    } else {
      create.mutate(input, {
        onSuccess: () => { toast.success("Standing policy authored"); onClose(); },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to author standing policy"),
      });
    }
  }

  return (
    <Overlay onClose={onClose} width={480}>
      <DrawerHeader eyebrow={editing ? "EDIT STANDING POLICY (#3034)" : "AUTHOR STANDING POLICY"} eyebrowColor={signal.info.text} title={editing ? editing.title : "New standing policy"} onClose={onClose} />

      <FieldRow label="OU's customer">
        <select
          value={ouCustomerId ?? ""}
          onChange={(e) => { setOuCustomerId(e.target.value ? Number(e.target.value) : null); setOuId(null); }}
          style={selectStyle()}
        >
          <option value="">Pick a customer to list its real OUs…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </FieldRow>

      <FieldRow label="Organizational unit">
        <select value={ouId ?? ""} onChange={(e) => setOuId(e.target.value ? Number(e.target.value) : null)} disabled={ouCustomerId == null} style={selectStyle()}>
          <option value="">{ouCustomerId == null ? "Pick a customer first" : ous.isLoading ? "Loading…" : "Select an OU…"}</option>
          {(ous.data?.ous ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {editing && <span style={{ fontSize: 10.5, color: text.faint }}>Currently OU {editing.ouId} — re-pick above to move it.</span>}
      </FieldRow>

      <FieldRow label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle()} />
      </FieldRow>

      <FieldRow label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle(), resize: "vertical" }} />
      </FieldRow>

      <FieldRow label="Target kind">
        <select value={targetKind} onChange={(e) => onTargetKindChange(e.target.value as StandingPolicyTargetKind)} style={selectStyle()}>
          <option value="mailbox_attribute">mailbox_attribute</option>
          <option value="group_membership">group_membership</option>
          <option value="service_policy">service_policy (no evaluator wired yet)</option>
        </select>
      </FieldRow>

      <FieldRow label="Target state (jsonb)">
        <textarea value={targetStateText} onChange={(e) => setTargetStateText(e.target.value)} rows={5}
          style={{ ...inputStyle(), fontFamily: "Menlo, ui-monospace, monospace", fontSize: 11.5, resize: "vertical" }} />
      </FieldRow>

      <FieldRow label="SOP (optional — names the procedure that enacts this)">
        <select value={sopId ?? ""} onChange={(e) => setSopId(e.target.value || null)} style={selectStyle()}>
          <option value="">No SOP named</option>
          {(sops.data ?? []).map((s) => <option key={s.sopId} value={s.sopId}>{s.title}</option>)}
        </select>
      </FieldRow>

      <FieldRow label="Catalog item (optional — #1550's binding)">
        <select value={catalogItemId ?? ""} onChange={(e) => setCatalogItemId(e.target.value ? Number(e.target.value) : null)} style={selectStyle()}>
          <option value="">No catalog item bound</option>
          {(catalog.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.title} ({i.status})</option>)}
        </select>
      </FieldRow>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: text.secondary, cursor: "pointer" }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active — default is off. Activating fires <code style={{ fontFamily: "Menlo, monospace", fontSize: 10.5 }}>policy.standing_policy.activated</code> for the OU's tenant.
      </label>

      {shapeError && (
        <div style={{ display: "flex", gap: 9, padding: "10px 12px", borderRadius: 9, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint }}>
          <Icon name="triangle-alert" size={14} color={signal.critical.strong} style={{ flex: "0 0 14px", marginTop: 2 }} />
          <span style={{ fontSize: 11.5, color: text.secondary }}>{shapeError}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
        <button onClick={submit} disabled={pending} style={{ ...primaryBtn(pending), flex: 1, height: 36 }}>
          {pending ? "Saving…" : editing ? "Save changes" : "Author policy"}
        </button>
        <button onClick={onClose} style={{ ...ghostBtn(), height: 36 }}>Cancel</button>
      </div>
    </Overlay>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: text.secondary }}>{label}</span>
      {children}
    </div>
  );
}
function inputStyle(): React.CSSProperties {
  return { padding: "8px 10px", borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none" };
}
function selectStyle(): React.CSSProperties {
  return { height: 34, padding: "0 9px", borderRadius: 7, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none" };
}

// ── Policy Engine opt-in ──────────────────────────────────────────────────────

function PolicyEngineOptInCard({ customer }: { customer: DirectoryCustomer }) {
  const optIn = usePolicyEngineOptIn(customer.id);
  const setOptIn = useSetPolicyEngineOptIn(customer.id);
  const on = optIn.data?.policyEngineOptIn ?? false;

  return (
    <div style={cardStyle({ padding: 15, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>Policy Engine opt-in — {customer.name}</span>
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
          Gates the continuous loop and the enactment route. The on-demand Evaluate button above does not check it — a one-off Graph read runs even for a tenant that never opted in.
        </span>
      </div>
      {optIn.isLoading ? <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span> : (
        <button
          onClick={() => setOptIn.mutate(!on, {
            onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update opt-in"),
          })}
          disabled={setOptIn.isPending}
          style={{
            height: 30, padding: "0 13px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: setOptIn.isPending ? "wait" : "pointer",
            border: `1px solid ${on ? signal.ok.border : border.card}`, background: on ? signal.ok.tint : "rgba(148,163,184,.08)",
            color: on ? signal.ok.text : text.muted,
          }}
        >
          {on ? "Opted in" : "Opted out"}
        </button>
      )}
    </div>
  );
}

// ── Shared drawer chrome (matches Sales.tsx's own) ────────────────────────────

function Overlay({ children, onClose, width = 420 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,.6)" }} />
      <div style={{
        position: "relative", width, maxWidth: "100%", height: "100%", background: surface.popover,
        borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
      }}>
        {children}
      </div>
    </div>
  );
}
function DrawerHeader({
  eyebrow, eyebrowColor, title, subtitle, onClose,
}: { eyebrow: string; eyebrowColor: string; title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: eyebrowColor }}>{eyebrow}</span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title, textWrap: "pretty" }}>{title}</span>
        {subtitle && <span style={{ fontSize: 11.5, color: text.muted }}>{subtitle}</span>}
      </div>
      <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

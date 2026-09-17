/**
 * Launch Control — MSP Console module page (Git #2615, Feature #2494).
 * Mounts into the shell's `ScreenSlot` at `/tenants/:id/lc`
 * (`Design/MSP_Console/design_handoff_msp_console/Launch Control.dc.html`,
 * README screen 19). Two tabs:
 *
 *   Actions           — every write_action_catalog row, grouped by domain,
 *                       with the four-state availability, the live licence
 *                       line, and a confirmation drawer whose pre-flight
 *                       checks block the Run button on any red row.
 *   What has been run — the tenant's real baseline_action_template_audit_log
 *                       rows, whatever surface fired them, with Undo wired to
 *                       the rollback route where a paired reverse step exists.
 *
 * Embedded contract: the shell renders the page header, so this module has
 * none, and the design's review-only toggles (tenant/tier/licence simulators)
 * are not ported — the session and the live routes decide every state.
 *
 * The design was drawn when no catalog action had a procedure attached; the
 * live catalog now has most of them execution_ready. Every readiness line and
 * gate here reads the row's real status rather than the design's blanket
 * "Not runnable yet", and the honest note at the foot is computed from the
 * same response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { action as actionTone, text } from "@/console/tokens";
import {
  useExecuteLaunchControlAction,
  useLaunchControlActions,
  useLaunchControlHistory,
  useRollbackLaunchControlExecution,
  type LaunchControlAction,
  type LaunchControlActionsResponse,
  type LaunchControlAvailability,
  type LaunchControlError,
  type LaunchControlHistoryRow,
} from "@/api/launch-control-api";
import {
  useCaPolicies,
  useCaPolicyImpact,
  usePromoteCaPolicy,
  type CaPolicy,
  type CaPolicyImpact,
  type CaPromotionError,
  type CaPromotionRow,
} from "@/api/ca-promotion-api";

// #4522 — "promotion": report-only Conditional Access policies, their real sign-in
// impact, and the gated promote-to-enforced step (Shane's #4518 decision).
type Tab = "actions" | "history" | "promotion";
type Filter = "all" | LaunchControlAvailability;
type ToneKey = "green" | "amber" | "red" | "blue" | "violet" | "slate";

// The design's own tone() table, verbatim.
const TONE: Record<ToneKey, { color: string; tint: string; line: string }> = {
  green: { color: "#34d399", tint: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.26)" },
  amber: { color: "#fbbf24", tint: "rgba(251,191,36,.1)", line: "rgba(251,191,36,.26)" },
  red: { color: "#f87171", tint: "rgba(248,113,113,.1)", line: "rgba(248,113,113,.26)" },
  blue: { color: "#60a5fa", tint: "rgba(96,165,250,.1)", line: "rgba(96,165,250,.26)" },
  violet: { color: "#a78bfa", tint: "rgba(167,139,250,.1)", line: "rgba(167,139,250,.26)" },
  slate: { color: "#94a3b8", tint: "rgba(148,163,184,.08)", line: "rgba(148,163,184,.2)" },
};

const AVAIL: Record<LaunchControlAvailability, [ToneKey, string]> = {
  included: ["green", "covered by their plan"],
  billable_upsell: ["amber", "needs an upgrade"],
  license_required: ["violet", "needs a Microsoft licence"],
  a_la_carte: ["slate", "not available"],
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "included", label: "Covered" },
  { id: "billable_upsell", label: "Needs an upgrade" },
  { id: "license_required", label: "Needs a licence" },
  { id: "a_la_carte", label: "Not available" },
];

const ACTIONS_ROUTE = "GET /api/msp/:mspId/launch-control/actions?customerId=";
const HISTORY_ROUTE = "GET /api/msp/:mspId/launch-control/history?customerId=";
const EXECUTE_ROUTE = "POST /api/msp/:mspId/launch-control/execute";
const ROLLBACK_ROUTE = "POST /api/msp/:mspId/launch-control/rollback/:auditLogId";
const CA_POLICIES_ROUTE = "GET /api/msp/:mspId/customers/:customerId/ca-policies";
const CA_IMPACT_ROUTE = "GET /api/msp/:mspId/customers/:customerId/ca-policies/:policyId/impact";
const CA_PROMOTE_ROUTE = "POST /api/msp/:mspId/customers/:customerId/ca-policies/:policyId/promote";

function noSafePath(a: LaunchControlAction): boolean {
  return a.safeOrGated === null || a.status === "blocked_no_workaround";
}

function isRunnable(a: LaunchControlAction): boolean {
  return a.status === "execution_ready" && !!a.templateId;
}

function riskOf(a: LaunchControlAction): [ToneKey, string, IconName] {
  if (noSafePath(a)) return ["slate", "no safe path", "ban"];
  return a.safeOrGated === "gated" ? ["amber", "needs care", "shield-alert"] : ["green", "low risk", "shield-check"];
}

function readiness(a: LaunchControlAction): { label: string; color: string } {
  if (noSafePath(a)) return { label: "There is no supported way to do this", color: text.label };
  if (isRunnable(a)) return { label: "Ready — a procedure is attached to it", color: "#6ee7b7" };
  if (a.templateId) return { label: "Not runnable yet — its procedure is not marked ready", color: text.label };
  return { label: "Not runnable yet — no procedure is attached to it", color: text.label };
}

interface Gate { ok: boolean; title: string; body: string }

function gatesFor(a: LaunchControlAction, data: LaunchControlActionsResponse): Gate[] {
  const av = a.availability;
  const planOk = av === "included" || av === "license_required";
  const lic = a.licenseRequirement;
  const testbed = data.tenant.isTestbed;
  const writeBackOk = data.writeBack.mspEnabled && data.writeBack.consentStatus === "granted";
  const safe = !noSafePath(a);

  const procedure: Gate = isRunnable(a)
    ? { ok: true, title: "A procedure is attached to this action", body: "The catalogue links it to a template that carries it out, and marks it ready to run." }
    : a.templateId
      ? { ok: false, title: "Its procedure is not marked ready to run", body: "A template is linked, but the catalogue has not marked this action ready to execute, so the server refuses it." }
      : { ok: false, title: "No procedure is attached to this action yet", body: "The catalogue knows what the action is, but nothing has been linked to it that could actually carry it out." };

  const licenceReadFailed = !!data.licenseRead.error && !!lic && !lic.satisfied;

  return [
    { ok: true, title: "You are allowed to act on this customer", body: "Your role and this customer being in your book both check out." },
    {
      ok: safe,
      title: safe ? "There is a supported way to do this" : "There is no supported way to do this",
      body: safe ? "Microsoft exposes a proper path for this change." : "Nothing safe exists to call, so the action is listed but cannot run.",
    },
    procedure,
    {
      ok: planOk,
      title: planOk ? "Covered by their plan" : av === "billable_upsell" ? "Their plan does not cover this" : "Not offered on any plan",
      body: planOk
        ? "Checked again at the moment you run it, never taken on trust from this screen."
        : "They would need to be on " + (a.minBundledTier || "a higher") + " monitoring or buy it as an add-on.",
    },
    {
      ok: !lic || lic.satisfied,
      title: !lic ? "No Microsoft licence requirement" : lic.satisfied ? "Their tenant holds the licence this needs" : "Their tenant lacks the licence this needs",
      body: !lic
        ? "This action does not depend on a premium Microsoft SKU."
        : "Read live from the tenant's subscribed SKUs on every listing and again at run time — never a stored flag, never sent from this screen. Any one of " +
          lic.skus.join(" or ") +
          " satisfies it, and it is checked last, after the plan." +
          (licenceReadFailed ? ` This read did not complete (${data.licenseRead.error}), so the licence is treated as missing.` : ""),
    },
    {
      ok: testbed,
      title: testbed ? "This is a test tenant" : "This is a live customer tenant",
      body: testbed
        ? "Writes are allowed here while the feature is being proven out."
        : "Writes are deliberately held back on live tenants for now. That limit is temporary and will be lifted separately.",
    },
    {
      ok: writeBackOk,
      title: writeBackOk ? "Write-back is switched on and consented" : "Write-back consent has not been confirmed",
      body: writeBackOk
        ? "The practice has write-back enabled and the customer has granted it."
        : "Both the practice switch and the customer's own consent have to be in place before anything is written.",
    },
  ];
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sourceLabel(source: string | null): string {
  switch (source) {
    case "launch_control": return "from Launch Control";
    case "launch_control_rollback": return "an undo from Launch Control";
    case "simulator": return "from the simulator";
    case "ca_promotion": return "a Conditional Access promotion";
    case null: return "source not recorded";
    default: return `from ${source}`;
  }
}

function historyDetail(h: LaunchControlHistoryRow): string {
  if (h.errorType === "license_gap") {
    return "Classified as a licence gap, not a permission failure" + (h.licenseFeature ? ` — ${h.licenseFeature}.` : ".");
  }
  if (h.outcome === "executed") return h.status != null ? `Microsoft answered ${h.status}.` : "Went through.";
  return `Failed${h.status != null ? ` with ${h.status}` : ""}${h.errorType ? ` — ${h.errorType.replace(/_/g, " ")}` : ""}.`;
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Pill({ tone, children }: { tone: ToneKey; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 999, background: t.tint, border: `1px solid ${t.line}`, fontSize: 10.5, fontWeight: 600, color: t.color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function ChipButton({ active, label, count, onClick, height = 30 }: { active: boolean; label: string; count: number | null; onClick: () => void; height?: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6, height, padding: "0 11px", borderRadius: 7,
        border: `1px solid ${active ? "rgba(96,165,250,.3)" : "rgba(148,163,184,.18)"}`,
        background: active ? "rgba(37,99,235,.18)" : "transparent",
        color: active ? "#bfdbfe" : text.muted, fontSize: height === 30 ? 12 : 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >
      {label}
      {count !== null && <span style={{ fontSize: 10.5, color: active ? "#60a5fa" : text.faint }}>{count}</span>}
    </button>
  );
}

function ContextChip({ icon, label, color, tone }: { icon: IconName; label: string; color: string; tone: ToneKey }) {
  const t = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 11px", borderRadius: 8, border: `1px solid ${t.line}`, background: t.tint }}>
      <Icon name={icon} size={13} color={t.color} />
      <span style={{ fontSize: 11.5, color, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

function Advisory({ error, route }: { error: LaunchControlError; route: string }) {
  const scope = error.status === 403;
  return (
    <div style={{ border: "1px solid rgba(251,191,36,.26)", borderRadius: 12, background: "rgba(251,191,36,.06)", padding: "14px 15px", display: "flex", gap: 11, alignItems: "flex-start" }}>
      <Icon name="circle-alert" size={16} color="#fbbf24" style={{ marginTop: 2, flex: "0 0 16px" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#fcd34d" }}>
          {scope ? "This customer is outside your scope" : "Launch Control could not be loaded"}
        </span>
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
          {scope
            ? "The route checks both your MSP and your own per-staff tenant scope before it returns anything."
            : error.message}
        </span>
        <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{route}</span>
      </div>
    </div>
  );
}

// ── Module ──────────────────────────────────────────────────────────────────

export function LaunchControl({ mspId, customerId, customerName }: { mspId: number; customerId: number; customerName: string }) {
  const actionsQuery = useLaunchControlActions(mspId, customerId);
  const historyQuery = useLaunchControlHistory(mspId, customerId);
  const [tab, setTab] = useState<Tab>("actions");
  const [filter, setFilter] = useState<Filter>("all");
  const [selId, setSelId] = useState<number | null>(null);
  // Live Graph reads (policies + sign-in logs) — only fetched once the tab is opened.
  const [promotionOpened, setPromotionOpened] = useState(false);
  const caPoliciesQuery = useCaPolicies(mspId, customerId, promotionOpened);
  const reportOnlyCount = caPoliciesQuery.data ? caPoliciesQuery.data.policies.filter((p) => p.reportOnly).length : null;

  const data = actionsQuery.data;
  const actions = useMemo(() => data?.actions ?? [], [data]);
  const history = historyQuery.data?.history ?? [];

  if (actionsQuery.isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: text.muted, fontSize: 12 }}>
        <Icon name="loader" size={14} className="animate-spin" /> Loading the action catalogue and a live licence read…
      </div>
    );
  }
  if (actionsQuery.isError || !data) {
    return actionsQuery.error ? <Advisory error={actionsQuery.error} route={ACTIONS_ROUTE} /> : null;
  }

  const tier = data.customerTier ? data.customerTier.toLowerCase() : null;
  const tierTone: ToneKey = tier === "premier" ? "violet" : tier === "growth" ? "blue" : "slate";
  const testbed = data.tenant.isTestbed;
  const sel = selId != null ? actions.find((a) => a.id === selId) ?? null : null;

  const readyCount = actions.filter(isRunnable).length;
  const reversibleCount = actions.filter((a) => isRunnable(a) && a.reversible).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        <ChipButton active={tab === "actions"} label="Actions" count={actions.length} onClick={() => setTab("actions")} />
        <ChipButton active={tab === "history"} label="What has been run" count={history.length} onClick={() => setTab("history")} />
        <ChipButton
          active={tab === "promotion"}
          label="Report-only policies"
          count={reportOnlyCount}
          onClick={() => { setPromotionOpened(true); setTab("promotion"); }}
        />
        <div style={{ flex: 1 }} />
        <ContextChip
          icon="layers"
          tone={tierTone}
          color={text.secondary}
          label={`${customerName} · ${tier ? `${tier} monitoring` : "no active monitoring plan"}`}
        />
        {!data.tenant.connected ? (
          <ContextChip icon="lock" tone="amber" color="#fcd34d" label="no tenant connected — nothing can be written" />
        ) : testbed ? (
          <ContextChip icon="flask-conical" tone="green" color="#6ee7b7" label="test tenant — writes allowed" />
        ) : (
          <ContextChip icon="lock" tone="amber" color="#fcd34d" label="live tenant — writes held back" />
        )}
      </div>

      {tab === "actions" && (
        <ActionsTab actions={actions} filter={filter} onFilter={setFilter} licenseReadError={data.licenseRead.error} onOpen={setSelId} />
      )}

      {tab === "history" && (
        <HistoryTab
          mspId={mspId}
          customerId={customerId}
          rows={history}
          loading={historyQuery.isLoading}
          error={historyQuery.error}
          testbed={testbed}
        />
      )}

      {tab === "promotion" && (
        <PromotionTab mspId={mspId} customerId={customerId} customerName={customerName} query={caPoliciesQuery} />
      )}

      {sel && (
        <ConfirmDrawer
          key={sel.id}
          mspId={mspId}
          customerId={customerId}
          customerName={customerName}
          action={sel}
          data={data}
          onClose={() => setSelId(null)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} style={{ flex: "0 0 13px" }} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          The action list, the plan check, the live licence check and the audit trail are all live. {readyCount} of {actions.length} actions have a procedure attached and marked ready to run, and {reversibleCount} of those can be undone. Writes are limited to a test tenant for now. Conditional Access actions are additionally refused as a licence gap when the tenant holds no Entra ID P1 or P2. Turning a report-only Conditional Access policy on is not a single action: it goes through Report-only policies, after its sign-in impact has been reviewed.
        </span>
      </div>
    </div>
  );
}

function ActionsTab({
  actions,
  filter,
  onFilter,
  licenseReadError,
  onOpen,
}: {
  actions: LaunchControlAction[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  licenseReadError: string | null;
  onOpen: (id: number) => void;
}) {
  const match = (f: Filter) => (a: LaunchControlAction) => f === "all" || a.availability === f;
  const visible = actions.filter(match(filter));
  const domainNames: string[] = [];
  for (const a of visible) if (!domainNames.includes(a.domain)) domainNames.push(a.domain);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <ChipButton key={f.id} height={28} active={filter === f.id} label={f.label} count={actions.filter(match(f.id)).length} onClick={() => onFilter(f.id)} />
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: text.label, whiteSpace: "nowrap" }}>{visible.length} of {actions.length} actions</span>
      </div>

      {actions.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "34px 20px", border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, background: "rgba(15,23,42,.6)" }}>
          <span style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="rocket" size={20} color="#60a5fa" />
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>No actions available</span>
          <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{ACTIONS_ROUTE}</span>
        </div>
      )}

      {domainNames.map((name) => (
        <div key={name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>{name.toUpperCase()}</span>
            {name === "Conditional Access" && (
              <span style={{ fontSize: 11.5, color: text.faint }}>Licence checked live against the tenant</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 10 }}>
            {visible.filter((a) => a.domain === name).map((a) => (
              <ActionCard key={a.id} action={a} licenseReadError={licenseReadError} onOpen={() => onOpen(a.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionCard({ action: a, licenseReadError, onOpen }: { action: LaunchControlAction; licenseReadError: string | null; onOpen: () => void }) {
  const [risk, riskLabel, riskIcon] = riskOf(a);
  const rt = TONE[risk];
  const [availTone, availLabel] = AVAIL[a.availability];
  const ready = readiness(a);
  const lic = a.licenseRequirement;
  const idle = noSafePath(a) ? "rgba(148,163,184,.14)" : "rgba(148,163,184,.16)";
  const licNote = lic
    ? lic.description + (lic.satisfied ? " — found in their tenant" : licenseReadError ? " — their tenant could not be read" : " — not found in their tenant")
    : "";

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`lc-action-${a.id}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(96,165,250,.4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = idle; }}
      style={{ border: `1px solid ${idle}`, borderRadius: 11, background: "rgba(15,23,42,.6)", padding: 13, display: "flex", flexDirection: "column", gap: 9, minWidth: 0, cursor: "pointer", transition: "border-color .15s" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: 8, background: rt.tint, border: `1px solid ${rt.line}`, color: rt.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={riskIcon} size={14} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{a.actionName}</span>
          <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{a.surface}</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Pill tone={availTone}>{availLabel}</Pill>
        <Pill tone={risk}>{riskLabel}</Pill>
        {a.minBundledTier && <Pill tone="slate">{a.minBundledTier.toLowerCase()} and up</Pill>}
      </div>
      {lic && (
        <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
          <Icon name="badge-check" size={13} color={lic.satisfied ? "#6ee7b7" : "#c4b5fd"} style={{ flex: "0 0 13px", marginTop: 1 }} />
          <span style={{ fontSize: 11, color: lic.satisfied ? "#6ee7b7" : "#c4b5fd", textWrap: "pretty" }}>{licNote}</span>
        </div>
      )}
      <span style={{ fontSize: 11.5, color: ready.color, textWrap: "pretty" }}>{ready.label}</span>
    </div>
  );
}

// ── Confirmation drawer ─────────────────────────────────────────────────────

type RunOutcome =
  | { kind: "ok"; message: string }
  | { kind: "fail"; message: string }
  | { kind: "license"; message: string };

function ConfirmDrawer({
  mspId,
  customerId,
  customerName,
  action: a,
  data,
  onClose,
}: {
  mspId: number;
  customerId: number;
  customerName: string;
  action: LaunchControlAction;
  data: LaunchControlActionsResponse;
  onClose: () => void;
}) {
  const execute = useExecuteLaunchControlAction(mspId, customerId);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const [risk, riskLabel] = riskOf(a);
  const [availTone, availLabel] = AVAIL[a.availability];
  const lic = a.licenseRequirement;
  const gates = gatesFor(a, data);
  const firstRed = gates.find((g) => !g.ok) ?? null;
  const missingVars = a.requiredVariables.filter((v) => !(vars[v] ?? "").trim());
  const canRun = !firstRed && missingVars.length === 0 && !execute.isPending;
  const what = a.templateDescription ?? a.blockedReason ?? "";

  const facts: { label: string; value: string; color: string }[] = [
    { label: "RISK", value: riskLabel, color: TONE[risk].color },
    { label: "AVAILABILITY", value: availLabel, color: TONE[availTone].color },
    { label: "PLAN NEEDED", value: a.minBundledTier ? `${a.minBundledTier.toLowerCase()} and up` : "no plan requirement", color: text.secondary },
    {
      label: "MICROSOFT LICENCE",
      value: lic ? `${lic.description.replace(/^Requires /, "")} — ${lic.satisfied ? "present" : "missing"}` : "none required",
      color: lic ? (lic.satisfied ? "#6ee7b7" : "#c4b5fd") : text.secondary,
    },
    { label: "CAN IT BE UNDONE", value: a.reversible ? "designed to be reversible" : "one way only", color: a.reversible ? "#6ee7b7" : "#fcd34d" },
  ];

  const runNote = noSafePath(a)
    ? "This one will never be runnable — it is here so the gap is visible rather than hidden."
    : firstRed && !isRunnable(a)
      ? "Held back because no procedure is attached to this action yet. Everything else on the list above is checked again at the moment you run it."
      : firstRed
        ? `Held back: ${firstRed.title.charAt(0).toLowerCase()}${firstRed.title.slice(1)}. Everything on the list above is checked again at the moment you run it.`
        : missingVars.length > 0
          ? `Fill in ${missingVars.join(", ")} first. Everything on the list above is checked again on the server at the moment you run it.`
          : "Everything on the list above is checked again on the server at the moment you run it, and a pre-approved change request is raised before anything is written.";

  const run = () => {
    if (!canRun) return;
    setOutcome(null);
    execute.mutate(
      { catalogActionId: a.id, variables: vars },
      {
        onSuccess: (res) => {
          const r = res.result;
          if (r.success) {
            const message = `Went through — ${r.method} ${r.endpoint}. Recorded as ${res.changeRequest.code}.`;
            setOutcome({ kind: "ok", message });
            toast.success(`${a.actionName} went through against ${customerName}`);
          } else {
            const missing = r.missingVariables?.length ? ` Missing: ${r.missingVariables.join(", ")}.` : "";
            const message = `Did not go through — ${r.method} ${r.endpoint} answered ${r.status}${r.errorType ? ` (${r.errorType.replace(/_/g, " ")})` : ""}. Recorded as ${res.changeRequest.code}.${missing}`;
            setOutcome({ kind: "fail", message });
            toast.error(`${a.actionName} did not go through`);
          }
        },
        onError: (err) => {
          setOutcome({ kind: err.errorType === "license_gap" ? "license" : "fail", message: err.message });
          toast.error(err.message);
        },
      },
    );
  };

  const outcomeTone: ToneKey | null = outcome ? (outcome.kind === "ok" ? "green" : outcome.kind === "license" ? "violet" : "red") : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.68)", backdropFilter: "blur(3px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="lc-confirm-drawer"
        style={{ width: "min(500px,95%)", height: "100%", background: "#0b1728", borderLeft: "1px solid rgba(148,163,184,.2)", padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>{a.domain.toUpperCase()} · {a.surface}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{a.actionName}</span>
            {what && <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{what}</span>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
              <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
            </div>
          ))}
        </div>

        {a.requiredVariables.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT IT NEEDS FROM YOU</span>
            {a.requiredVariables.map((v) => (
              <label key={v} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary, fontFamily: "Menlo, monospace" }}>{v}</span>
                <input
                  value={vars[v] ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
                  placeholder={v}
                  data-testid={`lc-var-${v}`}
                  style={{ height: 34, padding: "0 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none" }}
                />
              </label>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: "1px solid rgba(148,163,184,.18)", background: "rgba(2,6,23,.4)" }}>
            <Icon name="variable" size={15} color={text.muted} style={{ flex: "0 0 15px", marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
              {noSafePath(a) ? "Nothing to fill in — this one cannot be run at all." : "This action takes no input."}
            </span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHAT HAS TO BE TRUE FIRST</span>
          {gates.map((g) => (
            <div
              key={g.title}
              style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 11px", borderRadius: 9, border: `1px solid ${g.ok ? "rgba(52,211,153,.2)" : "rgba(251,191,36,.22)"}`, background: g.ok ? "rgba(52,211,153,.06)" : "rgba(251,191,36,.06)", minWidth: 0 }}
            >
              <Icon name={g.ok ? "circle-check-big" : "circle-alert"} size={14} color={g.ok ? "#34d399" : "#fbbf24"} style={{ flex: "0 0 14px", marginTop: 2 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: g.ok ? text.strong : "#fcd34d", textWrap: "pretty" }}>{g.title}</span>
                <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{g.body}</span>
              </div>
            </div>
          ))}
        </div>

        {outcome && outcomeTone && (
          <div data-testid="lc-run-outcome" style={{ display: "flex", gap: 10, padding: "11px 12px", borderRadius: 9, border: `1px solid ${TONE[outcomeTone].line}`, background: TONE[outcomeTone].tint }}>
            <Icon name={outcome.kind === "ok" ? "circle-check-big" : "circle-x"} size={14} color={TONE[outcomeTone].color} style={{ flex: "0 0 14px", marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty", wordBreak: "break-word" }}>{outcome.message}</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: "1px solid rgba(148,163,184,.12)" }}>
          <span style={{ fontSize: 11.5, color: canRun ? text.muted : "#fcd34d", textWrap: "pretty" }}>{runNote}</span>
          <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{EXECUTE_ROUTE}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={run}
              disabled={!canRun}
              data-testid="lc-run"
              title={firstRed ? firstRed.title : missingVars.length > 0 ? `Fill in ${missingVars.join(", ")}` : undefined}
              style={{
                flex: 1, height: 38, borderRadius: 8,
                border: `1px solid ${canRun ? actionTone.base : "rgba(148,163,184,.2)"}`,
                background: canRun ? actionTone.base : "transparent",
                color: canRun ? "#fff" : text.label,
                fontSize: 13, fontWeight: 600, cursor: canRun ? "pointer" : "not-allowed", opacity: canRun || execute.isPending ? 1 : 0.6,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <Icon name={execute.isPending ? "loader" : canRun ? "play" : "lock"} size={14} className={execute.isPending ? "animate-spin" : undefined} />
              Run this against {customerName}
            </button>
            <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function HistoryTab({
  mspId,
  customerId,
  rows,
  loading,
  error,
  testbed,
}: {
  mspId: number;
  customerId: number;
  rows: LaunchControlHistoryRow[];
  loading: boolean;
  error: LaunchControlError | null;
  testbed: boolean;
}) {
  const rollback = useRollbackLaunchControlExecution(mspId, customerId);
  const [armedId, setArmedId] = useState<number | null>(null);

  if (loading) return <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>;
  if (error) return <Advisory error={error} route={HISTORY_ROUTE} />;

  if (rows.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "34px 20px", border: "1px solid rgba(148,163,184,.16)", borderRadius: 12, background: "rgba(15,23,42,.6)" }}>
        <span style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="history" size={20} color="#60a5fa" />
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>No executions recorded</span>
        <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>baseline_action_template_audit_log</span>
      </div>
    );
  }

  const onlySimulator = rows.every((h) => h.source !== "launch_control" && h.source !== "launch_control_rollback");

  const undo = (h: LaunchControlHistoryRow) => {
    if (armedId !== h.id) { setArmedId(h.id); return; }
    setArmedId(null);
    rollback.mutate(h.id, {
      onSuccess: (res) => {
        if (res.result.success) toast.success(`Undo went through — ${res.result.method} ${res.result.endpoint}`);
        else toast.error(`Undo did not go through — ${res.result.status}${res.result.errorType ? ` (${res.result.errorType.replace(/_/g, " ")})` : ""}`);
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {rows.map((h) => {
        const ok = h.outcome === "executed";
        const t = TONE[ok ? "green" : "red"];
        const canUndo = ok && h.reversible && testbed;
        const armed = armedId === h.id;
        const pending = rollback.isPending && rollback.variables === h.id;
        const rollbackTitle = !ok
          ? "The change never landed, so there is nothing to undo"
          : !h.reversible
            ? h.source === "launch_control_rollback"
              ? "An undo cannot itself be undone"
              : "This action has no paired reverse step, so there is nothing to run"
            : !testbed
              ? "Writes are held back on live tenants, and an undo is a write"
              : ROLLBACK_ROUTE;
        const rbNote = !ok ? "nothing landed" : !h.reversible ? "no reverse step" : !testbed ? "held back on live tenants" : armed ? "click again to confirm" : "runs the paired reverse step";
        return (
          <div
            key={h.id}
            data-testid={`lc-history-${h.id}`}
            style={{ border: `1px solid ${ok ? "rgba(148,163,184,.16)" : "rgba(248,113,113,.2)"}`, borderRadius: 12, background: "rgba(15,23,42,.6)", padding: "14px 15px", display: "flex", gap: 13, alignItems: "flex-start", minWidth: 0 }}
          >
            <span style={{ width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: t.tint, border: `1px solid ${t.line}`, color: t.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={ok ? "circle-check-big" : "circle-x"} size={16} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{h.actionName ?? h.templateLabel ?? h.templateId ?? `Execution ${h.id}`}</span>
                <Pill tone={ok ? "green" : "red"}>{ok ? "went through" : "failed"}</Pill>
                <Pill tone="slate">{sourceLabel(h.source)}</Pill>
              </div>
              {h.endpoint && (
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: "#93c5fd", wordBreak: "break-all" }}>{h.method ? `${h.method} ` : ""}{h.endpoint}</span>
              )}
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{historyDetail(h)}</span>
              <span style={{ fontSize: 11, color: text.faint }}>{formatWhen(h.createdAt)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 0 auto", alignItems: "flex-end" }}>
              <button
                onClick={() => canUndo && !rollback.isPending && undo(h)}
                disabled={!canUndo || rollback.isPending}
                title={rollbackTitle}
                data-testid={`lc-undo-${h.id}`}
                style={{
                  height: 30, padding: "0 11px", borderRadius: 7, whiteSpace: "nowrap", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${canUndo ? (armed ? "rgba(251,191,36,.4)" : "rgba(96,165,250,.3)") : "rgba(148,163,184,.2)"}`,
                  background: canUndo ? (armed ? "rgba(251,191,36,.1)" : "rgba(37,99,235,.18)") : "transparent",
                  color: canUndo ? (armed ? "#fcd34d" : "#bfdbfe") : text.label,
                  cursor: canUndo && !rollback.isPending ? "pointer" : "not-allowed", opacity: canUndo ? 1 : 0.6,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {pending && <Icon name="loader" size={12} className="animate-spin" />}
                {armed ? "Confirm undo" : "Undo"}
              </button>
              <span style={{ fontSize: 11, color: text.faint, whiteSpace: "nowrap" }}>{rbNote}</span>
            </div>
          </div>
        );
      })}
      {onlySimulator && (
        <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
          Every attempt on record so far came from the internal simulator. Nothing has been run against a customer from this screen.
        </span>
      )}
    </div>
  );
}

// ── Report-only Conditional Access policies (#4522) ─────────────────────────

const CA_STATE_LABEL: Record<string, [ToneKey, string]> = {
  enabledForReportingButNotEnforced: ["amber", "report-only"],
  enabled: ["green", "enforced"],
  disabled: ["slate", "off"],
};

function stateLabel(state: string | null): [ToneKey, string] {
  return (state && CA_STATE_LABEL[state]) || ["slate", state ?? "unknown state"];
}

function daysLabel(days: number | null): string {
  if (days === null) return "no change date recorded";
  return days === 1 ? "1 day" : `${days} days`;
}

function readStatusMessage(status: string, detail: string | null): string {
  switch (status) {
    case "entra_premium_required": return detail ?? "This tenant has no Entra ID P1 or P2, so it has no Conditional Access policies or sign-in logs to read.";
    case "consent_revoked": return "Admin consent for this tenant has been revoked or was never granted, so nothing can be read.";
    case "policy_not_found": return detail ?? "This policy no longer exists on the tenant.";
    default: return detail ?? "Microsoft Graph did not answer this read.";
  }
}

function promotionOutcomeLabel(row: CaPromotionRow): [ToneKey, string] {
  switch (row.outcome) {
    case "succeeded": return ["green", "enforced"];
    case "failed": return ["red", "write failed"];
    case "refused": return ["amber", "refused"];
    default: return ["blue", "in progress"];
  }
}

function PromotionTab({
  mspId,
  customerId,
  customerName,
  query,
}: {
  mspId: number;
  customerId: number;
  customerName: string;
  query: ReturnType<typeof useCaPolicies>;
}) {
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(null);

  if (query.isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: text.muted, fontSize: 12 }}>
        <Icon name="loader" size={14} className="animate-spin" /> Reading this tenant's Conditional Access policies…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return query.error ? <Advisory error={query.error} route={CA_POLICIES_ROUTE} /> : null;
  }

  const data = query.data;
  const reportOnly = data.policies.filter((p) => p.reportOnly);
  const others = data.policies.filter((p) => !p.reportOnly);
  const open = openPolicyId ? data.policies.find((p) => p.id === openPolicyId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="lc-ca-promotion">
      <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: "1px solid rgba(96,165,250,.22)", background: "rgba(37,99,235,.08)" }}>
        <Icon name="shield-check" size={15} color="#60a5fa" style={{ flex: "0 0 15px", marginTop: 2 }} />
        <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
          Conditional Access policies are created report-only first. A report-only policy is evaluated on every sign-in but blocks nobody,
          so its sign-in log shows exactly who it would have blocked or challenged. Review that before turning it on.
        </span>
      </div>

      {data.status !== "ok" && (
        <div data-testid="lc-ca-read-status" style={{ border: "1px solid rgba(251,191,36,.26)", borderRadius: 12, background: "rgba(251,191,36,.06)", padding: "14px 15px", display: "flex", gap: 11 }}>
          <Icon name="circle-alert" size={16} color="#fbbf24" style={{ marginTop: 2, flex: "0 0 16px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#fcd34d" }}>The policies could not be read</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{readStatusMessage(data.status, data.detail)}</span>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{CA_POLICIES_ROUTE}</span>
          </div>
        </div>
      )}

      {data.status === "ok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>IN REPORT-ONLY</span>
          {reportOnly.length === 0 ? (
            <span style={{ fontSize: 12, color: text.muted }}>{customerName} has no report-only Conditional Access policies.</span>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 10 }}>
              {reportOnly.map((p) => (
                <PolicyCard key={p.id} policy={p} onOpen={() => setOpenPolicyId(p.id)} />
              ))}
            </div>
          )}
          {others.length > 0 && (
            <>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label, marginTop: 6 }}>EVERY OTHER POLICY</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {others.map((p) => {
                  const [tone, label] = stateLabel(p.state);
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: text.secondary }}>
                      <Pill tone={tone}>{label}</Pill>
                      <span style={{ textWrap: "pretty" }}>{p.displayName ?? p.id}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {data.promotions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: text.label }}>PROMOTION ATTEMPTS</span>
          {data.promotions.map((row) => {
            const [tone, label] = promotionOutcomeLabel(row);
            const s = row.impactSnapshot?.summary;
            return (
              <div key={row.id} data-testid={`lc-ca-promotion-${row.id}`} style={{ border: "1px solid rgba(148,163,184,.16)", borderRadius: 11, background: "rgba(15,23,42,.6)", padding: "11px 13px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong }}>{row.policyDisplayName ?? row.policyId}</span>
                  <Pill tone={tone}>{label}</Pill>
                  {row.impactAcknowledged && <Pill tone="slate">impact acknowledged</Pill>}
                </div>
                {s && (
                  <span style={{ fontSize: 11.5, color: text.muted }}>
                    Reviewed: {s.wouldBlock ?? 0} would have been blocked, {s.wouldInterrupt ?? 0} interrupted, {s.affectedUserCount ?? 0} users affected, {s.evaluated ?? 0} sign-ins evaluated.
                  </span>
                )}
                {row.outcomeReason && <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{row.outcomeReason}</span>}
                {row.operatorNote && <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>Note: {row.operatorNote}</span>}
                <span style={{ fontSize: 11, color: text.faint }}>
                  {row.actorName ?? "unknown operator"} · {formatWhen(row.createdAt)}
                  {row.changeRequestId ? ` · change request ${row.changeRequestId}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <PromotionDrawer
          key={open.id}
          mspId={mspId}
          customerId={customerId}
          customerName={customerName}
          policy={open}
          onClose={() => setOpenPolicyId(null)}
        />
      )}
    </div>
  );
}

function PolicyCard({ policy: p, onOpen }: { policy: CaPolicy; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`lc-ca-policy-${p.id}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ border: "1px solid rgba(251,191,36,.22)", borderRadius: 11, background: "rgba(15,23,42,.6)", padding: 13, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer" }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{p.displayName ?? p.id}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Pill tone="amber">report-only</Pill>
        <Pill tone="slate">{daysLabel(p.daysInCurrentState)} in this state</Pill>
      </div>
      <span style={{ fontSize: 11.5, color: "#93c5fd" }}>Review its sign-in impact</span>
    </div>
  );
}

function PromotionDrawer({
  mspId,
  customerId,
  customerName,
  policy,
  onClose,
}: {
  mspId: number;
  customerId: number;
  customerName: string;
  policy: CaPolicy;
  onClose: () => void;
}) {
  const impactQuery = useCaPolicyImpact(mspId, customerId, policy.id);
  const promote = usePromoteCaPolicy(mspId, customerId);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  const impact: CaPolicyImpact | undefined = impactQuery.data;
  const summary = impact?.summary ?? null;
  const readiness = impact?.readiness ?? null;
  const verified = impact?.status === "ok" && !!summary && !!readiness && !!impact.fingerprint;
  const needsAck = !!readiness?.requiresAcknowledgement;
  const writesAvailable = !!impact?.promotionWritesAvailable;
  const canPromote = verified && !!readiness?.eligible && writesAvailable && (!needsAck || acknowledged) && !promote.isPending;

  const holdReason = !impact
    ? null
    : impact.status !== "ok"
      ? `Held back: the impact could not be verified. ${readStatusMessage(impact.status, impact.detail)}`
      : readiness && !readiness.eligible
        ? `Held back: ${readiness.ineligibleReason}`
        : !writesAvailable
          ? "Held back: writes are limited to a test tenant for now."
          : needsAck && !acknowledged
            ? "Held back until you acknowledge the impact above."
            : "The server reads the sign-ins again when you confirm and refuses if anything changed since this review. A change request is raised before the policy is turned on.";

  const submit = () => {
    if (!canPromote || !impact?.fingerprint) return;
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    setOutcome(null);
    promote.mutate(
      { policyId: policy.id, reviewedFingerprint: impact.fingerprint, acknowledgeImpact: acknowledged, note },
      {
        onSuccess: (res) => {
          if (res.outcome === "succeeded") {
            setOutcome({ kind: "ok", message: `Turned on. Recorded as ${res.changeRequest.code} (promotion ${res.promotionId}).` });
            toast.success(`${policy.displayName ?? "Policy"} is now enforced on ${customerName}`);
          } else {
            setOutcome({ kind: "fail", message: `Microsoft answered ${res.status}${res.errorType ? ` (${res.errorType.replace(/_/g, " ")})` : ""}. Recorded as ${res.changeRequest.code}.` });
            toast.error("The policy was not turned on");
          }
        },
        onError: (err: CaPromotionError) => {
          if (err.code === "impact_changed") setAcknowledged(false);
          setOutcome({ kind: "fail", message: err.message });
          toast.error(err.message);
        },
      },
    );
  };

  const facts: { label: string; value: string; color: string }[] = summary && impact?.window
    ? [
        { label: "IN REPORT-ONLY", value: daysLabel(impact.window.reportOnlyDays), color: text.secondary },
        { label: "WOULD HAVE BEEN BLOCKED", value: String(summary.wouldBlock), color: summary.wouldBlock > 0 ? "#f87171" : "#6ee7b7" },
        { label: "WOULD HAVE BEEN CHALLENGED", value: String(summary.wouldInterrupt), color: summary.wouldInterrupt > 0 ? "#fbbf24" : "#6ee7b7" },
        { label: "USERS AFFECTED", value: String(summary.affectedUserCount), color: summary.affectedUserCount > 0 ? "#fbbf24" : "#6ee7b7" },
        { label: "ALREADY SATISFIED", value: String(summary.wouldSatisfy), color: text.secondary },
        { label: "SIGN-INS READ", value: `${summary.signInsScanned}${impact.complete ? "" : " (not all)"}`, color: impact.complete ? text.secondary : "#fcd34d" },
      ]
    : [];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.68)", backdropFilter: "blur(3px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="lc-ca-promotion-drawer"
        style={{ width: "min(560px,95%)", height: "100%", background: "#0b1728", borderLeft: "1px solid rgba(148,163,184,.2)", padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#93c5fd" }}>CONDITIONAL ACCESS · REPORT-ONLY</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{policy.displayName ?? policy.id}</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>What this policy would have done to {customerName}'s sign-ins had it been on.</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "1px solid transparent", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {impactQuery.isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: text.muted, fontSize: 12 }}>
            <Icon name="loader" size={14} className="animate-spin" /> Reading this policy's sign-ins from the tenant…
          </div>
        )}
        {impactQuery.error && <Advisory error={impactQuery.error} route={CA_IMPACT_ROUTE} />}

        {impact && impact.status !== "ok" && (
          <div data-testid="lc-ca-impact-unverifiable" style={{ display: "flex", gap: 10, padding: "11px 12px", borderRadius: 9, border: `1px solid ${TONE.red.line}`, background: TONE.red.tint }}>
            <Icon name="circle-x" size={14} color={TONE.red.color} style={{ flex: "0 0 14px", marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{readStatusMessage(impact.status, impact.detail)}</span>
          </div>
        )}

        {facts.length > 0 && (
          <div data-testid="lc-ca-impact-facts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 11 }}>
            {facts.map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: f.color }}>{f.value}</span>
              </div>
            ))}
          </div>
        )}

        {impact?.window && impact.status === "ok" && (
          <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
            Sign-ins from {formatWhen(impact.window.from)} to {formatWhen(impact.window.to)}. {impact.coverageNote}
          </span>
        )}

        {summary && summary.affectedUsers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>WHO IT WOULD AFFECT</span>
            {summary.affectedUsers.map((u) => (
              <div key={u.userId ?? u.userPrincipalName ?? ""} style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ color: text.strong }}>{u.userDisplayName ?? u.userPrincipalName ?? u.userId}</span>
                {u.userPrincipalName && <span style={{ color: text.faint, fontSize: 11 }}>{u.userPrincipalName}</span>}
                <span style={{ color: text.muted, fontSize: 11.5 }}>
                  {u.wouldBlock > 0 ? `${u.wouldBlock} blocked` : ""}{u.wouldBlock > 0 && u.wouldInterrupt > 0 ? ", " : ""}{u.wouldInterrupt > 0 ? `${u.wouldInterrupt} challenged` : ""}
                  {u.lastImpactAt ? ` · last ${formatWhen(u.lastImpactAt)}` : ""}
                </span>
              </div>
            ))}
            {summary.affectedUserCount > summary.affectedUsers.length && (
              <span style={{ fontSize: 11, color: text.faint }}>and {summary.affectedUserCount - summary.affectedUsers.length} more</span>
            )}
          </div>
        )}

        {summary && summary.impactEvents.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>MOST RECENT AFFECTED SIGN-INS</span>
            {summary.impactEvents.map((e, i) => (
              <div key={`${e.createdDateTime}-${i}`} style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap", fontSize: 11.5 }}>
                <Pill tone={e.outcome === "would_block" ? "red" : "amber"}>{e.outcome === "would_block" ? "blocked" : "challenged"}</Pill>
                <span style={{ color: text.secondary }}>{e.userPrincipalName ?? e.userDisplayName ?? "unknown user"}</span>
                <span style={{ color: text.muted }}>{e.appDisplayName ?? "unknown app"}{e.clientAppUsed ? ` · ${e.clientAppUsed}` : ""}</span>
                {e.createdDateTime && <span style={{ color: text.faint, fontSize: 11 }}>{formatWhen(e.createdDateTime)}</span>}
              </div>
            ))}
          </div>
        )}

        {readiness?.eligible && needsAck && (
          <label data-testid="lc-ca-acknowledge" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 12px", borderRadius: 9, border: `1px solid ${TONE.amber.line}`, background: TONE.amber.tint, cursor: "pointer" }}>
            <input type="checkbox" checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked); setArmed(false); }} style={{ marginTop: 3 }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {readiness.acknowledgementReasons.map((r) => (
                <span key={r} style={{ fontSize: 11.5, color: "#fcd34d", textWrap: "pretty" }}>{r}</span>
              ))}
              <span style={{ fontSize: 12, fontWeight: 600, color: text.strong }}>I have reviewed this and want the policy enforced anyway.</span>
            </span>
          </label>
        )}

        {verified && (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>NOTE FOR THE RECORD (OPTIONAL)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              data-testid="lc-ca-note"
              style={{ padding: "8px 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.2)", background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 12.5, outline: "none", resize: "vertical" }}
            />
          </label>
        )}

        {outcome && (
          <div data-testid="lc-ca-promotion-outcome" style={{ display: "flex", gap: 10, padding: "11px 12px", borderRadius: 9, border: `1px solid ${TONE[outcome.kind === "ok" ? "green" : "red"].line}`, background: TONE[outcome.kind === "ok" ? "green" : "red"].tint }}>
            <Icon name={outcome.kind === "ok" ? "circle-check-big" : "circle-x"} size={14} color={TONE[outcome.kind === "ok" ? "green" : "red"].color} style={{ flex: "0 0 14px", marginTop: 2 }} />
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty", wordBreak: "break-word" }}>{outcome.message}</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: "auto", paddingTop: 13, borderTop: "1px solid rgba(148,163,184,.12)" }}>
          {holdReason && <span style={{ fontSize: 11.5, color: canPromote ? text.muted : "#fcd34d", textWrap: "pretty" }}>{holdReason}</span>}
          <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.faint }}>{CA_PROMOTE_ROUTE}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={submit}
              disabled={!canPromote}
              data-testid="lc-ca-promote"
              style={{
                flex: 1, height: 38, borderRadius: 8,
                border: `1px solid ${canPromote ? (armed ? "rgba(251,191,36,.5)" : actionTone.base) : "rgba(148,163,184,.2)"}`,
                background: canPromote ? (armed ? "rgba(251,191,36,.14)" : actionTone.base) : "transparent",
                color: canPromote ? (armed ? "#fcd34d" : "#fff") : text.label,
                fontSize: 13, fontWeight: 600, cursor: canPromote ? "pointer" : "not-allowed", opacity: canPromote || promote.isPending ? 1 : 0.6,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <Icon name={promote.isPending ? "loader" : canPromote ? "shield-check" : "lock"} size={14} className={promote.isPending ? "animate-spin" : undefined} />
              {armed ? `Confirm: turn this policy on for ${customerName}` : "Turn this policy on"}
            </button>
            <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

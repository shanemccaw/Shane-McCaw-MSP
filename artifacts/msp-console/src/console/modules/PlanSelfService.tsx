/**
 * PlanSelfService — MSP-wide (Operations) module page (#3796, Feature #1692:
 * Billing, MSP Console). Mounts at `/ops/plan`
 * (`Design/MSP_Console/design_handoff_msp_console/Plan Self-Service.dc.html`,
 * README screen 49, "Plan & billing" in the Operations tree).
 *
 * Wired against the four real routes in
 * `artifacts/api-server/src/routes/msp-plan-self-service.ts` via
 * `src/api/msp-plan-api.ts` — see that file's header and
 * `docs/msp-console/msp-plan-self-service-contract-pack.md` for the full wire
 * contract. Unlike the design mock (which invented placeholder prices and
 * allowances because the contract pack it was built from didn't capture
 * them), every price, allowance and status on this page is the route's own
 * real response — there is no fixture data anywhere in this file.
 *
 * Load-bearing facts this page is built around, all from the contract pack:
 *
 * - Every write here is a Stripe Subscription Schedule, never an immediate
 *   change. The live tier/interval only flips later, driven by the billing
 *   webhook once Stripe actually advances into the target phase — this page
 *   can only ever *propose* a change via `pendingChange` + a schedule.
 * - `GET /msp/plan/current` returns the JSON literal `null` (200, not 404)
 *   when the MSP has no subscription row — that's the honest empty state,
 *   not an error.
 * - Annual billing 400s for every real tier today (`annual_price_cents` is
 *   unset on Free/Growth/Pro) — an admin data-entry gap in Plan Management,
 *   not a bug this page works around. The Annual toggle and a 400 in the
 *   wire log are both left visible rather than hidden, honestly.
 * - Canceling a pending change clears local state even if the underlying
 *   Stripe schedule release fails — deliberate best-effort on the server,
 *   not something this page can detect or improve on.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { action, border, signal, surface, text } from "@/console/tokens";
import {
  useCancelPendingPlanChange, useChangeMspPlan, useMspAvailableTiers, useMspCurrentPlan,
  MspPlanApiError,
  type AvailableTier, type MspBillingInterval, type MspSubscriptionStatus,
} from "@/api/msp-plan-api";

const STATUS_TONE: Record<MspSubscriptionStatus, { bg: string; line: string; fg: string; label: string }> = {
  active: { bg: "rgba(52,211,153,.1)", line: "rgba(52,211,153,.2)", fg: "#34d399", label: "Active" },
  trialing: { bg: "rgba(96,165,250,.1)", line: "rgba(96,165,250,.2)", fg: "#60a5fa", label: "Trialing" },
  past_due: { bg: "rgba(248,113,113,.1)", line: "rgba(248,113,113,.22)", fg: "#f87171", label: "Past due" },
  canceled: { bg: "rgba(148,163,184,.1)", line: "rgba(148,163,184,.2)", fg: "#94a3b8", label: "Canceled" },
  unpaid: { bg: "rgba(248,113,113,.1)", line: "rgba(248,113,113,.22)", fg: "#f87171", label: "Unpaid" },
};

interface LogEntry { code: number | string; path: string; message: string }

function money(cents: number | null): string {
  if (cents === null) return "—";
  if (cents === 0) return "$0";
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(bg: string, line: string, fg: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999,
    background: bg, border: `1px solid ${line}`, fontSize: 11, fontWeight: 600, color: fg, whiteSpace: "nowrap",
  };
}

export function PlanSelfService() {
  const currentQuery = useMspCurrentPlan();
  const tiersQuery = useMspAvailableTiers();
  const changePlan = useChangeMspPlan();
  const cancelChange = useCancelPendingPlanChange();

  const [targetServiceId, setTargetServiceId] = useState<number | null>(null);
  const [targetInterval, setTargetInterval] = useState<MspBillingInterval>("month");
  const [log, setLog] = useState<LogEntry[]>([]);

  const pushLog = (entry: LogEntry) => setLog((l) => [entry, ...l].slice(0, 4));

  if (currentQuery.isError) {
    const status = currentQuery.error instanceof MspPlanApiError ? currentQuery.error.status : null;
    if (status === 403) {
      return (
        <StatePanel
          icon="shield-alert" tone={signal.critical}
          title="Not available to this session"
          body="Every route behind this screen requires the ladder.msp-admin capability. Your session doesn't carry it, the same gate every MSPAdmin-only route in this console enforces."
          wire="requireCapability(&quot;ladder.msp-admin&quot;) · 403"
        />
      );
    }
    return (
      <StatePanel
        icon="triangle-alert" tone={signal.warning}
        title="Could not load your plan"
        body="The request to load the current subscription failed. Try again shortly."
        wire={`GET /api/msp/plan/current · ${status ?? "error"}`}
      />
    );
  }

  if (currentQuery.isLoading || tiersQuery.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {["70%", "50%"].map((w, i) => (
          <div key={i} style={cardStyle({ height: 90, padding: 15 })}>
            <div style={{ height: 12, width: w, borderRadius: 6, background: "rgba(148,163,184,.14)" }} />
          </div>
        ))}
      </div>
    );
  }

  const current = currentQuery.data ?? null;
  const hasSubscription = current !== null;
  const canSubmit = hasSubscription && (current.status === "active" || current.status === "trialing");
  const tiers = tiersQuery.data ?? [];

  const effectiveTargetId = targetServiceId ?? current?.tier.id ?? tiers[0]?.id ?? null;
  const target = tiers.find((t) => t.id === effectiveTargetId) ?? null;
  const sameAsLive = !!current && !!target && target.id === current.tier.id && targetInterval === current.billingInterval && !current.pendingChange;

  const submit = () => {
    if (!target) return;
    changePlan.mutate(
      { targetServiceId: target.id, targetInterval },
      {
        onSuccess: (result) => pushLog({
          code: 200, path: "POST /api/msp/plan/change",
          message: `Scheduled. ${result.pendingChange.serviceName}, ${result.pendingChange.billingInterval === "month" ? "monthly" : "annual"}, effective ${fmtDate(result.effectiveAt)}.`,
        }),
        onError: (err) => pushLog({
          code: err instanceof MspPlanApiError ? err.status : "error",
          path: "POST /api/msp/plan/change",
          message: err instanceof Error ? err.message : "Failed to schedule plan change",
        }),
      },
    );
  };

  const cancelPending = () => {
    cancelChange.mutate(undefined, {
      onSuccess: () => pushLog({ code: 200, path: "POST /api/msp/plan/cancel-pending-change", message: "Pending columns cleared. Schedule release is best-effort — a release failure is logged, not surfaced." }),
      onError: (err) => pushLog({
        code: err instanceof MspPlanApiError ? err.status : "error",
        path: "POST /api/msp/plan/cancel-pending-change",
        message: err instanceof Error ? err.message : "Failed to cancel the pending change",
      }),
    });
  };

  let subline = "Requires an existing Stripe subscription on this MSP.";
  if (hasSubscription && !canSubmit) subline = "Only active or trialing subscriptions can schedule a change.";
  else if (hasSubscription && sameAsLive) subline = "This is already your live plan and interval.";
  else if (hasSubscription && current) {
    subline = `Effective ${fmtDate(current.currentPeriodEnd)}. No proration. Scheduling only records intent — the live tier flips when Stripe advances the schedule.`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={pill("rgba(251,191,36,.1)", "rgba(251,191,36,.2)", "#fbbf24")}>MSPAdmin or higher</span>
      </div>

      {hasSubscription && current && (
        <>
          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 14 })}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <span style={{ width: 34, height: 34, flex: "0 0 34px", borderRadius: 10, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.2)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="layers" size={16} color="#60a5fa" />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 160, flex: 1 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: text.strong }}>{current.tier.name}</span>
                <span style={{ fontSize: 12, color: text.label }}>services.id {current.tier.id} · platform tier the MSP itself pays for</span>
              </span>
              <span style={pill(STATUS_TONE[current.status].bg, STATUS_TONE[current.status].line, STATUS_TONE[current.status].fg)}>
                {STATUS_TONE[current.status].label}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
              <Fact
                label="BILLING INTERVAL"
                value={current.billingInterval === "month" ? "Monthly" : "Annual"}
                note="Changes apply at cycle start only"
                color={text.strong}
              />
              <Fact
                label="CURRENT PERIOD ENDS"
                value={fmtDate(current.currentPeriodEnd)}
                note="Also the effective date of any change"
                color={text.strong}
              />
              <Fact
                label="TENANTS"
                value={`${current.tenantCountSnapshot}${current.tier.tenantAllowance ? ` of ${current.tier.tenantAllowance}` : " — unlimited"}`}
                note={current.tier.tenantAllowance ? `Hard cap ${current.tier.tenantAllowance * 2}` : "Allowance 0 or unset"}
                color={current.tier.tenantAllowance && current.tenantCountSnapshot > current.tier.tenantAllowance ? signal.warning.text : text.strong}
              />
              <Fact
                label="DUNNING"
                value={current.dunningState === null ? "Fully operational" : current.dunningState.replace(/_/g, " ")}
                note={current.dunningState === null ? "Null means fine, not unknown" : "Read-only here"}
                color={current.dunningState === null ? signal.ok.text : signal.critical.text}
              />
            </div>
          </div>

          {current.pendingChange && (
            <div style={{ border: "1px solid rgba(96,165,250,.35)", borderRadius: 12, background: "rgba(30,58,138,.18)", padding: 15, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
                <span style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, background: "rgba(96,165,250,.12)", border: "1px solid rgba(96,165,250,.24)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="clock" size={14} color="#60a5fa" />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 180, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: text.strong }}>
                    Scheduled: {current.pendingChange.serviceName}, {current.pendingChange.billingInterval === "month" ? "monthly" : "annual"}
                  </span>
                  <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
                    Takes effect {fmtDate(current.pendingChange.effectiveAt)}, at the start of the next billing cycle. No proration is applied. The live tier is only written when Stripe confirms the schedule has advanced into the target phase.
                  </span>
                </span>
                <button
                  onClick={cancelPending}
                  disabled={cancelChange.isPending}
                  style={{ height: 30, padding: "0 12px", borderRadius: 7, border: `1px solid ${border.sidebar}`, background: "transparent", color: text.body, fontSize: 12, fontWeight: 600, cursor: cancelChange.isPending ? "wait" : "pointer", whiteSpace: "nowrap" }}
                >
                  {cancelChange.isPending ? "Canceling…" : "Cancel change"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!hasSubscription && (
        <div style={cardStyle({ padding: "22px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" })}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.16)", color: text.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="credit-card" size={16} color={text.muted} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: text.strong }}>No platform subscription on this MSP</span>
          <span style={{ fontSize: 12, color: text.label, maxWidth: 440, textWrap: "pretty" }}>
            The current-plan read answers with a literal null, not an error. Changing a plan requires an existing Stripe subscription, so the actions below stay disabled until signup creates one.
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>Available tiers</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 9, border: `1px solid ${border.card}`, background: surface.card }}>
            {(["month", "year"] as const).map((iv) => {
              const on = iv === targetInterval;
              return (
                <button
                  key={iv}
                  onClick={() => setTargetInterval(iv)}
                  style={{
                    height: 26, padding: "0 12px", borderRadius: 6,
                    border: `1px solid ${on ? action.base : "transparent"}`,
                    background: on ? action.base : "transparent",
                    color: on ? "#fff" : text.muted, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {iv === "month" ? "Monthly" : "Annual"}
                </button>
              );
            })}
          </div>
        </div>

        {tiersQuery.isError ? (
          <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load the available tiers.</span>
        ) : tiers.length === 0 ? (
          <span style={{ fontSize: 11.5, color: text.muted }}>No public platform tiers were returned.</span>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            {tiers.map((t) => (
              <TierCard
                key={t.id}
                tier={t}
                isCurrent={hasSubscription && !!current && t.id === current.tier.id}
                selected={t.id === effectiveTargetId}
                interval={targetInterval}
                currentAllowance={current?.tier.tenantAllowance ?? null}
                activeTenantCount={current?.tenantCountSnapshot ?? 0}
                onSelect={() => setTargetServiceId(t.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 13 })}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: text.strong }}>
              {target ? `Change to ${target.name} · ${targetInterval === "month" ? "monthly" : "annual"}` : "Pick a tier above"}
            </span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>{subline}</span>
          </span>
          <button
            onClick={submit}
            disabled={!canSubmit || !target || changePlan.isPending}
            title={!hasSubscription ? "Requires an existing Stripe subscription" : !canSubmit ? "Only active or trialing subscriptions can change plan" : ""}
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 15px", borderRadius: 8,
              border: `1px solid ${canSubmit && target ? action.base : border.card}`,
              background: canSubmit && target ? action.base : "rgba(148,163,184,.08)",
              color: canSubmit && target ? "#fff" : text.label,
              fontSize: 12.5, fontWeight: 600, cursor: canSubmit && target ? "pointer" : "not-allowed", whiteSpace: "nowrap",
            }}
          >
            {changePlan.isPending ? "Scheduling…" : current?.pendingChange ? "Reschedule change" : "Schedule change"}
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: `1px solid ${border.faint}`, paddingTop: 12 }}>
            {log.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, flexWrap: "wrap", minWidth: 0 }}>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, fontWeight: 700, color: l.code === 200 ? signal.ok.strong : signal.critical.strong, whiteSpace: "nowrap" }}>{l.code}</span>
                <span style={{ fontFamily: "Menlo, monospace", fontSize: 11, color: text.label, whiteSpace: "nowrap" }}>{l.path}</span>
                <span style={{ fontSize: 11.5, color: text.muted, flex: 1, minWidth: 160, textWrap: "pretty" }}>{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ border: "1px solid rgba(251,191,36,.2)", borderRadius: 12, background: "rgba(251,191,36,.05)", padding: 15, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: "#fbbf24" }}>STATE OF THE BACKEND</span>
        {[
          "Annual billing 400s for all three real tiers: annual_price_cents is unset on Free, Growth and Pro. That's an admin data-entry step in Plan Management, not a code fix — the Annual toggle above stays live so that 400 is honest rather than hidden.",
          "Nothing on this surface writes the live tier. It only ever writes stripe_schedule_id plus the pending_* columns; the billing webhook flips the live columns once Stripe enters the target phase.",
          "Canceling a pending change clears local state even if the Stripe release call fails — deliberate best-effort on the server, with an orphaned-schedule edge case still open.",
        ].map((n, i) => (
          <span key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, minWidth: 0 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: "#fbbf24", marginTop: 6, flex: "0 0 5px" }} />
            <span style={{ fontSize: 12, color: text.secondary, flex: 1, textWrap: "pretty" }}>{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TierCard({
  tier, isCurrent, selected, interval, currentAllowance, activeTenantCount, onSelect,
}: {
  tier: AvailableTier; isCurrent: boolean; selected: boolean; interval: MspBillingInterval;
  currentAllowance: number | null; activeTenantCount: number; onSelect: () => void;
}) {
  const cents = interval === "year" ? tier.annualPriceCents : tier.monthlyPriceCents;
  const yearMissing = interval === "year" && tier.annualPriceCents === null;

  const targetAllowance = tier.tenantAllowance ?? 0;
  const isDowngrade = targetAllowance > 0 && ((currentAllowance ?? 0) === 0 || targetAllowance < (currentAllowance ?? 0));
  const hardCap = targetAllowance * 2;
  const blocked = isDowngrade && activeTenantCount >= hardCap;

  let note = tier.description ?? "";
  let noteColor: string = text.label;
  if (yearMissing) { note = "No annual price configured — this target returns 400"; noteColor = signal.warning.text; }
  else if (blocked) { note = `Blocked: you have ${activeTenantCount} active tenants; this tier allows up to ${hardCap}. Archive tenants before downgrading.`; noteColor = signal.warning.text; }

  return (
    <div
      onClick={onSelect}
      style={{
        border: `1px solid ${selected ? "rgba(96,165,250,.5)" : border.card}`, borderRadius: 12, background: surface.card,
        padding: 15, display: "flex", flexDirection: "column", gap: 11, minWidth: 0, cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: text.strong }}>{tier.name}</span>
        <span style={{ fontSize: 11, color: text.label }}>id {tier.id}{tier.slug ? ` · ${tier.slug}` : ""}</span>
        <div style={{ flex: 1 }} />
        {isCurrent && <span style={pill(signal.ok.tint, signal.ok.border, signal.ok.strong)}>Current</span>}
      </div>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em", color: yearMissing ? text.label : text.strong }}>
          {yearMissing ? "—" : money(cents)}
        </span>
        <span style={{ fontSize: 11.5, color: text.label }}>{interval === "year" ? "per year" : "per month"}</span>
      </span>
      <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
        {tier.tenantAllowance ? `${tier.tenantAllowance} tenants included` : "Unlimited tenants"}
      </span>
      {note && <span style={{ fontSize: 11, color: noteColor, textWrap: "pretty" }}>{note}</span>}
    </div>
  );
}

function Fact({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color, textWrap: "pretty" }}>{value}</span>
      <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>{note}</span>
    </div>
  );
}

function StatePanel({
  icon, tone, title, body, wire,
}: {
  icon: string; tone: { strong: string; text: string; tint: string; border: string };
  title: string; body: string; wire: string;
}) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
    </div>
  );
}

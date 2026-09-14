/**
 * Seat Pricing — per-tenant module page (Git #4111), Commercial group
 * "Billing" nav leaf (`console/nav.ts`). Wires the real route surface in
 * `artifacts/api-server/src/routes/msp-seat-pricing.ts` via
 * `@/api/seat-pricing-api`.
 *
 * Shane's decision (2026-09-14): the customer's price is NOT manually picked
 * by the operator — it is the real, live count of active licensed users in
 * the customer's M365 tenant, minus any manual "service account" seats the
 * operator excludes with a reason. This page shows that live number and lets
 * the operator set the one manual input (the exclusion) and apply the
 * computed price to the customer's actual subscription.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  SeatPricingApiError,
  useApplySeatPricing,
  useSeatPricing,
  useSetServiceAccountOverride,
} from "@/api/seat-pricing-api";

type Tone = { strong: string; text: string; tint: string; border: string };
const GREEN: Tone = signal.ok;
const AMBER: Tone = signal.warning;
const RED: Tone = signal.critical;
const BLUE: Tone = signal.info;

function money(cents: number | null): string {
  if (cents === null) return "—";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: Tone, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function primaryBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 14px", borderRadius: 8,
    border: `1px solid ${disabled ? border.card : action.base}`, background: disabled ? "transparent" : action.base,
    color: disabled ? text.faint : "#fff", fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}
function statTile(label: string, value: string, hint?: string) {
  return (
    <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, color: text.title }}>{value}</span>
      {hint && <span style={{ fontSize: 10.5, color: text.muted }}>{hint}</span>}
    </div>
  );
}

export function SeatPricing({ customerId, customerName }: { customerId: number; customerName: string }) {
  const query = useSeatPricing(customerId);
  const setOverride = useSetServiceAccountOverride(customerId);
  const apply = useApplySeatPricing(customerId);

  const [excludedInput, setExcludedInput] = useState<string>("0");
  const [reasonInput, setReasonInput] = useState<string>("");
  const [overrideErr, setOverrideErr] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [applyOk, setApplyOk] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setExcludedInput(String(query.data.excludedServiceAccountSeats));
      setReasonInput(query.data.overrideReason ?? "");
    }
  }, [query.data]);

  if (query.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading seat pricing for {customerName}…</span>;
  }
  if (query.isError || !query.data) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load seat pricing for this customer.</span>;
  }

  const d = query.data;

  function saveOverride() {
    const n = parseInt(excludedInput, 10);
    if (isNaN(n) || n < 0) { setOverrideErr("Enter a whole number of seats, zero or more."); return; }
    if (n > 0 && reasonInput.trim().length === 0) { setOverrideErr("A reason is required when excluding any seats."); return; }
    setOverrideErr(null);
    setOverride.mutate(
      { excludedServiceAccountSeats: n, reason: reasonInput.trim() || undefined },
      { onError: (err) => setOverrideErr(err instanceof SeatPricingApiError ? err.message : "Failed to save.") },
    );
  }

  function applyPricing() {
    setApplyErr(null);
    setApplyOk(null);
    apply.mutate(
      {},
      {
        onSuccess: (r) => setApplyOk(`Applied ${money(r.computedMonthlyPriceCents)}/month to subscription #${r.subscriptionId}.`),
        onError: (err) => setApplyErr(err instanceof SeatPricingApiError ? err.message : "Failed to apply."),
      },
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 13, minWidth: 0 })}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 220, flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>Seat pricing for {customerName}</span>
            <span style={{ fontSize: 11, color: text.muted }}>
              Automatic — driven by the customer&apos;s real, live count of active licensed M365 users, not an
              operator-picked plan.
            </span>
          </span>
          {d.rawActiveLicensedUserCount === null ? (
            <span style={pill({ strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border })}>
              no live count yet
            </span>
          ) : (
            <span style={pill(GREEN)}>live count available</span>
          )}
        </div>

        {d.rawActiveLicensedUserCount === null ? (
          <div style={{ border: `1px solid ${AMBER.border}`, borderRadius: 10, background: AMBER.tint, padding: 13, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: AMBER.strong }}>Cannot compute a real seat count yet</span>
            <span style={{ fontSize: 11.5, color: text.secondary }}>
              This customer has no priced `/subscribedSkus` catalog collected, or no per-user license snapshot
              (`license_assignment_snapshots`) run yet. Nothing is guessed — this waits for a real scan.
            </span>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            {statTile("ACTIVE LICENSED USERS", String(d.rawActiveLicensedUserCount), "Distinct users with a paid M365 SKU assigned")}
            {statTile("SERVICE ACCOUNTS EXCLUDED", String(d.excludedServiceAccountSeats), d.overrideReason ?? "Manual operator override")}
            {statTile("BILLABLE SEATS", String(d.billableSeatCount ?? "—"), "Active users minus exclusions")}
            {statTile(
              "COMPUTED MONTHLY PRICE",
              money(d.computedMonthlyPriceCents),
              d.perSeatRate ? `${d.perSeatRate.serviceName} @ ${money(d.perSeatRate.monthlyRateCents)}/seat` : "No per-seat rate resolved",
            )}
          </div>
        )}

        {d.licenseSource && (
          <span style={{ fontSize: 10.5, color: text.faint }}>
            Sourced from {d.licenseSource.checkKey}
            {d.licenseSource.collectedAt ? `, collected ${new Date(d.licenseSource.collectedAt).toLocaleString()}` : ""}
            {" · "}priced SKUs: {d.licenseSource.paidSkuPartNumbers.join(", ") || "none"}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
        {/* ── Service account exclusion override ──────────────────────── */}
        <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Service-account exclusion</span>
          <span style={{ fontSize: 11, color: text.muted }}>
            A real, operator-set number of seats to exclude from the live count before it prices this customer —
            e.g. break-glass or automation accounts that hold a licence but should never be billed.
          </span>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 10.5, color: text.faint }}>Excluded seats</label>
              <input
                type="number"
                min={0}
                value={excludedInput}
                onChange={(e) => setExcludedInput(e.target.value)}
                style={{ width: 90, height: 32, borderRadius: 7, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.4)", color: text.title, padding: "0 9px", fontSize: 12.5 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 10.5, color: text.faint }}>Reason</label>
              <input
                type="text"
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="e.g. 2 break-glass service accounts"
                style={{ height: 32, borderRadius: 7, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.4)", color: text.title, padding: "0 9px", fontSize: 12.5 }}
              />
            </div>
            <button style={primaryBtn(setOverride.isPending)} disabled={setOverride.isPending} onClick={saveOverride}>
              <Icon name="check" size={13} />
              {setOverride.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {overrideErr && <span style={{ fontSize: 11, color: RED.text }}>{overrideErr}</span>}
        </div>

        {/* ── Apply to subscription ────────────────────────────────────── */}
        <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Apply to subscription</span>
          <span style={{ fontSize: 11, color: text.muted }}>
            Writes the computed price onto this customer&apos;s actual subscription. Refused if that subscription
            is Stripe-synced — its price is set by Stripe, not here.
          </span>
          {d.activeSubscription ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: text.secondary }}>
              <span>Subscription #{d.activeSubscription.id} — {d.activeSubscription.planName ?? "unnamed plan"}</span>
              <span>Currently billed: {money(d.activeSubscription.unitAmountCents)}/month</span>
            </div>
          ) : (
            <span style={{ fontSize: 11.5, color: text.muted }}>No active subscription recorded for this customer yet.</span>
          )}
          <button
            style={primaryBtn(apply.isPending || d.computedMonthlyPriceCents === null)}
            disabled={apply.isPending || d.computedMonthlyPriceCents === null}
            onClick={applyPricing}
          >
            <Icon name="receipt" size={13} />
            {apply.isPending ? "Applying…" : `Apply ${money(d.computedMonthlyPriceCents)}/month`}
          </button>
          {applyErr && <span style={{ fontSize: 11, color: RED.text }}>{applyErr}</span>}
          {applyOk && <span style={{ fontSize: 11, color: GREEN.text }}>{applyOk}</span>}
        </div>
      </div>
    </div>
  );
}

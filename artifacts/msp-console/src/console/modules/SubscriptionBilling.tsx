/**
 * Subscription — per-tenant module page (Git #4110, wiring done by #2609),
 * Commercial "Billing" nav slot. Wires the real route surface in
 * `artifacts/api-server/src/routes/msp-subscription-billing.ts` via
 * `@/api/subscription-billing-api`.
 *
 * Three real, account-level commercial actions on the customer's real
 * `tenant_subscriptions` row: cancel (now or at period end), apply a custom
 * discount, or apply free month(s) — the latter two both issue a real Stripe
 * coupon through the same mechanism #4032 built for testimonial credits.
 *
 * No fixture module, no fabricated row — every value here is a real server
 * response or an honest loading/empty/error state.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  SubscriptionBillingApiError,
  useApplyDiscount,
  useApplyFreeMonth,
  useCancelSubscription,
  useSubscriptionBilling,
  type CustomerBillingCreditSummary,
} from "@/api/subscription-billing-api";

type Tone = { strong: string; text: string; tint: string; border: string };
const GREEN: Tone = signal.ok;
const AMBER: Tone = signal.warning;
const RED: Tone = signal.critical;
const BLUE: Tone = signal.info;
const SLATE: Tone = { strong: signal.neutral.strong, text: text.muted, tint: signal.neutral.tint, border: signal.neutral.border };

function money(cents: number | null): string {
  if (cents === null) return "—";
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}
function date(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
function primaryBtn(disabled?: boolean, danger?: boolean): React.CSSProperties {
  const bg = danger ? "rgba(248,113,113,.14)" : action.base;
  const fg = danger ? "#fca5a5" : "#fff";
  const lineColor = danger ? signal.critical.border : action.base;
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 33, padding: "0 13px", borderRadius: 8,
    border: `1px solid ${disabled ? border.card : lineColor}`, background: disabled ? "transparent" : bg,
    color: disabled ? text.faint : fg, fontSize: 12.5, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}
function inputStyle(): React.CSSProperties {
  return { height: 32, borderRadius: 7, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.4)", color: text.title, padding: "0 9px", fontSize: 12.5 };
}
function statusTone(status: string): Tone {
  if (status === "active" || status === "trialing") return GREEN;
  if (status === "past_due" || status === "unpaid") return AMBER;
  if (status === "canceled" || status === "incomplete_expired") return RED;
  return SLATE;
}
function creditStatusTone(status: string): Tone {
  if (status === "applied") return GREEN;
  if (status === "pending" || status === "awaiting_subscription") return BLUE;
  if (status === "failed") return RED;
  return SLATE;
}

function CreditRow({ credit }: { credit: CustomerBillingCreditSummary }) {
  const t = creditStatusTone(credit.status);
  const label = credit.discountType === "percentage"
    ? `${credit.discountValue}% off`
    : `$${credit.discountValue} off`;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: `1px solid ${border.faint}`, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: text.title }}>
          {label}{credit.durationMonths ? ` · ${credit.durationMonths} month${credit.durationMonths === 1 ? "" : "s"}` : ""}
        </span>
        <span style={{ fontSize: 10.5, color: text.faint }}>
          {credit.source.replace(/^msp_operator_/, "").replace(/_/g, " ")} · issued {date(credit.createdAt)}
          {credit.appliedAmountCents != null ? ` · applied ${money(credit.appliedAmountCents)}` : ""}
        </span>
      </div>
      <span style={pill(t)}>{credit.status.replace(/_/g, " ")}</span>
    </div>
  );
}

export function SubscriptionBilling({ mspId, customerId, customerName }: { mspId: number; customerId: number; customerName: string }) {
  const query = useSubscriptionBilling(mspId, customerId);
  const cancel = useCancelSubscription(mspId, customerId);
  const discount = useApplyDiscount(mspId, customerId);
  const freeMonth = useApplyFreeMonth(mspId, customerId);

  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(true);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [cancelOk, setCancelOk] = useState<string | null>(null);

  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [discountMonths, setDiscountMonths] = useState("1");
  const [discountReason, setDiscountReason] = useState("");
  const [discountErr, setDiscountErr] = useState<string | null>(null);
  const [discountOk, setDiscountOk] = useState<string | null>(null);

  const [freeMonths, setFreeMonths] = useState("1");
  const [freeReason, setFreeReason] = useState("");
  const [freeErr, setFreeErr] = useState<string | null>(null);
  const [freeOk, setFreeOk] = useState<string | null>(null);

  if (query.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading subscription for {customerName}…</span>;
  }
  if (query.isError || !query.data) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load subscription details for this customer.</span>;
  }

  const d = query.data;
  const sub = d.subscription;

  function submitCancel() {
    setCancelErr(null);
    setCancelOk(null);
    cancel.mutate(
      { atPeriodEnd: cancelAtPeriodEnd, reason: cancelReason.trim() || undefined },
      {
        onSuccess: (r) => setCancelOk(`Subscription ${r.subscription.status === "canceled" ? "canceled" : "set to cancel " + (r.subscription.cancelAtPeriodEnd ? "at period end" : "now")}.`),
        onError: (err) => setCancelErr(err instanceof SubscriptionBillingApiError ? err.message : "Failed to cancel."),
      },
    );
  }

  function submitDiscount() {
    setDiscountErr(null);
    setDiscountOk(null);
    const value = parseFloat(discountValue);
    if (isNaN(value) || value <= 0) { setDiscountErr("Enter a discount value greater than zero."); return; }
    const months = discountMonths.trim() === "" ? null : parseInt(discountMonths, 10);
    if (months !== null && (isNaN(months) || months < 1)) { setDiscountErr("Duration must be a whole number of months, or left blank for a one-time credit."); return; }
    discount.mutate(
      { discountType, discountValue: value, durationMonths: months, reason: discountReason.trim() || undefined },
      {
        onSuccess: (r) => setDiscountOk(`Discount credit issued — status: ${r.credit.status.replace(/_/g, " ")}.`),
        onError: (err) => setDiscountErr(err instanceof SubscriptionBillingApiError ? err.message : "Failed to apply discount."),
      },
    );
  }

  function submitFreeMonth() {
    setFreeErr(null);
    setFreeOk(null);
    const months = parseInt(freeMonths, 10);
    if (isNaN(months) || months < 1) { setFreeErr("Enter at least 1 month."); return; }
    freeMonth.mutate(
      { months, reason: freeReason.trim() || undefined },
      {
        onSuccess: (r) => setFreeOk(`${months} free month${months === 1 ? "" : "s"} issued — status: ${r.credit.status.replace(/_/g, " ")}.`),
        onError: (err) => setFreeErr(err instanceof SubscriptionBillingApiError ? err.message : "Failed to apply free month(s)."),
      },
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* ── Current subscription ─────────────────────────────────────────── */}
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 })}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 220, flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: text.title }}>Subscription for {customerName}</span>
            <span style={{ fontSize: 11, color: text.muted }}>The real, tenant-scoped billing row — cancel, discount, or grant free month(s).</span>
          </span>
          {sub && <span style={pill(statusTone(sub.status))}>{sub.status.replace(/_/g, " ")}</span>}
        </div>

        {!sub ? (
          <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>No active subscription</span>
            <span style={{ fontSize: 11.5, color: text.muted }}>This customer has no active or trialing `tenant_subscriptions` row to act on right now.</span>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>PLAN</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: text.title }}>{sub.planName ?? "Unnamed"}</span>
              <span style={{ fontSize: 10.5, color: text.muted }}>{sub.source === "manual" ? "Billed outside Stripe" : `Stripe · ${sub.billingParty}`}</span>
            </div>
            <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>PRICE</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: text.title }}>{money(sub.unitAmountCents)}/mo</span>
              <span style={{ fontSize: 10.5, color: text.muted }}>{sub.currency.toUpperCase()}</span>
            </div>
            <div style={{ border: `1px solid ${border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 12, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>PERIOD ENDS</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>{date(sub.currentPeriodEnd)}</span>
              {sub.cancelAtPeriodEnd && <span style={{ fontSize: 10.5, color: AMBER.text }}>Cancels at period end</span>}
            </div>
          </div>
        )}
      </div>

      {sub && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>
          {/* ── Cancel ────────────────────────────────────────────────────── */}
          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Cancel subscription</span>
            <span style={{ fontSize: 11, color: text.muted }}>
              {sub.source === "manual"
                ? "This row has no Stripe subscription behind it — cancels immediately, there is no period end to defer to."
                : "Calls Stripe directly, then syncs the real status back to this row."}
            </span>
            {sub.source !== "manual" && (
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: text.secondary, cursor: "pointer" }}>
                <input type="checkbox" checked={cancelAtPeriodEnd} onChange={(e) => setCancelAtPeriodEnd(e.target.checked)} />
                Cancel at period end (leave unchecked to cancel now)
              </label>
            )}
            <input type="text" placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={inputStyle()} />
            <button
              style={primaryBtn(cancel.isPending, true)}
              disabled={cancel.isPending}
              onClick={submitCancel}
            >
              <Icon name="ban" size={13} />
              {cancel.isPending ? "Cancelling…" : sub.source === "manual" ? "Cancel now" : cancelAtPeriodEnd ? "Cancel at period end" : "Cancel now"}
            </button>
            {cancelErr && <span style={{ fontSize: 11, color: RED.text }}>{cancelErr}</span>}
            {cancelOk && <span style={{ fontSize: 11, color: GREEN.text }}>{cancelOk}</span>}
          </div>

          {/* ── Discount ──────────────────────────────────────────────────── */}
          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Apply a discount</span>
            <span style={{ fontSize: 11, color: text.muted }}>Issues a real Stripe coupon to the next invoice — or the next N months, if a duration is set.</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")} style={{ ...inputStyle(), width: 110 }}>
                <option value="percentage">% off</option>
                <option value="fixed">$ off</option>
              </select>
              <input type="number" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} style={{ ...inputStyle(), width: 80 }} />
              <input type="number" min={1} placeholder="months" value={discountMonths} onChange={(e) => setDiscountMonths(e.target.value)} style={{ ...inputStyle(), width: 80 }} title="Duration in months — leave blank for a one-time credit" />
            </div>
            <input type="text" placeholder="Reason (optional)" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} style={inputStyle()} />
            <button style={primaryBtn(discount.isPending)} disabled={discount.isPending} onClick={submitDiscount}>
              <Icon name="percent" size={13} />
              {discount.isPending ? "Applying…" : "Apply discount"}
            </button>
            {discountErr && <span style={{ fontSize: 11, color: RED.text }}>{discountErr}</span>}
            {discountOk && <span style={{ fontSize: 11, color: GREEN.text }}>{discountOk}</span>}
          </div>

          {/* ── Free month(s) ─────────────────────────────────────────────── */}
          <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 })}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Grant free month(s)</span>
            <span style={{ fontSize: 11, color: text.muted }}>A 100%-off credit spanning N consecutive invoices — a real repeating Stripe coupon, not an approximation.</span>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 10.5, color: text.faint }}>Months</label>
                <input type="number" min={1} max={12} value={freeMonths} onChange={(e) => setFreeMonths(e.target.value)} style={{ ...inputStyle(), width: 80 }} />
              </div>
            </div>
            <input type="text" placeholder="Reason (optional)" value={freeReason} onChange={(e) => setFreeReason(e.target.value)} style={inputStyle()} />
            <button style={primaryBtn(freeMonth.isPending)} disabled={freeMonth.isPending} onClick={submitFreeMonth}>
              <Icon name="gift" size={13} />
              {freeMonth.isPending ? "Applying…" : "Grant free month(s)"}
            </button>
            {freeErr && <span style={{ fontSize: 11, color: RED.text }}>{freeErr}</span>}
            {freeOk && <span style={{ fontSize: 11, color: GREEN.text }}>{freeOk}</span>}
          </div>
        </div>
      )}

      {/* ── Credit history ────────────────────────────────────────────────── */}
      <div style={cardStyle({ padding: 16, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 })}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Credit history</span>
        {d.credits.length === 0 ? (
          <span style={{ fontSize: 11.5, color: text.muted }}>No discounts or free months issued for this customer yet.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {d.credits.map((c) => <CreditRow key={c.id} credit={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

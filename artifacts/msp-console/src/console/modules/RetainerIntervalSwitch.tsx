/**
 * Retainer Interval Switch — a narrow, honest slice of the Commercial
 * "Billing" nav slot (#4112, Feature #1692). The full Billing screen (Design
 * screen 23) is still blocked on a real Design export (#2608) and is NOT
 * built here — this module does exactly one thing: let an operator propose a
 * month<->year switch on one of this customer's active retainers, and see/
 * cancel a proposal still awaiting the customer's decision.
 *
 * This never touches Stripe. Proposing only writes
 * `client_services.proposed_*` (`msp-retainer-billing.ts`) — the switch only
 * becomes real once the customer approves it from their own Billing page
 * (`portal-retainer-billing.ts`'s approve-interval-proposal route), which
 * reuses the exact same scheduling mechanics the customer's own self-service
 * switch uses.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { surface, text, signal, action, border } from "@/console/tokens";
import {
  useCancelIntervalProposal,
  useProposeIntervalSwitch,
  useRetainerBillingList,
  type RetainerBillingInterval,
  type RetainerBillingRow,
} from "@/api/retainer-billing-api";

function cardStyle(extra?: React.CSSProperties): React.CSSProperties {
  return { border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, ...extra };
}
function pill(t: { text: string; tint: string; border: string }, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
    background: t.tint, border: `1px solid ${t.border}`, fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: "nowrap",
    ...extra,
  };
}
function primaryBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 13px", borderRadius: 8,
    border: `1px solid ${disabled ? border.card : action.base}`, background: disabled ? "transparent" : action.base,
    color: disabled ? text.faint : "#fff", fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
  };
}
function ghostBtn(disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 13px", borderRadius: 8,
    border: `1px solid ${border.card}`, background: "transparent",
    color: disabled ? text.faint : text.secondary, fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
  };
}

function otherInterval(i: RetainerBillingInterval): RetainerBillingInterval {
  return i === "year" ? "month" : "year";
}
function intervalLabel(i: RetainerBillingInterval): string {
  return i === "year" ? "yearly" : "monthly";
}

function RetainerCard({ row, mspId, customerId }: { row: RetainerBillingRow; mspId: number; customerId: number }) {
  const propose = useProposeIntervalSwitch(mspId, customerId);
  const cancel = useCancelIntervalProposal(mspId, customerId);
  const [target, setTarget] = useState<RetainerBillingInterval>(otherInterval(row.billingInterval));
  const [error, setError] = useState<string | null>(null);

  const busy = propose.isPending || cancel.isPending;

  function submitPropose() {
    setError(null);
    propose.mutate(
      { clientServiceId: row.clientServiceId, targetInterval: target },
      { onError: (err) => setError(err.message) },
    );
  }
  function submitCancel() {
    setError(null);
    cancel.mutate({ clientServiceId: row.clientServiceId }, { onError: (err) => setError(err.message) });
  }

  return (
    <div style={cardStyle({ padding: 14, display: "flex", flexDirection: "column", gap: 10 })}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: text.title }}>{row.serviceName}</span>
          <span style={{ fontSize: 11, color: text.muted }}>Billed {intervalLabel(row.billingInterval)} today</span>
        </div>
        {row.hasPendingSwitch && (
          <span style={pill(signal.info)}>customer already has a self-service switch scheduled</span>
        )}
        {row.hasPendingProposal && !row.hasPendingSwitch && (
          <span style={pill(signal.warning)}>proposal pending customer decision</span>
        )}
      </div>

      {row.hasPendingProposal ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: text.secondary }}>
            Proposed switch to {intervalLabel(row.proposedBillingInterval!)}
            {row.proposedAt ? ` on ${new Date(row.proposedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""} — awaiting the customer&apos;s approve/reject in their portal.
          </span>
          <button onClick={submitCancel} disabled={busy} style={ghostBtn(busy)}>
            <Icon name="circle-x" size={13} />
            {cancel.isPending ? "Withdrawing…" : "Withdraw proposal"}
          </button>
        </div>
      ) : row.hasPendingSwitch ? (
        <span style={{ fontSize: 11.5, color: text.muted }}>
          Cannot propose a switch while the customer&apos;s own self-service switch is scheduled.
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as RetainerBillingInterval)}
            style={{
              height: 32, borderRadius: 8, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)",
              color: text.body, fontSize: 12, padding: "0 10px",
            }}
          >
            <option value="month">Propose monthly billing</option>
            <option value="year">Propose yearly billing</option>
          </select>
          <button onClick={submitPropose} disabled={busy} style={primaryBtn(busy)}>
            <Icon name="receipt" size={13} />
            {propose.isPending ? "Sending…" : "Propose switch"}
          </button>
        </div>
      )}

      {error && <span style={{ fontSize: 11.5, color: signal.critical.text }}>{error}</span>}
    </div>
  );
}

export function RetainerIntervalSwitch({ mspId, customerId, customerName }: { mspId: number; customerId: number; customerName: string }) {
  const list = useRetainerBillingList(mspId, customerId);

  if (list.isLoading) {
    return <span style={{ fontSize: 11.5, color: text.muted }}>Loading {customerName}&apos;s retainer billing…</span>;
  }
  if (list.isError) {
    return <span style={{ fontSize: 11.5, color: signal.critical.text }}>Failed to load retainer billing details for this customer.</span>;
  }
  const retainers = list.data?.retainers ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={cardStyle({ padding: 14, display: "flex", flexDirection: "column", gap: 6 })}>
        <span style={{ fontSize: 12, fontWeight: 700, color: text.title }}>Retainer interval switch</span>
        <span style={{ fontSize: 11.5, color: text.muted, lineHeight: 1.55 }}>
          Propose a month↔year billing-interval change for one of {customerName}&apos;s active retainers. This does
          not change anything by itself — the customer must approve it from their own Billing page before Stripe
          is ever touched. This is a narrow slice of the Commercial &quot;Billing&quot; nav slot; the full
          invoicing/plan screen is a separate, still-blocked build.
        </span>
      </div>

      {retainers.length === 0 ? (
        <div style={cardStyle({ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" })}>
          <Icon name="receipt" size={20} color={text.muted} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>No active recurring retainer for this customer</span>
        </div>
      ) : (
        retainers.map((row) => (
          <RetainerCard key={row.clientServiceId} row={row} mspId={mspId} customerId={customerId} />
        ))
      )}
    </div>
  );
}

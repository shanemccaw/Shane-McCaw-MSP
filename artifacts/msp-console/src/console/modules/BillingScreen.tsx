/**
 * Billing — the Commercial "Billing" nav slot's full screen (#2609), stacking
 * four real, previously-separate capabilities behind one tabbed shell rather
 * than an unreadably long vertical scroll:
 *
 *   Subscription    — cancel / discount / free-month (#4110)
 *   Seat Pricing    — automatic seat pricing + exclusion override (#4111)
 *   Retainer Switch — propose a month<->year interval switch (#4112)
 *   Invoices        — draft CRUD + versioned re-issue (#4109)
 *
 * Subscription, Seat Pricing and Retainer Switch are all scoped to the
 * currently-selected tenant. Invoices is NOT — it is billed to a separate,
 * unrelated `usersTable` axis (see `Invoices.tsx`'s own header) and carries
 * its own client picker.
 *
 * No real Claude Design export exists for this screen (#2608 never landed).
 * Shane authorized building it directly (2026-09-15) rather than waiting —
 * the banner below is the required, visible marker of that.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { text, signal, action, border } from "@/console/tokens";
import { SubscriptionBilling } from "./SubscriptionBilling";
import { SeatPricing } from "./SeatPricing";
import { RetainerIntervalSwitch } from "./RetainerIntervalSwitch";
import { Invoices } from "./Invoices";

type BillingTab = "subscription" | "seats" | "retainer" | "invoices";

function AgentBuiltBanner() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 9, padding: "8px 13px", borderRadius: 8,
        border: `1px dashed ${signal.notice.border}`, background: signal.notice.tint,
      }}
    >
      <Icon name="flask-conical" size={14} color={signal.notice.strong} />
      <span style={{ fontSize: 11, fontWeight: 600, color: signal.notice.strong }}>
        Agent-built UI — pending design review
      </span>
      <span style={{ fontSize: 10.5, color: text.muted }}>
        No Claude Design export exists for this screen yet (#2608). Built directly against the real
        backend on Shane&apos;s explicit authorization — layout and styling have not had a design pass.
      </span>
    </div>
  );
}

export function BillingScreen({ mspId, customerId, customerName }: { mspId: number; customerId: number; customerName: string }) {
  const [tab, setTab] = useState<BillingTab>("subscription");

  const tabs: { id: BillingTab; label: string; icon: string }[] = [
    { id: "subscription", label: "Subscription", icon: "credit-card" },
    { id: "seats", label: "Seat Pricing", icon: "users-round" },
    { id: "retainer", label: "Retainer Switch", icon: "history" },
    { id: "invoices", label: "Invoices", icon: "receipt" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <AgentBuiltBanner />

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 7,
                border: `1px solid ${active ? "rgba(96,165,250,.3)" : border.card}`,
                background: active ? "rgba(37,99,235,.18)" : "transparent",
                color: active ? "#bfdbfe" : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              <Icon name={t.icon} size={13} color={active ? action.hover : text.faint} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "subscription" && <SubscriptionBilling mspId={mspId} customerId={customerId} customerName={customerName} />}
      {tab === "seats" && <SeatPricing customerId={customerId} customerName={customerName} />}
      {tab === "retainer" && <RetainerIntervalSwitch mspId={mspId} customerId={customerId} customerName={customerName} />}
      {tab === "invoices" && <Invoices mspId={mspId} />}
    </div>
  );
}

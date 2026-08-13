/**
 * The Properties panel. Mirrors `ServiceProperties.tsx`'s split: nothing
 * open shows the screen's own settings (SLA thresholds) and headline stats;
 * a delivery or a fulfillment type open shows its full facts, read-only
 * except for the few fields that write straight through here (status,
 * note, and — for a type — recurring/active).
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, PRIMARY, TEXT } from "../../theme";
import {
  deliveryById,
  getSnapshot,
  saveSlaThreshold,
  setDeliveryStatus,
  setStatusNote,
  subscribe,
  syncFromPurchases,
  typeByKey,
  type FulfillmentState,
} from "./fulfillmentStore";
import { DELIVERY_STATUSES, firedWhenLabel, formatDate, SOURCE_LABEL, STATUS_LABEL, slaNote, usd, type DeliveryRow, type FulfillmentTypeRow } from "./fulfillmentTypes";

export function FulfillmentProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const delivery = deliveryById(state.openItemId, state);
  const type = typeByKey(state.openTypeKey, state);

  if (delivery) return <DeliveryView item={delivery} saving={state.saving} />;
  if (type) return <TypeView type={type} />;
  return <Overview state={state} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>{title}</span>
      {children}
    </div>
  );
}

function Fact({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "none", minWidth: 76, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: mono ? FONT.mono : "inherit", fontSize: 11.5, color: color ?? TEXT.strong, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// ── Nothing open ─────────────────────────────────────────────────────────────

function Overview({ state }: { state: FulfillmentState }) {
  const summary = state.summary;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <button
        onClick={() => void syncFromPurchases()}
        disabled={state.syncing}
        style={{ alignSelf: "flex-start", padding: "5px 12px", borderRadius: 5, border: 0, background: PRIMARY, color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: state.syncing ? "default" : "pointer", opacity: state.syncing ? 0.6 : 1 }}
      >
        {state.syncing ? "Syncing…" : "Sync from purchases"}
      </button>

      {summary && (
        <Section title="Queue">
          <Fact label="Total" value={String(summary.total)} />
          <Fact label="Overdue" value={String(summary.overdue)} color={summary.overdue > 0 ? ACCENT.amber : undefined} />
          {DELIVERY_STATUSES.map((s) => (
            <Fact key={s} label={STATUS_LABEL[s]} value={String(summary.byStatus[s] ?? 0)} />
          ))}
        </Section>
      )}

      <Section title="Internal SLA thresholds">
        <span style={{ fontSize: 11, lineHeight: 1.5, color: TEXT.faint, marginBottom: 2 }}>
          Operator-facing, separate from any customer-facing SLA.
        </span>
        {state.slaConfigs.length === 0 && <span style={{ fontSize: 11.5, color: TEXT.faint }}>None configured yet.</span>}
        {state.slaConfigs.map((cfg) => (
          <SlaRow key={cfg.key} label={cfg.label} thresholdDays={cfg.thresholdDays} onSave={(days) => void saveSlaThreshold(cfg.key, days)} />
        ))}
      </Section>

      {state.message && <span style={{ fontSize: 11.5, color: ACCENT.greenBright }}>{state.message}</span>}
    </div>
  );
}

function SlaRow({ label, thresholdDays, onSave }: { label: string; thresholdDays: number; onSave: (days: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: TEXT.body }}>{label}</span>
      <input
        type="number"
        min={1}
        max={365}
        defaultValue={thresholdDays}
        onBlur={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n > 0 && n !== thresholdDays) onSave(n);
        }}
        style={{ width: 52, padding: "2px 6px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: "inherit", fontSize: 11.5 }}
      />
      <span style={{ fontSize: 10.5, color: TEXT.faint }}>days</span>
    </div>
  );
}

// ── A delivery open ──────────────────────────────────────────────────────────

function DeliveryView({ item, saving }: { item: DeliveryRow; saving: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="Status">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {DELIVERY_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => void setDeliveryStatus(item.id, s)}
              disabled={saving}
              style={{
                padding: "3px 9px",
                borderRadius: 10,
                border: `1px solid ${item.deliveryStatus === s ? ACCENT.info : LINE.control}`,
                background: item.deliveryStatus === s ? "rgba(127,180,216,.14)" : "transparent",
                color: item.deliveryStatus === s ? ACCENT.info : TEXT.dimmer,
                fontFamily: "inherit",
                fontSize: 11,
                cursor: saving ? "default" : "pointer",
              }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {item.isOverdue && item.deliveryStatus !== "delivered" && (
          <span style={{ fontSize: 11, color: ACCENT.amber }}>{slaNote(item)}</span>
        )}
      </Section>

      <Section title="Note">
        <textarea
          defaultValue={item.statusNote ?? ""}
          placeholder="Add context about this status…"
          rows={3}
          onBlur={(e) => {
            if (e.target.value !== (item.statusNote ?? "")) void setStatusNote(item.id, e.target.value);
          }}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: "inherit", fontSize: 11.5, resize: "vertical" }}
        />
      </Section>

      <Section title="What was sold">
        <Fact label="Title" value={item.itemTitle} />
        <Fact label="Type" value={SOURCE_LABEL[item.sourceType]} />
        <Fact label="Amount" value={usd(item.purchaseAmountCents)} />
        {item.wholesaleChargedCents != null && <Fact label="Real cost" value={usd(item.wholesaleChargedCents)} color={ACCENT.amber} />}
        <Fact label="Purchased" value={formatDate(item.purchasedAt)} />
      </Section>

      <Section title="Client">
        <Fact label="Name" value={item.clientName ?? "—"} />
        {item.clientEmail && <Fact label="Email" value={item.clientEmail} mono />}
        <Fact label="MSP" value={item.mspName ?? "—"} />
        <Fact label="Customer" value={item.customerName ?? "—"} />
      </Section>

      <Section title="SLA">
        <Fact label="Due" value={formatDate(item.slaDueAt)} color={item.isOverdue && item.deliveryStatus !== "delivered" ? ACCENT.amber : undefined} />
        <Fact label="Threshold" value={item.slaThresholdDays != null ? `${item.slaThresholdDays} days` : "—"} />
      </Section>

      {(item.projectId ?? item.presentationId ?? item.invoiceId) != null && (
        <Section title="Linked records">
          {item.projectId != null && <Fact label="Project" value={`#${item.projectId}`} mono />}
          {item.presentationId != null && <Fact label="Presentation" value={`#${item.presentationId}`} mono />}
          {item.invoiceId != null && <Fact label="Invoice" value={`#${item.invoiceId}`} mono />}
        </Section>
      )}
    </div>
  );
}

// ── A fulfillment type open ──────────────────────────────────────────────────

function TypeView({ type }: { type: FulfillmentTypeRow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="What it is">
        <Fact label="Key" value={type.key} mono />
        <Fact label="Fires when" value={firedWhenLabel(type.firedWhen)} />
        <Fact label="Billing" value={type.recurring ? "Recurring" : "One-time"} />
        <Fact label="Status" value={type.isActive ? "Active" : "Inactive"} color={type.isActive ? ACCENT.greenBright : undefined} />
      </Section>
      {type.description && (
        <Section title="Description">
          <span style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.body, whiteSpace: "pre-wrap" }}>{type.description}</span>
        </Section>
      )}
      <Section title="Workflow event">
        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: ACCENT.info }}>fulfillment.{type.key}</span>
        <span style={{ fontSize: 11, lineHeight: 1.5, color: TEXT.faint }}>
          A Workflow Definition with an Event trigger of this name receives the full fulfillment payload as its start payload.
        </span>
      </Section>
    </div>
  );
}

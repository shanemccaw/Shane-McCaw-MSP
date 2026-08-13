/**
 * Fulfillment screen body — the centre content. Same split as
 * `ServicesBody.tsx`: nothing open shows a dashboard (the numbers the Watch
 * tab is built from, so they are never hidden behind a filter); a delivery
 * open shows a read-only summary card with quick status actions; a
 * fulfillment type open shows its full detail plus the test-resolve tool
 * (`admin-fulfillment-types.ts`'s `POST /resolve`), the one piece of the old
 * `pages/FulfillmentTypes.tsx` that genuinely needs its own space rather than
 * fitting in a peek.
 */

import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, Loader2, Play, Trash2 } from "lucide-react";
import { ACCENT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  deliveryById,
  getSnapshot,
  refreshAll,
  removeType,
  setDeliveryStatus,
  subscribe,
  syncFromPurchases,
  testResolveType,
  typeByKey,
  type FulfillmentState,
} from "./fulfillmentStore";
import { DELIVERY_STATUSES, firedWhenLabel, formatDate, nextStatus, SOURCE_LABEL, slaNote, STATUS_LABEL, usd, type DeliveryRow, type FulfillmentTypeRow } from "./fulfillmentTypes";

export function FulfillmentBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const delivery = deliveryById(state.openItemId, state);
  const type = typeByKey(state.openTypeKey, state);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} title={delivery?.itemTitle ?? type?.label ?? "Fulfillment"} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px" }}>
        {delivery ? <DeliveryRecordView item={delivery} saving={state.saving} /> : type ? <TypeRecordView type={type} /> : <Overview state={state} />}
      </div>
      {state.message && <Toast message={state.message} />}
    </div>
  );
}

function Header({ state, title }: { state: FulfillmentState; title: string }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{title}</span>
      {state.summary && (
        <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${LINE.strong}`, fontSize: 10.5, color: TEXT.dimmer }}>
          {state.summary.total} in the queue
        </span>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      <button onClick={() => void syncFromPurchases()} disabled={state.syncing} style={buttonStyle(true)}>
        {state.syncing ? "Syncing…" : "Sync from purchases"}
      </button>
      <button onClick={() => void refreshAll()} style={buttonStyle(false)}>
        Refresh
      </button>
    </div>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : TEXT.soft,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

function Toast({ message }: { message: string }) {
  return (
    <div style={{ flex: "none", padding: "8px 16px", fontSize: 12, color: TEXT.strong, background: SURFACE.card, borderTop: `1px solid ${LINE.base}` }}>
      {message}
    </div>
  );
}

// ── Overview (nothing open) ──────────────────────────────────────────────────

function Overview({ state }: { state: FulfillmentState }) {
  const { menu, open, close } = useContextMenu();
  const summary = state.summary;
  if (!summary && state.loading) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading the queue…</div>;
  }
  if (!summary) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.faint }}>Nothing has synced yet. Sync from purchases to build the queue.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          padding: "18px 20px",
          borderRadius: 10,
          background: summary.overdue > 0 ? "linear-gradient(135deg, rgba(242,202,99,.14), rgba(242,202,99,.02))" : "linear-gradient(135deg, rgba(127,180,216,.12), rgba(127,180,216,.02))",
          border: `1px solid ${summary.overdue > 0 ? "rgba(242,202,99,.30)" : "rgba(127,180,216,.24)"}`,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: summary.overdue > 0 ? ACCENT.amber : ACCENT.info }}>
          {summary.overdue > 0 ? "Needs attention" : "Everything sold that requires delivery"}
        </span>
        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.03em", color: TEXT.primary }}>{summary.total} item{summary.total === 1 ? "" : "s"}</span>
        <span style={{ fontSize: 11.5, color: TEXT.meta }}>
          {summary.overdue > 0
            ? `${summary.overdue} past its SLA due date and not yet delivered.`
            : "Nothing is overdue — everything sold across every MSP and customer, tracked here."}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>By status</span>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {DELIVERY_STATUSES.map((s) => (
            <div key={s} style={{ flex: "1 1 150px", minWidth: 0, padding: "13px 15px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: s === "blocked" ? ACCENT.danger : TEXT.caption }}>{STATUS_LABEL[s]}</span>
              <div style={{ marginTop: 8, fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: TEXT.primary }}>{summary.byStatus[s] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {state.overdueRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: ACCENT.amber }}>Overdue right now</span>
          {state.overdueRows.slice(0, 8).map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => getShellApi()?.openDoc({ kind: "delivery", id: String(item.id), screenId: "fulfillment" })}
              onContextMenu={(e) =>
                open(
                  e,
                  // Same status choices `FulfillmentProperties.tsx`'s `DeliveryView`
                  // already offers as buttons — `setDeliveryStatus` has no
                  // arm-then-confirm gate on this screen.
                  DELIVERY_STATUSES.filter((s) => s !== item.deliveryStatus).map((s) => ({
                    label: `Mark ${STATUS_LABEL[s].toLowerCase()}`,
                    onSelect: () => void setDeliveryStatus(item.id, s),
                  })),
                  `Actions for ${item.itemTitle}`,
                )
              }
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card, cursor: "pointer" }}
            >
              <AlertTriangle size={13} color={ACCENT.amber} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.itemTitle}</span>
              <span style={{ fontSize: 11, color: ACCENT.amber }}>{slaNote(item)}</span>
            </div>
          ))}
        </div>
      )}
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

// ── A delivery open ──────────────────────────────────────────────────────────

function DeliveryRecordView({ item, saving }: { item: DeliveryRow; saving: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div style={{ padding: "22px 24px", borderRadius: 12, border: `1px solid ${LINE.strong}`, background: SURFACE.card }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.dim }}>{SOURCE_LABEL[item.sourceType]}</span>
        <div style={{ marginTop: 9, fontSize: 20, fontWeight: 700, letterSpacing: "-.015em", lineHeight: 1.2, color: TEXT.bright }}>{item.itemTitle}</div>
        {item.itemDescription && <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.55, color: TEXT.dim }}>{item.itemDescription}</div>}

        <div style={{ marginTop: 17, display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-.02em", color: TEXT.bright }}>{usd(item.purchaseAmountCents)}</span>
          <span style={{ fontSize: 12, color: TEXT.caption }}>purchased {formatDate(item.purchasedAt)}</span>
        </div>

        <div style={{ marginTop: 14, fontSize: 11.5, color: TEXT.quiet }}>
          {item.clientName ?? item.clientEmail ?? "Unassigned client"}
          {item.mspName ? ` · ${item.mspName}` : ""}
        </div>

        <div style={{ marginTop: 17, fontSize: 11, color: item.isOverdue && item.deliveryStatus !== "delivered" ? ACCENT.amber : TEXT.faint }}>
          {slaNote(item)}
          {item.slaDueAt ? ` — due ${formatDate(item.slaDueAt)}` : ""}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {DELIVERY_STATUSES.filter((s) => s !== item.deliveryStatus).map((s) => (
          <ActionButton key={s} label={`Mark ${STATUS_LABEL[s].toLowerCase()}`} busy={saving} onClick={() => void setDeliveryStatus(item.id, s)} />
        ))}
      </div>

      <span style={{ fontSize: 11, lineHeight: 1.5, textAlign: "center", color: TEXT.faint }}>
        Status and note edit straight through — from here, the peek, or the contextual tab.
      </span>
    </div>
  );
}

function ActionButton({ label, onClick, busy }: { label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{ padding: "7px 13px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well, color: TEXT.body, fontFamily: "inherit", fontSize: 12, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
    >
      {label}
    </button>
  );
}

// ── A fulfillment type open ──────────────────────────────────────────────────

function TypeRecordView({ type }: { type: FulfillmentTypeRow }) {
  const [payload, setPayload] = useState("{}");
  const [resolving, setResolving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function fire() {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    setResolving(true);
    try {
      await testResolveType(type.key, parsed);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div style={{ padding: "22px 24px", borderRadius: 12, border: `1px solid ${LINE.strong}`, background: SURFACE.card }}>
        <span style={{ fontFamily: "Menlo, Consolas, monospace", fontSize: 10.5, color: ACCENT.info }}>fulfillment.{type.key}</span>
        <div style={{ marginTop: 9, fontSize: 20, fontWeight: 700, letterSpacing: "-.015em", color: TEXT.bright }}>{type.label}</div>
        {type.description && <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.55, color: TEXT.dim }}>{type.description}</div>}
        <div style={{ marginTop: 14, fontSize: 11.5, color: TEXT.quiet }}>
          Fires on {firedWhenLabel(type.firedWhen)} · {type.recurring ? "recurring billing" : "one-time"} · {type.isActive ? "active" : "inactive"}
        </div>
      </div>

      <div style={{ padding: "16px 18px", borderRadius: 10, border: `1px solid ${LINE.base}`, background: SURFACE.card, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.caption }}>Test resolve</span>
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: TEXT.faint }}>
          Manually fires <code>resolve_fulfillment</code> with a fresh idempotency key — any Workflow Definition subscribed to this event fires for real.
        </span>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={4}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: "Menlo, Consolas, monospace", fontSize: 11.5, resize: "vertical" }}
        />
        <button onClick={() => void fire()} disabled={resolving || !type.isActive} style={{ ...buttonStyle(true), alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}>
          {resolving ? <Loader2 size={13} /> : <Play size={13} />}
          Fire event
        </button>
        {!type.isActive && <span style={{ fontSize: 11, color: ACCENT.amber }}>Inactive — activate it from the peek before testing.</span>}
      </div>

      <button
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          void removeType(type.key);
        }}
        style={{
          alignSelf: "flex-start",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 5,
          border: `1px solid ${confirmDelete ? ACCENT.danger : LINE.strong}`,
          background: "transparent",
          color: confirmDelete ? ACCENT.danger : TEXT.dim,
          fontFamily: "inherit",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        <Trash2 size={13} />
        {confirmDelete ? "Delete — press again" : "Delete"}
      </button>
    </div>
  );
}

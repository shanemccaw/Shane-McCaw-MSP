/**
 * The queue browser — this screen's Explorer panel. Same shape as
 * `ServiceExplorer.tsx`: a filter box, chip facets, grouped rows. Grouped by
 * delivery status rather than a category, since "what state is this in" is
 * the one thing worth scanning a delivery list for.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  clearFilters,
  filtersActive,
  getSnapshot,
  setFilterOverdue,
  setFilterSource,
  setFilterStatus,
  setPage,
  setSearch,
  subscribe,
  type FulfillmentState,
} from "./fulfillmentStore";
import { compactUsd, DELIVERY_STATUSES, slaNote, SOURCE_LABEL, SOURCE_TYPES, STATUS_LABEL, type DeliveryRow } from "./fulfillmentTypes";

export function FulfillmentExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return <FulfillmentExplorerView state={state} />;
}

export function FulfillmentExplorerView({ state }: { state: FulfillmentState }) {
  const groups = new Map<string, DeliveryRow[]>();
  for (const item of state.items) {
    const list = groups.get(item.deliveryStatus);
    if (list) list.push(item);
    else groups.set(item.deliveryStatus, [item]);
  }
  const ordered = DELIVERY_STATUSES.filter((s) => groups.has(s)).map((s) => [s, groups.get(s)!] as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", borderBottom: `1px solid ${LINE.subtle}`, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          value={state.filters.q}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, title…"
          style={{
            height: 26,
            padding: "0 9px",
            borderRadius: 4,
            border: `1px solid ${LINE.control}`,
            background: "#292929",
            color: TEXT.primary,
            fontFamily: "inherit",
            fontSize: 12,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Chip label="All statuses" on={state.filters.status === ""} onClick={() => setFilterStatus("")} />
          {DELIVERY_STATUSES.map((s) => (
            <Chip key={s} label={STATUS_LABEL[s]} on={state.filters.status === s} onClick={() => setFilterStatus(s)} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Chip label="All types" on={state.filters.sourceType === ""} onClick={() => setFilterSource("")} />
          {SOURCE_TYPES.map((s) => (
            <Chip key={s} label={SOURCE_LABEL[s]} on={state.filters.sourceType === s} onClick={() => setFilterSource(s)} />
          ))}
          <Chip label="Overdue only" on={state.filters.overdue} onClick={() => setFilterOverdue(!state.filters.overdue)} tone={ACCENT.amber} />
        </div>
        {filtersActive(state) && (
          <button onClick={clearFilters} style={{ alignSelf: "flex-start", background: "transparent", border: 0, color: TEXT.dim, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>
            Clear filters
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 12px" }}>
        {state.loading && state.items.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.meta }}>Reading the queue…</div>}
        {state.error && <div style={{ padding: "10px 12px", fontSize: 12, color: ACCENT.danger, lineHeight: 1.5 }}>{state.error}</div>}
        {!state.loading && !state.error && state.items.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.faint, lineHeight: 1.5 }}>
            Nothing matches. Sync from the Home tab to pull in new sales, or clear a filter.
          </div>
        )}

        {ordered.map(([status, items]) => (
          <div key={status}>
            <span style={{ display: "block", padding: "7px 13px 4px", fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
              {STATUS_LABEL[status]} · {items.length}
            </span>
            {items.map((item) => (
              <Row key={item.id} item={item} state={state} />
            ))}
          </div>
        ))}
      </div>

      {state.meta && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderTop: `1px solid ${LINE.subtle}`, fontSize: 10.5, color: TEXT.faint }}>
          <span>
            {state.meta.total === 0 ? "0 items" : `${(state.page - 1) * state.meta.pageSize + 1}–${Math.min(state.page * state.meta.pageSize, state.meta.total)} of ${state.meta.total}`}
          </span>
          {state.meta.total > state.meta.pageSize && (
            <span style={{ display: "flex", gap: 6 }}>
              <PageButton disabled={state.page <= 1} onClick={() => setPage(state.page - 1)}>
                ←
              </PageButton>
              <PageButton disabled={state.page * state.meta.pageSize >= state.meta.total} onClick={() => setPage(state.page + 1)}>
                →
              </PageButton>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PageButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ padding: "1px 7px", borderRadius: 4, border: `1px solid ${LINE.control}`, background: "transparent", color: disabled ? TEXT.faintest : TEXT.dim, fontSize: 11, cursor: disabled ? "default" : "pointer" }}
    >
      {children}
    </button>
  );
}

function Chip({ label, on, onClick, tone }: { label: string; on: boolean; onClick: () => void; tone?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        border: `1px solid ${on ? (tone ?? "rgba(255,255,255,.28)") : LINE.control}`,
        background: on ? (tone ? "rgba(242,202,99,.12)" : WASH.hover) : "transparent",
        color: on ? (tone ?? TEXT.primary) : TEXT.dimmer,
        fontFamily: "inherit",
        fontSize: 10.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Row({ item, state }: { item: DeliveryRow; state: FulfillmentState }) {
  const on = state.openItemId === item.id;
  const border = on ? ACCENT.info : item.isOverdue && item.deliveryStatus !== "delivered" ? ACCENT.amber : item.deliveryStatus === "blocked" ? ACCENT.danger : "transparent";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openDoc({ kind: "delivery", id: String(item.id), screenId: "fulfillment" })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          getShellApi()?.openDoc({ kind: "delivery", id: String(item.id), screenId: "fulfillment" });
        }
      }}
      style={{ display: "block", padding: "7px 13px", cursor: "pointer", borderLeft: `2px solid ${border}`, background: on ? WASH.hoverSoft : "transparent" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>{item.itemTitle}</span>
        <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: TEXT.softer }}>{compactUsd(item.purchaseAmountCents)}</span>
      </div>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, color: item.isOverdue && item.deliveryStatus !== "delivered" ? ACCENT.amber : TEXT.faint }}>
        {item.clientName ?? item.mspName ?? item.customerName ?? "Unassigned"} · {slaNote(item)}
      </span>
    </div>
  );
}

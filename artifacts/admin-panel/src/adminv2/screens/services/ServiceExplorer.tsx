/**
 * The catalog browser — this screen's Explorer panel.
 *
 * Grouped by `topCategory()` (one level of `categoryPath`, see that function's
 * doc comment for why not a full tree) with a filter box, the same shape as
 * `EndpointExplorer.tsx`. A row shows what actually decides whether a catalog
 * entry is worth opening: its effective price, its billing, and — the one
 * thing that would otherwise be invisible — whether it is public with no real
 * price (`SHELL.md`'s "rows carry real data, not labels").
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { getSnapshot, setCategory, setFilter, subscribe, type ServicesState } from "./servicesStore";
import { BILLING_LABEL, effectivePriceCents, hasNoPrice, topCategory, usd, VISIBILITY_LABEL, type Service } from "./servicesTypes";

export function ServiceExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return <ServiceExplorerView state={state} />;
}

export function ServiceExplorerView({ state }: { state: ServicesState }) {
  const categories = [...new Set(state.services.map(topCategory))].sort();
  const query = state.filter.trim().toLowerCase();

  const visible = state.services.filter((s) => {
    if (state.category !== "all" && topCategory(s) !== state.category) return false;
    if (!query) return true;
    return s.name.toLowerCase().includes(query) || (s.slug ?? "").toLowerCase().includes(query);
  });

  const groups = new Map<string, Service[]>();
  for (const s of visible) {
    const g = topCategory(s);
    const list = groups.get(g);
    if (list) list.push(s);
    else groups.set(g, [s]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", borderBottom: `1px solid ${LINE.subtle}`, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          value={state.filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services"
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
          <Chip on={state.category === "all"} onClick={() => setCategory("all")}>
            All
          </Chip>
          {categories.map((c) => (
            <Chip key={c} on={state.category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 12px" }}>
        {state.loading && <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.meta }}>Reading the catalog…</div>}
        {state.error && <div style={{ padding: "10px 12px", fontSize: 12, color: ACCENT.danger, lineHeight: 1.5 }}>{state.error}</div>}
        {!state.loading && !state.error && visible.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.faint, lineHeight: 1.5 }}>
            {state.services.length === 0 ? "The catalog is empty." : "Nothing matches that filter."}
          </div>
        )}

        {ordered.map(([group, services]) => (
          <div key={group}>
            <span
              style={{
                display: "block",
                padding: "7px 13px 4px",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: ".09em",
                textTransform: "uppercase",
                color: TEXT.caption,
              }}
            >
              {group}
            </span>
            {services.map((s) => (
              <Row key={s.id} service={s} state={state} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        border: `1px solid ${on ? "rgba(255,255,255,.28)" : LINE.control}`,
        background: on ? WASH.hover : "transparent",
        color: on ? TEXT.primary : TEXT.dimmer,
        fontFamily: "inherit",
        fontSize: 10.5,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Row({ service, state }: { service: Service; state: ServicesState }) {
  const on = state.openId === String(service.id);
  const noPrice = hasNoPrice(service);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openDoc({ kind: "service", id: String(service.id), screenId: "services" })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          getShellApi()?.openDoc({ kind: "service", id: String(service.id), screenId: "services" });
        }
      }}
      style={{
        display: "block",
        padding: "7px 13px",
        cursor: "pointer",
        borderLeft: `2px solid ${on ? ACCENT.info : noPrice ? ACCENT.amber : "transparent"}`,
        background: on ? WASH.hoverSoft : state.savingIds.has(service.id) ? WASH.hoverFaint : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>
          {service.name}
        </span>
        <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: TEXT.softer }}>
          {usd(effectivePriceCents(service))}
        </span>
      </div>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, color: noPrice ? ACCENT.amber : TEXT.faint }}>
        {BILLING_LABEL[service.billingType]} · {VISIBILITY_LABEL[service.visibility]}
        {noPrice ? " · no real price" : ""}
      </span>
    </div>
  );
}

/**
 * The CRM screen's left (Explorer) panel — real Zoho pipeline stages, not a
 * global tree (handoff.md section 1: contextual content only).
 */

import { useSyncExternalStore } from "react";
import { ACCENT, LINE, PRIMARY, TEXT } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import { getSnapshot, setView, subscribe } from "./crmStore";
import { formatUsd } from "./zohoTypes";

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "12px 12px 6px",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".09em",
        textTransform: "uppercase",
        color: TEXT.caption,
      }}
    >
      {children}
    </div>
  );
}

function NavRow({ label, live, active, onClick }: { label: string; live: string; active: boolean; onClick: () => void }) {
  const { menu, open, close } = useContextMenu();

  return (
    <>
      <button
        className="av2-row"
        onClick={onClick}
        onContextMenu={(event) =>
          open(
            event,
            [
              { label: "Open", onSelect: onClick },
              { label: "Copy count", onSelect: () => copyToClipboard(live), disabled: !live },
            ],
            `Actions for ${label}`,
          )
        }
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: 8,
          padding: "7px 12px",
          background: active ? "rgba(15,108,189,.16)" : "transparent",
          border: 0,
          borderLeft: `2px solid ${active ? PRIMARY : "transparent"}`,
          color: active ? TEXT.bright : TEXT.body,
          fontSize: 12.5,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ flex: "none", fontSize: 11, fontFamily: "Menlo, Consolas, monospace", color: TEXT.meta }}>
          {live}
        </span>
      </button>
      <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

function StageRow({ stage, count, total }: { stage: string; count: number; total: number }) {
  const { menu, open, close } = useContextMenu();
  const totalText = formatUsd(total);

  return (
    <div
      onContextMenu={(event) =>
        open(
          event,
          [
            { label: "View in Pipeline", onSelect: () => setView("pipeline") },
            { label: "Copy stage name", onSelect: () => copyToClipboard(stage) },
            { label: "Copy total value", onSelect: () => copyToClipboard(totalText) },
          ],
          `Actions for ${stage}`,
        )
      }
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: "6px 12px",
        borderBottom: `1px solid ${LINE.subtle}`,
      }}
    >
      <ContextMenu menu={menu} onClose={close} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: TEXT.body }}>
          {stage}
        </span>
        <span style={{ flex: "none", fontSize: 11, fontFamily: "Menlo, Consolas, monospace", color: TEXT.meta }}>
          {count}
        </span>
      </div>
      <span style={{ fontSize: 11, color: ACCENT.green }}>{totalText}</span>
    </div>
  );
}

export function CrmExplorerPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const stages = new Map<string, { count: number; total: number }>();
  for (const deal of state.deals) {
    const key = typeof deal.Stage === "string" && deal.Stage ? deal.Stage : "No stage";
    const entry = stages.get(key) ?? { count: 0, total: 0 };
    entry.count += 1;
    const amount = Number(deal.Amount);
    if (Number.isFinite(amount)) entry.total += amount;
    stages.set(key, entry);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 12 }}>
      <SectionLabel>Views</SectionLabel>
      <NavRow label="Pipeline" live={String(state.deals.length)} active={state.view === "pipeline"} onClick={() => setView("pipeline")} />
      <NavRow label="Leads" live={String(state.leads.length)} active={state.view === "leads"} onClick={() => setView("leads")} />
      <NavRow label="Connections" live="" active={state.view === "connections"} onClick={() => setView("connections")} />

      {stages.size > 0 && (
        <>
          <SectionLabel>Stages</SectionLabel>
          {[...stages.entries()].map(([stage, info]) => (
            <StageRow key={stage} stage={stage} count={info.count} total={info.total} />
          ))}
        </>
      )}

      {state.deals.length === 0 && !state.dealsLoading && (
        <div style={{ padding: "8px 12px", fontSize: 11.5, color: TEXT.faint, lineHeight: 1.5 }}>
          No deals loaded from Zoho yet.
        </div>
      )}
    </div>
  );
}

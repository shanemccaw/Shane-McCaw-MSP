/**
 * The Marketing screen's Explorer panel.
 *
 * Per-screen contextual content, not a global tree — SHELL.md is explicit
 * that the left panel is never navigation. Two real sub-views (campaigns,
 * traffic & results — see `marketingTypes.ts`'s doc comment for why articles/
 * hero headlines/email templates are not here), so the top band is the
 * sub-view switcher and beneath it is the real campaign list.
 */

import { useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { BarChart3, Megaphone } from "lucide-react";
import { FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import { campaignAssets, copyCampaignNumbers, getSnapshot, selectCampaign, setCampaignStatus, setTab, subscribe, type MarketingState, type MarketingTab } from "./marketingStore";
import { CAMPAIGN_STATUS_TRANSITIONS, CAMPAIGN_STATUS_TONE, type CampaignListRow } from "./marketingTypes";

const SECTIONS: Array<{ tab: MarketingTab; label: string; icon: typeof Megaphone }> = [
  { tab: "campaigns", label: "Campaigns", icon: Megaphone },
  { tab: "analytics", label: "Traffic & results", icon: BarChart3 },
];

function SectionRow({ tab, label, icon: Icon, on, count }: { tab: MarketingTab; label: string; icon: typeof Megaphone; on: boolean; count: number | null }) {
  return (
    <button
      onClick={() => setTab(tab)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        height: 26,
        padding: "0 8px 0 10px",
        border: 0,
        borderLeft: `2px solid ${on ? TEXT.quiet : "transparent"}`,
        background: on ? WASH.hover : "transparent",
        color: on ? TEXT.bright : TEXT.softer,
        fontFamily: "inherit",
        fontSize: 12.5,
        fontWeight: on ? 700 : 400,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <Icon size={13} color={on ? TEXT.quiet : TEXT.label} style={{ flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {count !== null && <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.dim }}>{count}</span>}
    </button>
  );
}

function Row({
  on,
  tone,
  name,
  sub,
  onSelect,
  onContextMenu,
}: {
  on: boolean;
  tone?: string;
  name: string;
  sub?: string;
  onSelect: () => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
}) {
  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        width: "100%",
        minHeight: 30,
        padding: "3px 8px 3px 20px",
        border: 0,
        borderLeft: `2px solid ${on ? TEXT.quiet : "transparent"}`,
        background: on ? WASH.hover : "transparent",
        color: on ? TEXT.bright : TEXT.softer,
        fontFamily: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {tone && <span style={{ flex: "none", width: 6, height: 6, borderRadius: 3, background: tone }} />}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {sub && <span style={{ fontSize: 10.5, color: TEXT.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
      </span>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "8px 12px", fontSize: 11, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

/** Real, non-destructive actions only — Delete stays behind the peek's arm-then-confirm gate (`index.tsx`'s `campaign` peek), never duplicated here. */
function campaignRowMenuItems(c: CampaignListRow, openIt: () => void) {
  const transitions = CAMPAIGN_STATUS_TRANSITIONS[c.status];
  return [
    { label: "Open", onSelect: openIt },
    ...transitions.map((t) => ({ label: t.label, onSelect: () => void setCampaignStatus(c.id, t.to) })),
    { label: "Copy the numbers", onSelect: () => copyCampaignNumbers(c.id) },
  ];
}

function CampaignRows({ state, onContextMenu }: { state: MarketingState; onContextMenu: (event: ReactMouseEvent, c: CampaignListRow) => void }) {
  if (state.campaignsLoading && state.campaigns.length === 0) return <Empty>Reading campaigns…</Empty>;
  if (state.campaigns.length === 0) return <Empty>{state.campaignsError ?? "No campaigns yet."}</Empty>;
  return (
    <>
      {state.campaigns.map((c) => (
        <Row
          key={c.id}
          on={state.selectedCampaignId === c.id}
          tone={CAMPAIGN_STATUS_TONE[c.status]}
          name={c.name}
          sub={`${c.status} · ${campaignAssets(c.id).length || "0"} assets`}
          onSelect={() => {
            selectCampaign(c.id);
            getShellApi()?.openDoc({ kind: "campaign", id: String(c.id), screenId: "marketing" });
          }}
          onContextMenu={(event) => onContextMenu(event, c)}
        />
      ))}
    </>
  );
}

export function MarketingExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const { menu, open, close } = useContextMenu();

  return (
    <div style={{ padding: "6px 0 12px" }}>
      {SECTIONS.map((s) => (
        <SectionRow key={s.tab} tab={s.tab} label={s.label} icon={s.icon} on={state.tab === s.tab} count={s.tab === "campaigns" ? state.campaigns.length || null : null} />
      ))}
      <div style={{ margin: "6px 0", borderTop: `1px solid ${LINE.subtle}` }} />
      {state.tab === "campaigns" && (
        <CampaignRows
          state={state}
          onContextMenu={(event, c) =>
            open(
              event,
              campaignRowMenuItems(c, () => {
                selectCampaign(c.id);
                getShellApi()?.openDoc({ kind: "campaign", id: String(c.id), screenId: "marketing" });
              }),
              `Actions for ${c.name}`,
            )
          }
        />
      )}
      {state.tab === "analytics" && <Empty>Real visitors, pages, sources and the conversion funnel — nothing to pick here.</Empty>}
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

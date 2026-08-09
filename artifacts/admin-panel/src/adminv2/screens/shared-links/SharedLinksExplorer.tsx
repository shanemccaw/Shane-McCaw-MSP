/**
 * The link browser — this screen's Explorer panel. Same shape as
 * `ServiceExplorer.tsx`/`FulfillmentExplorer.tsx`: a filter box, status
 * chips, a sort control, grouped rows. Grouped by status (Active/Expired)
 * rather than a category — "is this link still working" is the one thing
 * worth scanning a share list for.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  copyShareLink,
  extendShareAction,
  getSnapshot,
  revokeShareAction,
  setSearch,
  setSort,
  setStatusFilter,
  subscribe,
  visibleShares,
  type SharedLinksState,
  type SortField,
  type StatusFilter,
} from "./sharedLinksStore";
import { clientLabel, formatDate, isExpired, isHighEngagement, isOpenable, relativeExpiry, shareUrl, type Share } from "./sharedLinksTypes";

export function SharedLinksExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return <SharedLinksExplorerView state={state} />;
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  expired: "Expired",
  "never-opened": "Never opened",
};

const SORT_LABEL: Record<SortField, string> = {
  views: "Views",
  expires: "Expiring",
  client: "Client",
};

export function SharedLinksExplorerView({ state }: { state: SharedLinksState }) {
  const visible = visibleShares(state);
  const active = visible.filter((s) => !isExpired(s));
  const expired = visible.filter(isExpired);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", borderBottom: `1px solid ${LINE.subtle}`, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          value={state.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, email, company…"
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
          {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((f) => (
            <Chip key={f} on={state.statusFilter === f} onClick={() => setStatusFilter(f)}>
              {STATUS_LABEL[f]}
            </Chip>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: TEXT.faint }}>Sort</span>
          {(Object.keys(SORT_LABEL) as SortField[]).map((f) => (
            <Chip key={f} on={state.sortField === f} onClick={() => setSort(f)}>
              {SORT_LABEL[f]}
              {state.sortField === f ? (state.sortDir === "asc" ? " ↑" : " ↓") : ""}
            </Chip>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0 12px" }}>
        {state.loading && state.shares.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.meta }}>Reading shared links…</div>}
        {state.error && <div style={{ padding: "10px 12px", fontSize: 12, color: ACCENT.danger, lineHeight: 1.5 }}>{state.error}</div>}
        {!state.loading && !state.error && visible.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: 12, color: TEXT.faint, lineHeight: 1.5 }}>
            {state.shares.length === 0 ? "No clients have shared a result or document yet." : "Nothing matches that filter."}
          </div>
        )}

        {active.length > 0 && (
          <div>
            <span style={{ display: "block", padding: "7px 13px 4px", fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
              Active · {active.length}
            </span>
            {active.map((s) => (
              <Row key={s.id} share={s} state={state} />
            ))}
          </div>
        )}
        {expired.length > 0 && (
          <div>
            <span style={{ display: "block", padding: "7px 13px 4px", fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
              Expired · {expired.length}
            </span>
            {expired.map((s) => (
              <Row key={s.id} share={s} state={state} />
            ))}
          </div>
        )}
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

function Row({ share, state }: { share: Share; state: SharedLinksState }) {
  const on = state.openId === String(share.id);
  const expired = isExpired(share);
  const hot = isHighEngagement(share);
  const border = on ? ACCENT.info : hot ? ACCENT.amber : "transparent";
  const { menu, open, close } = useContextMenu();
  const openRecord = () => getShellApi()?.openDoc({ kind: "share", id: String(share.id), screenId: "shared-links" });

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={openRecord}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openRecord();
          }
        }}
        onContextMenu={(e) =>
          open(
            e,
            [
              { label: "Open", onSelect: openRecord },
              // No public viewer exists for a quick_win_scores link — never offer to copy a dead URL.
              { label: "Copy link", onSelect: () => copyShareLink(shareUrl(share)), disabled: !isOpenable(share) },
              {
                label: expired ? "Extend 14 days (revives it)" : "Extend 14 days",
                onSelect: () => void extendShareAction(share.id),
              },
              ...(!expired
                ? [{ label: "Revoke now", onSelect: () => void revokeShareAction(share.id), danger: true }]
                : []),
            ],
            `Actions for ${clientLabel(share.client)}`,
          )
        }
        style={{
          display: "block",
          padding: "7px 13px",
          cursor: "pointer",
          borderLeft: `2px solid ${border}`,
          background: on ? WASH.hoverSoft : state.savingIds.has(share.id) ? WASH.hoverFaint : "transparent",
          opacity: expired ? 0.6 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>
            {clientLabel(share.client)}
          </span>
          <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: hot ? ACCENT.amber : TEXT.softer }}>
            {share.viewCount} view{share.viewCount === 1 ? "" : "s"}
          </span>
        </div>
        <span style={{ display: "block", marginTop: 3, fontSize: 11, color: expired ? TEXT.faint : hot ? ACCENT.amber : TEXT.faint }}>
          {expired ? `Expired ${formatDate(share.expiresAt)}` : `Expires in ${relativeExpiry(share.expiresAt)}`}
          {hot ? " · high engagement" : ""}
        </span>
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

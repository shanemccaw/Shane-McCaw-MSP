/**
 * Shared Links — client-facing, token-based links to a diagnostic scores
 * snapshot or a generated document (`quick_win_result_shares`, reached
 * through `admin-quick-win.ts`). Rebuilds the existing (non-adminv2)
 * `pages/crm/DiagnosticShares.tsx` inside `SHELL.md`'s `registerScreen`
 * contract, keeping its validated filter/sort logic (`sharedLinksStore.ts`'s
 * `visibleShares`) and adding the two admin mutations that page never had —
 * extend and revoke, both new routes on the same table, not a schema change
 * (see `admin-quick-win.ts`'s route doc comments).
 *
 * The client creates these from the portal, not the admin — there is no
 * "New link" anywhere here, on the fixed tab or otherwise, because no route
 * lets an operator mint one. `SHELL.md` section 1's audit ("Endpoints,
 * Money, SQL, Documents, Services and Marketing all had per-record actions
 * on their fixed tabs and were stripped") is why Extend/Revoke live only on
 * the contextual tab, the peek, and the record body — never Home or Watch.
 */

import { AlertTriangle, Ban, CalendarClock, Copy, Link2, Search } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GalleryRow } from "../../registry/types";
import { SharedLinksBody } from "./SharedLinksBody";
import { SharedLinksExplorer } from "./SharedLinksExplorer";
import { SharedLinksProperties } from "./SharedLinksProperties";
import {
  copyShareLink,
  expiringSoon,
  extendShareAction,
  getSnapshot,
  revokeShareAction,
  RIBBON_KEYS,
  refreshShares,
  selectShare,
  shareById,
  totalViews,
} from "./sharedLinksStore";
import { clientLabel, formatDate, isExpired, isHighEngagement, isOpenable, relativeExpiry, scoreEntries, shareUrl, whatIsShared } from "./sharedLinksTypes";

const AREA = "shared-links";
const ROUTE = "/shared-links";

function go() {
  return () => getShellApi()?.navigate(ROUTE);
}

function openSharePeek(id: number) {
  return () => getShellApi()?.openPeek("share", String(id));
}

/** `SHELL.md` section 5: "Rows carry real data, not labels" — tile is the view count, detail is who it's with and when it expires. */
function shareRows(): GalleryRow[] {
  const state = getSnapshot();
  return state.shares.map((s) => ({
    id: String(s.id),
    group: isExpired(s) ? "Expired" : isHighEngagement(s) ? "High engagement" : "Active",
    tile: String(s.viewCount),
    name: clientLabel(s.client),
    head: whatIsShared(s),
    sub: isExpired(s) ? `Expired ${formatDate(s.expiresAt)}` : `Expires in ${relativeExpiry(s.expiresAt)}`,
    on: state.openId === String(s.id),
    onSelect: openSharePeek(s.id),
  }));
}

function expiringRows(): GalleryRow[] {
  return expiringSoon().map((s) => ({
    id: String(s.id),
    tile: String(s.viewCount),
    name: clientLabel(s.client),
    head: whatIsShared(s),
    sub: `Expires in ${relativeExpiry(s.expiresAt)}`,
    onSelect: openSharePeek(s.id),
  }));
}

registerScreen({
  id: "shared-links",
  title: "Shared Links",
  area: AREA,
  icon: Link2,
  route: ROUTE,

  render: (ctx) => {
    // Mirrors `screens/services/index.tsx`'s adoption of `ctx.recordId` —
    // opening a link from a peek, the palette or a gallery row routes here
    // with the share id as `recordId`; adopting it into the store is what
    // lets `SharedLinksProperties`/`SharedLinksBody` (no ctx of their own)
    // know which record is open.
    selectShare(ctx.recordId ?? null);
    return <SharedLinksBody />;
  },

  ribbon: [
    {
      tab: "content",
      order: 40,
      group: {
        label: "Shared links",
        large: [
          {
            label: "All shared links",
            icon: Link2,
            intent: "open",
            liveKey: RIBBON_KEYS.total,
            onSelect: go(),
            gallery: {
              id: "shared-links-all",
              title: "Shared links",
              searchable: true,
              searchPlaceholder: "Type a client name or company",
              rows: shareRows(),
            },
            title: "Clients create these. A link getting passed around inside a company is the signal.",
          },
        ],
        small: [
          {
            label: "Expiring soon",
            icon: CalendarClock,
            intent: "open",
            onSelect: go(),
            gallery: {
              id: "shared-links-expiring",
              title: "Expiring soon",
              rows: expiringRows(),
            },
          },
          { label: "Reload", icon: Search, intent: "global", onSelect: () => void refreshShares(), title: "Re-read every shared link" },
        ],
      },
    },
    {
      tab: "watch",
      order: 70,
      group: {
        label: "Shared links",
        large: [
          {
            label: "Expiring soon",
            icon: AlertTriangle,
            intent: "open",
            color: ACCENT.amber,
            liveKey: RIBBON_KEYS.expiringWatch,
            onSelect: go(),
            gallery: {
              id: "shared-links-watch-expiring",
              title: "Expiring soon",
              rows: expiringRows(),
            },
            title: "Active links a client opened that will stop working soon — worth a nudge before they go dark",
          },
        ],
      },
    },
  ],

  /**
   * Share Tools. The Back group is spliced in at position 2 by the shell —
   * do not add one here (`SHELL.md` section 2). No `confirm`-armed action
   * lives here on purpose (`RibbonCommand` has none) — Revoke is reversible
   * via Extend, unlike a real delete, so a plain click is honest; anything
   * that genuinely destroys data would belong in the peek instead.
   */
  contextualTab: (ctx) => {
    if (ctx.kind !== "share" || !ctx.recordId) return null;
    const id = Number(ctx.recordId);
    const share = shareById(id);
    if (!share) return null;
    const expired = isExpired(share);

    return {
      id: "share-tools",
      label: "Share Tools",
      groups: [
        {
          label: "This link",
          large: [
            {
              label: "Extend 14 days",
              icon: CalendarClock,
              intent: "record",
              color: ACCENT.greenBright,
              onSelect: () => void extendShareAction(id),
              title: expired ? "Gives it a fresh 14-day window, starting today" : "Adds 14 days to what's left",
            },
          ],
          small: [
            ...(!expired
              ? [{ label: "Revoke now", icon: Ban, intent: "record" as const, color: ACCENT.danger, onSelect: () => void revokeShareAction(id) }]
              : []),
            { label: "Copy link", icon: Copy, intent: "record" as const, onSelect: () => copyShareLink(shareUrl(share)), disabled: !isOpenable(share) },
          ],
        },
      ],
    };
  },

  peeks: {
    share: (id) => {
      const state = getSnapshot();
      const share = shareById(id, state);
      if (!share) return null;

      const expired = isExpired(share);
      const saving = state.savingIds.has(share.id);

      return {
        kind: "share",
        eyebrow: "SHARED LINK",
        title: clientLabel(share.client),
        sub: whatIsShared(share),
        icon: Link2,
        tone: expired ? undefined : isHighEngagement(share) ? ACCENT.amber : ACCENT.info,
        tag: expired ? "Expired" : isHighEngagement(share) ? "High engagement" : "Active",
        tagTone: expired ? undefined : isHighEngagement(share) ? ACCENT.amber : ACCENT.info,
        note: saving ? "Working…" : undefined,
        facts: [
          { label: "Views", value: String(share.viewCount), color: share.viewCount >= 3 ? ACCENT.amber : undefined },
          { label: "Shared", value: formatDate(share.createdAt) },
          {
            label: "Expires",
            value: expired ? `Expired ${formatDate(share.expiresAt)}` : `${formatDate(share.expiresAt)} (${relativeExpiry(share.expiresAt)})`,
            color: expired ? ACCENT.danger : undefined,
            prose: true,
          },
        ],
        body:
          share.shareKind === "quick_win_scores" && scoreEntries(share).length > 0
            ? { title: "Scores snapshot", content: JSON.stringify(share.scoresSnapshot, null, 2) }
            : undefined,
        open: () => getShellApi()?.openDoc({ kind: "share", id: String(share.id), screenId: "shared-links" }),
        openLabel: "Open it properly",
        actions: [
          { label: "Copy link", onSelect: () => copyShareLink(shareUrl(share)) },
          { label: "Extend 14 days", tone: "primary", onSelect: () => void extendShareAction(share.id) },
          ...(!expired ? [{ label: "Revoke now", tone: "danger" as const, onSelect: () => void revokeShareAction(share.id) }] : []),
        ],
      };
    },
  },

  commands: (): CommandItem[] => {
    const state = getSnapshot();

    const records: CommandItem[] = state.shares.map((s) => ({
      id: `rec:share-${s.id}`,
      type: "record",
      kind: "share",
      name: clientLabel(s.client),
      sub: `${whatIsShared(s)} · ${s.viewCount} view${s.viewCount === 1 ? "" : "s"}`,
      tag: isExpired(s) ? "expired" : isHighEngagement(s) ? "hot" : undefined,
      area: AREA,
      run: openSharePeek(s.id),
    }));

    const soon = expiringSoon(state);

    const answers: CommandItem[] = [
      {
        id: "ans:shared-links-total",
        type: "answer",
        name: "Shared links",
        sub: "Total, all time",
        area: AREA,
        live: String(state.shares.length),
        run: go(),
      },
      {
        id: "ans:shared-links-expiring",
        type: "answer",
        name: "Shared links expiring soon",
        sub: "Active, expiring within 3 days",
        area: AREA,
        live: String(soon.length),
        run: go(),
      },
      {
        id: "ans:shared-links-views",
        type: "answer",
        name: "Shared link views",
        sub: "Summed across every link",
        area: AREA,
        live: String(totalViews(state)),
        run: go(),
      },
    ];

    const actions: CommandItem[] = [
      { id: "act:shared-links-reload", type: "action", kind: "run", name: "Reload shared links", sub: "Re-reads every link from the database", area: AREA, run: () => void refreshShares() },
    ];

    return [...records, ...answers, ...actions];
  },

  left: { title: "Shared Links", render: () => <SharedLinksExplorer /> },
  right: { title: "Properties", render: () => <SharedLinksProperties /> },
});

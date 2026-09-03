import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bell, BellOff, Settings, ChevronRight } from "lucide-react";
import { useNotifications } from "./useNotifications";
import { iconForCategory, SEVERITY_COLOR, dayGroupFor, formatNotificationTime, type NotificationDayGroup } from "./notificationDisplay";
import type { PortalNotification } from "./types";

const HAIRLINE = "rgba(255,255,255,.10)";
const HAIRLINE_SOFT = "rgba(255,255,255,.08)";

type Tab = "personal" | "all";

/** Order groups TODAY before EARLIER, matching the design's own grouping. */
const GROUP_ORDER: readonly NotificationDayGroup[] = ["TODAY", "EARLIER"];

function groupRows(rows: readonly PortalNotification[]): { label: NotificationDayGroup; rows: PortalNotification[] }[] {
  const byGroup = new Map<NotificationDayGroup, PortalNotification[]>();
  for (const row of rows) {
    const g = dayGroupFor(row.createdAt);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(row);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ label: g, rows: byGroup.get(g)! }));
}

function NotificationRow({ n, onOpen }: { n: PortalNotification; onOpen: (n: PortalNotification) => void }) {
  const Icon = iconForCategory(n.category);
  const color = SEVERITY_COLOR[n.severity];
  const linked = n.linkPath !== null;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`alert-row-${n.id}`}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(n);
        }
      }}
      className="mb-[2px] flex cursor-pointer gap-[10px] rounded-lg px-[10px] py-[9px] pl-3 transition-colors hover:bg-white/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
      style={{ borderLeft: `2px solid ${color}`, background: n.read ? "transparent" : "rgba(255,255,255,.03)" }}
    >
      <Icon size={16} strokeWidth={1.75} color="#94a3b8" className="mt-px flex-none" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[13px]"
            style={{ fontWeight: n.read ? 400 : 600, color: n.read ? "#cbd5e1" : "#f8fafc" }}
          >
            {n.title}
          </span>
          <span className="ml-auto flex-none text-[10.5px] text-[#475569]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatNotificationTime(n.createdAt)}
          </span>
        </div>
        {n.body ? <span className="text-xs leading-[1.45] text-[#94a3b8]">{n.body}</span> : null}
        <div className="flex items-center gap-[7px]">
          {n.category ? (
            <span
              className="rounded-full text-[10px] text-[#64748b]"
              style={{ border: "1px solid rgba(148,163,184,.25)", padding: "1.5px 8px" }}
            >
              {n.category}
            </span>
          ) : null}
          {!n.read ? <span className="size-[6px] flex-none rounded-full" style={{ background: "#00B4D8" }} /> : null}
          {linked ? <ChevronRight size={12} color="#334155" className="ml-auto flex-none" aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Portal Shell: alerts dropdown (#1821). Real backend —
 * `artifacts/api-server/src/routes/notifications.ts`'s `/portal/notifications*`
 * routes, live via `/portal/notifications/stream` SSE — see `useNotifications.ts`
 * for the full endpoint map and `docs/alert_preferences.md` for the
 * preferences surface this links out to (built under a separate issue; this
 * component only links there, per this issue's own scope).
 *
 * Zero-unread renders as "Up to date", not an error — and a customer with no
 * notifications at all yet gets the calm empty state below, never a blank
 * hole (design README "Popovers" — Alerts, empty state).
 *
 * `open`/`onToggle`/`onClose` are controlled by `TopBar`'s shared
 * `openPopover` state (README "State" §`openPopover`) — the same mutual
 * exclusivity + shared full-viewport overlay #1820's `UserMenu` and #1822's
 * `SopTray` already share, so alerts, SOP and account never show open at
 * once. Unlike those two, the trigger button lives inside this component
 * rather than inline in `TopBar` (its badge needs the real unread count this
 * component's own `useNotifications()` call owns).
 */
export function AlertsDropdown({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("personal");
  const rootRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const { unreadCount, live, personal, activity, loadPersonal, loadActivity, markRead, markAllRead } =
    useNotifications();

  // Personal feed backs both the "Personal" tab and the empty-vs-full gate
  // for the whole popover, so it loads as soon as the popover opens
  // regardless of which tab is selected.
  useEffect(() => {
    if (!open) return;
    if (!personal.loaded && !personal.loading) void loadPersonal();
  }, [open, personal.loaded, personal.loading, loadPersonal]);

  useEffect(() => {
    if (!open || tab !== "all") return;
    if (!activity.loaded && !activity.loading) void loadActivity();
  }, [open, tab, activity.loaded, activity.loading, loadActivity]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const openNotification = (n: PortalNotification) => {
    if (!n.read) void markRead(n.id);
    if (n.linkPath !== null) {
      navigate(n.deepLink.href);
      onClose();
    }
  };

  const hasEverHadAny = personal.loaded && personal.items.length > 0;
  const showEmptyState = personal.loaded && !hasEverHadAny;
  const activeFeed = tab === "personal" ? personal : activity;
  const groups = groupRows(activeFeed.items);
  const anyUnread = (unreadCount ?? 0) > 0;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-testid="topbar-alerts-trigger"
        aria-label={anyUnread ? `Alerts, ${unreadCount} unread` : "Alerts"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
        className="relative z-50 flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
        style={{ background: open ? "rgba(255,255,255,.06)" : undefined }}
      >
        <Bell size={17} strokeWidth={1.75} color="#94a3b8" />
        {anyUnread ? (
          <span
            className="absolute right-[3px] top-[3px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px] text-[9px] font-bold text-white"
            style={{ background: "#0078D4", fontVariantNumeric: "tabular-nums" }}
          >
            {unreadCount! > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div
            data-testid="alerts-popover"
            className="absolute right-0 z-50 flex flex-col overflow-hidden rounded-[14px]"
            style={{
              top: "calc(100% + 8px)",
              width: 404,
              maxHeight: 620,
              background: "rgba(11,17,32,.98)",
              border: `1px solid ${HAIRLINE}`,
              boxShadow: "0 18px 48px rgba(0,0,0,.55)",
            }}
          >
            {showEmptyState ? (
              <>
                <div
                  className="flex flex-none items-center gap-2 px-[14px] pb-[11px] pt-[13px]"
                  style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}` }}
                >
                  <span className="text-[13.5px] font-semibold text-[#f8fafc]">Alerts</span>
                  <span className="ml-auto text-[11px] text-[#64748b]">Up to date</span>
                </div>
                <div className="flex flex-col items-center gap-[10px] px-6 pb-[26px] pt-[30px] text-center">
                  <div
                    className="flex size-10 items-center justify-center rounded-[11px]"
                    style={{ background: "rgba(255,255,255,.04)", border: `1px solid ${HAIRLINE_SOFT}` }}
                  >
                    <BellOff size={18} strokeWidth={1.75} color="#475569" />
                  </div>
                  <span className="text-[13px] font-semibold text-[#cbd5e1]">Nothing needs your attention</span>
                  <span className="max-w-[250px] text-xs leading-[1.5] text-[#64748b]">
                    Alerts land here when a scan, drift, or your MSP&rsquo;s work triggers one of your conditions.
                  </span>
                </div>
              </>
            ) : !personal.loaded ? (
              <div className="flex items-center justify-center px-[14px] py-10 text-xs text-[#64748b]">Loading…</div>
            ) : (
              <>
                <div
                  className="flex flex-none items-center gap-2 px-[14px] pb-[11px] pt-[13px]"
                  style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}` }}
                >
                  <span className="text-[13.5px] font-semibold text-[#f8fafc]">Alerts</span>
                  {live ? (
                    <span className="flex items-center gap-[5px] text-[10px] font-semibold text-[#64748b]" style={{ letterSpacing: ".05em" }}>
                      <span className="size-[6px] animate-pulse rounded-full" style={{ background: "#00B4D8" }} />
                      LIVE
                    </span>
                  ) : null}
                  {anyUnread ? (
                    <span
                      className="rounded-full text-[10px] font-semibold text-[#00B4D8]"
                      style={{ border: "1px solid rgba(0,180,216,.45)", padding: "2px 8px" }}
                    >
                      {unreadCount} unread
                    </span>
                  ) : null}
                  {anyUnread ? (
                    <button
                      type="button"
                      data-testid="alerts-mark-all-read"
                      onClick={() => void markAllRead()}
                      className="ml-auto text-[11px] font-semibold text-[#60a5fa]"
                    >
                      Mark all read
                    </button>
                  ) : (
                    <span className="ml-auto text-[11px] text-[#64748b]">Up to date</span>
                  )}
                </div>
                <div className="flex flex-none gap-1 px-[10px] py-2" style={{ borderBottom: `1px solid ${HAIRLINE_SOFT}` }}>
                  {(
                    [
                      ["personal", "Personal"],
                      ["all", "All activity"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      data-testid={`alerts-tab-${key}`}
                      onClick={() => setTab(key)}
                      className="rounded-full px-3 py-1 text-[11.5px] font-semibold"
                      style={{
                        color: tab === key ? "#f8fafc" : "#94a3b8",
                        background: tab === key ? "rgba(255,255,255,.06)" : "transparent",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 overflow-y-auto p-[6px]">
                  {activeFeed.loading && !activeFeed.loaded ? (
                    <div className="flex items-center justify-center py-8 text-xs text-[#64748b]">Loading…</div>
                  ) : groups.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-xs text-[#64748b]">
                      Nothing in {tab === "personal" ? "Personal" : "All activity"} yet.
                    </div>
                  ) : (
                    groups.map((g) => (
                      <div key={g.label} className="flex flex-col">
                        <span
                          className="px-3 pb-[5px] pt-[9px] text-[9.5px] font-bold text-[#475569]"
                          style={{ letterSpacing: ".14em" }}
                        >
                          {g.label}
                        </span>
                        {g.rows.map((n) => (
                          <NotificationRow key={n.id} n={n} onOpen={openNotification} />
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            <div
              className="flex flex-none items-center px-[14px] py-[10px]"
              style={{ borderTop: `1px solid ${HAIRLINE_SOFT}` }}
            >
              {!showEmptyState ? (
                <button
                  type="button"
                  data-testid="alerts-open-activity-feed"
                  onClick={() => setTab("all")}
                  className="text-xs text-[#94a3b8] hover:text-[#cbd5e1]"
                >
                  Open activity feed
                </button>
              ) : null}
              <button
                type="button"
                data-testid="alerts-preferences-link"
                onClick={() => {
                  onClose();
                  navigate("/coming-soon?feature=" + encodeURIComponent("Alert preferences"));
                }}
                className="ml-auto flex items-center gap-[6px] text-xs text-[#94a3b8] hover:text-[#cbd5e1]"
              >
                <Settings size={13} strokeWidth={1.75} color="#64748b" aria-hidden="true" />
                Alert preferences
                <ChevronRight size={13} color="#475569" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

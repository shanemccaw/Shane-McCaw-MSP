/**
 * PortalNotifications — Client Portal activity feed / notification history.
 * Shows the customer's own notifications in plain-language, chronological order.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalNotification {
  id: number;
  title: string;
  body?: string | null;
  category?: string | null;
  severity?: string | null;
  linkPath?: string | null;
  feedType: string;
  read: boolean;
  createdAt: string;
}

// ── Category colors ───────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  fulfillment: "#3b82f6",
  payment:     "#22c55e",
  security:    "#ef4444",
  ai:          "#a855f7",
  sow:         "#6366f1",
  signal:      "#f59e0b",
  message:     "#14b8a6",
  system:      "#6b7280",
  lead:        "#06b6d4",
  dunning:     "#f97316",
  consent:     "#ef4444",
  automation:  "#eab308",
  project:     "#3b82f6",
  onboarding:  "#22c55e",
};
const DEFAULT_COLOR = "#0078D4";

// ── Time formatting ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function groupByDate(entries: PortalNotification[]): [string, PortalNotification[]][] {
  const groups = new Map<string, PortalNotification[]>();
  for (const e of entries) {
    const key = formatDate(e.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.entries()];
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortalNotifications() {
  const { fetchWithAuth } = useAuth();
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const oldestRef = useRef<string | undefined>(undefined);

  const fetchNotifications = useCallback(async (reset = false) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const beforeParam = !reset && oldestRef.current ? `&before=${oldestRef.current}` : "";
      const [res, countRes] = await Promise.all([
        fetchWithAuth(`/api/portal/notifications?limit=40${beforeParam}`),
        reset ? fetchWithAuth("/api/portal/notifications/unread-count") : Promise.resolve(null),
      ]);
      if (res.ok) {
        const data = (await res.json()) as PortalNotification[];
        if (reset) setNotifications(data); else setNotifications(prev => [...prev, ...data]);
        if (data.length > 0) oldestRef.current = data[data.length - 1]?.createdAt;
        setHasMore(data.length === 40);
      }
      if (countRes?.ok) {
        const { unreadCount: cnt } = (await countRes.json()) as { unreadCount: number };
        setUnreadCount(cnt);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchNotifications(true); }, [fetchNotifications]);

  const markAllRead = async () => {
    await fetchWithAuth("/api/portal/notifications/read-all", { method: "POST" });
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const markRead = async (id: number) => {
    await fetchWithAuth(`/api/portal/notifications/${id}/read`, { method: "PATCH" });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(n => Math.max(0, n - 1));
  };

  const groups = groupByDate(notifications);

  return (
    <PortalLayout unreadNotifications={unreadCount}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#0A2540]">Notifications</h1>
            <p className="text-sm text-gray-500 mt-0.5">Your recent account activity and updates</p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-sm font-medium text-[#0078D4] hover:underline"
            >
              Mark all read ({unreadCount})
            </button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <svg className="w-12 h-12 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-sm">You're all caught up!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(([date, items]) => (
              <section key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{date}</p>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="space-y-2">
                  {items.map(n => {
                    const color = (n.category && CAT_COLORS[n.category]) || DEFAULT_COLOR;
                    const card = (
                      <div
                        key={n.id}
                        className={`flex gap-3.5 p-4 rounded-xl border transition-all group cursor-pointer ${!n.read ? "bg-[#0078D4]/[0.03] border-[#0078D4]/20 hover:border-[#0078D4]/30" : "bg-white border-gray-100 hover:border-gray-200"}`}
                        onClick={() => !n.read && void markRead(n.id)}
                      >
                        {/* Color accent */}
                        <div
                          className="flex-shrink-0 w-1 self-stretch rounded-full"
                          style={{ backgroundColor: n.read ? "transparent" : color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm leading-snug ${!n.read ? "font-semibold text-[#0A2540]" : "text-gray-700"}`}>
                              {n.title}
                            </p>
                            <span className="text-[11px] text-gray-400 flex-shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                          </div>
                          {n.body && (
                            <p className="text-sm text-gray-500 mt-1 leading-relaxed">{n.body}</p>
                          )}
                          {n.severity && n.severity !== "info" && (
                            <span className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${n.severity === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>
                              {n.severity}
                            </span>
                          )}
                          {n.linkPath && (
                            <a
                              href={n.linkPath}
                              className="inline-block mt-2 text-xs font-medium text-[#0078D4] hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              View details →
                            </a>
                          )}
                        </div>
                      </div>
                    );
                    return <div key={n.id}>{card}</div>;
                  })}
                </div>
              </section>
            ))}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  disabled={loadingMore}
                  onClick={() => void fetchNotifications(false)}
                  className="text-sm font-medium text-[#0078D4] hover:underline disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

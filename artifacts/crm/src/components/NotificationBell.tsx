/**
 * NotificationBell — CRM (Client) Portal header notification bell.
 * SSE-driven live updates, unread badge, category-icon mapping, deep-links.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

// ── Category icon SVGs ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
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

function getCategoryColor(category?: string | null): string {
  return (category && CATEGORY_COLORS[category]) || "#0078D4";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
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

// ── Time formatting ───────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NotificationBell() {
  const { accessToken, fetchWithAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [notifRes, countRes] = await Promise.all([
        fetchWithAuth("/api/portal/notifications?limit=25"),
        fetchWithAuth("/api/portal/notifications/unread-count"),
      ]);
      if (notifRes.ok) setNotifications((await notifRes.json()) as Notification[]);
      if (countRes.ok) {
        const { unreadCount: cnt } = (await countRes.json()) as { unreadCount: number };
        setUnreadCount(cnt);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, fetchWithAuth]);

  useEffect(() => { void fetchNotifications(); }, [fetchNotifications]);

  // ── SSE ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    const url = `/api/portal/notifications/stream?token=${encodeURIComponent(accessToken)}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as { type: string; notification?: Notification; unreadCount?: number };
        if (data.type === "notification" && data.notification) {
          setNotifications(prev => [data.notification!, ...prev].slice(0, 40));
          if (!data.notification!.read) setUnreadCount(n => n + 1);
        } else if (data.type === "unread_count" && data.unreadCount !== undefined) {
          setUnreadCount(data.unreadCount);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [accessToken]);

  // ── Close on outside click ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

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

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => { setOpen(v => !v); if (!open) void fetchNotifications(); }}
        className="relative p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/8 transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 flex flex-col max-h-[440px] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="text-sm font-semibold text-[#0A2540]">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-[#0078D4] hover:underline font-medium px-2"
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-sm text-gray-400">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-20 gap-1.5 text-gray-400">
                <svg className="w-5 h-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-xs">No notifications yet</p>
              </div>
            ) : (
              <ul>
                {notifications.map(n => {
                  const color = getCategoryColor(n.category);
                  const item = (
                    <li
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer ${!n.read ? "bg-blue-50/50" : ""}`}
                      onClick={() => !n.read && void markRead(n.id)}
                    >
                      {/* Color dot */}
                      <div
                        className="flex-shrink-0 w-2 h-2 rounded-full mt-2"
                        style={{ backgroundColor: color, opacity: n.read ? 0.3 : 1 }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs leading-snug ${!n.read ? "font-semibold text-[#0A2540]" : "text-gray-600"}`}>
                            {n.title}
                          </p>
                          <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                        </div>
                        {n.body && (
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        {n.severity && n.severity !== "info" && (
                          <span className={`inline-block mt-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${n.severity === "critical" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>
                            {n.severity}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                  return n.linkPath ? (
                    <Link key={n.id} href={n.linkPath} onClick={() => { setOpen(false); if (!n.read) void markRead(n.id); }}>
                      {item}
                    </Link>
                  ) : item;
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-2.5">
            <Link
              href="/portal/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-[#0078D4] hover:underline font-medium"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * NotificationBell — MSP Portal header notification bell with SSE-driven
 * live updates, unread badge, category-to-icon/color mapping, and deep-links.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Bell, X, CheckCheck, Package, CreditCard, Shield, Cpu, FileText, Activity, MessageCircle, Settings, UserPlus, AlertTriangle, Lock, Zap, Layers, Rocket, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ── Category icon/color map ───────────────────────────────────────────────────
//
// Colors flow through the Portal Foundation Redesign status tokens
// (--color-status-{red,amber,green,blue,violet} in index.css) rather than raw
// Tailwind palette classes, so the bell stays in step with light/dark theme.
// The token set is intentionally small; each legacy hue maps to its nearest
// status token, and truly neutral categories (system) use the muted surface.

const CATEGORY_MAP: Record<string, { Icon: React.ElementType; color: string; bg: string }> = {
  fulfillment: { Icon: Package,        color: "text-status-blue",   bg: "bg-status-blue/15"   },
  payment:     { Icon: CreditCard,     color: "text-status-green",  bg: "bg-status-green/15"  },
  security:    { Icon: Shield,         color: "text-status-red",    bg: "bg-status-red/15"    },
  ai:          { Icon: Cpu,            color: "text-status-violet", bg: "bg-status-violet/15" },
  sow:         { Icon: FileText,       color: "text-status-blue",   bg: "bg-status-blue/15"   },
  signal:      { Icon: Activity,       color: "text-status-amber",  bg: "bg-status-amber/15"  },
  message:     { Icon: MessageCircle,  color: "text-status-blue",   bg: "bg-status-blue/15"   },
  system:      { Icon: Settings,       color: "text-muted-foreground", bg: "bg-muted"         },
  lead:        { Icon: UserPlus,       color: "text-status-blue",   bg: "bg-status-blue/15"   },
  dunning:     { Icon: AlertTriangle,  color: "text-status-amber",  bg: "bg-status-amber/15"  },
  consent:     { Icon: Lock,           color: "text-status-red",    bg: "bg-status-red/15"    },
  automation:  { Icon: Zap,            color: "text-status-amber",  bg: "bg-status-amber/15"  },
  project:     { Icon: Layers,         color: "text-status-blue",   bg: "bg-status-blue/15"   },
  onboarding:  { Icon: Rocket,         color: "text-status-green",  bg: "bg-status-green/15"  },
  offer:       { Icon: Tag,            color: "text-status-violet", bg: "bg-status-violet/15" },
};

const DEFAULT_CATEGORY = { Icon: Bell, color: "text-primary", bg: "bg-primary/15" };

function getCategoryStyle(category?: string | null) {
  return (category && CATEGORY_MAP[category]) || DEFAULT_CATEGORY;
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity?: string | null }) {
  if (!severity || severity === "info") return null;
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${severity === "critical" ? "bg-red-500" : "bg-amber-400"}`}
    />
  );
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
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotificationBell() {
  const { accessToken, fetchWithAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const evtSourceRef = useRef<EventSource | null>(null);

  // ── Fetch initial notifications ──────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [notifRes, countRes] = await Promise.all([
        fetchWithAuth("/api/msp/notifications?limit=30"),
        fetchWithAuth("/api/msp/notifications/unread-count"),
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

  // ── SSE connection for live updates ──────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    const url = `/api/msp/notifications/stream?token=${encodeURIComponent(accessToken)}`;
    const es = new EventSource(url);
    evtSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string) as { type: string; notification?: Notification; unreadCount?: number };
        if (data.type === "notification" && data.notification) {
          setNotifications(prev => [data.notification!, ...prev].slice(0, 50));
          setUnreadCount(n => n + (data.notification!.feedType === "personal" && !data.notification!.read ? 1 : 0));
        } else if (data.type === "unread_count" && data.unreadCount !== undefined) {
          setUnreadCount(data.unreadCount);
        }
      } catch { /* ignore parse errors */ }
    };

    return () => { es.close(); evtSourceRef.current = null; };
  }, [accessToken]);

  // ── Close panel on outside click ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // ── Mark all read ────────────────────────────────────────────────────────
  const markAllRead = async () => {
    await fetchWithAuth("/api/msp/notifications/read-all", { method: "PATCH" });
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  // ── Mark one read ────────────────────────────────────────────────────────
  const markRead = async (id: number) => {
    await fetchWithAuth(`/api/msp/notifications/${id}/read`, { method: "PATCH" });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(n => Math.max(0, n - 1));
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => { setOpen(v => !v); if (!open) void fetchNotifications(); }}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Notifications"
      >
        <Bell className="size-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-background border border-border rounded-xl shadow-xl z-50 flex flex-col max-h-[480px] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] h-4 px-1.5">{unreadCount}</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={markAllRead}>
                  <CheckCheck className="size-3" />
                  Mark all read
                </Button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-1.5 text-muted-foreground">
                <Bell className="size-5 opacity-30" />
                <p className="text-xs">No notifications yet</p>
              </div>
            ) : (
              <ul>
                {notifications.map(n => {
                  const { Icon, color, bg } = getCategoryStyle(n.category);
                  const inner = (
                    <li
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors cursor-pointer ${!n.read ? "bg-primary/[0.03]" : ""}`}
                      onClick={() => !n.read && markRead(n.id)}
                    >
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full ${bg} flex items-center justify-center mt-0.5`}>
                        <Icon className={`size-3.5 ${color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs leading-snug ${!n.read ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                            <SeverityDot severity={n.severity} />
                            {" "}{n.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 mt-0.5">{timeAgo(n.createdAt)}</span>
                        </div>
                        {n.body && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                      </div>
                    </li>
                  );
                  return n.linkPath
                    ? <Link key={n.id} href={n.linkPath} onClick={() => { setOpen(false); if (!n.read) void markRead(n.id); }}>{inner}</Link>
                    : inner;
                })}
              </ul>
            )}
          </div>

          {/* Footer: link to full activity feed */}
          <div className="flex-shrink-0 border-t border-border px-4 py-2.5">
            <Link
              href="/activity"
              onClick={() => setOpen(false)}
              className="text-xs text-primary hover:underline"
            >
              View all activity →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

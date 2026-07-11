/**
 * Activity Feed — full chronological event history for MSP Portal users.
 * MSPAdmin/PlatformAdmin see cross-customer all_activity feed.
 * MSPOperator and below see only their MSP-scoped events.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package, CreditCard, Shield, Cpu, FileText, Activity,
  MessageCircle, Settings, UserPlus, AlertTriangle, Lock,
  Zap, Layers, Rocket, Bell, RefreshCw, ChevronDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeedEntry {
  id: number;
  title: string;
  body?: string | null;
  category?: string | null;
  severity?: string | null;
  linkPath?: string | null;
  feedType: string;
  read: boolean;
  createdAt: string;
  mspId?: number | null;
}

// ── Category icon/color map ───────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, { Icon: React.ElementType; color: string; bg: string; label: string }> = {
  fulfillment: { Icon: Package,       color: "text-blue-400",   bg: "bg-blue-500/15",   label: "Fulfillment" },
  payment:     { Icon: CreditCard,    color: "text-green-400",  bg: "bg-green-500/15",  label: "Payment"     },
  security:    { Icon: Shield,        color: "text-red-400",    bg: "bg-red-500/15",    label: "Security"    },
  ai:          { Icon: Cpu,           color: "text-purple-400", bg: "bg-purple-500/15", label: "AI"          },
  sow:         { Icon: FileText,      color: "text-indigo-400", bg: "bg-indigo-500/15", label: "SOW"         },
  signal:      { Icon: Activity,      color: "text-amber-400",  bg: "bg-amber-500/15",  label: "Signal"      },
  message:     { Icon: MessageCircle, color: "text-teal-400",   bg: "bg-teal-500/15",   label: "Message"     },
  system:      { Icon: Settings,      color: "text-gray-400",   bg: "bg-gray-500/15",   label: "System"      },
  lead:        { Icon: UserPlus,      color: "text-cyan-400",   bg: "bg-cyan-500/15",   label: "Lead"        },
  dunning:     { Icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/15", label: "Dunning"     },
  consent:     { Icon: Lock,          color: "text-red-400",    bg: "bg-red-500/15",    label: "Consent"     },
  automation:  { Icon: Zap,           color: "text-yellow-400", bg: "bg-yellow-500/15", label: "Automation"  },
  project:     { Icon: Layers,        color: "text-blue-400",   bg: "bg-blue-500/15",   label: "Project"     },
  onboarding:  { Icon: Rocket,        color: "text-green-400",  bg: "bg-green-500/15",  label: "Onboarding"  },
};
const DEFAULT_CAT = { Icon: Bell, color: "text-primary", bg: "bg-primary/15", label: "General" };

function getCat(category?: string | null) {
  return (category && CATEGORY_MAP[category]) || DEFAULT_CAT;
}

// ── Time formatting ───────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function groupByDate(entries: FeedEntry[]): [string, FeedEntry[]][] {
  const groups = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const key = formatDate(e.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.entries()];
}

// ── Category filter pill ──────────────────────────────────────────────────────

const ALL_CATEGORIES = Object.entries(CATEGORY_MAP).map(([key, v]) => ({ key, label: v.label }));

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ActivityFeedPage() {
  const { user, fetchWithAuth } = useAuth();
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [feedTypeFilter, setFeedTypeFilter] = useState<"all_activity" | "personal">("all_activity");
  const oldestRef = useRef<string | undefined>(undefined);

  const isAdmin = user?.mspRole === "MSPAdmin" || user?.mspRole === "PlatformAdmin";

  const fetchFeed = useCallback(async (reset = false) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const endpoint = isAdmin
        ? `/api/msp/notifications/activity-feed?limit=50${reset ? "" : `&before=${oldestRef.current ?? ""}`}`
        : `/api/msp/notifications?limit=50`;
      const res = await fetchWithAuth(endpoint);
      if (!res.ok) return;
      const data = (await res.json()) as FeedEntry[];
      const filtered = categoryFilter ? data.filter(e => e.category === categoryFilter) : data;
      if (reset) {
        setEntries(filtered);
      } else {
        setEntries(prev => [...prev, ...filtered]);
      }
      if (data.length > 0) oldestRef.current = data[data.length - 1]?.createdAt;
      setHasMore(data.length === 50);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [fetchWithAuth, isAdmin, categoryFilter]);

  useEffect(() => {
    oldestRef.current = undefined;
    void fetchFeed(true);
  }, [categoryFilter, feedTypeFilter, fetchFeed]);

  const filteredEntries = feedTypeFilter === "all_activity"
    ? entries
    : entries.filter(e => e.feedType === "personal");

  const groups = groupByDate(filteredEntries);

  return (
    <AppShell title="Activity Feed">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Activity Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "Cross-customer chronological event history for your MSP." : "Your recent activity and notifications."}
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {isAdmin && (
            <div className="flex gap-1 bg-muted rounded-lg p-1 flex-shrink-0">
              {(["all_activity", "personal"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFeedTypeFilter(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${feedTypeFilter === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "all_activity" ? "All Activity" : "My Notifications"}
                </button>
              ))}
            </div>
          )}

          {/* Category filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setCategoryFilter(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${!categoryFilter ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              All
            </button>
            {ALL_CATEGORIES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setCategoryFilter(categoryFilter === key ? null : key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${categoryFilter === key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => { oldestRef.current = undefined; void fetchFeed(true); }}
          >
            <RefreshCw className="size-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>

        {/* Feed */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Bell className="size-10 opacity-20" />
            <p className="text-sm">No activity yet</p>
            {categoryFilter && (
              <Button variant="ghost" size="sm" onClick={() => setCategoryFilter(null)}>
                Clear filter
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(([date, items]) => (
              <section key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{date}</p>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-2">
                  {items.map(entry => {
                    const { Icon, color, bg } = getCat(entry.category);
                    const card = (
                      <div
                        key={entry.id}
                        className={`flex gap-3.5 p-4 rounded-xl border border-border hover:border-border/80 hover:bg-muted/30 transition-all group ${!entry.read && entry.feedType === "personal" ? "bg-primary/[0.02]" : "bg-background"}`}
                      >
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full ${bg} flex items-center justify-center mt-0.5`}>
                          <Icon className={`size-4 ${color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-foreground leading-snug">{entry.title}</p>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {entry.severity && entry.severity !== "info" && (
                                <Badge
                                  variant={entry.severity === "critical" ? "destructive" : "secondary"}
                                  className="text-[10px] h-4 px-1.5"
                                >
                                  {entry.severity}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">{formatTime(entry.createdAt)}</span>
                            </div>
                          </div>
                          {entry.body && (
                            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{entry.body}</p>
                          )}
                          {entry.category && (
                            <span className="inline-block mt-2 text-[10px] text-muted-foreground/70 uppercase tracking-wide">
                              {getCat(entry.category).label}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                    return entry.linkPath ? (
                      <a key={entry.id} href={entry.linkPath} className="block">{card}</a>
                    ) : (
                      <div key={entry.id}>{card}</div>
                    );
                  })}
                </div>
              </section>
            ))}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => fetchFeed(false)}
                  className="gap-2"
                >
                  {loadingMore ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

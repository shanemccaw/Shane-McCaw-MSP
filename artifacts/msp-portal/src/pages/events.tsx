/**
 * Events page — signals and events feed scoped to MSP's book of business.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  RefreshCw, Search, Filter, AlertTriangle, 
  Info, Clock, Activity, AlertCircle 
} from "lucide-react";

interface EventItem {
  id: number;
  type: string;
  customerName: string;
  description: string;
  severity: "info" | "warning" | "critical";
  occurredAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  warning: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  critical: "bg-red-500/10 text-red-500 border-red-500/20",
};

const SEVERITY_BG: Record<string, string> = {
  info: "bg-card hover:bg-accent/50",
  warning: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30",
  critical: "bg-red-500/10 hover:bg-red-500/20 border-red-500/30",
};

const SEVERITY_ICONS: Record<string, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (diffInSeconds < 60) return `Just now`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

export default function EventsPage() {
  const { fetchWithAuth } = useAuth();
  const mspSlug = useMspSlug();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      // Increased limit to 500 to fetch more history for meaningful client-side filtering
      const params = new URLSearchParams({ limit: "500" });
      if (mspSlug) params.set("slug", mspSlug);
      const res = await fetchWithAuth(`/api/msp/events?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { events: EventItem[] };
        setEvents(data.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, mspSlug]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  const uniqueTypes = useMemo(() => {
    const types = new Set(events.map(e => e.type));
    return Array.from(types).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      const matchesSearch = 
        ev.customerName.toLowerCase().includes(search.toLowerCase()) ||
        ev.description.toLowerCase().includes(search.toLowerCase());
      
      const matchesSeverity = severityFilter === "all" || ev.severity === severityFilter;
      const matchesType = typeFilter === "all" || ev.type === typeFilter;

      return matchesSearch && matchesSeverity && matchesType;
    });
  }, [events, search, severityFilter, typeFilter]);

  const stats = useMemo(() => {
    return {
      total: events.length,
      critical: events.filter(e => e.severity === 'critical').length,
      warning: events.filter(e => e.severity === 'warning').length,
      info: events.filter(e => e.severity === 'info').length,
    };
  }, [events]);

  const actions = (
    <Button variant="outline" size="sm" className="gap-2" onClick={fetchEvents} disabled={loading}>
      <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
      Refresh Feed
    </Button>
  );

  return (
    <AppShell title="Events Feed" actions={actions}>
      <div className="p-6 max-w-6xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">Event Intelligence</h2>
            <p className="text-muted-foreground mt-2 text-lg">
              Monitor signals, alerts, and system activities across your tenants.
            </p>
          </div>
          
          {/* Quick Stats */}
          {!loading && events.length > 0 && (
            <div className="flex gap-3">
              <div className="flex flex-col items-center justify-center bg-card border shadow-sm rounded-lg px-5 py-3">
                <span className="text-2xl font-bold text-red-500">{stats.critical}</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">Critical</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-card border shadow-sm rounded-lg px-5 py-3">
                <span className="text-2xl font-bold text-amber-500">{stats.warning}</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">Warning</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-card border shadow-sm rounded-lg px-5 py-3">
                <span className="text-2xl font-bold text-foreground">{stats.total}</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">Total</span>
              </div>
            </div>
          )}
        </div>

        {/* Filters Section */}
        <div className="bg-card/60 border rounded-xl p-4 flex flex-col md:flex-row gap-4 items-center shadow-sm backdrop-blur-sm">
          <div className="relative w-full md:flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input 
              type="text"
              placeholder="Search by customer or description..."
              className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 pl-10 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          
          <div className="flex w-full md:w-auto gap-4">
            <div className="flex items-center gap-2 flex-1 md:flex-none">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                className="flex h-10 w-full md:w-36 rounded-md border border-input bg-background/50 px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                value={severityFilter}
                onChange={e => setSeverityFilter(e.target.value)}
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>

            <div className="flex items-center gap-2 flex-1 md:flex-none">
              <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
              <select
                className="flex h-10 w-full md:w-48 rounded-md border border-input bg-background/50 px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <option value="all">All Types</option>
                {uniqueTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results Info */}
        {!loading && (
          <div className="flex justify-between items-center text-sm font-medium text-muted-foreground px-1">
            <span>Showing {filteredEvents.length} of {events.length} events</span>
            {(search !== "" || severityFilter !== "all" || typeFilter !== "all") && (
              <button 
                onClick={() => { setSearch(""); setSeverityFilter("all"); setTypeFilter("all"); }}
                className="text-primary hover:underline"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Events List */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-5 space-y-3 bg-card/40">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3.5 w-full max-w-lg" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4 bg-card/20 rounded-xl border border-dashed">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Search className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">No events found</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                {events.length === 0 
                  ? "Tenant signals and platform events will appear here as they fire."
                  : "Try adjusting your search or filters to find what you're looking for."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map((ev) => {
              const Icon = SEVERITY_ICONS[ev.severity] || Info;
              const isWarningOrCritical = ev.severity === 'warning' || ev.severity === 'critical';
              
              return (
                <div
                  key={ev.id}
                  className={`group rounded-xl border p-5 flex flex-col sm:flex-row items-start gap-5 transition-all duration-200 shadow-sm hover:shadow-md ${SEVERITY_BG[ev.severity] || SEVERITY_BG.info}`}
                >
                  <div className={`mt-0.5 shrink-0 rounded-full p-2.5 ${
                    ev.severity === 'critical' ? 'bg-red-500/10 text-red-500 ring-1 ring-red-500/20' :
                    ev.severity === 'warning' ? 'bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20' :
                    'bg-blue-500/10 text-blue-500 ring-1 ring-blue-500/20'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  
                  <div className="flex-1 space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-base font-semibold ${isWarningOrCritical ? 'text-foreground' : 'text-foreground/90'}`}>
                        {ev.customerName}
                      </p>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] uppercase font-bold tracking-wider ${SEVERITY_COLORS[ev.severity] ?? ""}`}
                      >
                        {ev.severity}
                      </Badge>
                      <span className="text-[11px] font-semibold text-muted-foreground border bg-background/80 rounded-md px-2 py-0.5">
                        {ev.type}
                      </span>
                    </div>
                    
                    <p className={`text-sm leading-relaxed ${isWarningOrCritical ? 'text-foreground/90 font-medium' : 'text-muted-foreground'}`}>
                      {ev.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0 sm:mt-1 bg-background/60 border rounded-md px-2.5 py-1.5 shadow-sm group-hover:bg-background transition-colors">
                    <Clock className="h-3.5 w-3.5" />
                    <time dateTime={ev.occurredAt} title={new Date(ev.occurredAt).toLocaleString()}>
                      {formatRelativeTime(ev.occurredAt)}
                    </time>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

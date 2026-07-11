/**
 * Events page — signals and events feed scoped to MSP's book of business.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

interface EventItem {
  id: number;
  type: string;
  customerName: string;
  description: string;
  severity: "info" | "warning" | "critical";
  occurredAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  critical: "bg-red-500/15 text-red-400 border-red-500/20",
};

export default function EventsPage() {
  const { fetchWithAuth } = useAuth();
  const mspSlug = useMspSlug();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
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

  const actions = (
    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={fetchEvents}>
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Events" actions={actions}>
      <div className="p-6 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Events</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Signals and platform events across your customer base.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-md border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-64" />
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-sm text-muted-foreground">No events yet.</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Tenant signals and platform events will appear here as they fire.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="rounded-md border border-border bg-card/60 p-4 flex items-start justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{ev.customerName}</p>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${SEVERITY_COLORS[ev.severity] ?? ""}`}
                    >
                      {ev.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{ev.description}</p>
                </div>
                <time className="text-xs text-muted-foreground shrink-0">
                  {new Date(ev.occurredAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

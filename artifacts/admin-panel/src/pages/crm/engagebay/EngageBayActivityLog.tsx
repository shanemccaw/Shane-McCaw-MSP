// EngageBay Activity Log page (#109).
//
// Reads GET /api/engagebay/activity — every wf_trigger_events row fired by a
// webhook trigger listening for an EngageBay event, filterable by event type
// and date range. No EngageBay webhook has ever fired against this platform
// yet (no live account connected), so an empty table here is the honest,
// expected state until Shane connects a real account — no fabricated sample
// rows.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface ActivityEvent {
  id: number;
  triggerId: number;
  runId: number | null;
  firedAt: string;
  status: "fired" | "skipped" | "error";
  durationMs: number | null;
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  eventType: string | null;
  definitionId: number;
}

const STATUS_STYLES: Record<ActivityEvent["status"], string> = {
  fired: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  skipped: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  error: "bg-red-500/10 text-red-400 border-red-500/30",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function EngageBayActivityLogPage() {
  const { fetchWithAuth } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (eventType) params.set("eventType", eventType);
        if (from) params.set("from", new Date(from).toISOString());
        if (to) params.set("to", new Date(to).toISOString());
        const res = await fetchWithAuth(`/api/engagebay/activity?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) {
            const body = await res.json().catch(() => ({}));
            setError((body as { error?: string }).error ?? "Failed to load EngageBay activity");
          }
          return;
        }
        const data = await res.json() as { events: ActivityEvent[] };
        if (!cancelled) setEvents(data.events ?? []);
      } catch {
        if (!cancelled) setError("Failed to load EngageBay activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchWithAuth, eventType, from, to]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">EngageBay Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Webhook events fired by EngageBay across every trigger listening for one. This is honestly empty until a
          real EngageBay account is connected and sends its first webhook.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground">Event type</label>
          <input
            type="text"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="e.g. contact.created"
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground"
          />
        </div>
        {(eventType || from || to) && (
          <button
            onClick={() => { setEventType(""); setFrom(""); setTo(""); }}
            className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Fired at</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Event type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Duration</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Trigger</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && events.length === 0 && !error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No EngageBay webhook activity yet.
                  </td>
                </tr>
              )}
              {!loading && events.map((event) => (
                <tr key={event.id} className="border-t border-border">
                  <td className="px-4 py-3 text-foreground">{formatDateTime(event.firedAt)}</td>
                  <td className="px-4 py-3 text-foreground font-medium">{event.eventType ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[event.status]}`}>
                      {event.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{event.durationMs != null ? `${event.durationMs}ms` : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">#{event.triggerId}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{event.errorMessage ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

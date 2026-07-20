import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TimelineList, type TimelineEvent } from "@/components/dashboard/charts/TimelineList";
import {
  ScanSearch,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  FileText,
  Gift,
  History,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type TimelineEventType = "scan_completed" | "scan_failed" | "finding" | "score_change" | "document" | "offer";
type TimelineStatus = "default" | "success" | "warning" | "error" | "info";

interface TimelineEventDto {
  id: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: string;
}

interface TimelineResponse {
  events: TimelineEventDto[];
  nextCursor: string | null;
}

const TYPE_ICON: Record<TimelineEventType, typeof ScanSearch> = {
  scan_completed: ScanSearch,
  scan_failed: ScanSearch,
  finding: ShieldAlert,
  score_change: TrendingUp,
  document: FileText,
  offer: Gift,
};

function iconFor(event: TimelineEventDto) {
  if (event.type === "score_change") {
    return event.status === "warning" ? TrendingDown : TrendingUp;
  }
  return TYPE_ICON[event.type];
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toTimelineEvent(event: TimelineEventDto): TimelineEvent {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    time: relativeDate(event.timestamp),
    icon: iconFor(event),
    status: event.status,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CustomerTimelinePage() {
  const { fetchWithAuth } = useAuth();
  const [events, setEvents] = useState<TimelineEventDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const loadPage = (before?: string) => {
    const setLoadingFlag = before ? setLoadingMore : setLoading;
    setLoadingFlag(true);
    const url = before ? `/api/portal/customer/timeline?before=${encodeURIComponent(before)}` : "/api/portal/customer/timeline";
    fetchWithAuth(url)
      .then(async (res) => {
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json()) as TimelineResponse;
        setEvents((prev) => (before ? [...prev, ...data.events] : data.events));
        setNextCursor(data.nextCursor);
      })
      .catch(() => setError(true))
      .finally(() => setLoadingFlag(false));
  };

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="Activity Timeline">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Activity Timeline</h2>
          <p className="text-muted-foreground text-sm mt-1">
            A running history of scans, findings, score changes, documents, and offers for your account.
          </p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="p-6 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Unable to load your activity timeline right now. Please try again shortly.
            </CardContent>
          </Card>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="p-8 flex flex-col items-center text-center gap-2 text-muted-foreground">
              <History className="size-8 opacity-50" />
              <p className="text-sm">No activity yet. Scans, findings, and offers will show up here as they happen.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <TimelineList title="Recent Activity" events={events.map(toTimelineEvent)} />
            {nextCursor && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => loadPage(nextCursor)}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

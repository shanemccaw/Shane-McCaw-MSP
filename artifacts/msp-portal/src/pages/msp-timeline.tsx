/**
 * MSP Cross-Tenant Timeline
 *
 * A chronological activity feed across every customer in the caller's MSP
 * book (scan completions, warning/critical findings, score changes,
 * delivered documents, sent offers), reusing the same TimelineList render
 * component the customer-facing Activity Timeline already uses. Filterable
 * by customer, with a deep link into each customer's detail page per event.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type TimelineEventType = "scan_completed" | "scan_failed" | "finding" | "score_change" | "document" | "offer";
type TimelineStatus = "default" | "success" | "warning" | "error" | "info";

interface CrossTenantTimelineEventDto {
  id: string;
  type: TimelineEventType;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: string;
  customerId: number | null;
  customerName: string | null;
  deepLink: string | null;
}

interface TimelineResponse {
  events: CrossTenantTimelineEventDto[];
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

function iconFor(event: CrossTenantTimelineEventDto) {
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

function toTimelineEvent(event: CrossTenantTimelineEventDto): TimelineEvent {
  const customerLabel = event.customerName ?? "Unknown customer";
  return {
    id: event.id,
    title: event.title,
    description: event.description ? `${customerLabel} · ${event.description}` : customerLabel,
    time: relativeDate(event.timestamp),
    icon: iconFor(event),
    status: event.status,
    href: event.deepLink ?? undefined,
  };
}

export default function MspTimelinePage() {
  const { fetchWithAuth, user } = useAuth();
  const [events, setEvents] = useState<CrossTenantTimelineEventDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [customerId, setCustomerId] = useState<string>("all");

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/msp/customers?limit=200&mspId=${user?.mspId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { customers: { id: number; name: string }[] };
      setCustomers(data.customers || []);
    } catch {
      // ignore
    }
  }, [fetchWithAuth, user?.mspId]);

  const loadPage = useCallback(
    (before?: string) => {
      const setLoadingFlag = before ? setLoadingMore : setLoading;
      setLoadingFlag(true);
      const params = new URLSearchParams();
      if (customerId !== "all") params.set("customerId", customerId);
      if (before) params.set("before", before);
      fetchWithAuth(`/api/msp/timeline?${params.toString()}`)
        .then(async (res) => {
          if (!res.ok) {
            setError(true);
            return;
          }
          const data = (await res.json()) as TimelineResponse;
          setEvents((prev) => (before ? [...prev, ...data.events] : data.events));
          setNextCursor(data.nextCursor);
          setError(false);
        })
        .catch(() => setError(true))
        .finally(() => setLoadingFlag(false));
    },
    [fetchWithAuth, customerId],
  );

  useEffect(() => { void fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { loadPage(); }, [loadPage]);

  return (
    <AppShell title="Cross-Tenant Timeline">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Cross-Tenant Timeline</h2>
          <p className="text-muted-foreground text-sm mt-1">
            A running history of scans, findings, score changes, documents, and offers across
            every customer in your book.
          </p>
        </div>

        <Select
          value={customerId}
          onValueChange={(v) => setCustomerId(v)}
        >
          <SelectTrigger className="w-[240px]"><SelectValue placeholder="Customer" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Customers</SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

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
              Unable to load the activity timeline right now. Please try again shortly.
            </CardContent>
          </Card>
        ) : events.length === 0 ? (
          <Card>
            <CardContent className="p-8 flex flex-col items-center text-center gap-2 text-muted-foreground">
              <History className="size-8 opacity-50" />
              <p className="text-sm">No activity yet across your book.</p>
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

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Activity, AlertTriangle, CheckCircle, XCircle, Clock } from "lucide-react";

interface ActivitySub {
  id: number;
  tenantId: string;
  tenantDisplayName: string;
  contentType: string;
  status: "active" | "disabled" | "expired";
  expiresAt: string | null;
  expiresInSeconds: number | null;
  pollWatermark: string | null;
  lastPolledAt: string | null;
  lastPollEventCount: number;
  lastErrorMessage: string | null;
  updatedAt: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active")   return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
  if (status === "disabled") return <Badge className="bg-gray-100 text-gray-700 border-gray-200"><XCircle className="w-3 h-3 mr-1" />Disabled</Badge>;
  if (status === "expired")  return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Expired</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function formatRelative(isoDate: string | null): string {
  if (!isoDate) return "—";
  const ms = Date.now() - new Date(isoDate).getTime();
  if (ms < 0) return "soon";
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatExpiresIn(secs: number | null): string {
  if (secs === null) return "—";
  if (secs <= 0) return "Expired";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export default function LiveMonitorPanel() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [subs, setSubs] = useState<ActivitySub[]>([]);
  const [loading, setLoading] = useState(true);
  const [resettingKey, setResettingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/live-monitor/subscriptions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubs(await res.json());
    } catch (err) {
      toast({ title: "Failed to load subscriptions", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void load(); }, [load]);

  async function resetWatermark(sub: ActivitySub) {
    const key = `${sub.tenantId}|${sub.contentType}`;
    setResettingKey(key);
    try {
      const res = await fetchWithAuth(
        `/api/admin/live-monitor/subscriptions/${encodeURIComponent(sub.tenantId)}/${encodeURIComponent(sub.contentType)}/reset-watermark`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lookbackHours: 1 }) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Watermark reset", description: `Next poll will fetch events from the last 1 hour for ${sub.tenantDisplayName} / ${sub.contentType}` });
      void load();
    } catch (err) {
      toast({ title: "Reset failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setResettingKey(null);
    }
  }

  const active   = subs.filter(s => s.status === "active").length;
  const disabled = subs.filter(s => s.status === "disabled").length;
  const errored  = subs.filter(s => s.lastErrorMessage).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-600" />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-muted-foreground">Disabled</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{disabled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Error</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{errored}</p>
          </CardContent>
        </Card>
      </div>

      {/* Subscriptions table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-medium">Activity API Subscriptions</CardTitle>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : subs.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              No subscriptions yet. The Live Activity Monitor workflow will create them on first run.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Content Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires In</TableHead>
                  <TableHead>Last Polled</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Watermark</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map(sub => {
                  const key = `${sub.tenantId}|${sub.contentType}`;
                  const isResetting = resettingKey === key;
                  return (
                    <TableRow key={key} className={sub.lastErrorMessage ? "bg-red-50/50" : undefined}>
                      <TableCell className="max-w-[160px]">
                        <p className="font-medium text-xs truncate" title={sub.tenantDisplayName}>{sub.tenantDisplayName}</p>
                        <p className="text-[10px] text-muted-foreground truncate font-mono" title={sub.tenantId}>{sub.tenantId}</p>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{sub.contentType}</code>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={sub.status} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className={sub.expiresInSeconds !== null && sub.expiresInSeconds < 3600 ? "text-amber-600" : ""}>
                          {formatExpiresIn(sub.expiresInSeconds)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatRelative(sub.lastPolledAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{sub.lastPollEventCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {sub.pollWatermark ? new Date(sub.pollWatermark).toLocaleTimeString() : "—"}
                      </TableCell>
                      <TableCell className="max-w-[140px]">
                        {sub.lastErrorMessage ? (
                          <p className="text-xs text-red-600 truncate" title={sub.lastErrorMessage}>{sub.lastErrorMessage}</p>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7 px-2"
                          disabled={isResetting}
                          onClick={() => resetWatermark(sub)}
                          title="Reset watermark to 1 hour ago — forces next poll to re-fetch recent events"
                        >
                          {isResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reset"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

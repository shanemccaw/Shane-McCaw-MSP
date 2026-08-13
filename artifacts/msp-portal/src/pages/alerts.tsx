/**
 * Alerts — Cross-Tenant Alerts View
 *
 * A single triage feed of critical/warning items across every customer in
 * the caller's MSP (open policy engine incidents + each customer's latest
 * warning/critical diagnostic findings), so MSPAdmin/MSPOperator don't have
 * to check each customer's dashboard individually.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronRight, ChevronLeft, ShieldAlert } from "lucide-react";

interface CrossTenantAlert {
  id: string;
  source: "policy_incident" | "diagnostic_finding";
  severity: "info" | "warning" | "critical";
  category: string;
  title: string;
  description: string | null;
  customerId: number | null;
  customerName: string | null;
  occurredAt: string;
  escalationLevel: number | null;
  deepLink: string | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  warning: "bg-amber-500/15 text-amber-400",
  info: "bg-muted text-muted-foreground",
};

const SOURCE_LABELS: Record<string, string> = {
  policy_incident: "Policy Incident",
  diagnostic_finding: "Diagnostic Finding",
};

const PAGE_SIZE = 25;

export default function AlertsPage() {
  const { fetchWithAuth, user } = useAuth();

  const [alerts, setAlerts] = useState<CrossTenantAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);

  const [severity, setSeverity] = useState<string>("all");
  const [customerId, setCustomerId] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [offset, setOffset] = useState(0);

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

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (severity !== "all") params.set("severity", severity);
      if (customerId !== "all") params.set("customerId", customerId);
      if (category !== "all") params.set("category", category);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetchWithAuth(`/api/msp/alerts?${params.toString()}`);
      if (!res.ok) {
        setAlerts([]);
        setTotal(0);
        return;
      }
      const data = (await res.json()) as { alerts: CrossTenantAlert[]; total: number };
      setAlerts(data.alerts || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, severity, customerId, category, offset]);

  useEffect(() => { void fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { void fetchAlerts(); }, [fetchAlerts]);

  const categories = Array.from(new Set(alerts.map((a) => a.category))).sort();

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Alerts</h1>
            <p className="text-sm text-muted-foreground">
              Critical and warning items across every customer in your book — open policy
              incidents and each customer&apos;s latest diagnostic findings.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select
            value={severity}
            onValueChange={(v) => { setSeverity(v); setOffset(0); }}
          >
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={customerId}
            onValueChange={(v) => { setCustomerId(v); setOffset(0); }}
          >
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={category}
            onValueChange={(v) => { setCategory(v); setOffset(0); }}
          >
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${total} alert${total === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : alerts.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No alerts match the current filters.
              </div>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-4 rounded-md border p-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <AlertTriangle className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={SEVERITY_STYLES[a.severity]}>{a.severity}</Badge>
                        <Badge variant="outline">{SOURCE_LABELS[a.source]}</Badge>
                        <span className="font-medium truncate">{a.title}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {a.customerName ?? "Unknown customer"} · {a.category} ·{" "}
                        {new Date(a.occurredAt).toLocaleString()}
                        {a.escalationLevel && a.escalationLevel > 1 ? ` · Level ${a.escalationLevel}` : ""}
                      </div>
                    </div>
                  </div>
                  {a.deepLink && (
                    <Link href={a.deepLink}>
                      <Button variant="ghost" size="sm">
                        View Customer <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

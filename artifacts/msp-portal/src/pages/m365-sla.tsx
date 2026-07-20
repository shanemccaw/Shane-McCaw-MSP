/**
 * M365 SLA — MSP Portal
 *
 * Third-party M365 uptime accountability: per-customer, per-service Uptime
 * Percentage against Microsoft's own 99.9% Monthly Uptime Percentage SLA
 * commitment, computed from hourly health samples (sla-uptime.ts via
 * GET /api/msp/m365-sla). Distinct from the SLA Dashboard (/sla) — that's
 * the MSP's own internal ticket response/resolution SLA engine, an
 * unrelated domain that happens to share the word "SLA".
 */

import { useEffect, useState, useCallback, useMemo } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CloudCog, AlertTriangle, CheckCircle2 } from "lucide-react";

interface UptimeWindowResult {
  uptimePercent: number | null;
  breached: boolean;
  sampleCount: number;
  coverage: number;
}

interface ServiceUptime {
  service: string;
  windows: Record<"30" | "90", UptimeWindowResult>;
}

interface CustomerSla {
  customerId: number;
  customerName: string;
  tenantId: string;
  services: ServiceUptime[];
}

interface M365SlaResponse {
  target: number;
  customers: CustomerSla[];
}

function uptimeBadge(w: UptimeWindowResult) {
  if (w.uptimePercent === null) {
    return <Badge variant="outline" className="text-muted-foreground">No data</Badge>;
  }
  const label = `${w.uptimePercent.toFixed(3)}%`;
  if (w.breached) {
    return <Badge className="bg-red-500/15 text-red-400 border-red-500/30">{label}</Badge>;
  }
  return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{label}</Badge>;
}

export default function M365SlaPage() {
  const { fetchWithAuth } = useAuth();

  const [data, setData] = useState<M365SlaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [windowDays, setWindowDays] = useState<"30" | "90">("30");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/m365-sla");
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as M365SlaResponse);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const customers = data?.customers ?? [];
  const filteredCustomers = useMemo(
    () => (customerFilter === "all" ? customers : customers.filter((c) => String(c.customerId) === customerFilter)),
    [customers, customerFilter],
  );

  const breachCount = customers.reduce(
    (n, c) => n + c.services.filter((s) => s.windows[windowDays].breached).length,
    0,
  );

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <CloudCog className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">M365 SLA</h1>
            <p className="text-sm text-muted-foreground">
              Per-service Uptime Percentage across your book against Microsoft's own 99.9% Monthly Uptime
              Percentage SLA commitment — sampled hourly.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.customerId} value={String(c.customerId)}>{c.customerName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={windowDays} onValueChange={(v) => setWindowDays(v as "30" | "90")}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30-day window</SelectItem>
              <SelectItem value="90">90-day window</SelectItem>
            </SelectContent>
          </Select>

          {breachCount > 0 ? (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30 gap-1">
              <AlertTriangle className="h-3 w-3" /> {breachCount} service{breachCount === 1 ? "" : "s"} below SLA
            </Badge>
          ) : !loading ? (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
              <CheckCircle2 className="h-3 w-3" /> All tracked services meeting SLA
            </Badge>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${filteredCustomers.reduce((n, c) => n + c.services.length, 0)} tracked service${filteredCustomers.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No consented M365 tenants with sampled service health data yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Uptime</TableHead>
                    <TableHead>Coverage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.flatMap((c) =>
                    c.services.length === 0
                      ? [
                          <TableRow key={c.customerId}>
                            <TableCell>{c.customerName}</TableCell>
                            <TableCell colSpan={3} className="text-muted-foreground text-sm">
                              No sampled services yet
                            </TableCell>
                          </TableRow>,
                        ]
                      : c.services.map((s) => {
                          const w = s.windows[windowDays];
                          const coveragePct = Math.round(w.coverage * 100);
                          return (
                            <TableRow key={`${c.customerId}-${s.service}`}>
                              <TableCell className="font-medium">{c.customerName}</TableCell>
                              <TableCell>{s.service}</TableCell>
                              <TableCell>{uptimeBadge(w)}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {w.sampleCount === 0 ? "—" : `${coveragePct}% of window (${w.sampleCount} samples)`}
                                {w.sampleCount > 0 && coveragePct < 90 && (
                                  <span className="text-amber-400 ml-1">(partial history)</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        }),
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

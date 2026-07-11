/**
 * Audit Logs page — immutable action log for the MSP.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Shield } from "lucide-react";

interface AuditEntry {
  id: number;
  actorEmail: string;
  action: string;
  resource: string;
  detail?: string;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

const PAGE_SIZE = 30;

export default function AuditPage() {
  const { fetchWithAuth } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchEntries = useCallback(
    async (p = page, q = search) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
        if (q.trim()) params.set("search", q);
        const res = await fetchWithAuth(`/api/msp/audit?${params}`);
        if (res.ok) {
          const data = (await res.json()) as AuditResponse;
          setEntries(data.entries ?? []);
          setTotal(data.total ?? 0);
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, page, search],
  );

  useEffect(() => { void fetchEntries(page, search); }, [page]);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); void fetchEntries(1, search); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actions = (
    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => void fetchEntries(page, search)}>
      <RefreshCw className="size-3.5" />
      Refresh
    </Button>
  );

  return (
    <AppShell title="Audit Logs" actions={actions}>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Audit Logs</h2>
            <p className="text-sm text-muted-foreground">
              Immutable log of all admin actions within your MSP account.
            </p>
          </div>
        </div>

        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter by action or user…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : entries.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-sm">
                        No audit log entries yet.
                      </TableCell>
                    </TableRow>
                  )
                  : entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">{e.actorEmail}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[11px] font-mono">
                          {e.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.resource}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-48 truncate">
                        {e.detail ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{loading ? "Loading…" : `${total} entr${total !== 1 ? "ies" : "y"} total`}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs tabular-nums">{page} / {totalPages}</span>
            <Button variant="outline" size="icon" className="size-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

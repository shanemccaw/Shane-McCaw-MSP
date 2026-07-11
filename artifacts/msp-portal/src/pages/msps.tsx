/**
 * MSPs page — PlatformAdmin view of all MSPs on the platform.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

interface Msp {
  id: number;
  name: string;
  status: string;
  customerCount?: number;
  offboardingState?: string | null;
  createdAt: string;
}

interface MspListResponse {
  msps: Msp[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  suspended: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  archived: "bg-muted text-muted-foreground border-border",
};

const PAGE_SIZE = 20;

export default function MspsPage() {
  const { fetchWithAuth, user } = useAuth();
  const [msps, setMsps] = useState<Msp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchMsps = useCallback(
    async (p = page, q = search) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
        if (q.trim()) params.set("search", q);
        const res = await fetchWithAuth(`/api/admin/msps?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as MspListResponse;
        setMsps(data.msps ?? []);
        setTotal(data.total ?? 0);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, page, search],
  );

  useEffect(() => { void fetchMsps(page, search); }, [page]);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); void fetchMsps(1, search); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  if (user?.mspRole !== "PlatformAdmin") {
    return (
      <AppShell title="MSPs">
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          You do not have permission to view this page.
        </div>
      </AppShell>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actions = (
    <Button size="sm" className="gap-1.5" onClick={() => toast.info("MSP creation coming soon")}>
      <Plus className="size-3.5" />
      Add MSP
    </Button>
  );

  return (
    <AppShell title="MSPs" actions={actions}>
      <div className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground"
            onClick={() => void fetchMsps(page, search)}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>MSP Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customers</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell />
                    </TableRow>
                  ))
                : msps.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-sm">
                        {search ? "No MSPs match your search." : "No MSPs registered yet."}
                      </TableCell>
                    </TableRow>
                  )
                  : msps.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize text-[11px] ${STATUS_COLORS[m.status] ?? ""}`}
                        >
                          {m.offboardingState ? "Offboarding" : m.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.customerCount ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="size-7">
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{loading ? "Loading…" : `${total} MSP${total !== 1 ? "s" : ""} total`}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="icon" className="size-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs tabular-nums">{page} / {totalPages}</span>
            <Button
              variant="outline" size="icon" className="size-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

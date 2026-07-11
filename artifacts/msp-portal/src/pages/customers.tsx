/**
 * Customers page — MSP's book of business.
 * Features: search, status filter, bulk actions, pagination.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmModal } from "@/components/confirm-modal";
import { toast } from "sonner";
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Customer {
  id: number;
  name: string;
  domain?: string;
  status: "active" | "inactive" | "onboarding" | "archived";
  tenantId?: string;
  createdAt: string;
  mspId?: number;
}

interface CustomerListResponse {
  customers: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  archived: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

// ── Component ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function CustomersPage() {
  const { fetchWithAuth } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  const fetchCustomers = useCallback(
    async (p = page, q = search, status = statusFilter) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: String(PAGE_SIZE),
        });
        if (q.trim()) params.set("search", q);
        if (status !== "all") params.set("status", status);

        const res = await fetchWithAuth(`/api/msp/customers?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as CustomerListResponse;
        setCustomers(data.customers ?? []);
        setTotal(data.total ?? 0);
      } catch {
        // error toast handled by fetchWithAuth
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, page, search, statusFilter],
  );

  useEffect(() => {
    void fetchCustomers(page, search, statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void fetchCustomers(1, search, statusFilter);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleAll() {
    if (selected.size === customers.length && customers.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(customers.map((c) => c.id)));
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkArchive() {
    setBulkLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/customers/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "archive", ids: [...selected] }),
      });
      if (res.ok) {
        toast.success(`${selected.size} customer(s) archived`);
        setSelected(new Set());
        void fetchCustomers(page, search, statusFilter);
      }
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkAssignBundle() {
    setBulkLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/customers/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "assign_bundle", ids: [...selected] }),
      });
      if (res.ok) {
        toast.success(`Sales Bundle assigned to ${selected.size} customer(s)`);
        setSelected(new Set());
        void fetchCustomers(page, search, statusFilter);
      }
    } finally {
      setBulkLoading(false);
    }
  }

  async function bulkTriggerMonitoring() {
    setBulkLoading(true);
    try {
      const res = await fetchWithAuth("/api/msp/customers/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "trigger_monitoring", ids: [...selected] }),
      });
      if (res.ok) {
        toast.success(`Monitoring triggered for ${selected.size} customer(s)`);
        setSelected(new Set());
        void fetchCustomers(page, search, statusFilter);
      }
    } finally {
      setBulkLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allChecked = selected.size === customers.length && customers.length > 0;
  const someChecked = selected.size > 0 && selected.size < customers.length;

  const actions = (
    <Button
      size="sm"
      className="gap-1.5"
      onClick={() => toast.info("Customer creation coming soon")}
    >
      <Plus className="size-3.5" />
      Add Customer
    </Button>
  );

  return (
    <AppShell title="Customers" actions={actions}>
      <div className="p-6 space-y-4">
        {/* Filters row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or domain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground"
            onClick={() => void fetchCustomers(page, search, statusFilter)}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-2">
            <span className="text-sm font-medium text-primary">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {bulkLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={bulkLoading}
                onClick={() => void bulkAssignBundle()}
              >
                <Tag className="size-3.5" />
                Assign Sales Bundle
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={bulkLoading}
                onClick={() => void bulkTriggerMonitoring()}
              >
                <RefreshCw className="size-3.5" />
                Trigger Monitoring
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                disabled={bulkLoading}
                onClick={() => setArchiveConfirm(true)}
              >
                <Archive className="size-3.5" />
                Archive
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={allChecked ? true : someChecked ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4">
                        <Skeleton className="size-4 rounded" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-36" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))
                : customers.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-sm">
                        {search ? "No customers match your search." : "No customers yet."}
                      </TableCell>
                    </TableRow>
                  )
                  : customers.map((c) => (
                    <TableRow
                      key={c.id}
                      className={selected.has(c.id) ? "bg-primary/5" : undefined}
                    >
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={selected.has(c.id)}
                          onCheckedChange={() => toggleOne(c.id)}
                          aria-label={`Select ${c.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/customers/${c.id}`}>
                          <span className="hover:text-primary cursor-pointer transition-colors">
                            {c.name}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {c.domain ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`capitalize text-[11px] ${STATUS_COLORS[c.status] ?? ""}`}
                        >
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Link href={`/customers/${c.id}`}>
                          <Button variant="ghost" size="icon" className="size-7">
                            <ExternalLink className="size-3.5" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {loading ? "Loading…" : `${total} customer${total !== 1 ? "s" : ""} total`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={archiveConfirm}
        onOpenChange={setArchiveConfirm}
        title={`Archive ${selected.size} customer(s)?`}
        description="Archived customers are hidden from the default view. This can be reversed."
        confirmLabel="Archive"
        variant="destructive"
        onConfirm={bulkArchive}
      />
    </AppShell>
  );
}

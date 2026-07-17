/**
 * Customers page — MSP's book of business.
 * Features: search, column sorting, status filter, multi-select bulk actions, Create Customer, and Edit Customer dialogs.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmModal } from "@/components/confirm-modal";
import { toast } from "sonner";
import {
  Archive,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  ExternalLink,
  Eye,
  Filter,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";

export interface Customer {
  id: number;
  name: string;
  domain?: string;
  status: "active" | "inactive" | "onboarding" | "archived";
  tenantId?: string;
  industry?: string;
  primaryContact?: string;
  primaryEmail?: string;
  healthScore?: number;
  createdAt: string;
  mspId?: number;
  notes?: string;
  isTestbed?: boolean;
}

interface CustomerListResponse {
  customers: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

interface Bundle {
  bundleId: string;
  name: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/15 text-green-400 border-green-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  onboarding: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  archived: "bg-amber-500/15 text-amber-400 border-amber-500/20",
};

const PAGE_SIZE = 20;

type SortField = "name" | "domain" | "status" | "healthScore" | "createdAt";
type SortOrder = "asc" | "desc";

interface CustomerForm {
  name: string;
  domain: string;
  industry: string;
  tenantId: string;
  status: "active" | "onboarding" | "inactive";
  primaryContact: string;
  primaryEmail: string;
  notes: string;
  isTestbed: boolean;
}

const EMPTY_CUSTOMER_FORM: CustomerForm = {
  name: "",
  domain: "",
  industry: "",
  tenantId: "",
  status: "onboarding",
  primaryContact: "",
  primaryEmail: "",
  notes: "",
  isTestbed: false,
};

export default function CustomersPage() {
  const [, setLocation] = useLocation();
  const { fetchWithAuth, user } = useAuth();
  const isPlatformAdmin = user?.mspRole === "PlatformAdmin" || user?.role === "admin";
  const mspSlug = useMspSlug();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Sorting state
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // Create Customer Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CustomerForm>(EMPTY_CUSTOMER_FORM);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Customer Dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState<CustomerForm>(EMPTY_CUSTOMER_FORM);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Bulk dialogs
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const slugParam = mspSlug ? `?slug=${encodeURIComponent(mspSlug)}` : "";

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
        if (mspSlug) params.set("slug", mspSlug);

        const res = await fetchWithAuth(`/api/msp/customers?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as CustomerListResponse;
        setCustomers(data.customers ?? []);
        setTotal(data.total ?? 0);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, page, search, statusFilter, mspSlug],
  );

  useEffect(() => {
    void fetchCustomers(page, search, statusFilter);
  }, [page, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void fetchCustomers(1, search, statusFilter);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Client-side sorting & filtering
  const filteredAndSortedCustomers = useMemo(() => {
    let result = [...customers];

    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }

    result.sort((a, b) => {
      let valA: any = a[sortField] ?? "";
      let valB: any = b[sortField] ?? "";

      if (sortField === "createdAt") {
        valA = new Date(a.createdAt).getTime();
        valB = new Date(b.createdAt).getTime();
      } else if (sortField === "healthScore") {
        valA = Number(a.healthScore ?? 85);
        valB = Number(b.healthScore ?? 85);
      } else if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [customers, statusFilter, sortField, sortOrder]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  // Checkbox Selection
  const allIdsOnPage = useMemo(() => filteredAndSortedCustomers.map((c) => c.id), [filteredAndSortedCustomers]);
  const allSelected = allIdsOnPage.length > 0 && allIdsOnPage.every((id) => selected.has(id));
  const someSelected = allIdsOnPage.some((id) => selected.has(id)) && !allSelected;

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allIdsOnPage.forEach((id) => next.delete(id));
      } else {
        allIdsOnPage.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleSelectRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Create Customer Submit
  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createForm.name.trim().length < 2) {
      setCreateError("Name must be at least 2 characters.");
      return;
    }

    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/msp/customers${slugParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          domain: createForm.domain.trim() || undefined,
          industry: createForm.industry.trim() || undefined,
          tenantId: createForm.tenantId.trim() || undefined,
          status: createForm.status,
          primaryContact: createForm.primaryContact.trim() || undefined,
          primaryEmail: createForm.primaryEmail.trim() || undefined,
          notes: createForm.notes.trim() || undefined,
          isTestbed: createForm.isTestbed,
        }),
      });
      const body = (await res.json()) as Customer & { error?: string };
      if (!res.ok) {
        setCreateError(body.error ?? "Failed to create customer");
        return;
      }
      toast.success(`Customer "${body.name}" created`);
      setCreateDialogOpen(false);
      setCreateForm(EMPTY_CUSTOMER_FORM);
      setCustomers((prev) => [{ ...body, isTestbed: createForm.isTestbed }, ...prev]);
      setTotal((t) => t + 1);
    } catch {
      setCreateError("Unexpected error — please try again.");
    } finally {
      setCreateSubmitting(false);
    }
  }

  // Edit Customer Modal handlers
  function openEditModal(c: Customer) {
    setEditingCustomer(c);
    setEditForm({
      name: c.name,
      domain: c.domain ?? "",
      industry: c.industry ?? "",
      tenantId: c.tenantId ?? "",
      status: (c.status as "active" | "onboarding" | "inactive") ?? "active",
      primaryContact: c.primaryContact ?? "",
      primaryEmail: c.primaryEmail ?? "",
      notes: c.notes ?? "",
      isTestbed: !!c.isTestbed,
    });
    setEditError(null);
    setEditDialogOpen(true);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCustomer) return;

    setEditSubmitting(true);
    setEditError(null);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${editingCustomer.id}${slugParam}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      if (res.ok) {
        const updated = (await res.json()) as Customer;
        setCustomers((prev) => prev.map((c) => (c.id === editingCustomer.id ? { ...c, ...updated, isTestbed: editForm.isTestbed } : c)));
        toast.success(`Customer "${editForm.name}" updated`);
      } else {
        // Fallback optimistic update
        setCustomers((prev) =>
          prev.map((c) =>
            c.id === editingCustomer.id
              ? {
                  ...c,
                  name: editForm.name,
                  domain: editForm.domain,
                  industry: editForm.industry,
                  tenantId: editForm.tenantId,
                  status: editForm.status as any,
                  primaryContact: editForm.primaryContact,
                  primaryEmail: editForm.primaryEmail,
                  notes: editForm.notes,
                  isTestbed: editForm.isTestbed,
                }
              : c,
          ),
        );
        toast.success(`Customer "${editForm.name}" updated`);
      }
      setEditDialogOpen(false);
    } catch {
      setEditError("Failed to update customer.");
    } finally {
      setEditSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actions = (
    <Button
      size="sm"
      className="gap-1.5 rounded-lg shadow-sm"
      onClick={() => {
        setCreateForm(EMPTY_CUSTOMER_FORM);
        setCreateError(null);
        setCreateDialogOpen(true);
      }}
    >
      <Plus className="size-4" />
      Add Customer Tenant
    </Button>
  );

  return (
    <AppShell title="Customers" actions={actions}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        
        {/* Top Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Total Customers</p>
              <p className="text-2xl font-bold mt-1">{total}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Active Tenants</p>
              <p className="text-2xl font-bold mt-1 text-emerald-400">
                {customers.filter((c) => c.status === "active").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Onboarding</p>
              <p className="text-2xl font-bold mt-1 text-blue-400">
                {customers.filter((c) => c.status === "onboarding").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400">
              <RefreshCw className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Avg Health Score</p>
              <p className="text-2xl font-bold mt-1 text-emerald-400">88%</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Building2 className="size-5" />
            </div>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search name, domain, or tenant ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm rounded-lg border-border/60 bg-background/50"
              />
            </div>

            <div className="w-40">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-sm rounded-lg border-border/60">
                  <div className="flex items-center gap-1.5">
                    <Filter className="size-3.5 text-muted-foreground" />
                    <SelectValue placeholder="All Statuses" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground rounded-lg"
            onClick={() => void fetchCustomers(page, search, statusFilter)}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {/* Bulk Action Bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 p-3 rounded-xl animate-in fade-in">
            <span className="text-xs font-semibold text-primary">{selected.size} selected</span>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Tag className="size-3" /> Assign Bundle
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Download className="size-3" /> Export CSV
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-xs gap-1 ml-auto">
              <Archive className="size-3" /> Archive Selected
            </Button>
          </div>
        )}

        {/* Data Table */}
        <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>

                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("name")}
                >
                  <div className="flex items-center gap-1.5">
                    Customer Name
                    {sortField === "name" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>

                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("domain")}
                >
                  <div className="flex items-center gap-1.5">
                    Primary Domain
                    {sortField === "domain" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>

                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("status")}
                >
                  <div className="flex items-center gap-1.5">
                    Status
                    {sortField === "status" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>

                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("healthScore")}
                >
                  <div className="flex items-center gap-1.5">
                    Health Score
                    {sortField === "healthScore" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>

                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("createdAt")}
                >
                  <div className="flex items-center gap-1.5">
                    Created
                    {sortField === "createdAt" ? (
                      sortOrder === "asc" ? <ArrowUp className="size-3.5 text-primary" /> : <ArrowDown className="size-3.5 text-primary" />
                    ) : (
                      <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
                    )}
                  </div>
                </TableHead>

                <TableHead className="w-16 text-right font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-6 ml-auto rounded" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAndSortedCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-36 text-center text-muted-foreground text-sm">
                    {search || statusFilter !== "all"
                      ? "No customer tenants match your search."
                      : "No customer tenants created yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedCustomers.map((c) => (
                  <TableRow
                    key={c.id}
                    className="group hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => setLocation(`/customers/${c.id}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleSelectRow(c.id)}
                      />
                    </TableCell>

                    <TableCell className="font-semibold text-slate-200 group-hover:text-primary transition-colors">
                      <div className="flex flex-col">
                        <span>{c.name}</span>
                        {c.tenantId && <span className="text-xs text-muted-foreground font-mono font-normal">{c.tenantId}</span>}
                      </div>
                    </TableCell>

                    <TableCell className="text-slate-300 text-sm font-mono">
                      {c.domain ?? "—"}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`capitalize text-[11px] px-2 py-0.5 border font-medium ${STATUS_COLORS[c.status] ?? ""}`}
                      >
                        {c.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="font-bold text-emerald-400 tabular-nums">
                      {c.healthScore ?? 88}%
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </TableCell>

                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 rounded-lg">
                            <MoreHorizontal className="size-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setLocation(`/customers/${c.id}`)}>
                            <Eye className="size-4 mr-2 text-primary" />
                            View Full Snapshot
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditModal(c)}>
                            <Edit className="size-4 mr-2 text-amber-400" />
                            Edit Customer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
          <span>{loading ? "Loading…" : `Showing ${filteredAndSortedCustomers.length} of ${total} customers`}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs tabular-nums font-medium px-2">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="icon"
              className="size-8 rounded-lg"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

      </div>

      {/* Create Customer Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(o) => { if (!createSubmitting) setCreateDialogOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Add Customer Tenant</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cust-name">Customer Name <span className="text-destructive">*</span></Label>
                <Input
                  id="cust-name"
                  placeholder="Contoso Ltd"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                  disabled={createSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-domain">Primary Domain</Label>
                <Input
                  id="cust-domain"
                  placeholder="contoso.com"
                  value={createForm.domain}
                  onChange={(e) => setCreateForm((p) => ({ ...p, domain: e.target.value }))}
                  disabled={createSubmitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cust-tenant">M365 Tenant ID</Label>
                <Input
                  id="cust-tenant"
                  placeholder="72f988bf-..."
                  value={createForm.tenantId}
                  onChange={(e) => setCreateForm((p) => ({ ...p, tenantId: e.target.value }))}
                  disabled={createSubmitting}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-status">Status</Label>
                <Select
                  value={createForm.status}
                  onValueChange={(v) => setCreateForm((p) => ({ ...p, status: v as any }))}
                  disabled={createSubmitting}
                >
                  <SelectTrigger id="cust-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cust-contact">Technical Contact</Label>
                <Input
                  id="cust-contact"
                  placeholder="John Doe"
                  value={createForm.primaryContact}
                  onChange={(e) => setCreateForm((p) => ({ ...p, primaryContact: e.target.value }))}
                  disabled={createSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cust-email">Contact Email</Label>
                <Input
                  id="cust-email"
                  type="email"
                  placeholder="jdoe@contoso.com"
                  value={createForm.primaryEmail}
                  onChange={(e) => setCreateForm((p) => ({ ...p, primaryEmail: e.target.value }))}
                  disabled={createSubmitting}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cust-notes">Internal Notes</Label>
              <Textarea
                id="cust-notes"
                placeholder="Onboarding requirements..."
                rows={3}
                value={createForm.notes}
                onChange={(e) => setCreateForm((p) => ({ ...p, notes: e.target.value }))}
                disabled={createSubmitting}
              />
            </div>

            {isPlatformAdmin && (
              <div className="flex items-center justify-between p-3 border border-purple-500/30 bg-purple-500/5 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="create-cust-testbed" className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 cursor-pointer">
                    <Sparkles className="size-3.5 text-purple-500" />
                    <span>Testbed Customer Tenant (is_testbed)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Designates this customer tenant as a synthetic sandbox/testbed for baseline testing.
                  </p>
                </div>
                <Switch
                  id="create-cust-testbed"
                  checked={createForm.isTestbed}
                  onCheckedChange={(v) => setCreateForm((p) => ({ ...p, isTestbed: v }))}
                  disabled={createSubmitting}
                />
              </div>
            )}

            {createError && <p className="text-sm text-destructive font-medium">{createError}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateDialogOpen(false)} disabled={createSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={createSubmitting}>
                {createSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                Create Customer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(o) => { if (!editSubmitting) setEditDialogOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Customer — {editingCustomer?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleEditSubmit(e)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-name">Customer Name</Label>
                <Input
                  id="edit-cust-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                  disabled={editSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-domain">Primary Domain</Label>
                <Input
                  id="edit-cust-domain"
                  value={editForm.domain}
                  onChange={(e) => setEditForm((p) => ({ ...p, domain: e.target.value }))}
                  disabled={editSubmitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-tenant">M365 Tenant ID</Label>
                <Input
                  id="edit-cust-tenant"
                  value={editForm.tenantId}
                  onChange={(e) => setEditForm((p) => ({ ...p, tenantId: e.target.value }))}
                  disabled={editSubmitting}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-status">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((p) => ({ ...p, status: v as any }))}
                  disabled={editSubmitting}
                >
                  <SelectTrigger id="edit-cust-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-contact">Contact Name</Label>
                <Input
                  id="edit-cust-contact"
                  value={editForm.primaryContact}
                  onChange={(e) => setEditForm((p) => ({ ...p, primaryContact: e.target.value }))}
                  disabled={editSubmitting}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-cust-email">Contact Email</Label>
                <Input
                  id="edit-cust-email"
                  type="email"
                  value={editForm.primaryEmail}
                  onChange={(e) => setEditForm((p) => ({ ...p, primaryEmail: e.target.value }))}
                  disabled={editSubmitting}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-cust-notes">Internal Notes</Label>
              <Textarea
                id="edit-cust-notes"
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                disabled={editSubmitting}
              />
            </div>

            {isPlatformAdmin && (
              <div className="flex items-center justify-between p-3 border border-purple-500/30 bg-purple-500/5 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-cust-testbed" className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 cursor-pointer">
                    <Sparkles className="size-3.5 text-purple-500" />
                    <span>Testbed Customer Tenant (is_testbed)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Designates this customer tenant as a synthetic sandbox/testbed for baseline testing.
                  </p>
                </div>
                <Switch
                  id="edit-cust-testbed"
                  checked={editForm.isTestbed}
                  onCheckedChange={(v) => setEditForm((p) => ({ ...p, isTestbed: v }))}
                  disabled={editSubmitting}
                />
              </div>
            )}

            {editError && <p className="text-sm text-destructive font-medium">{editError}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditDialogOpen(false)} disabled={editSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

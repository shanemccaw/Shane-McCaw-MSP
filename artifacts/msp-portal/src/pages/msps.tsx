/**
 * MspsPage — PlatformAdmin view of all MSPs on the platform.
 * Includes search, column sorting, status filtering, Create MSP, and Edit MSP dialogs.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Building2,
  ChevronLeft,
  ChevronRight,
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
} from "lucide-react";
import { toast } from "sonner";

export interface Msp {
  id: number;
  name: string;
  slug: string;
  domain?: string;
  status: string;
  customerCount?: number;
  tier?: string;
  primaryContactEmail?: string;
  notes?: string;
  isTestbed?: boolean;
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
  trial: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const TIER_BADGES: Record<string, string> = {
  Enterprise: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  Platinum: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  Gold: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Silver: "bg-slate-500/15 text-slate-300 border-slate-500/20",
};

const PAGE_SIZE = 20;
const SLUG_RE = /^[a-z0-9-]*$/;

type SortField = "name" | "status" | "customerCount" | "createdAt";
type SortOrder = "asc" | "desc";

interface CreateMspForm {
  name: string;
  slug: string;
  domain: string;
  status: "trial" | "active" | "suspended";
  tier: string;
  primaryContactEmail: string;
  notes: string;
  isTestbed: boolean;
}

const EMPTY_FORM: CreateMspForm = {
  name: "",
  slug: "",
  domain: "",
  status: "trial",
  tier: "Gold",
  primaryContactEmail: "",
  notes: "",
  isTestbed: false,
};

function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function MspsPage() {
  const [, setLocation] = useLocation();
  const { fetchWithAuth, user } = useAuth();
  const isPlatformAdmin = user?.mspRole === "PlatformAdmin" || user?.role === "admin";
  const [msps, setMsps] = useState<Msp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Sorting
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // Create MSP dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateMspForm>(EMPTY_FORM);
  const [slugManual, setSlugManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Edit MSP dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingMsp, setEditingMsp] = useState<Msp | null>(null);
  const [editForm, setEditForm] = useState<CreateMspForm>(EMPTY_FORM);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  useEffect(() => {
    void fetchMsps(page, search);
  }, [page]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void fetchMsps(1, search);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Client-side filtering & sorting for smooth UX
  const filteredAndSortedMsps = useMemo(() => {
    let result = [...msps];

    if (statusFilter !== "all") {
      result = result.filter((m) => m.status === statusFilter);
    }

    result.sort((a, b) => {
      let valA: any = a[sortField] ?? "";
      let valB: any = b[sortField] ?? "";

      if (sortField === "createdAt") {
        valA = new Date(a.createdAt).getTime();
        valB = new Date(b.createdAt).getTime();
      } else if (sortField === "customerCount") {
        valA = Number(a.customerCount ?? 0);
        valB = Number(b.customerCount ?? 0);
      } else if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [msps, statusFilter, sortField, sortOrder]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setSlugManual(false);
    setServerError(null);
    setCreateDialogOpen(true);
  }

  function handleNameChange(name: string) {
    setForm((prev) => ({
      ...prev,
      name,
      slug: slugManual ? prev.slug : slugify(name),
    }));
  }

  function handleSlugChange(slug: string) {
    if (SLUG_RE.test(slug)) {
      setForm((prev) => ({ ...prev, slug }));
      setSlugManual(true);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setServerError("Name must be at least 2 characters.");
      return;
    }
    if (form.slug.length < 2 || !SLUG_RE.test(form.slug)) {
      setServerError("Slug must be lowercase letters, numbers, and hyphens.");
      return;
    }

    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/admin/msps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug,
          domain: form.domain.trim() || undefined,
          status: form.status,
          tier: form.tier,
          primaryContactEmail: form.primaryContactEmail.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      const body = (await res.json()) as Msp & { error?: string };
      if (!res.ok) {
        setServerError(body.error ?? "Failed to create MSP");
        return;
      }
      toast.success(`MSP "${body.name}" created successfully`);
      setCreateDialogOpen(false);
      setMsps((prev) => [body, ...prev]);
      setTotal((t) => t + 1);
    } catch {
      setServerError("Unexpected error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function openEditDialog(msp: Msp) {
    setEditingMsp(msp);
    setEditForm({
      name: msp.name,
      slug: msp.slug,
      domain: msp.domain ?? "",
      status: (msp.status as "trial" | "active" | "suspended") ?? "active",
      tier: msp.tier ?? "Gold",
      primaryContactEmail: msp.primaryContactEmail ?? "",
      notes: msp.notes ?? "",
      isTestbed: !!msp.isTestbed,
    });
    setEditError(null);
    setEditDialogOpen(true);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMsp) return;

    setEditError(null);
    setEditSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/msps/${editingMsp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          domain: editForm.domain.trim() || undefined,
          status: editForm.status,
          tier: editForm.tier,
          primaryContactEmail: editForm.primaryContactEmail.trim() || undefined,
          notes: editForm.notes.trim() || undefined,
          isTestbed: editForm.isTestbed,
        }),
      });

      if (res.ok) {
        const updated = (await res.json()) as Msp;
        setMsps((prev) => prev.map((m) => (m.id === editingMsp.id ? { ...m, ...updated, isTestbed: editForm.isTestbed } : m)));
        toast.success(`MSP "${editForm.name}" updated`);
      } else {
        // Fallback optimistic update
        setMsps((prev) =>
          prev.map((m) =>
            m.id === editingMsp.id
              ? {
                  ...m,
                  name: editForm.name,
                  domain: editForm.domain,
                  status: editForm.status,
                  tier: editForm.tier,
                  primaryContactEmail: editForm.primaryContactEmail,
                  notes: editForm.notes,
                  isTestbed: editForm.isTestbed,
                }
              : m,
          ),
        );
        toast.success(`MSP "${editForm.name}" updated`);
      }
      setEditDialogOpen(false);
    } catch {
      setEditError("Failed to update MSP partner details.");
    } finally {
      setEditSubmitting(false);
    }
  }

  if (user?.mspRole !== "PlatformAdmin") {
    return (
      <AppShell title="MSPs">
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm space-y-2">
          <Building2 className="size-8 text-muted-foreground/50" />
          <p>You do not have permission to view platform MSPs.</p>
        </div>
      </AppShell>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actions = (
    <Button size="sm" className="gap-1.5 rounded-lg shadow-sm" onClick={openCreateDialog}>
      <Plus className="size-4" />
      Add MSP Partner
    </Button>
  );

  return (
    <AppShell title="MSPs" actions={actions}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        
        {/* Top summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Total MSPs</p>
              <p className="text-2xl font-bold mt-1">{total}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Active MSPs</p>
              <p className="text-2xl font-bold mt-1 text-emerald-400">
                {msps.filter((m) => m.status === "active").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Trial MSPs</p>
              <p className="text-2xl font-bold mt-1 text-blue-400">
                {msps.filter((m) => m.status === "trial").length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400">
              <RefreshCw className="size-5" />
            </div>
          </div>
          <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/50 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase">Total Managed Clients</p>
              <p className="text-2xl font-bold mt-1">
                {msps.reduce((acc, m) => acc + (m.customerCount ?? 0), 0)}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
              <Building2 className="size-5" />
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search MSP name, slug, or domain…"
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
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground rounded-lg"
            onClick={() => void fetchMsps(page, search)}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>

        {/* MSP Data Table */}
        <div className="rounded-xl border border-border/60 bg-slate-900/30 backdrop-blur-md overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("name")}
                >
                  <div className="flex items-center gap-1.5">
                    MSP Partner Name
                    {sortField === "name" ? (
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

                <TableHead className="font-semibold">Tier</TableHead>

                <TableHead
                  className="cursor-pointer font-semibold select-none"
                  onClick={() => handleSort("customerCount")}
                >
                  <div className="flex items-center gap-1.5">
                    Customers
                    {sortField === "customerCount" ? (
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
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-6 w-6 ml-auto rounded" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAndSortedMsps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-36 text-center text-muted-foreground text-sm">
                    {search || statusFilter !== "all"
                      ? "No MSP partners match your search criteria."
                      : "No MSP partners registered yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedMsps.map((m) => (
                  <TableRow
                    key={m.id}
                    className="group hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => setLocation(`/msps/${m.id}`)}
                  >
                    <TableCell className="font-semibold text-slate-200 group-hover:text-primary transition-colors">
                      <div className="flex flex-col">
                        <span>{m.name}</span>
                        <span className="text-xs text-muted-foreground font-normal font-mono">{m.slug}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`capitalize text-[11px] px-2 py-0.5 border font-medium ${STATUS_COLORS[m.status] ?? ""}`}
                      >
                        {m.offboardingState ? "Offboarding" : m.status}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[11px] px-2 py-0.5 border font-medium ${TIER_BADGES[m.tier ?? "Gold"] ?? TIER_BADGES.Gold}`}
                      >
                        {m.tier ?? "Gold"}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-slate-300 font-medium tabular-nums">
                      {m.customerCount ?? 0} tenants
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </TableCell>

                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 rounded-lg">
                            <MoreHorizontal className="size-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setLocation(`/msps/${m.id}`)}>
                            <Eye className="size-4 mr-2 text-primary" />
                            View Full Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(m)}>
                            <Edit className="size-4 mr-2 text-amber-400" />
                            Edit MSP Partner
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              fetchWithAuth(`/api/admin/msps/${m.id}/impersonate`, { method: "POST" })
                                .then(async (res) => {
                                  if (!res.ok) return;
                                  const data = (await res.json()) as { token?: string };
                                  if (data.token) {
                                    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                                    window.open(`${base}/?impersonation_token=${encodeURIComponent(data.token)}`, "_blank");
                                  }
                                })
                                .catch(() => {});
                            }}
                          >
                            <ExternalLink className="size-4 mr-2 text-blue-400" />
                            Impersonate Partner
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

        {/* Pagination footer */}
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
          <span>{loading ? "Loading…" : `Showing ${filteredAndSortedMsps.length} of ${total} MSPs`}</span>
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

      {/* Create MSP dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!submitting) setCreateDialogOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Add MSP Partner</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="msp-name">MSP Name <span className="text-destructive">*</span></Label>
                <Input
                  id="msp-name"
                  placeholder="Contoso Managed Services"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={submitting}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="msp-slug">Slug <span className="text-destructive">*</span></Label>
                <Input
                  id="msp-slug"
                  placeholder="contoso-msp"
                  value={form.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  disabled={submitting}
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="msp-domain">Primary Domain</Label>
                <Input
                  id="msp-domain"
                  placeholder="contoso.com"
                  value={form.domain}
                  onChange={(e) => setForm((prev) => ({ ...prev, domain: e.target.value }))}
                  disabled={submitting}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="msp-contact">Primary Contact Email</Label>
                <Input
                  id="msp-contact"
                  type="email"
                  placeholder="admin@contoso.com"
                  value={form.primaryContactEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, primaryContactEmail: e.target.value }))}
                  disabled={submitting}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="msp-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, status: v as "trial" | "active" | "suspended" }))}
                  disabled={submitting}
                >
                  <SelectTrigger id="msp-status" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="msp-tier">Platform Tier</Label>
                <Select
                  value={form.tier}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, tier: v }))}
                  disabled={submitting}
                >
                  <SelectTrigger id="msp-tier" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Silver">Silver</SelectItem>
                    <SelectItem value="Gold">Gold</SelectItem>
                    <SelectItem value="Platinum">Platinum</SelectItem>
                    <SelectItem value="Enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="msp-notes">Internal Notes</Label>
              <Textarea
                id="msp-notes"
                placeholder="Special SLA requirements, onboarding notes..."
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                disabled={submitting}
                rows={3}
                className="text-sm"
              />
            </div>

            {isPlatformAdmin && (
              <div className="flex items-center justify-between p-3 border border-purple-500/30 bg-purple-500/5 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="create-msp-testbed" className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 cursor-pointer">
                    <Sparkles className="size-3.5 text-purple-500" />
                    <span>Testbed Partner Environment (is_testbed)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Designates this MSP partner as a synthetic sandbox/testbed for baseline testing.
                  </p>
                </div>
                <Switch
                  id="create-msp-testbed"
                  checked={form.isTestbed}
                  onCheckedChange={(v) => setForm((prev) => ({ ...prev, isTestbed: v }))}
                  disabled={submitting}
                />
              </div>
            )}

            {serverError && <p className="text-sm text-destructive font-medium">{serverError}</p>}

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreateDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                Create MSP Partner
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit MSP dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!editSubmitting) setEditDialogOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Edit MSP Partner — {editingMsp?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleEditSubmit(e)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">MSP Name</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={editSubmitting}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-domain">Primary Domain</Label>
                <Input
                  id="edit-domain"
                  value={editForm.domain}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, domain: e.target.value }))}
                  disabled={editSubmitting}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-status">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((prev) => ({ ...prev, status: v as "trial" | "active" | "suspended" }))}
                  disabled={editSubmitting}
                >
                  <SelectTrigger id="edit-status" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-tier">Platform Tier</Label>
                <Select
                  value={editForm.tier}
                  onValueChange={(v) => setEditForm((prev) => ({ ...prev, tier: v }))}
                  disabled={editSubmitting}
                >
                  <SelectTrigger id="edit-tier" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Silver">Silver</SelectItem>
                    <SelectItem value="Gold">Gold</SelectItem>
                    <SelectItem value="Platinum">Platinum</SelectItem>
                    <SelectItem value="Enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-contact">Primary Contact Email</Label>
              <Input
                id="edit-contact"
                type="email"
                value={editForm.primaryContactEmail}
                onChange={(e) => setEditForm((prev) => ({ ...prev, primaryContactEmail: e.target.value }))}
                disabled={editSubmitting}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">Internal Notes</Label>
              <Textarea
                id="edit-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                disabled={editSubmitting}
                rows={3}
                className="text-sm"
              />
            </div>

            {isPlatformAdmin && (
              <div className="flex items-center justify-between p-3 border border-purple-500/30 bg-purple-500/5 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-msp-testbed" className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5 cursor-pointer">
                    <Sparkles className="size-3.5 text-purple-500" />
                    <span>Testbed Partner Environment (is_testbed)</span>
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Designates this MSP partner as a synthetic sandbox/testbed for baseline testing.
                  </p>
                </div>
                <Switch
                  id="edit-msp-testbed"
                  checked={editForm.isTestbed}
                  onCheckedChange={(v) => setEditForm((prev) => ({ ...prev, isTestbed: v }))}
                  disabled={editSubmitting}
                />
              </div>
            )}

            {editError && <p className="text-sm text-destructive font-medium">{editError}</p>}

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditDialogOpen(false)} disabled={editSubmitting}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={editSubmitting}>
                {editSubmitting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

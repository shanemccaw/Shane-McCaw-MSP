/**
 * MspAdmin — Platform admin console for MSP tenant management.
 * Lists all MSPs, allows create/suspend/reactivate, and drills into each MSP.
 */

import { useState, useEffect, useCallback } from "react";
import { useAdminFetch } from "@/lib/useAdminFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { toast } from "sonner";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
} from "lucide-react";

interface Msp {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: "active" | "suspended" | "trial";
  isDirectBusiness: boolean;
  trialEndsAt: string | null;
  offboardingState: string | null;
  createdAt: string;
}

interface MspListResponse {
  msps: Msp[];
  total: number;
  page: number;
  limit: number;
}

interface MspDetail extends Msp {
  subscription: {
    status: string;
    dunningState: string | null;
    tenantCountSnapshot: number;
    serviceName: string;
    stripeCustomerId: string | null;
  } | null;
  userCount: number;
  override: Record<string, unknown> | null;
}

const STATUS_BADGE: Record<string, string> = {
  active: "text-green-600 bg-green-50 border-green-200",
  suspended: "text-red-600 bg-red-50 border-red-200",
  trial: "text-amber-600 bg-amber-50 border-amber-200",
};

export default function MspAdminPage() {
  const { adminFetch } = useAdminFetch();
  const [msps, setMsps] = useState<Msp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedMsp, setSelectedMsp] = useState<MspDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actioning, setActioning] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", domain: "" });
  const LIMIT = 25;

  const loadMsps = useCallback(async (p = page, q = search, s = statusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (q) params.set("search", q);
      if (s !== "all") params.set("status", s);
      const res = await adminFetch(`/api/admin/msps?${params}`);
      if (res.ok) {
        const data = (await res.json()) as MspListResponse;
        setMsps(data.msps);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [adminFetch, page, search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => { void loadMsps(1, search, statusFilter); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, statusFilter]);

  useEffect(() => { void loadMsps(page, search, statusFilter); }, [page]);

  async function loadDetail(id: number) {
    setLoadingDetail(true);
    try {
      const res = await adminFetch(`/api/admin/msps/${id}`);
      if (res.ok) {
        const data = (await res.json()) as MspDetail;
        setSelectedMsp(data);
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await adminFetch("/api/admin/msps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createForm.name, slug: createForm.slug, domain: createForm.domain || undefined }),
      });
      if (res.ok) {
        toast.success("MSP created");
        setShowCreate(false);
        setCreateForm({ name: "", slug: "", domain: "" });
        void loadMsps(1, "", "all");
        setSearch(""); setStatusFilter("all"); setPage(1);
      } else {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Create failed");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleSuspend(id: number) {
    if (!confirm("Suspend this MSP? All users will lose access immediately.")) return;
    setActioning(id);
    try {
      const res = await adminFetch(`/api/admin/msps/${id}/suspend`, { method: "POST" });
      if (res.ok) {
        toast.success("MSP suspended");
        setMsps((m) => m.map((mm) => mm.id === id ? { ...mm, status: "suspended" } : mm));
        if (selectedMsp?.id === id) setSelectedMsp((s) => s ? { ...s, status: "suspended" } : s);
      } else {
        toast.error("Suspend failed");
      }
    } finally {
      setActioning(null);
    }
  }

  async function handleReactivate(id: number) {
    setActioning(id);
    try {
      const res = await adminFetch(`/api/admin/msps/${id}/reactivate`, { method: "POST" });
      if (res.ok) {
        toast.success("MSP reactivated");
        setMsps((m) => m.map((mm) => mm.id === id ? { ...mm, status: "active" } : mm));
        if (selectedMsp?.id === id) setSelectedMsp((s) => s ? { ...s, status: "active" } : s);
      } else {
        toast.error("Reactivate failed");
      }
    } finally {
      setActioning(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="size-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">MSP Management</h2>
            <p className="text-sm text-muted-foreground">Platform admin view of all MSP tenants.</p>
          </div>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="size-3.5" />
          New MSP
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, slug, domain…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
            <SelectItem value="active" className="text-xs">Active</SelectItem>
            <SelectItem value="trial" className="text-xs">Trial</SelectItem>
            <SelectItem value="suspended" className="text-xs">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => void loadMsps()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-4">
        {/* MSP table */}
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                    ))}
                  </TableRow>
                ))
                : msps.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                        No MSPs found.
                      </TableCell>
                    </TableRow>
                  )
                  : msps.map((msp) => (
                    <TableRow
                      key={msp.id}
                      className={`cursor-pointer ${selectedMsp?.id === msp.id ? "bg-primary/5" : ""}`}
                      onClick={() => void loadDetail(msp.id)}
                    >
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{msp.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{msp.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[msp.status] ?? ""}`}>
                          {msp.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(msp.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {msp.status === "active" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6"
                              title="Suspend"
                              disabled={actioning === msp.id}
                              onClick={(e) => { e.stopPropagation(); void handleSuspend(msp.id); }}
                            >
                              {actioning === msp.id ? <Loader2 className="size-3 animate-spin" /> : <PauseCircle className="size-3 text-amber-600" />}
                            </Button>
                          )}
                          {msp.status === "suspended" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6"
                              title="Reactivate"
                              disabled={actioning === msp.id}
                              onClick={(e) => { e.stopPropagation(); void handleReactivate(msp.id); }}
                            >
                              {actioning === msp.id ? <Loader2 className="size-3 animate-spin" /> : <PlayCircle className="size-3 text-green-600" />}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        {/* Detail panel */}
        <div>
          {loadingDetail ? (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-48" />
              </CardContent>
            </Card>
          ) : selectedMsp ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {selectedMsp.name}
                  <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[selectedMsp.status] ?? ""}`}>
                    {selectedMsp.status}
                  </Badge>
                  {selectedMsp.isDirectBusiness && (
                    <Badge variant="outline" className="text-[10px]">Direct</Badge>
                  )}
                </CardTitle>
                <CardDescription className="font-mono text-xs">{selectedMsp.slug}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {selectedMsp.subscription && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subscription</p>
                    <div className="flex items-center gap-2">
                      <span>{selectedMsp.subscription.serviceName}</span>
                      <Badge variant="outline" className="text-[10px]">{selectedMsp.subscription.status}</Badge>
                      {selectedMsp.subscription.dunningState && (
                        <Badge variant="destructive" className="text-[10px]">{selectedMsp.subscription.dunningState}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedMsp.subscription.tenantCountSnapshot} active tenants
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Users</p>
                    <p className="font-medium flex items-center gap-1">
                      <Users className="size-3" />
                      {selectedMsp.userCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Overrides</p>
                    <p className="font-medium flex items-center gap-1">
                      <Shield className="size-3" />
                      {selectedMsp.override ? "Active" : "None"}
                    </p>
                  </div>
                  {selectedMsp.domain && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Domain</p>
                      <p className="font-medium">{selectedMsp.domain}</p>
                    </div>
                  )}
                  {selectedMsp.trialEndsAt && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Trial Ends</p>
                      <p className="font-medium">{new Date(selectedMsp.trialEndsAt).toLocaleDateString()}</p>
                    </div>
                  )}
                  {selectedMsp.offboardingState && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Offboarding</p>
                      <Badge variant="destructive" className="text-[10px] mt-0.5">{selectedMsp.offboardingState}</Badge>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
                  {selectedMsp.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-amber-600 border-amber-200 hover:bg-amber-50 gap-1.5 justify-start"
                      disabled={actioning === selectedMsp.id}
                      onClick={() => void handleSuspend(selectedMsp.id)}
                    >
                      <PauseCircle className="size-3.5" />
                      Suspend MSP
                    </Button>
                  )}
                  {selectedMsp.status === "suspended" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-200 hover:bg-green-50 gap-1.5 justify-start"
                      disabled={actioning === selectedMsp.id}
                      onClick={() => void handleReactivate(selectedMsp.id)}
                    >
                      <PlayCircle className="size-3.5" />
                      Reactivate MSP
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 justify-start text-muted-foreground"
                    onClick={() => window.open(`/portal/msps`, "_blank")}
                  >
                    <ExternalLink className="size-3.5" />
                    View in MSP Portal
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">
                Select an MSP to see details
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} MSP{total !== 1 ? "s" : ""} total</span>
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

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Create MSP Tenant</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="msp-name" className="text-xs">Organisation Name *</Label>
              <Input
                id="msp-name"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Contoso IT Solutions"
                required
                minLength={2}
                maxLength={120}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="msp-slug" className="text-xs">Slug * (lowercase, hyphens only)</Label>
              <Input
                id="msp-slug"
                value={createForm.slug}
                onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                placeholder="contoso-it"
                required
                minLength={2}
                maxLength={60}
                pattern="^[a-z0-9-]+"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="msp-domain" className="text-xs">Domain (optional)</Label>
              <Input
                id="msp-domain"
                value={createForm.domain}
                onChange={(e) => setCreateForm((f) => ({ ...f, domain: e.target.value }))}
                placeholder="contosoit.com"
                className="h-8 text-sm"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={creating} className="gap-1.5">
                {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Create MSP
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

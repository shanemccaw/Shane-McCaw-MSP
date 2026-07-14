/**
 * MSPs page — PlatformAdmin view of all MSPs on the platform.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

interface Msp {
  id: number;
  name: string;
  slug: string;
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
  trial: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const PAGE_SIZE = 20;

const SLUG_RE = /^[a-z0-9-]*$/;

interface CreateMspForm {
  name: string;
  slug: string;
  domain: string;
  status: "trial" | "active";
}

const EMPTY_FORM: CreateMspForm = { name: "", slug: "", domain: "", status: "trial" };

function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function MspsPage() {
  const { fetchWithAuth, user } = useAuth();
  const [msps, setMsps] = useState<Msp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create MSP dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateMspForm>(EMPTY_FORM);
  const [slugManual, setSlugManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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

  function openDialog() {
    setForm(EMPTY_FORM);
    setSlugManual(false);
    setServerError(null);
    setDialogOpen(true);
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

  function validate(): string | null {
    if (form.name.trim().length < 2) return "Name must be at least 2 characters.";
    if (form.slug.length < 2) return "Slug must be at least 2 characters.";
    if (!SLUG_RE.test(form.slug)) return "Slug must be lowercase letters, numbers, and hyphens only.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setServerError(err); return; }

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
        }),
      });
      const body = (await res.json()) as Msp & { error?: string };
      if (!res.ok) {
        setServerError(body.error ?? "Failed to create MSP");
        return;
      }
      toast.success(`MSP "${body.name}" created`);
      setDialogOpen(false);
      setMsps((prev) => [body, ...prev]);
      setTotal((t) => t + 1);
    } catch {
      setServerError("Unexpected error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

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
    <Button size="sm" className="gap-1.5" onClick={openDialog}>
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                            window.location.href = `${base}/${m.slug}/dashboard`;
                          }}
                          title={`Go to ${m.name} dashboard`}
                        >
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

      {/* Create MSP dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!submitting) setDialogOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add MSP</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="msp-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="msp-name"
                placeholder="Contoso IT Services"
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={submitting}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="msp-slug">
                Slug <span className="text-destructive">*</span>
                <span className="ml-1 text-xs text-muted-foreground font-normal">(URL-safe identifier)</span>
              </Label>
              <Input
                id="msp-slug"
                placeholder="contoso-it"
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                disabled={submitting}
                className="h-9 text-sm font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="msp-domain">Domain <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
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
              <Label htmlFor="msp-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((prev) => ({ ...prev, status: v as "trial" | "active" }))}
                disabled={submitting}
              >
                <SelectTrigger id="msp-status" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {serverError && (
              <p className="text-sm text-destructive">{serverError}</p>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                Create MSP
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

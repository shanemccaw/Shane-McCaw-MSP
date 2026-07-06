import { useState, useMemo } from "react";
import { Plus, Download, Trash2, Eye, EyeOff, Lock, Copy, Upload, Loader2 } from "lucide-react";
import { useServices, useDeleteService, useUpdateService, useCreateService, type ServiceRow } from "@/hooks/useServices";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import VisibilityBadge from "./VisibilityBadge";
import ServicesFilters, { type FilterState } from "./ServicesFilters";

const PAGE_SIZE = 20;

function priceLabel(s: ServiceRow): string {
  const fmt = (v: string | null) => {
    if (!v) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const base = fmt(s.basePrice);
  const max = fmt(s.maxPrice);
  if (base && max) return `${base}–${max}`;
  if (base) return base;
  return fmt(s.price) ?? "—";
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[#21262D]">
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3.5 rounded bg-[#21262D] animate-pulse" style={{ width: `${40 + (i * 13) % 50}%` }} />
        </td>
      ))}
    </tr>
  );
}

interface Props {
  onEdit: (id: number) => void;
  onCreate: () => void;
}

export default function ServicesList({ onEdit, onCreate }: Props) {
  const { toast } = useToast();
  const { fetchWithAuth } = useAuth();
  const { data: services = [], isLoading } = useServices();
  const deleteService = useDeleteService();
  const updateService = useUpdateService();
  const createService = useCreateService();

  const [filters, setFilters] = useState<FilterState>({ search: "", category: "", visibility: "", priceType: "" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [archiveTarget, setArchiveTarget] = useState<ServiceRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [sortCol, setSortCol] = useState<"name" | "category" | "price" | "visibility" | "updatedAt">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [publishingToProd, setPublishingToProd] = useState(false);

  async function handlePublishToProd() {
    setPublishingToProd(true);
    try {
      const res = await fetchWithAuth("/api/admin/services/publish-to-prod", { method: "POST" });
      const body = await res.json() as { ok?: boolean; upserted?: number; removed?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to publish");
      toast({ title: "Published to production", description: `${body.upserted ?? 0} service(s) synced, ${body.removed ?? 0} removed.` });
    } catch (err) {
      toast({ title: "Publish failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setPublishingToProd(false);
    }
  }

  const categories = useMemo(
    () => [...new Set(services.map(s => s.category).filter(Boolean) as string[])].sort(),
    [services]
  );

  const filtered = useMemo(() => {
    let list = services;
    const q = filters.search.toLowerCase();
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || (s.slug ?? "").toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q));
    if (filters.category) list = list.filter(s => s.category === filters.category);
    if (filters.visibility) list = list.filter(s => s.visibility === filters.visibility);
    if (filters.priceType === "free") list = list.filter(s => !s.price && !s.basePrice);
    if (filters.priceType === "paid") list = list.filter(s => !!(s.price || s.basePrice));
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "name") cmp = a.name.localeCompare(b.name);
      else if (sortCol === "category") cmp = (a.category ?? "").localeCompare(b.category ?? "");
      else if (sortCol === "price") cmp = parseFloat(a.price ?? a.basePrice ?? "0") - parseFloat(b.price ?? b.basePrice ?? "0");
      else if (sortCol === "visibility") cmp = a.visibility.localeCompare(b.visibility);
      else if (sortCol === "updatedAt") cmp = new Date(a.updatedAt ?? a.createdAt).getTime() - new Date(b.updatedAt ?? b.createdAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [services, filters, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir(col === "updatedAt" ? "desc" : "asc"); }
    setPage(1);
  }

  function toggleSelect(id: number) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function selectAll() {
    if (selected.size === pageRows.length) setSelected(new Set());
    else setSelected(new Set(pageRows.map(r => r.id)));
  }

  function SortIcon({ col }: { col: typeof sortCol }) {
    if (sortCol !== col) return <span className="text-[#30363D] ml-1">↕</span>;
    return <span className="text-[#0078D4] ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  async function handleDuplicate(s: ServiceRow) {
    const baseName = s.name + " (copy)";
    const baseSlug = (s.slug ?? s.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")) + "-copy";
    try {
      const created = await createService.mutateAsync({ name: baseName, slug: baseSlug, billingType: s.billingType });
      await updateService.mutateAsync({
        id: created.id,
        data: {
          description: s.description, category: s.category, deliverables: s.deliverables,
          price: s.price, basePrice: s.basePrice, maxPrice: s.maxPrice, durationDays: s.durationDays,
          turnaround: s.turnaround, isPublic: false, visibility: "private",
          serviceType: s.serviceType, tagline: s.tagline, targetAudience: s.targetAudience,
          inclusions: s.inclusions, features: s.features, badge: s.badge, highlighted: false,
          hoursPerMonth: s.hoursPerMonth, iconName: s.iconName, pageHref: null, sortOrder: s.sortOrder,
          tier: s.tier, workflowTemplateId: s.workflowTemplateId, slug: baseSlug,
          billingType: s.billingType, name: baseName,
        },
      });
      toast({ title: "Service duplicated", description: baseName });
      onEdit(created.id);
    } catch (err) {
      toast({ title: "Duplicate failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function handleBulkVisibility(visibility: "public" | "private" | "landing_page_only") {
    const ids = [...selected];
    await Promise.allSettled(ids.map(id => updateService.mutateAsync({ id, data: { visibility, isPublic: visibility === "public" } })));
    toast({ title: `${ids.length} service${ids.length !== 1 ? "s" : ""} set to ${visibility}` });
    setSelected(new Set());
  }

  async function handleBulkArchive() {
    const ids = [...selected];
    let failed = 0;
    await Promise.allSettled(ids.map(async id => {
      try { await deleteService.mutateAsync(id); }
      catch { failed++; }
    }));
    if (failed > 0) toast({ title: `${failed} service${failed !== 1 ? "s" : ""} could not be archived`, variant: "destructive" });
    else toast({ title: `${ids.length - failed} service${ids.length - failed !== 1 ? "s" : ""} archived` });
    setSelected(new Set());
    setBulkArchiveOpen(false);
  }

  async function handleArchive(s: ServiceRow) {
    try {
      await deleteService.mutateAsync(s.id);
      toast({ title: "Service archived" });
    } catch (err) {
      toast({ title: "Cannot archive", description: (err as Error).message, variant: "destructive" });
    }
    setArchiveTarget(null);
  }

  function exportCsv() {
    const rows = selected.size > 0 ? filtered.filter(r => selected.has(r.id)) : filtered;
    const header = ["ID", "Name", "Slug", "Category", "Price", "Base Price", "Max Price", "Billing", "Visibility", "Badge", "Created At"];
    const lines = rows.map(r => [
      r.id, JSON.stringify(r.name), r.slug ?? "", r.category ?? "", r.price ?? "", r.basePrice ?? "", r.maxPrice ?? "",
      r.billingType, r.visibility, r.badge ?? "", r.createdAt,
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "services.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const ThBtn = ({ col, label }: { col: typeof sortCol; label: string }) => (
    <th className="px-3 py-2.5 text-left">
      <button type="button" onClick={() => toggleSort(col)}
        className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider hover:text-[#E6EDF3] transition-colors whitespace-nowrap">
        {label}<SortIcon col={col} />
      </button>
    </th>
  );

  return (
    <div className="flex h-full overflow-hidden">
      <ServicesFilters filters={filters} onChange={f => { setFilters(f); setPage(1); setSelected(new Set()); }} categories={categories} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#30363D] bg-[#161B22] flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[#E6EDF3]">Service Offerings</h2>
            <p className="text-xs text-[#7D8590]">
              {isLoading ? "Loading…" : `${filtered.length} of ${services.length} service${services.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={exportCsv}
              className="flex items-center gap-1.5 border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
              <Download className="w-3.5 h-3.5" />
              {selected.size > 0 ? `Export ${selected.size}` : "Export CSV"}
            </button>
            <button type="button" onClick={() => { void handlePublishToProd(); }} disabled={publishingToProd}
              className="flex items-center gap-1.5 border border-[#30363D] text-[#C9D1D9] hover:border-emerald-500/40 hover:text-emerald-400 bg-[#1C2128] px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors">
              {publishingToProd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Publish to Prod
            </button>
            <button type="button" onClick={onCreate}
              className="flex items-center gap-1.5 bg-[#0078D4] hover:bg-[#006CBE] text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" />
              New Service
            </button>
          </div>
        </div>

        {/* Bulk action toolbar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-[#0078D4]/10 border-b border-[#0078D4]/20 flex-shrink-0">
            <span className="text-xs font-semibold text-[#0078D4]">{selected.size} selected</span>
            <div className="flex items-center gap-1.5 ml-2">
              <button type="button" onClick={() => void handleBulkVisibility("public")}
                className="flex items-center gap-1 text-xs border border-emerald-500/30 text-emerald-400 px-2.5 py-1 rounded-lg hover:bg-emerald-500/10 transition-colors">
                <Eye className="w-3 h-3" /> Set Public
              </button>
              <button type="button" onClick={() => void handleBulkVisibility("private")}
                className="flex items-center gap-1 text-xs border border-[#30363D] text-[#7D8590] px-2.5 py-1 rounded-lg hover:bg-[#1C2128] transition-colors">
                <EyeOff className="w-3 h-3" /> Set Private
              </button>
              <button type="button" onClick={() => void handleBulkVisibility("landing_page_only")}
                className="flex items-center gap-1 text-xs border border-amber-500/30 text-amber-400 px-2.5 py-1 rounded-lg hover:bg-amber-500/10 transition-colors">
                <Lock className="w-3 h-3" /> Set LP Only
              </button>
              <button type="button" onClick={() => setBulkArchiveOpen(true)}
                className="flex items-center gap-1 text-xs border border-red-500/30 text-red-400 px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition-colors">
                <Trash2 className="w-3 h-3" /> Archive
              </button>
              <button type="button" onClick={exportCsv}
                className="flex items-center gap-1 text-xs border border-[#30363D] text-[#7D8590] px-2.5 py-1 rounded-lg hover:bg-[#1C2128] transition-colors">
                <Download className="w-3 h-3" /> CSV
              </button>
            </div>
            <button type="button" onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
              Deselect all
            </button>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#161B22] sticky top-0 z-10">
              <tr className="border-b border-[#21262D]">
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox"
                    checked={pageRows.length > 0 && selected.size === pageRows.length}
                    onChange={selectAll}
                    className="rounded border-[#30363D] bg-[#0D1117] text-[#0078D4]" />
                </th>
                <ThBtn col="name" label="Name" />
                <ThBtn col="category" label="Category" />
                <ThBtn col="price" label="Price" />
                <ThBtn col="visibility" label="Visibility" />
                <th className="px-3 py-2.5 text-left">
                  <span className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider">Badge</span>
                </th>
                <ThBtn col="updatedAt" label="Updated" />
                <th className="px-3 py-2.5 w-24">
                  <span className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262D]">
              {isLoading ? (
                [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-[#7D8590]">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-10 h-10 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <p className="text-sm">No services match your filters</p>
                    </div>
                  </td>
                </tr>
              ) : (
                pageRows.map(s => (
                  <tr key={s.id}
                    className={`group hover:bg-[#161B22] transition-colors cursor-pointer ${selected.has(s.id) ? "bg-[#0078D4]/5" : ""}`}
                    onClick={() => onEdit(s.id)}>
                    <td className="px-3 py-3" onClick={e => { e.stopPropagation(); toggleSelect(s.id); }}>
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)}
                        className="rounded border-[#30363D] bg-[#0D1117] text-[#0078D4]" />
                    </td>
                    <td className="px-3 py-3">
                      <div>
                        <p className="text-sm font-medium text-[#E6EDF3] leading-snug">{s.name}</p>
                        {s.slug && <p className="text-xs font-mono text-[#484F58] truncate max-w-[200px]">{s.slug}</p>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-[#7D8590]">{s.category ?? "—"}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-semibold text-[#0078D4]">{priceLabel(s)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <VisibilityBadge visibility={s.visibility} size="xs" />
                    </td>
                    <td className="px-3 py-3">
                      {s.badge
                        ? <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] px-1.5 py-0.5 rounded font-medium">{s.badge}</span>
                        : <span className="text-xs text-[#30363D]">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-[#7D8590]">{new Date(s.updatedAt ?? s.createdAt).toLocaleDateString()}</span>
                    </td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={() => onEdit(s.id)} title="Edit"
                          className="p-1.5 rounded text-[#7D8590] hover:text-[#0078D4] hover:bg-[#0078D4]/10 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button type="button" onClick={() => void handleDuplicate(s)} title="Duplicate"
                          className="p-1.5 rounded text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => setArchiveTarget(s)} title="Archive"
                          className="p-1.5 rounded text-[#7D8590] hover:text-red-400 hover:bg-red-500/10 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#30363D] bg-[#161B22] flex-shrink-0">
            <p className="text-xs text-[#7D8590]">
              Page {page} of {totalPages} · {filtered.length} results
            </p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage(1)} disabled={page === 1}
                className="px-2 py-1 text-xs rounded border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] disabled:opacity-30 transition-colors">«</button>
              <button type="button" onClick={() => setPage(p => p - 1)} disabled={page === 1}
                className="px-2 py-1 text-xs rounded border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] disabled:opacity-30 transition-colors">‹</button>
              <span className="px-3 py-1 text-xs text-[#E6EDF3] bg-[#0078D4] rounded border border-[#0078D4]">{page}</span>
              <button type="button" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}
                className="px-2 py-1 text-xs rounded border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] disabled:opacity-30 transition-colors">›</button>
              <button type="button" onClick={() => setPage(totalPages)} disabled={page === totalPages}
                className="px-2 py-1 text-xs rounded border border-[#30363D] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] disabled:opacity-30 transition-colors">»</button>
            </div>
          </div>
        )}
      </div>

      {/* Archive single confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={o => { if (!o) setArchiveTarget(null); }}>
        <AlertDialogContent className="bg-[#161B22] border-[#30363D]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#E6EDF3]">Archive service?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              <strong className="text-[#E6EDF3]">{archiveTarget?.name}</strong> will be permanently deleted.
              This cannot be undone. Services referenced by active clients, contracts, or workflow templates cannot be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#30363D] text-[#7D8590] hover:bg-[#1C2128]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveTarget && void handleArchive(archiveTarget)}
              className="bg-red-600 hover:bg-red-700 text-white border-0">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk archive confirmation */}
      <AlertDialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <AlertDialogContent className="bg-[#161B22] border-[#30363D]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#E6EDF3]">Archive {selected.size} services?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              Services referenced by active clients, contracts, or workflow templates will be skipped.
              All others will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#30363D] text-[#7D8590] hover:bg-[#1C2128]">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleBulkArchive()} className="bg-red-600 hover:bg-red-700 text-white border-0">
              Archive {selected.size} services
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

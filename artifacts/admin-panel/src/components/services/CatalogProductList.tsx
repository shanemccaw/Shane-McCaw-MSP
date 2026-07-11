import { useState, useMemo } from "react";
import { Plus, Download, Trash2, Eye, EyeOff, Lock, Copy, Upload, Loader2, GripVertical, Search } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useServices, useDeleteService, useUpdateService, useCreateService, useBulkCategoryMove, type ServiceRow } from "@/hooks/useServices";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import VisibilityBadge from "./VisibilityBadge";

function priceLabel(s: ServiceRow): string {
  const fmt = (v: string | null | undefined) => {
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

function serviceTypeColor(type: string | null): string {
  switch (type) {
    case "micro_offer": return "bg-emerald-500/10 text-emerald-400";
    case "retainer": return "bg-purple-500/10 text-purple-400";
    case "optional": return "bg-amber-500/10 text-amber-400";
    case "service_area": return "bg-[#0078D4]/10 text-[#0078D4]";
    default: return "bg-[#21262D] text-[#7D8590]";
  }
}

interface SortableRowProps {
  service: ServiceRow;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (id: number) => void;
  onCheck: (id: number) => void;
  onDuplicate: (s: ServiceRow) => void;
  onArchive: (s: ServiceRow) => void;
}

function SortableRow({ service: s, isSelected, isChecked, onSelect, onCheck, onDuplicate, onArchive }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-[#21262D] transition-colors ${isSelected ? "bg-[#0078D4]/8" : isChecked ? "bg-[#0078D4]/5" : "hover:bg-[#1C2128]"}`}
      onClick={() => onSelect(s.id)}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="flex-shrink-0 text-[#30363D] opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Checkbox */}
      <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); onCheck(s.id); }}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onCheck(s.id)}
          className="rounded border-[#30363D] bg-[#0D1117] text-[#0078D4]"
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-xs font-medium truncate ${isSelected ? "text-[#0078D4]" : "text-[#E6EDF3]"}`}>{s.name}</p>
          {s.serviceType && (
            <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${serviceTypeColor(s.serviceType)}`}>
              {s.serviceType.replace(/_/g, " ")}
            </span>
          )}
          {s.isFreeOffering && (
            <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-emerald-500/10 text-emerald-400">
              Free
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-semibold text-[#0078D4]">{priceLabel(s)}</span>
          <span className="text-[10px] text-[#484F58]">·</span>
          <VisibilityBadge visibility={s.visibility} size="xs" />
          {(s.categoryPath ?? s.category) && (
            <>
              <span className="text-[10px] text-[#484F58]">·</span>
              <span className="text-[10px] text-[#484F58] truncate">{s.categoryPath ?? s.category}</span>
            </>
          )}
        </div>
      </div>

      {/* Row actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={() => onDuplicate(s)} title="Duplicate" className="p-1 rounded text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#21262D]">
          <Copy className="w-3 h-3" />
        </button>
        <button type="button" onClick={() => onArchive(s)} title="Archive" className="p-1 rounded text-[#7D8590] hover:text-red-400 hover:bg-red-500/10">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

interface Props {
  services: ServiceRow[];
  isLoading: boolean;
  categoryPath: string | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreateNew: () => void;
}

export default function CatalogProductList({ services, isLoading, categoryPath, selectedId, onSelect, onCreateNew }: Props) {
  const { toast } = useToast();
  const { fetchWithAuth } = useAuth();
  const deleteService = useDeleteService();
  const updateService = useUpdateService();
  const createService = useCreateService();
  const bulkCategoryMove = useBulkCategoryMove();
  const { refetch } = useServices();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [archiveTarget, setArchiveTarget] = useState<ServiceRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState("");
  const [showBulkCategoryInput, setShowBulkCategoryInput] = useState(false);
  const [publishingToProd, setPublishingToProd] = useState(false);
  const [sortedIds, setSortedIds] = useState<number[]>([]);

  const filtered = useMemo(() => {
    let list = services;
    if (categoryPath === "__uncategorized__") {
      list = list.filter(s => !s.categoryPath && !s.category);
    } else if (categoryPath !== null) {
      list = list.filter(s => {
        const p = s.categoryPath ?? s.category ?? "";
        return p === categoryPath || p.startsWith(categoryPath + "/");
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || (s.categoryPath ?? s.category ?? "").toLowerCase().includes(q) || (s.tags ?? []).some(t => t.toLowerCase().includes(q)));
    }
    return list;
  }, [services, categoryPath, search]);

  const sortedFiltered = useMemo(() => {
    if (sortedIds.length === 0) return [...filtered].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    const idxMap = new Map(sortedIds.map((id, i) => [id, i]));
    return [...filtered].sort((a, b) => {
      const ia = idxMap.has(a.id) ? idxMap.get(a.id)! : 999;
      const ib = idxMap.has(b.id) ? idxMap.get(b.id)! : 999;
      return ia - ib;
    });
  }, [filtered, sortedIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const currentOrder = sortedFiltered.map(s => s.id);
    const oldIdx = currentOrder.indexOf(Number(active.id));
    const newIdx = currentOrder.indexOf(Number(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const newOrder = arrayMove(currentOrder, oldIdx, newIdx);
    setSortedIds(newOrder);
    // Persist sortOrder to server
    void Promise.allSettled(newOrder.map((id, i) =>
      updateService.mutateAsync({ id, data: { sortOrder: i } })
    ));
  }

  function toggleSelect(id: number) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function selectAll() {
    if (selected.size === sortedFiltered.length) setSelected(new Set());
    else setSelected(new Set(sortedFiltered.map(r => r.id)));
  }

  async function handleDuplicate(s: ServiceRow) {
    const baseName = s.name + " (copy)";
    const baseSlug = (s.slug ?? s.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")) + "-copy";
    try {
      const created = await createService.mutateAsync({ name: baseName, slug: baseSlug, billingType: s.billingType });
      await updateService.mutateAsync({
        id: created.id,
        data: {
          description: s.description, category: s.category, categoryPath: s.categoryPath,
          deliverables: s.deliverables, price: s.price, basePrice: s.basePrice, maxPrice: s.maxPrice,
          durationDays: s.durationDays, turnaround: s.turnaround, isPublic: false, visibility: "private",
          serviceType: s.serviceType, tagline: s.tagline, targetAudience: s.targetAudience,
          inclusions: s.inclusions, features: s.features, badge: s.badge, highlighted: false,
          hoursPerMonth: s.hoursPerMonth, iconName: s.iconName, pageHref: null, sortOrder: s.sortOrder,
          tier: s.tier, workflowTemplateId: s.workflowTemplateId, slug: baseSlug,
          billingType: s.billingType, name: baseName, tags: s.tags, isFreeOffering: s.isFreeOffering,
          fulfillmentTypeKey: s.fulfillmentTypeKey, triggeringSignalKeys: s.triggeringSignalKeys,
        },
      });
      toast({ title: "Service duplicated", description: baseName });
      onSelect(created.id);
    } catch (err) {
      toast({ title: "Duplicate failed", description: (err as Error).message, variant: "destructive" });
    }
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
    if (failed > 0) toast({ title: `${failed} service(s) could not be archived`, variant: "destructive" });
    else toast({ title: `${ids.length - failed} service(s) archived` });
    setSelected(new Set());
    setBulkArchiveOpen(false);
  }

  async function handleBulkCategoryMove() {
    const ids = [...selected];
    await bulkCategoryMove.mutateAsync({ ids, categoryPath: bulkCategoryTarget || null });
    toast({ title: `${ids.length} service(s) moved to "${bulkCategoryTarget || "uncategorized"}"` });
    setSelected(new Set());
    setShowBulkCategoryInput(false);
    setBulkCategoryTarget("");
  }

  function exportCsv() {
    const rows = selected.size > 0 ? filtered.filter(r => selected.has(r.id)) : filtered;
    const header = ["ID", "Name", "Slug", "CategoryPath", "Price", "Visibility"];
    const lines = rows.map(r => [r.id, JSON.stringify(r.name), r.slug ?? "", r.categoryPath ?? r.category ?? "", r.price ?? "", r.visibility].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "services.csv"; a.click();
    URL.revokeObjectURL(url);
  }

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

  const allCategories = useMemo(
    () => [...new Set(services.map(s => s.categoryPath ?? s.category).filter(Boolean) as string[])].sort(),
    [services]
  );

  return (
    <div className="flex flex-col border-r border-[#21262D] bg-[#0D1117] overflow-hidden" style={{ width: 380, flexShrink: 0 }}>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#21262D] flex-shrink-0">
        <span className="text-xs font-bold text-[#E6EDF3]">
          {categoryPath === null ? "All Products" : categoryPath === "__uncategorized__" ? "Uncategorized" : categoryPath}
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={exportCsv} title="Export CSV"
            className="p-1.5 rounded text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => void handlePublishToProd()} disabled={publishingToProd} title="Publish to Prod"
            className="p-1.5 rounded text-[#7D8590] hover:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors">
            {publishingToProd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </button>
          <button type="button" onClick={onCreateNew}
            className="flex items-center gap-1 text-xs font-semibold bg-[#0078D4] text-white px-2.5 py-1.5 rounded-lg hover:bg-[#006CBE] transition-colors">
            <Plus className="w-3 h-3" /> New
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-3 py-2 border-b border-[#21262D] flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484F58]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-[#1C2128] border border-[#30363D] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
          />
        </div>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-b border-[#0078D4]/20 bg-[#0078D4]/5 flex-shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-[#0078D4]">{selected.size} selected</span>
            <button type="button" onClick={() => void handleBulkVisibility("public")}
              className="flex items-center gap-1 text-[10px] border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded hover:bg-emerald-500/10">
              <Eye className="w-3 h-3" /> Public
            </button>
            <button type="button" onClick={() => void handleBulkVisibility("private")}
              className="flex items-center gap-1 text-[10px] border border-[#30363D] text-[#7D8590] px-2 py-0.5 rounded hover:bg-[#1C2128]">
              <EyeOff className="w-3 h-3" /> Private
            </button>
            <button type="button" onClick={() => void handleBulkVisibility("landing_page_only")}
              className="flex items-center gap-1 text-[10px] border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded hover:bg-amber-500/10">
              <Lock className="w-3 h-3" /> LP Only
            </button>
            <button type="button" onClick={() => setShowBulkCategoryInput(p => !p)}
              className="flex items-center gap-1 text-[10px] border border-[#30363D] text-[#7D8590] px-2 py-0.5 rounded hover:bg-[#1C2128]">
              Move to…
            </button>
            <button type="button" onClick={() => setBulkArchiveOpen(true)}
              className="flex items-center gap-1 text-[10px] border border-red-500/30 text-red-400 px-2 py-0.5 rounded hover:bg-red-500/10">
              <Trash2 className="w-3 h-3" />
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[10px] text-[#484F58] hover:text-[#7D8590]">
              Clear
            </button>
          </div>
          {showBulkCategoryInput && (
            <div className="mt-2 flex gap-2">
              <input
                list="bulk-cat-list"
                value={bulkCategoryTarget}
                onChange={e => setBulkCategoryTarget(e.target.value)}
                placeholder="New category path (empty = uncategorized)"
                className="flex-1 text-xs bg-[#1C2128] border border-[#30363D] rounded px-2 py-1 text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
              />
              <datalist id="bulk-cat-list">{allCategories.map(c => <option key={c} value={c} />)}</datalist>
              <button type="button" onClick={() => void handleBulkCategoryMove()} disabled={bulkCategoryMove.isPending}
                className="text-xs bg-[#0078D4] text-white px-2.5 py-1 rounded hover:bg-[#006CBE] disabled:opacity-50">
                Move
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#21262D] bg-[#161B22] flex-shrink-0">
        <div className="w-3.5 flex-shrink-0" />
        <div className="flex-shrink-0" onClick={selectAll}>
          <input
            type="checkbox"
            checked={sortedFiltered.length > 0 && selected.size === sortedFiltered.length}
            onChange={selectAll}
            className="rounded border-[#30363D] bg-[#0D1117] text-[#0078D4] w-3.5 h-3.5"
          />
        </div>
        <span className="text-[10px] font-bold text-[#7D8590] uppercase tracking-wider flex-1">Name</span>
        <span className="text-[10px] text-[#484F58]">{sortedFiltered.length}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-3 border-b border-[#21262D]">
              <div className="w-3.5 h-3.5 rounded bg-[#21262D] animate-pulse" />
              <div className="flex-1 space-y-1">
                <div className="h-3 rounded bg-[#21262D] animate-pulse" style={{ width: `${50 + (i * 17) % 40}%` }} />
                <div className="h-2.5 rounded bg-[#21262D] animate-pulse" style={{ width: `${30 + (i * 13) % 30}%` }} />
              </div>
            </div>
          ))
        ) : sortedFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#484F58]">
            <p className="text-sm">No services here</p>
            <button type="button" onClick={onCreateNew} className="mt-3 text-xs text-[#0078D4] hover:underline">+ New service</button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedFiltered.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {sortedFiltered.map(s => (
                <SortableRow
                  key={s.id}
                  service={s}
                  isSelected={selectedId === s.id}
                  isChecked={selected.has(s.id)}
                  onSelect={onSelect}
                  onCheck={toggleSelect}
                  onDuplicate={handleDuplicate}
                  onArchive={setArchiveTarget}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Archive single */}
      <AlertDialog open={!!archiveTarget} onOpenChange={o => { if (!o) setArchiveTarget(null); }}>
        <AlertDialogContent className="bg-[#161B22] border-[#30363D]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#E6EDF3]">Archive service?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">
              <strong className="text-[#E6EDF3]">{archiveTarget?.name}</strong> will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#30363D] text-[#7D8590] hover:bg-[#1C2128]">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveTarget && void handleArchive(archiveTarget)} className="bg-red-600 hover:bg-red-700 text-white border-0">Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk archive */}
      <AlertDialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <AlertDialogContent className="bg-[#161B22] border-[#30363D]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#E6EDF3]">Archive {selected.size} services?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#7D8590]">Services referenced by active clients or contracts will be skipped.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#30363D] text-[#7D8590] hover:bg-[#1C2128]">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleBulkArchive()} className="bg-red-600 hover:bg-red-700 text-white border-0">Archive {selected.size}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

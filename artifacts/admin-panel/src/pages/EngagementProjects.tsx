import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Pencil, Trash2, Loader2, X, GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EngagementProject {
  id: number;
  title: string;
  priceRange: string;
  description: string | null;
  triggeredBy: string[];
  sowItems: string[];
  pages: string[];
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

type FormMode = "create" | "edit";

const SERVICE_PAGES: { slug: string; label: string }[] = [
  { slug: "copilot-ai", label: "Copilot AI" },
  { slug: "microsoft-365", label: "Microsoft 365" },
  { slug: "sharepoint", label: "SharePoint" },
  { slug: "power-platform", label: "Power Platform" },
  { slug: "governance", label: "Governance" },
  { slug: "cloud-migration", label: "Cloud Migration" },
];

const EMPTY_FORM = {
  title: "",
  priceRange: "",
  description: "",
  triggeredBy: [] as string[],
  sowItems: [] as string[],
  pages: [] as string[],
  sortOrder: 0,
  isVisible: true,
};

function ArrayEditor({
  label, items, onChange, placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setDraft("");
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i: number, val: string) => {
    const next = [...items];
    next[i] = val;
    onChange(next);
  };
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...items];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const moveDown = (i: number) => {
    if (i === items.length - 1) return;
    const next = [...items];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-2">{label}</label>
      <div className="space-y-2 mb-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex flex-col gap-0.5 pt-1.5">
              <button type="button" onClick={() => moveUp(i)} className="text-[#7D8590] hover:text-[#7D8590]" disabled={i === 0}>
                <ChevronUp className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => moveDown(i)} className="text-[#7D8590] hover:text-[#7D8590]" disabled={i === items.length - 1}>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            <GripVertical className="w-4 h-4 text-[#484F58] mt-2 flex-shrink-0" />
            <input
              value={item}
              onChange={e => update(i, e.target.value)}
              className="flex-1 border border-[#30363D] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
            />
            <button type="button" onClick={() => remove(i)} className="text-[#7D8590] hover:text-red-500 transition-colors mt-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? "Add item…"}
          className="flex-1 border border-[#30363D] rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-1.5 bg-[#0078D4]/10 text-[#0078D4] text-sm font-medium rounded hover:bg-[#0078D4]/20 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function PageTagsChecklist({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (pages: string[]) => void;
}) {
  const toggle = (slug: string) => {
    if (selected.includes(slug)) {
      onChange(selected.filter((s) => s !== slug));
    } else {
      onChange([...selected, slug]);
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-2">
        Service Pages
      </label>
      <p className="text-xs text-[#7D8590] mb-3">
        Choose which service pages show this project in their "Project Engagements" section.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SERVICE_PAGES.map(({ slug, label }) => (
          <label
            key={slug}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors select-none ${
              selected.includes(slug)
                ? "border-[#0078D4] bg-[#0078D4]/5 text-[#0078D4]"
                : "border-[#30363D] bg-[#161B22] text-[#C9D1D9] hover:border-[#30363D]"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(slug)}
              onChange={() => toggle(slug)}
              className="w-3.5 h-3.5 accent-[#0078D4] flex-shrink-0"
            />
            <span className="text-sm font-medium">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function EngagementProjectsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [projects, setProjects] = useState<EngagementProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<FormMode>("create");
  const [editId, setEditId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/engagement-projects");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json() as EngagementProject[];
      setProjects(data);
    } catch {
      toast({ title: "Error", description: "Failed to load engagement projects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, sortOrder: (projects.length + 1) * 10 });
    setMode("create");
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(p: EngagementProject) {
    setForm({
      title: p.title,
      priceRange: p.priceRange,
      description: p.description ?? "",
      triggeredBy: p.triggeredBy ?? [],
      sowItems: p.sowItems ?? [],
      pages: p.pages ?? [],
      sortOrder: p.sortOrder,
      isVisible: p.isVisible,
    });
    setMode("edit");
    setEditId(p.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditId(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (!form.priceRange.trim()) { toast({ title: "Price range is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        priceRange: form.priceRange.trim(),
        description: form.description.trim() || null,
        triggeredBy: form.triggeredBy,
        sowItems: form.sowItems,
        pages: form.pages,
        sortOrder: Number(form.sortOrder) || 0,
        isVisible: form.isVisible,
      };
      const url = mode === "edit" && editId != null
        ? `/api/admin/engagement-projects/${editId}`
        : "/api/admin/engagement-projects";
      const method = mode === "edit" ? "PUT" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save failed");
      toast({ title: mode === "edit" ? "Project updated" : "Project created" });
      closeForm();
      await load();
    } catch {
      toast({ title: "Error", description: "Failed to save project", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      const res = await fetchWithAuth(`/api/admin/engagement-projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      toast({ title: "Project deleted" });
      setConfirmDeleteId(null);
      await load();
    } catch {
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-[#E6EDF3]">Engagement Projects</h1>
          <p className="text-sm text-[#7D8590] mt-0.5">
            Project types shown on the Pricing page (Track 02). Each record drives SOW generation.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Project Type
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 text-[#0078D4] animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-[#7D8590] text-sm border border-dashed border-[#30363D] rounded-xl">
          No engagement projects yet. Click "New Project Type" to add one.
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => (
            <div key={p.id} className={`bg-[#161B22] rounded-xl border transition-all ${expandedId === p.id ? "border-[#0078D4]/40 shadow-sm" : "border-[#30363D]"}`}>
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-[#E6EDF3] text-sm">{p.title}</p>
                    <span className="text-[#0078D4] font-bold text-sm">{p.priceRange}</span>
                    {!p.isVisible && (
                      <span className="text-xs bg-[#30363D]/50 text-[#7D8590] px-2 py-0.5 rounded-full font-medium">Hidden</span>
                    )}
                    {(p.pages ?? []).length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {(p.pages ?? []).map((slug) => {
                          const page = SERVICE_PAGES.find((pg) => pg.slug === slug);
                          return page ? (
                            <span key={slug} className="text-xs bg-[#0078D4]/8 text-[#0078D4] border border-[#0078D4]/20 px-2 py-0.5 rounded-full font-medium">
                              {page.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                  {p.description && (
                    <p className="text-xs text-[#7D8590] mt-0.5 line-clamp-1">{p.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-[#7D8590]">{p.triggeredBy.length} trigger{p.triggeredBy.length !== 1 ? "s" : ""}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-[#7D8590]">{p.sowItems.length} SOW item{p.sowItems.length !== 1 ? "s" : ""}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-[#7D8590]">sort: {p.sortOrder}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    className="text-[#7D8590] hover:text-[#7D8590] p-1.5 rounded-lg hover:bg-[#1C2128] transition-colors"
                    title="Expand"
                  >
                    {expandedId === p.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="text-[#7D8590] hover:text-[#0078D4] p-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(p.id)}
                    className="text-[#7D8590] hover:text-red-500 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                    title="Delete"
                    disabled={deleting === p.id}
                  >
                    {deleting === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {expandedId === p.id && (
                <div className="border-t border-[#30363D] px-5 py-4 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wide mb-2">Triggered By</p>
                      {p.triggeredBy.length === 0 ? (
                        <p className="text-xs text-[#7D8590] italic">None defined</p>
                      ) : (
                        <ul className="space-y-1">
                          {p.triggeredBy.map((t, i) => (
                            <li key={i} className="text-xs text-[#C9D1D9] flex items-start gap-1.5">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                              {t}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wide mb-2">Typical SOW Items</p>
                      {p.sowItems.length === 0 ? (
                        <p className="text-xs text-[#7D8590] italic">None defined</p>
                      ) : (
                        <ul className="space-y-1">
                          {p.sowItems.map((s, i) => (
                            <li key={i} className="text-xs text-[#C9D1D9] flex items-start gap-1.5">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#00B4D8] flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wide mb-2">Shown on Service Pages</p>
                    {(p.pages ?? []).length === 0 ? (
                      <p className="text-xs text-[#7D8590] italic">Not tagged to any service page — will not appear on service pages</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(p.pages ?? []).map((slug) => {
                          const page = SERVICE_PAGES.find((pg) => pg.slug === slug);
                          return page ? (
                            <span key={slug} className="text-xs bg-[#0078D4]/8 text-[#0078D4] border border-[#0078D4]/20 px-2.5 py-1 rounded-full font-medium">
                              {page.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
          <div className="bg-[#161B22] rounded-2xl shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#30363D]">
              <h2 className="text-lg font-extrabold text-[#E6EDF3]">
                {mode === "edit" ? "Edit Project Type" : "New Project Type"}
              </h2>
              <button onClick={closeForm} className="text-[#7D8590] hover:text-[#7D8590] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={e => void handleSave(e)} className="px-6 py-5 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1.5">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="e.g. M365 Tenant Migration"
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                />
              </div>

              {/* Price Range */}
              <div>
                <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1.5">
                  Price Range <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.priceRange}
                  onChange={e => setForm(f => ({ ...f, priceRange: e.target.value }))}
                  required
                  placeholder="e.g. $5,000 – $15,000"
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Short description shown on the Pricing page…"
                  className="w-full border border-[#30363D] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 resize-none"
                />
              </div>

              {/* Service Pages */}
              <PageTagsChecklist
                selected={form.pages}
                onChange={pages => setForm(f => ({ ...f, pages }))}
              />

              {/* Triggered By */}
              <ArrayEditor
                label="Triggered By"
                items={form.triggeredBy}
                onChange={items => setForm(f => ({ ...f, triggeredBy: items }))}
                placeholder="What situation triggers this engagement type…"
              />

              {/* SOW Items */}
              <ArrayEditor
                label="Typical SOW Items"
                items={form.sowItems}
                onChange={items => setForm(f => ({ ...f, sowItems: items }))}
                placeholder="Add a deliverable or SOW line item…"
              />

              {/* Sort Order + Visibility */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1.5">Sort Order</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={e => setForm(f => ({ ...f, sortOrder: Number(e.target.value) }))}
                    className="w-full border border-[#30363D] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
                  />
                  <p className="text-xs text-[#7D8590] mt-1">Lower numbers appear first on the page.</p>
                </div>
                <div className="flex items-end pb-1 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isVisible}
                      onChange={e => setForm(f => ({ ...f, isVisible: e.target.checked }))}
                      className="w-4 h-4 accent-[#0078D4]"
                    />
                    <span className="text-sm font-medium text-[#C9D1D9]">Visible on Pricing page</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 text-sm font-medium text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-60 transition-colors"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {mode === "edit" ? "Save Changes" : "Create Project Type"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={confirmDeleteId != null} onOpenChange={open => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project type?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the Pricing page immediately. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => confirmDeleteId != null && void handleDelete(confirmDeleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Pencil, Trash2, Loader2, Sparkles, ToggleLeft, ToggleRight, X } from "lucide-react";

interface HeroHeadline {
  id: number;
  leadText: string;
  gradientText: string;
  active: boolean;
  seasonalLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  createdAt: string;
}

interface HeadlineForm {
  leadText: string;
  gradientText: string;
  active: boolean;
  seasonalLabel: string;
  startDate: string;
  endDate: string;
  sortOrder: string;
}

const EMPTY_FORM: HeadlineForm = {
  leadText: "",
  gradientText: "",
  active: true,
  seasonalLabel: "",
  startDate: "",
  endDate: "",
  sortOrder: "0",
};

function formatWindow(h: HeroHeadline) {
  if (!h.startDate && !h.endDate) return "Evergreen";
  const start = h.startDate ? new Date(h.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "…";
  const end = h.endDate ? new Date(h.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "…";
  return `${start} – ${end}`;
}

export default function HeroHeadlinesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [headlines, setHeadlines] = useState<HeroHeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<HeadlineForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/admin/marketing/hero-headlines");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHeadlines(await res.json() as HeroHeadline[]);
    } catch {
      toast({ title: "Failed to load hero headlines", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, sortOrder: String(headlines.length) });
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (h: HeroHeadline) => {
    setEditingId(h.id);
    setForm({
      leadText: h.leadText,
      gradientText: h.gradientText,
      active: h.active,
      seasonalLabel: h.seasonalLabel ?? "",
      startDate: h.startDate ? h.startDate.slice(0, 10) : "",
      endDate: h.endDate ? h.endDate.slice(0, 10) : "",
      sortOrder: String(h.sortOrder),
    });
    setFormError("");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormError("");
  };

  const handleSave = async () => {
    setFormError("");
    if (!form.leadText.trim()) { setFormError("Lead text is required"); return; }
    if (!form.gradientText.trim()) { setFormError("Gradient text is required"); return; }
    if ((form.startDate && !form.endDate) || (!form.startDate && form.endDate)) {
      setFormError("Start and end date must be set together, or both left blank for an evergreen headline");
      return;
    }

    setSaving(true);
    try {
      const body = {
        leadText: form.leadText,
        gradientText: form.gradientText,
        active: form.active,
        seasonalLabel: form.seasonalLabel.trim() || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      };
      const res = editingId
        ? await fetchWithAuth(`/api/admin/marketing/hero-headlines/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetchWithAuth("/api/admin/marketing/hero-headlines", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setFormError(err.error ?? "Failed to save headline");
        return;
      }
      toast({ title: editingId ? "Headline updated" : "Headline created" });
      closeForm();
      void load();
    } catch {
      setFormError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (h: HeroHeadline) => {
    if (!confirm(`Delete this headline? "${h.leadText}${h.gradientText}" — this cannot be undone.`)) return;
    setDeletingId(h.id);
    try {
      const res = await fetchWithAuth(`/api/admin/marketing/hero-headlines/${h.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to delete headline", variant: "destructive" });
        return;
      }
      toast({ title: "Headline deleted" });
      void load();
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (h: HeroHeadline) => {
    try {
      const res = await fetchWithAuth(`/api/admin/marketing/hero-headlines/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !h.active }),
      });
      if (!res.ok) {
        toast({ title: "Failed to update headline", variant: "destructive" });
        return;
      }
      setHeadlines(prev => prev.map(x => x.id === h.id ? { ...x, active: !x.active } : x));
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hero Headlines</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage the rotating headline on the public site's home page hero — evergreen or scheduled for a season.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#005A9E] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Headline
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <h2 className="font-bold text-foreground text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {editingId ? "Edit Headline" : "Create Headline"}
            </h2>
            <button onClick={closeForm} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-foreground mb-1.5">Lead text <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.leadText}
                onChange={e => setForm(f => ({ ...f, leadText: e.target.value }))}
                placeholder="Your tenant has problems. "
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Plain text, typed out first. Include a trailing space if the gradient clause continues the sentence.</p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-foreground mb-1.5">Gradient text <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.gradientText}
                onChange={e => setForm(f => ({ ...f, gradientText: e.target.value }))}
                placeholder="We find them before your CEO does."
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Renders with the blue-violet gradient, concatenated right after the lead text.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Seasonal label</label>
              <input
                type="text"
                value={form.seasonalLabel}
                onChange={e => setForm(f => ({ ...f, seasonalLabel: e.target.value }))}
                placeholder="e.g. Black Friday"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Internal note only — not shown on the site.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Sort order</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.sortOrder}
                onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Start date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">End date</label>
              <input
                type="date"
                value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Leave both dates blank for an always-on evergreen headline.</p>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                  className="focus:outline-none"
                >
                  {form.active
                    ? <ToggleRight className="w-8 h-8 text-primary" />
                    : <ToggleLeft className="w-8 h-8 text-muted-foreground/60" />
                  }
                </button>
                <span className="text-xs font-semibold text-foreground">
                  {form.active ? "Active" : "Inactive"}
                </span>
              </label>
            </div>
          </div>

          {formError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-4">{formError}</p>
          )}

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#005A9E] disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : editingId ? "Update Headline" : "Create Headline"}
            </button>
            <button onClick={closeForm} className="text-sm text-muted-foreground hover:text-foreground px-3 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading headlines…
          </div>
        ) : headlines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <p className="font-semibold text-foreground mb-1">No headlines yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              The public site falls back to a single static headline until at least one is created here.
            </p>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#005A9E] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create headline
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-accent border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Headline</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Window</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Order</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {headlines.map(h => (
                  <tr key={h.id} className="hover:bg-accent/50 transition-colors">
                    <td className="px-4 py-3 max-w-md">
                      <span className="text-foreground">{h.leadText}</span>
                      <span className="font-semibold text-primary">{h.gradientText}</span>
                      {h.seasonalLabel && (
                        <span className="block text-[11px] text-muted-foreground mt-0.5">{h.seasonalLabel}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatWindow(h)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void handleToggleActive(h)}
                        title={h.active ? "Click to deactivate" : "Click to activate"}
                        className="focus:outline-none"
                      >
                        {h.active ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-400 px-2.5 py-1 rounded-full font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs bg-border/50 text-muted-foreground px-2.5 py-1 rounded-full font-medium">
                            Inactive
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-foreground font-mono text-xs">{h.sortOrder}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(h)}
                          className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleDelete(h)}
                          disabled={deletingId === h.id}
                          className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === h.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

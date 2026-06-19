import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Service {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  price: string | null;
  durationDays: number | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  isPublic: boolean;
  createdAt: string;
  serviceType: string | null;
  tagline: string | null;
  targetAudience: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  iconName: string | null;
  pageHref: string | null;
  sortOrder: number;
}

export default function ServicesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Service | null>(null);
  const [form, setForm] = useState<Partial<Service>>({});
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", slug: "", billingType: "one_time" as "one_time" | "recurring_monthly" });
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/services");
      if (!res.ok) { toast({ title: "Failed to load services", variant: "destructive" }); return; }
      const data = await res.json() as Service[];
      setServices(data);
    } catch { toast({ title: "Could not reach API server", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  function selectService(s: Service) {
    setSelected(s);
    setForm({ ...s });
    setShowCreate(false);
  }

  function setField(key: keyof Service, value: string | boolean | number | string[] | null) {
    setForm(p => ({ ...p, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const body = await res.json() as Service & { error?: string };
      if (!res.ok) { toast({ title: (body as { error?: string }).error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: "Service saved" });
      setSelected(body);
      setForm({ ...body });
      await fetchServices();
    } finally { setSaving(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetchWithAuth("/api/admin/services", {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          slug: createForm.slug.trim() || null,
          billingType: createForm.billingType,
        }),
      });
      const body = await res.json() as Service & { error?: string };
      if (!res.ok) { toast({ title: body.error ?? "Create failed", variant: "destructive" }); return; }
      toast({ title: "Service created" });
      setShowCreate(false);
      setCreateForm({ name: "", slug: "", billingType: "one_time" });
      await fetchServices();
      selectService(body);
    } finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        toast({ title: body.error ?? "Delete failed", variant: "destructive" });
        return;
      }
      toast({ title: "Service deleted" });
      if (selected?.id === deleteTarget.id) { setSelected(null); setForm({}); }
      await fetchServices();
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="flex h-full">
      {/* Service list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-[#0A2540] text-sm">Service Offerings</h2>
            <p className="text-xs text-gray-500 mt-0.5">{services.length} services</p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setSelected(null); setForm({}); }}
            className="flex items-center gap-1.5 bg-[#0078D4] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="divide-y divide-gray-100 flex-1 overflow-y-auto">
            {services.map(s => (
              <div key={s.id} className={`group flex items-center gap-1 pr-2 hover:bg-gray-50 transition-colors ${selected?.id === s.id ? "bg-blue-50 border-l-2 border-[#0078D4]" : ""}`}>
                <button onClick={() => selectService(s)} className="flex-1 text-left px-4 py-3.5 min-w-0">
                  <p className="font-medium text-sm text-[#0A2540] leading-snug truncate">{s.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${s.billingType === "recurring_monthly" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>
                      {s.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time charge"}
                    </span>
                    {s.price && <span className="text-xs text-gray-500">${parseFloat(s.price).toLocaleString()}</span>}
                  </div>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setDeleteTarget(s); }}
                  className="flex-shrink-0 p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete service"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail / edit panel */}
      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <form onSubmit={handleCreate} className="p-6 max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#0A2540]">New Service</h2>
              <button type="button" onClick={() => setShowCreate(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors text-sm">
                Cancel
              </button>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text" required autoFocus
                  value={createForm.name}
                  onChange={e => {
                    const name = e.target.value;
                    setCreateForm(p => ({
                      ...p,
                      name,
                      slug: p.slug || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                    }));
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="e.g. Microsoft 365 Audit"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                  Slug <span className="text-red-500">*</span>
                </label>
                <input
                  type="text" required
                  value={createForm.slug}
                  onChange={e => setCreateForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="url-friendly-slug"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Billing Type</label>
                <div className="flex gap-3">
                  {[
                    { value: "one_time", label: "One-time charge" },
                    { value: "recurring_monthly", label: "Monthly retainer" },
                  ].map(opt => (
                    <label key={opt.value} className={`flex items-center gap-2.5 flex-1 border rounded-xl p-3 cursor-pointer transition-all ${createForm.billingType === opt.value ? "border-[#0078D4] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                      <input type="radio" name="createBillingType" value={opt.value}
                        checked={createForm.billingType === opt.value}
                        onChange={() => setCreateForm(p => ({ ...p, billingType: opt.value as "one_time" | "recurring_monthly" }))}
                        className="text-[#0078D4]" />
                      <span className="text-sm font-medium text-[#0A2540]">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={creating || !createForm.name.trim()}
                className="w-full bg-[#0078D4] text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
                {creating ? "Creating…" : "Create Service"}
              </button>
            </div>
          </form>
        ) : !selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Select a service to edit</p>
              <p className="text-xs mt-1">or click <span className="font-medium text-[#0078D4]">New</span> to create one</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-6 max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[#0A2540]">Edit Service</h2>
              <button type="submit" disabled={saving}
                className="bg-[#0078D4] text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name ?? ""} required
                  onChange={e => setField("name", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Slug</label>
                <input type="text" value={form.slug ?? ""}
                  onChange={e => setField("slug", e.target.value.toLowerCase().replace(/\s+/g, "-") || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="url-friendly-slug" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Category</label>
                <input type="text" value={form.category ?? ""}
                  onChange={e => setField("category", e.target.value || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Description</label>
                <textarea value={form.description ?? ""} rows={3}
                  onChange={e => setField("description", e.target.value || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Deliverables</label>
                <textarea value={form.deliverables ?? ""} rows={3}
                  onChange={e => setField("deliverables", e.target.value || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                  placeholder="One per line or comma-separated…" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Price ($)</label>
                  <input type="number" value={form.price ?? ""} min="0" step="0.01"
                    onChange={e => setField("price", e.target.value || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Duration (days)</label>
                  <input type="number" value={form.durationDays ?? ""} min="1"
                    onChange={e => setField("durationDays", e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Turnaround</label>
                <input type="text" value={form.turnaround ?? ""}
                  onChange={e => setField("turnaround", e.target.value || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="e.g. 5 business days" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Billing Type</label>
                <div className="flex gap-3">
                  {[
                    { value: "one_time", label: "One-time charge" },
                    { value: "recurring_monthly", label: "Monthly retainer" },
                  ].map(opt => (
                    <label key={opt.value} className={`flex items-center gap-2.5 flex-1 border rounded-xl p-3 cursor-pointer transition-all ${form.billingType === opt.value ? "border-[#0078D4] bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}>
                      <input type="radio" name="billingType" value={opt.value}
                        checked={form.billingType === opt.value}
                        onChange={() => setField("billingType", opt.value)}
                        className="text-[#0078D4]" />
                      <div>
                        <p className="text-sm font-medium text-[#0A2540]">{opt.label}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="isPublic" checked={form.isPublic ?? true}
                  onChange={e => setField("isPublic", e.target.checked)}
                  className="rounded" />
                <label htmlFor="isPublic" className="text-sm font-medium text-gray-700">Visible on public site</label>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Marketing Fields</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Service Type</label>
                    <select value={form.serviceType ?? ""}
                      onChange={e => setField("serviceType", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]">
                      <option value="">— none —</option>
                      <option value="micro_offer">micro_offer</option>
                      <option value="retainer">retainer</option>
                      <option value="service_area">service_area</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Tagline</label>
                    <input type="text" value={form.tagline ?? ""}
                      onChange={e => setField("tagline", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Target Audience</label>
                    <textarea value={form.targetAudience ?? ""} rows={2}
                      onChange={e => setField("targetAudience", e.target.value || null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Inclusions (one per line)</label>
                    <textarea value={(form.inclusions ?? []).join("\n")} rows={5}
                      onChange={e => setField("inclusions", e.target.value ? e.target.value.split("\n").filter(Boolean) : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Features (one per line)</label>
                    <textarea value={(form.features ?? []).join("\n")} rows={5}
                      onChange={e => setField("features", e.target.value ? e.target.value.split("\n").filter(Boolean) : null)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Badge</label>
                      <input type="text" value={form.badge ?? ""}
                        onChange={e => setField("badge", e.target.value || null)}
                        placeholder="e.g. Most requested"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Hours/Month</label>
                      <input type="text" value={form.hoursPerMonth ?? ""}
                        onChange={e => setField("hoursPerMonth", e.target.value || null)}
                        placeholder="e.g. 10 hours"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Icon Name</label>
                      <input type="text" value={form.iconName ?? ""}
                        onChange={e => setField("iconName", e.target.value || null)}
                        placeholder="e.g. Cloud, Bot, Shield…"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Sort Order</label>
                      <input type="number" value={form.sortOrder ?? 0} min="0"
                        onChange={e => setField("sortOrder", parseInt(e.target.value) || 0)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Page Href</label>
                    <input type="text" value={form.pageHref ?? ""}
                      onChange={e => setField("pageHref", e.target.value || null)}
                      placeholder="e.g. /services/microsoft-365"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="highlighted" checked={form.highlighted ?? false}
                      onChange={e => setField("highlighted", e.target.checked)}
                      className="rounded" />
                    <label htmlFor="highlighted" className="text-sm font-medium text-gray-700">Highlighted (Most Popular)</label>
                  </div>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the service offering. This action cannot be undone.
              If any client has this service active, the delete will be blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); void handleDelete(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? "Deleting…" : "Delete Service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

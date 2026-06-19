import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Service {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  price: string | null;
  durationDays: number | null;
  createdAt: string;
}

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
}

interface AssignForm {
  clientUserId: string;
  serviceId: string;
  startDate: string;
  nextMilestone: string;
  nextMilestoneDate: string;
}

export default function AdminServices() {
  const { fetchWithAuth } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", description: "", category: "", deliverables: "", price: "", durationDays: "" });
  const [assignForm, setAssignForm] = useState<AssignForm>({ clientUserId: "", serviceId: "", startDate: "", nextMilestone: "", nextMilestoneDate: "" });

  const load = async () => {
    const [svcRes, clientRes] = await Promise.all([fetchWithAuth("/api/admin/services"), fetchWithAuth("/api/admin/clients")]);
    if (svcRes.ok) setServices(await svcRes.json() as Service[]);
    if (clientRes.ok) setClients(await clientRes.json() as Client[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = { ...form, durationDays: form.durationDays ? Number(form.durationDays) : null, price: form.price || null };
      let res: Response;
      if (editingId) {
        res = await fetchWithAuth(`/api/admin/services/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        res = await fetchWithAuth("/api/admin/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      if (!res.ok) { setError((await res.json() as { error: string }).error); } else { setShowForm(false); setEditingId(null); await load(); }
    } finally { setSaving(false); }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/client-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientUserId: Number(assignForm.clientUserId), serviceId: Number(assignForm.serviceId), startDate: assignForm.startDate || null, nextMilestone: assignForm.nextMilestone || null, nextMilestoneDate: assignForm.nextMilestoneDate || null }),
      });
      if (!res.ok) { setError((await res.json() as { error: string }).error); } else { setShowAssign(false); setAssignForm({ clientUserId: "", serviceId: "", startDate: "", nextMilestone: "", nextMilestoneDate: "" }); }
    } finally { setSaving(false); }
  };

  const handleEdit = (s: Service) => {
    setEditingId(s.id);
    setForm({ name: s.name, description: s.description ?? "", category: s.category ?? "", deliverables: s.deliverables ?? "", price: s.price ?? "", durationDays: s.durationDays ? String(s.durationDays) : "" });
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[#0A2540]">Service Templates</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Define services and assign them to clients.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowAssign(true); setError(""); }}
            className="border border-[#0078D4] text-[#0078D4] text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/5 transition-colors">
            Assign to Client
          </button>
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: "", description: "", category: "", deliverables: "", price: "", durationDays: "" }); setError(""); }}
            className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            New Service
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#0A2540] mb-4">{editingId ? "Edit Service" : "New Service"}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: "Name *", key: "name", required: true, span: 2 },
              { label: "Category", key: "category", span: 1 },
              { label: "Price (USD)", key: "price", span: 1 },
              { label: "Duration (days)", key: "durationDays", span: 1, type: "number" },
            ].map(({ label, key, required, span, type }) => (
              <div key={key} className={span === 2 ? "sm:col-span-2" : ""}>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">{label}</label>
                <input type={type ?? "text"} required={required}
                  value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
              </div>
            ))}
            {["description", "deliverables"].map(key => (
              <div key={key} className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#0A2540] mb-1 capitalize">{key}</label>
                <textarea rows={2} value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
              </div>
            ))}
            {error && <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Service"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {showAssign && (
        <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#0A2540] mb-4">Assign Service to Client</h3>
          <form onSubmit={handleAssign} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Client *</label>
              <select required value={assignForm.clientUserId} onChange={e => setAssignForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="">— Select Client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Service *</label>
              <select required value={assignForm.serviceId} onChange={e => setAssignForm(f => ({ ...f, serviceId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="">— Select Service —</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Start Date</label>
              <input type="date" value={assignForm.startDate} onChange={e => setAssignForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Next Milestone Date</label>
              <input type="date" value={assignForm.nextMilestoneDate} onChange={e => setAssignForm(f => ({ ...f, nextMilestoneDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Next Milestone Description</label>
              <input value={assignForm.nextMilestone} onChange={e => setAssignForm(f => ({ ...f, nextMilestone: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Assigning…" : "Assign Service"}
              </button>
              <button type="button" onClick={() => { setShowAssign(false); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
      ) : services.length === 0 ? (
        <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">No services yet.</div>
      ) : (
        <div className="bg-white border border-border rounded-xl divide-y divide-border">
          {services.map(s => (
            <div key={s.id} className="px-5 py-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="text-sm font-bold text-[#0A2540]">{s.name}</p>
                  {s.category && <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] font-semibold px-2 py-0.5 rounded-full">{s.category}</span>}
                </div>
                {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  {s.price && <span>${parseFloat(s.price).toLocaleString()}</span>}
                  {s.durationDays && <span>{s.durationDays} days</span>}
                </div>
              </div>
              <button onClick={() => handleEdit(s)} className="text-xs font-semibold text-[#0078D4] hover:underline flex-shrink-0">Edit</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

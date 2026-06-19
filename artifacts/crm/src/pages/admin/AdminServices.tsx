import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, ChevronUp, Plus, Trash2, Settings2, Save, Loader2 } from "lucide-react";

interface WizardOption {
  id: string;
  label: string;
  description: string;
  priceAdjustment: number;
}

interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

interface Service {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  durationDays: number | null;
  createdAt: string;
  orderWorkflow: WizardStep[] | null;
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

function nanoid() {
  return Math.random().toString(36).slice(2, 10);
}

function WorkflowBuilder({ service, onClose }: { service: Service; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    fetchWithAuth(`/api/admin/services/${service.id}/workflow`)
      .then(r => r.json() as Promise<{ workflow: WizardStep[] }>)
      .then(data => { setSteps(data.workflow ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id]);

  const addStep = () => setSteps(s => [...s, { id: nanoid(), title: "", options: [] }]);

  const removeStep = (idx: number) => setSteps(s => s.filter((_, i) => i !== idx));

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps(s => {
      const arr = [...s];
      const next = idx + dir;
      if (next < 0 || next >= arr.length) return arr;
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };

  const updateStepTitle = (idx: number, title: string) =>
    setSteps(s => s.map((st, i) => i === idx ? { ...st, title } : st));

  const addOption = (stepIdx: number) =>
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: [...st.options, { id: nanoid(), label: "", description: "", priceAdjustment: 0 }] }
      : st));

  const removeOption = (stepIdx: number, optIdx: number) =>
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: st.options.filter((_, oi) => oi !== optIdx) }
      : st));

  const updateOption = (stepIdx: number, optIdx: number, field: keyof WizardOption, value: string | number) =>
    setSteps(s => s.map((st, i) => i === stepIdx
      ? { ...st, options: st.options.map((o, oi) => oi === optIdx ? { ...o, [field]: value } : o) }
      : st));

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetchWithAuth(`/api/admin/services/${service.id}/workflow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: steps }),
      });
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-[#0078D4]/30 bg-[#F7F9FC] rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-bold text-[#0A2540]">Order Workflow — {service.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build the questionnaire clients walk through to calculate their final price.
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-[#0A2540] font-medium">
          Close
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-[#0078D4]" />
        </div>
      ) : (
        <>
          {steps.length === 0 && (
            <p className="text-sm text-muted-foreground bg-white border border-border rounded-lg px-4 py-3 mb-4">
              No steps yet. Add a step to create the wizard questionnaire.
            </p>
          )}

          <div className="space-y-4">
            {steps.map((step, si) => (
              <div key={step.id} className="bg-white border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveStep(si, -1)} disabled={si === 0}
                      className="text-muted-foreground hover:text-[#0A2540] disabled:opacity-30 transition-colors">
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1}
                      className="text-muted-foreground hover:text-[#0A2540] disabled:opacity-30 transition-colors">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className="text-xs font-bold text-[#0078D4] bg-[#0078D4]/10 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
                    {si + 1}
                  </span>
                  <input
                    type="text"
                    placeholder="Step title (e.g. How many users?)"
                    value={step.title}
                    onChange={e => updateStepTitle(si, e.target.value)}
                    className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                  <button onClick={() => removeStep(si)}
                    className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="ml-12 space-y-2">
                  {step.options.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No options yet — add one below.</p>
                  )}
                  {step.options.map((opt, oi) => (
                    <div key={opt.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_110px_28px] gap-2 items-start">
                      <input
                        type="text"
                        placeholder="Option label"
                        value={opt.label}
                        onChange={e => updateOption(si, oi, "label", e.target.value)}
                        className="border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                      />
                      <input
                        type="text"
                        placeholder="Short description (optional)"
                        value={opt.description}
                        onChange={e => updateOption(si, oi, "description", e.target.value)}
                        className="border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                      />
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">+$</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={opt.priceAdjustment}
                          onChange={e => updateOption(si, oi, "priceAdjustment", parseFloat(e.target.value) || 0)}
                          className="w-full border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                        />
                      </div>
                      <button onClick={() => removeOption(si, oi)}
                        className="text-red-400 hover:text-red-600 transition-colors h-[30px] flex items-center justify-center">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => addOption(si)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#005A9E] transition-colors mt-1">
                    <Plus className="w-3 h-3" />
                    Add option
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button onClick={addStep}
              className="flex items-center gap-2 border border-dashed border-[#0078D4]/50 text-[#0078D4] text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/5 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Add step
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 bg-[#0078D4] text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : "Save Workflow"}
            </button>
            {savedMsg && <span className="text-xs text-green-600 font-semibold">✓ Saved</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminServices() {
  const { fetchWithAuth } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [workflowServiceId, setWorkflowServiceId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", description: "", category: "", deliverables: "",
    price: "", basePrice: "", maxPrice: "", durationDays: "",
  });
  const [assignForm, setAssignForm] = useState<AssignForm>({
    clientUserId: "", serviceId: "", startDate: "", nextMilestone: "", nextMilestoneDate: "",
  });

  const load = async () => {
    const [svcRes, clientRes] = await Promise.all([
      fetchWithAuth("/api/admin/services"),
      fetchWithAuth("/api/admin/clients"),
    ]);
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
      const payload = {
        ...form,
        durationDays: form.durationDays ? Number(form.durationDays) : null,
        price: form.price || null,
        basePrice: form.basePrice || null,
        maxPrice: form.maxPrice || null,
      };
      let res: Response;
      if (editingId) {
        res = await fetchWithAuth(`/api/admin/services/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetchWithAuth("/api/admin/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        setError((await res.json() as { error: string }).error);
      } else {
        setShowForm(false);
        setEditingId(null);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/client-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUserId: Number(assignForm.clientUserId),
          serviceId: Number(assignForm.serviceId),
          startDate: assignForm.startDate || null,
          nextMilestone: assignForm.nextMilestone || null,
          nextMilestoneDate: assignForm.nextMilestoneDate || null,
        }),
      });
      if (!res.ok) {
        setError((await res.json() as { error: string }).error);
      } else {
        setShowAssign(false);
        setAssignForm({ clientUserId: "", serviceId: "", startDate: "", nextMilestone: "", nextMilestoneDate: "" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (s: Service) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      description: s.description ?? "",
      category: s.category ?? "",
      deliverables: s.deliverables ?? "",
      price: s.price ?? "",
      basePrice: s.basePrice ?? "",
      maxPrice: s.maxPrice ?? "",
      durationDays: s.durationDays ? String(s.durationDays) : "",
    });
    setShowForm(true);
    setWorkflowServiceId(null);
  };

  const toggleWorkflow = (id: number) => {
    setWorkflowServiceId(prev => prev === id ? null : id);
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[#0A2540]">Service Templates</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Define services and assign them to clients.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowAssign(true); setError(""); }}
            className="border border-[#0078D4] text-[#0078D4] text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/5 transition-colors"
          >
            Assign to Client
          </button>
          <button
            onClick={() => {
              setShowForm(true); setEditingId(null);
              setForm({ name: "", description: "", category: "", deliverables: "", price: "", basePrice: "", maxPrice: "", durationDays: "" });
              setError(""); setWorkflowServiceId(null);
            }}
            className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Service
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#0A2540] mb-4">{editingId ? "Edit Service" : "New Service"}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Name *</label>
              <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Category</label>
              <input type="text" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">
                Fixed Price (USD) <span className="font-normal text-muted-foreground">— for flat-rate services</span>
              </label>
              <input type="text" placeholder="e.g. 497" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">
                Base Price (USD) <span className="font-normal text-muted-foreground">— wizard starting price</span>
              </label>
              <input type="text" placeholder="e.g. 1000" value={form.basePrice}
                onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">
                Max Price (USD) <span className="font-normal text-muted-foreground">— displayed range ceiling</span>
              </label>
              <input type="text" placeholder="e.g. 5000" value={form.maxPrice}
                onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Duration (days)</label>
              <input type="number" value={form.durationDays} onChange={e => setForm(f => ({ ...f, durationDays: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {["description", "deliverables"].map(key => (
              <div key={key} className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#0A2540] mb-1 capitalize">{key}</label>
                <textarea rows={2} value={form[key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none" />
              </div>
            ))}
            {error && (
              <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Service"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">
                Cancel
              </button>
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
              <select required value={assignForm.clientUserId}
                onChange={e => setAssignForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="">— Select Client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name ?? c.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Service *</label>
              <select required value={assignForm.serviceId}
                onChange={e => setAssignForm(f => ({ ...f, serviceId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white">
                <option value="">— Select Service —</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Start Date</label>
              <input type="date" value={assignForm.startDate}
                onChange={e => setAssignForm(f => ({ ...f, startDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Next Milestone Date</label>
              <input type="date" value={assignForm.nextMilestoneDate}
                onChange={e => setAssignForm(f => ({ ...f, nextMilestoneDate: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Next Milestone Description</label>
              <input value={assignForm.nextMilestone}
                onChange={e => setAssignForm(f => ({ ...f, nextMilestone: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {error && (
              <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Assigning…" : "Assign Service"}
              </button>
              <button type="button" onClick={() => { setShowAssign(false); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : services.length === 0 ? (
        <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
          No services yet.
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl divide-y divide-border">
          {services.map(s => (
            <div key={s.id}>
              <div className="px-5 py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-bold text-[#0A2540]">{s.name}</p>
                    {s.category && (
                      <span className="text-xs bg-[#0078D4]/10 text-[#0078D4] font-semibold px-2 py-0.5 rounded-full">
                        {s.category}
                      </span>
                    )}
                    {(s.orderWorkflow?.length ?? 0) > 0 && (
                      <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Settings2 className="w-2.5 h-2.5" />
                        {s.orderWorkflow!.length} wizard step{s.orderWorkflow!.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {s.price && <span>${parseFloat(s.price).toLocaleString()} fixed</span>}
                    {s.basePrice && (
                      <span>
                        ${parseFloat(s.basePrice).toLocaleString()} base
                        {s.maxPrice ? ` – $${parseFloat(s.maxPrice).toLocaleString()}` : ""}
                      </span>
                    )}
                    {s.durationDays && <span>{s.durationDays} days</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleWorkflow(s.id)}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                      workflowServiceId === s.id
                        ? "bg-[#0078D4]/10 border-[#0078D4]/30 text-[#0078D4]"
                        : "border-border text-muted-foreground hover:text-[#0078D4] hover:border-[#0078D4]/30"
                    }`}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Workflow
                  </button>
                  <button onClick={() => handleEdit(s)} className="text-xs font-semibold text-[#0078D4] hover:underline">
                    Edit
                  </button>
                </div>
              </div>
              {workflowServiceId === s.id && (
                <div className="px-5 pb-4">
                  <WorkflowBuilder service={s} onClose={() => setWorkflowServiceId(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

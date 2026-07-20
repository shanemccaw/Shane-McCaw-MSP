import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { WizardStep, WizardOption } from "@/hooks/useServices";

function nanoid() { return Math.random().toString(36).slice(2, 10); }

export default function WorkflowBuilder({ serviceId, serviceName, onClose }: { serviceId: number; serviceName: string; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const [steps, setSteps] = useState<WizardStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [allServices, setAllServices] = useState<{ id: number; name: string }[]>([]);
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [copyMode, setCopyMode] = useState<"replace" | "append">("replace");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    void fetchWithAuth(`/api/admin/services/${serviceId}/workflow`)
      .then(r => r.json() as Promise<{ workflow: WizardStep[] }>)
      .then(d => { setSteps(d.workflow ?? []); setLoading(false); })
      .catch(() => setLoading(false));
    void fetchWithAuth("/api/admin/services")
      .then(r => r.json() as Promise<{ id: number; name: string }[]>)
      .then(d => setAllServices(d.filter(s => s.id !== serviceId)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  const handleCopyFrom = async () => {
    if (!copySourceId) return;
    setCopying(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${copySourceId}/workflow`);
      const data = await res.json() as { workflow: WizardStep[] };
      const imported = (data.workflow ?? []).map(st => ({ ...st, id: nanoid(), options: st.options.map((o: WizardOption) => ({ ...o, id: nanoid() })) }));
      setSteps(prev => copyMode === "append" ? [...prev, ...imported] : imported);
      setShowCopyFrom(false); setCopySourceId("");
    } finally { setCopying(false); }
  };

  const addStep = () => setSteps(s => [...s, { id: nanoid(), title: "", options: [] }]);
  const removeStep = (idx: number) => setSteps(s => s.filter((_, i) => i !== idx));
  const moveStep = (idx: number, dir: -1 | 1) => setSteps(s => { const a = [...s]; const n = idx + dir; if (n < 0 || n >= a.length) return a; [a[idx], a[n]] = [a[n], a[idx]]; return a; });
  const updateStepTitle = (idx: number, title: string) => setSteps(s => s.map((st, i) => i === idx ? { ...st, title } : st));
  const updateStepDesc = (idx: number, description: string) => setSteps(s => s.map((st, i) => i === idx ? { ...st, description } : st));
  const addOption = (si: number) => setSteps(s => s.map((st, i) => i === si ? { ...st, options: [...st.options, { id: nanoid(), label: "", description: "", priceAdjustment: 0 }] } : st));
  const removeOption = (si: number, oi: number) => setSteps(s => s.map((st, i) => i === si ? { ...st, options: st.options.filter((_, j) => j !== oi) } : st));
  const updateOption = (si: number, oi: number, field: keyof WizardOption, value: string | number) =>
    setSteps(s => s.map((st, i) => i === si ? { ...st, options: st.options.map((o, j) => j === oi ? { ...o, [field]: value } : o) } : st));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/services/${serviceId}/workflow`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: steps }) });
      if (!res.ok) { const e = await res.json() as { error?: string }; setSaveError(e.error ?? "Save failed"); setTimeout(() => setSaveError(""), 4000); }
      else { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2500); }
    } catch { setSaveError("Network error"); setTimeout(() => setSaveError(""), 4000); }
    finally { setSaving(false); }
  };

  return (
    <div className="border border-primary/30 bg-accent rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-bold text-foreground">Project Template — {serviceName}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Build the questionnaire clients walk through to calculate their final price.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowCopyFrom(p => !p); setCopySourceId(""); }} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${showCopyFrom ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"}`}>Copy from…</button>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
      {showCopyFrom && (
        <div className="bg-card border border-border rounded-xl p-4 mb-4 space-y-3">
          <p className="text-xs font-semibold text-foreground">Copy workflow steps from another service</p>
          <select value={copySourceId} onChange={e => setCopySourceId(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground">
            <option value="">— Select a service —</option>
            {allServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex gap-4">
            {(["replace", "append"] as const).map(m => (
              <label key={m} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                <input type="radio" name="copyMode" value={m} checked={copyMode === m} onChange={() => setCopyMode(m)} />
                {m === "replace" ? "Replace" : "Append"}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void handleCopyFrom()} disabled={!copySourceId || copying} className="flex items-center gap-1.5 text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-medium hover:bg-[#006CBE] disabled:opacity-50">
              {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}{copying ? "Copying…" : "Copy steps"}
            </button>
            <button onClick={() => setShowCopyFrom(false)} className="text-xs text-muted-foreground hover:text-foreground px-2">Cancel</button>
          </div>
        </div>
      )}
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : (
        <>
          {steps.length === 0 && <p className="text-sm text-muted-foreground bg-card border border-border rounded-lg px-4 py-3 mb-4">No steps yet. Add a step to create the wizard questionnaire.</p>}
          <div className="space-y-4">
            {steps.map((step, si) => (
              <div key={step.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveStep(si, -1)} disabled={si === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveStep(si, 1)} disabled={si === steps.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center">{si + 1}</span>
                  <input value={step.title} onChange={e => updateStepTitle(si, e.target.value)} placeholder="Step title" className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-accent text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                  <button onClick={() => removeStep(si)} className="text-red-400 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="ml-12 mb-3">
                  <textarea value={step.description ?? ""} onChange={e => updateStepDesc(si, e.target.value)} placeholder="Description (optional)" rows={2} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-accent text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="ml-12 space-y-2">
                  {step.options.map((opt, oi) => (
                    <div key={opt.id} className="grid grid-cols-[1fr_110px_28px] gap-2 items-start">
                      <input value={opt.label} onChange={e => updateOption(si, oi, "label", e.target.value)} placeholder="Option label" className="border border-border rounded-lg px-3 py-1.5 text-xs bg-accent text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">+$</span>
                        <input type="number" min="0" step="1" value={opt.priceAdjustment} onChange={e => updateOption(si, oi, "priceAdjustment", parseFloat(e.target.value) || 0)} className="w-full border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs bg-accent text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      </div>
                      <button onClick={() => removeOption(si, oi)} className="text-red-400 h-[30px] flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => addOption(si)} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary transition-colors mt-1"><Plus className="w-3 h-3" />Add option</button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={addStep} className="flex items-center gap-2 border border-dashed border-primary/50 text-primary text-xs font-semibold px-4 py-2 rounded-lg hover:bg-primary/5"><Plus className="w-3.5 h-3.5" />Add step</button>
            <button onClick={() => void handleSave()} disabled={saving} className="flex items-center gap-2 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{saving ? "Saving…" : "Save Project Template"}
            </button>
            {savedMsg && <span className="text-xs text-emerald-400 font-semibold">✓ Saved</span>}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

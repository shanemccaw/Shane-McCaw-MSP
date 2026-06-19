import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Service { id: number; name: string; category: string | null; }
interface ContractTemplate {
  serviceId: number;
  body: string;
  version: string;
  updatedAt: string | null;
}

export default function ContractTemplatesPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<Service | null>(null);
  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingServices, setLoadingServices] = useState(true);

  const fetchServices = useCallback(async () => {
    setLoadingServices(true);
    try {
      const res = await fetchWithAuth("/api/admin/services");
      if (!res.ok) return;
      setServices(await res.json() as Service[]);
    } finally { setLoadingServices(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  async function selectService(s: Service) {
    setSelected(s);
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/contract-templates/${s.id}`);
      if (!res.ok) { setTemplate(null); setBody(""); return; }
      const data = await res.json() as ContractTemplate;
      setTemplate(data);
      setBody(data.body ?? "");
    } finally { setLoading(false); }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/contract-templates/${selected.id}`, {
        method: "PUT",
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to save", variant: "destructive" }); return;
      }
      const data = await res.json() as ContractTemplate;
      setTemplate(data);
      toast({ title: "Contract template saved" });
    } finally { setSaving(false); }
  }

  function formatDate(d: string | null) {
    if (!d) return "Never saved";
    return new Date(d).toLocaleString();
  }

  return (
    <div className="flex h-full">
      {/* Service list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-[#0A2540] text-sm">Contract Templates</h2>
          <p className="text-xs text-gray-500 mt-0.5">One per service offering</p>
        </div>
        {loadingServices ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {services.map(s => (
              <button key={s.id} onClick={() => void selectService(s)}
                className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors ${selected?.id === s.id ? "bg-blue-50 border-l-2 border-[#0078D4]" : ""}`}>
                <p className="font-medium text-sm text-[#0A2540] leading-snug truncate">{s.name}</p>
                {s.category && <p className="text-xs text-gray-400 mt-0.5">{s.category}</p>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Select a service to edit its contract</p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading contract…</div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
              <div>
                <h2 className="font-bold text-[#0A2540] text-base">{selected.name}</h2>
                <div className="flex items-center gap-3 mt-0.5">
                  {template?.version && (
                    <span className="text-xs text-gray-500">
                      <span className="font-medium text-[#0078D4]">{template.version}</span>
                    </span>
                  )}
                  <span className="text-xs text-gray-400">Last saved: {formatDate(template?.updatedAt ?? null)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreview(p => !p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${preview ? "border-[#0078D4] text-[#0078D4] bg-blue-50" : "border-gray-300 text-gray-600 hover:border-gray-400"}`}
                >
                  {preview ? "Edit" : "Preview"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[#0078D4] text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {/* Editor / Preview */}
            <div className="flex-1 overflow-hidden">
              {preview ? (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-8">
                    <h3 className="text-lg font-bold text-[#0A2540] mb-4">Contract Preview</h3>
                    {body ? (
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">{body}</pre>
                    ) : (
                      <p className="text-gray-400 text-sm italic">No contract body yet. Switch to Edit to write one.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col p-6">
                  <div className="mb-2 flex items-center gap-2">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Contract Body (Markdown / Plain text)</label>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    This is the contract text shown to clients at sign-time. Use Markdown for formatting.
                    Variables: <code className="bg-gray-100 px-1 rounded">{`{{client_name}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{service_name}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{price}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{date}}`}</code>
                  </p>
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    className="flex-1 w-full border border-gray-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none leading-relaxed"
                    placeholder={`# Service Agreement\n\nThis Agreement is entered into between Shane McCaw Consulting and {{client_name}}...\n\n## Scope of Work\n\n{{service_name}}\n\n## Fees\n\n{{price}}\n\n## Terms\n\n...`}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  async function handleDelete() {
    if (!selected) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/contract-templates/${selected.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: "Delete failed", description: err.error ?? "Could not delete the contract template.", variant: "destructive" });
        return;
      }
      toast({ title: "Contract template deleted", description: `The template for "${selected.name}" has been removed.` });
      setTemplate(null);
      setBody("");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(d: string | null) {
    if (!d) return "Never saved";
    return new Date(d).toLocaleString();
  }

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Service list */}
      <div className="w-full lg:w-72 flex-shrink-0 border-b lg:border-b-0 border-r-0 lg:border-r border-border bg-card overflow-y-auto max-h-60 lg:max-h-none">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground text-sm">Contract Templates</h2>
          <p className="text-xs text-muted-foreground mt-0.5">One per service offering</p>
        </div>
        {loadingServices ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="divide-y divide-border">
            {services.map(s => (
              <button key={s.id} onClick={() => void selectService(s)}
                className={`w-full text-left px-4 py-3.5 hover:bg-accent transition-colors ${selected?.id === s.id ? "bg-primary/10 border-l-2 border-primary" : ""}`}>
                <p className="font-medium text-sm text-foreground leading-snug truncate">{s.name}</p>
                {s.category && <p className="text-xs text-muted-foreground mt-0.5">{s.category}</p>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Select a service to edit its contract</p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading contract…</div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card flex-shrink-0">
              <div>
                <h2 className="font-bold text-foreground text-base">{selected.name}</h2>
                <div className="flex items-center gap-3 mt-0.5">
                  {template?.version && (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-medium text-primary">{template.version}</span>
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">Last saved: {formatDate(template?.updatedAt ?? null)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {template && template.body && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={deleting}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={() => setPreview(p => !p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${preview ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-muted-foreground/60"}`}
                >
                  {preview ? "Edit" : "Preview"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-primary text-white rounded-lg px-4 py-1.5 text-xs font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {/* Editor / Preview */}
            <div className="flex-1 overflow-hidden">
              {preview ? (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-3xl mx-auto bg-card rounded-xl border border-border p-8">
                    <h3 className="text-lg font-bold text-foreground mb-4">Contract Preview</h3>
                    {body ? (
                      <pre className="whitespace-pre-wrap text-sm text-foreground/90 font-sans leading-relaxed">{body}</pre>
                    ) : (
                      <p className="text-muted-foreground text-sm italic">No contract body yet. Switch to Edit to write one.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col p-6">
                  <div className="mb-2 flex items-center gap-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contract Body (Markdown / Plain text)</label>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    This is the contract text shown to clients at sign-time. Use Markdown for formatting.
                    Variables: <code className="bg-accent px-1 rounded">{`{{client_name}}`}</code>, <code className="bg-accent px-1 rounded">{`{{service_name}}`}</code>, <code className="bg-accent px-1 rounded">{`{{price}}`}</code>, <code className="bg-accent px-1 rounded">{`{{date}}`}</code>
                  </p>
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    className="flex-1 w-full border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none leading-relaxed"
                    placeholder={`# Service Agreement\n\nThis Agreement is entered into between Shane McCaw Consulting and {{client_name}}...\n\n## Scope of Work\n\n{{service_name}}\n\n## Fees\n\n{{price}}\n\n## Terms\n\n...`}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={open => { if (!open) setConfirmDelete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contract template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the contract template for <strong>{selected?.name}</strong>. The service itself will not be affected, but any future contracts for this service will fall back to the default template. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={e => { e.preventDefault(); void handleDelete(); }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Deleting…" : "Yes, delete template"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

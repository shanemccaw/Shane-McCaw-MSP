import { useState, useEffect } from "react";
import { X, Loader2, SlidersHorizontal, Copy, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = "/api";

interface PromptMeta {
  id: number | null;
  key: string;
  name: string;
  description: string;
  promptBody: string;
  defaultBody: string;
}

export default function PromptEditDialog({
  open, onClose, promptKey,
  fetchWithAuth,
}: {
  open: boolean;
  onClose: () => void;
  promptKey: string;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const { toast } = useToast();
  const [meta, setMeta] = useState<PromptMeta | null>(null);
  const [body, setBody] = useState("");
  const [originalBody, setOriginalBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !promptKey) return;
    setLoading(true); setMeta(null); setBody(""); setOriginalBody("");
    fetchWithAuth(`${API}/admin/ai-prompts/by-key/${encodeURIComponent(promptKey)}`)
      .then(async r => {
        const d = await r.json() as { prompt: PromptMeta; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load prompt");
        setMeta(d.prompt);
        setBody(d.prompt.promptBody);
        setOriginalBody(d.prompt.promptBody);
      })
      .catch(e => toast({ title: "Failed to load prompt", description: String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [open, promptKey, fetchWithAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = body !== originalBody;

  const handleClose = () => {
    if (isDirty && !confirm("You have unsaved changes. Discard them?")) return;
    onClose();
  };

  const save = async () => {
    if (!meta) return;
    setSaving(true);
    try {
      const r = await fetchWithAuth(`${API}/admin/ai-prompts/by-key/${encodeURIComponent(promptKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBody: body, defaultBody: meta.defaultBody }),
      });
      const d = await r.json() as { prompt: PromptMeta; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Save failed");
      setMeta(d.prompt);
      setOriginalBody(d.prompt.promptBody);
      setBody(d.prompt.promptBody);
      toast({ title: "Prompt saved", description: "The prompt body has been updated." });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const resetToDefault = () => {
    if (!meta) return;
    if (body !== meta.defaultBody && !confirm("Reset to the built-in default? This will overwrite your current edits.")) return;
    setBody(meta.defaultBody);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast({ title: "Copied", description: "Prompt text copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={handleClose} />
      <div className="relative w-full max-w-2xl bg-card border border-gray-700/50 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-400" />
            <h3 className="text-white font-semibold text-sm">Edit Prompt</h3>
            {meta && <span className="text-xs text-gray-500 font-mono bg-background px-2 py-0.5 rounded">{meta.key}</span>}
          </div>
          <button onClick={handleClose} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading prompt…
            </div>
          ) : meta ? (
            <>
              <div>
                <div className="text-white font-medium text-sm">{meta.name}</div>
                {meta.description && <div className="text-gray-400 text-xs mt-1 leading-relaxed">{meta.description}</div>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-gray-400 text-xs font-medium">Prompt Body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={16}
                  className="w-full bg-background border border-gray-700/50 text-gray-200 text-xs font-mono rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y leading-relaxed"
                />
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <span>{body.length.toLocaleString()} chars</span>
                  {isDirty && <span className="text-yellow-400 ml-2">• Unsaved changes</span>}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700/50 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={resetToDefault}
              disabled={loading || !meta}
              title="Reset to built-in default"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset to Default
            </button>
            <button
              onClick={() => void copyText()}
              disabled={loading || !meta}
              title="Copy prompt text"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={handleClose} className="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">Cancel</button>
            <button
              onClick={() => void save()}
              disabled={saving || loading || !meta || !isDirty}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 transition-colors"
            >
              {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface AiPrompt {
  id: number;
  key: string;
  name: string;
  description: string;
  category: string;
  featureArea: string;
  featureRoute: string;
  model: string | null;
  promptBody: string;
  defaultBody: string;
  updatedAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  scripting:      "bg-blue-500/15 text-blue-400 border-blue-500/25",
  marketing:      "bg-purple-500/15 text-purple-400 border-purple-500/25",
  advisory:       "bg-amber-500/15 text-amber-400 border-amber-500/25",
  inbox:          "bg-teal-500/15 text-teal-400 border-teal-500/25",
  classification: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  artifacts:      "bg-green-500/15 text-green-400 border-green-500/25",
};

export default function PromptCenterEdit({ params }: { params: { id?: string } }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState<AiPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const id = params?.id;

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/ai-prompts/${id}`);
        if (!res.ok) throw new Error("Prompt not found");
        const data = await res.json() as { prompt: AiPrompt };
        setPrompt(data.prompt);
        setBody(data.prompt.promptBody);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load prompt");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, fetchWithAuth]);

  const isDirty = prompt ? body !== prompt.promptBody : false;
  const isModifiedFromDefault = prompt ? prompt.promptBody !== prompt.defaultBody : false;

  const handleSave = useCallback(async () => {
    if (!prompt) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${prompt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBody: body }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Save failed");
      }
      const data = await res.json() as { prompt: AiPrompt };
      setPrompt(data.prompt);
      setBody(data.prompt.promptBody);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [prompt, body, fetchWithAuth]);

  const handleReset = useCallback(async () => {
    if (!prompt) return;
    setResetting(true);
    setSaveError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${prompt.id}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Reset failed");
      }
      const data = await res.json() as { prompt: AiPrompt };
      setPrompt(data.prompt);
      setBody(data.prompt.promptBody);
      setShowResetConfirm(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }, [prompt, fetchWithAuth]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void handleSave();
    }
  }, [handleSave]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/prompt-center">
          <span className="inline-flex items-center gap-1.5 text-sm text-[#7D8590] hover:text-[#C9D1D9] cursor-pointer">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Prompt Center
          </span>
        </Link>
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">{error ?? "Prompt not found"}</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-3">
        <Link href="/prompt-center">
          <span className="inline-flex items-center gap-1.5 text-sm text-[#7D8590] hover:text-[#C9D1D9] cursor-pointer">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Prompt Center
          </span>
        </Link>
        <svg className="w-3 h-3 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm text-[#E6EDF3] font-medium">{prompt.name}</span>
      </div>

      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-[#E6EDF3]">{prompt.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border capitalize ${CATEGORY_COLORS[prompt.category] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
                {prompt.category}
              </span>
              {isModifiedFromDefault && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  Customised
                </span>
              )}
            </div>
            <p className="text-sm text-[#7D8590] mt-1">{prompt.description}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-[#484F58] shrink-0">
            <span>Key: <code className="text-[#7D8590] font-mono">{prompt.key}</code></span>
            {prompt.model && <span>Model: <code className="text-[#7D8590] font-mono">{prompt.model}</code></span>}
            {prompt.featureArea && (
              <div className="flex items-center gap-1">
                <span>Feature: {prompt.featureArea}</span>
                {prompt.featureRoute && (
                  <a href={`/admin-panel${prompt.featureRoute}`} className="text-[#0078D4] hover:text-[#006CBE]" title="Go to feature">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            )}
            <span>Updated: {new Date(prompt.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {prompt.category !== "scripting" && prompt.promptBody.includes("{{") && (
          <div className="bg-[#1C2128] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#7D8590]">
            <span className="font-semibold text-[#C9D1D9]">Note:</span> This prompt uses <code className="font-mono text-[#00B4D8]">{"{{placeholders}}"}</code> to document where dynamic content (lead names, email bodies, etc.) is injected at call time. Keep the same placeholders in any edits.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-[#E6EDF3]">Prompt Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={24}
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-4 py-3 text-sm text-[#E6EDF3] font-mono leading-relaxed resize-y focus:outline-none focus:border-[#0078D4] placeholder:text-[#484F58]"
          spellCheck={false}
          placeholder="Enter the prompt body…"
        />
        <p className="text-xs text-[#484F58]">
          {body.length.toLocaleString()} characters · Changes take effect immediately on the next AI call · <kbd className="px-1 py-0.5 bg-[#1C2128] rounded text-[10px]">Ctrl+S</kbd> to save
        </p>
      </div>

      {saveError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-sm text-red-400">{saveError}</div>
      )}

      {saved && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2.5 text-sm text-green-400 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Saved — next AI call will use the updated prompt
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#21262D]">
        <div>
          {isModifiedFromDefault && !showResetConfirm && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-[#7D8590] hover:text-[#C9D1D9] px-3 py-1.5 rounded hover:bg-[#1C2128] transition-colors"
            >
              Reset to default
            </button>
          )}
          {showResetConfirm && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7D8590]">This will overwrite your edits with the original. Continue?</span>
              <button
                onClick={() => void handleReset()}
                disabled={resetting}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {resetting ? "Resetting…" : "Yes, reset"}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="text-xs text-[#7D8590] hover:text-[#C9D1D9] px-2 py-1 rounded hover:bg-[#1C2128] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/prompt-center">
            <span className="text-xs text-[#7D8590] hover:text-[#C9D1D9] px-3 py-1.5 rounded hover:bg-[#1C2128] transition-colors cursor-pointer">
              {isDirty ? "Discard changes" : "Back"}
            </span>
          </Link>
          <button
            onClick={() => void handleSave()}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#006CBE] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

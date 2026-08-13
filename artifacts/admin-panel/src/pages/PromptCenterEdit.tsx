import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLocation } from "wouter";
import DOMPurify from "dompurify";
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
  draftBody: string | null;
  updatedAt: string;
}

interface AiPromptVersion {
  id: number;
  promptId: number;
  versionNumber: number;
  body: string;
  action: "draft" | "publish" | "reset";
  createdAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  scripting:      "bg-blue-500/15 text-blue-400 border-blue-500/25",
  marketing:      "bg-purple-500/15 text-purple-400 border-purple-500/25",
  advisory:       "bg-amber-500/15 text-amber-400 border-amber-500/25",
  inbox:          "bg-teal-500/15 text-teal-400 border-teal-500/25",
  classification: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  artifacts:      "bg-green-500/15 text-green-400 border-green-500/25",
  insights:       "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
};

const ACTION_LABELS: Record<AiPromptVersion["action"], string> = {
  draft: "Draft saved",
  publish: "Published",
  reset: "Reset to default",
};

const ACTION_COLORS: Record<AiPromptVersion["action"], string> = {
  draft: "text-[#00B4D8]",
  publish: "text-green-400",
  reset: "text-amber-400",
};

// Prompt keys backed by a real document/SOW generation flow — these are the
// only keys that support the Test Draft feature.
function supportsTestDraft(key: string): boolean {
  return key === "insights-consulting-consolidated_sow"
    || key.startsWith("insights-report-")
    || key.startsWith("insights-consulting-");
}

export default function PromptCenterEdit({ params }: { params: { id?: string } }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState<AiPrompt | null>(null);
  const [versions, setVersions] = useState<AiPromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revertingId, setRevertingId] = useState<number | null>(null);

  // Test Draft state
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testClientUserId, setTestClientUserId] = useState("");
  const [testProjectId, setTestProjectId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ htmlContent: string; sowTotal?: number } | null>(null);

  const id = params?.id;

  const loadPrompt = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${id}`);
      if (!res.ok) throw new Error("Prompt not found");
      const data = await res.json() as { prompt: AiPrompt };
      setPrompt(data.prompt);
      // Default the editor to the draft if one exists, otherwise the published body.
      setBody(data.prompt.draftBody ?? data.prompt.promptBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompt");
    } finally {
      setLoading(false);
    }
  }, [id, fetchWithAuth]);

  const loadVersions = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${id}/versions`);
      if (!res.ok) return;
      const data = await res.json() as { versions: AiPromptVersion[] };
      setVersions(data.versions);
    } catch {
      // non-fatal — history is a secondary affordance
    }
  }, [id, fetchWithAuth]);

  useEffect(() => { void loadPrompt(); }, [loadPrompt]);
  useEffect(() => { void loadVersions(); }, [loadVersions]);

  const hasDraft = !!prompt?.draftBody;
  const isDirty = prompt ? body !== (prompt.draftBody ?? prompt.promptBody) : false;
  const isModifiedFromDefault = prompt ? prompt.promptBody !== prompt.defaultBody || hasDraft : false;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleBackClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDirty) {
        e.preventDefault();
        if (window.confirm("You have unsaved changes. Discard and go back?")) {
          navigate("/prompt-center");
        }
      }
    },
    [isDirty, navigate],
  );

  const handleSaveDraft = useCallback(async () => {
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
      setBody(data.prompt.draftBody ?? data.prompt.promptBody);
      setSaved("Draft saved — publish when you're ready");
      setTimeout(() => setSaved(null), 3000);
      void loadVersions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [prompt, body, fetchWithAuth, loadVersions]);

  const handlePublish = useCallback(async () => {
    if (!prompt) return;
    setPublishing(true);
    setSaveError(null);
    try {
      // If the editor has unsaved text, publish it directly; otherwise publish the saved draft.
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${prompt.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBody: body }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Publish failed");
      }
      const data = await res.json() as { prompt: AiPrompt };
      setPrompt(data.prompt);
      setBody(data.prompt.promptBody);
      setSaved("Published — live for the next AI call");
      setTimeout(() => setSaved(null), 3000);
      void loadVersions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }, [prompt, body, fetchWithAuth, loadVersions]);

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
      setSaved("Reset to default and published");
      setTimeout(() => setSaved(null), 3000);
      void loadVersions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }, [prompt, fetchWithAuth, loadVersions]);

  const handleRevert = useCallback(async (versionId: number) => {
    if (!prompt) return;
    setRevertingId(versionId);
    setSaveError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/${prompt.id}/revert/${versionId}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Revert failed");
      }
      const data = await res.json() as { prompt: AiPrompt };
      setPrompt(data.prompt);
      setBody(data.prompt.draftBody ?? data.prompt.promptBody);
      setSaved("Reverted and published — this is now the live prompt");
      setTimeout(() => setSaved(null), 3500);
      void loadVersions();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setRevertingId(null);
    }
  }, [prompt, fetchWithAuth, loadVersions]);

  const handleTestDraft = useCallback(async () => {
    if (!prompt) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const clientUserId = parseInt(testClientUserId, 10);
      if (!clientUserId) throw new Error("Enter a valid client user ID");
      const projectId = testProjectId.trim() ? parseInt(testProjectId, 10) : undefined;

      const res = await fetchWithAuth(`/api/admin/ai-prompts/${prompt.id}/test-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientUserId, projectId, body }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Test generation failed");
      }
      const data = await res.json() as { htmlContent: string; sowTotal?: number };
      setTestResult(data);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Test generation failed");
    } finally {
      setTesting(false);
    }
  }, [prompt, testClientUserId, testProjectId, body, fetchWithAuth]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      void handleSaveDraft();
    }
  }, [handleSaveDraft]);

  const canTestDraft = useMemo(() => prompt ? supportsTestDraft(prompt.key) : false, [prompt]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/prompt-center">
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground/90 cursor-pointer">
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
        <Link href="/prompt-center" onClick={handleBackClick}>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground/90 cursor-pointer">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Prompt Center
          </span>
        </Link>
        <svg className="w-3 h-3 text-muted-foreground/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm text-foreground font-medium">{prompt.name}</span>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-foreground">{prompt.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border capitalize ${CATEGORY_COLORS[prompt.category] ?? "bg-accent text-muted-foreground border-border"}`}>
                {prompt.category}
              </span>
              {isModifiedFromDefault && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  Customised
                </span>
              )}
              {hasDraft && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#00B4D8]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00B4D8] inline-block" />
                  Draft pending
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{prompt.description}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground/60 shrink-0">
            <span>Key: <code className="text-muted-foreground font-mono">{prompt.key}</code></span>
            {prompt.model && <span>Model: <code className="text-muted-foreground font-mono">{prompt.model}</code></span>}
            {prompt.featureArea && (
              <div className="flex items-center gap-1">
                <span>Feature: {prompt.featureArea}</span>
                {prompt.featureRoute && (
                  <a href={`/admin-panel${prompt.featureRoute}`} className="text-primary hover:text-[#006CBE]" title="Go to feature">
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
          <div className="bg-accent border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/90">Note:</span> This prompt uses <code className="font-mono text-[#00B4D8]">{"{{placeholders}}"}</code> to document where dynamic content (lead names, email bodies, etc.) is injected at call time. Keep the same placeholders in any edits.
          </div>
        )}

        {hasDraft && (
          <div className="bg-[#00B4D8]/10 border border-[#00B4D8]/25 rounded-lg px-3 py-2 text-xs text-[#7EE0F2]">
            This prompt has an unpublished draft. The <span className="font-semibold">live/published body</span> is still what runs in production until you click Publish.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-foreground">
          {hasDraft ? "Draft Body" : "Prompt Body"}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={24}
          className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground font-mono leading-relaxed resize-y focus:outline-none focus:border-primary placeholder:text-muted-foreground/60"
          spellCheck={false}
          placeholder="Enter the prompt body…"
        />
        <p className="text-xs text-muted-foreground/60">
          {body.length.toLocaleString()} characters · Save Draft stages changes without affecting live traffic · Publish makes it live · <kbd className="px-1 py-0.5 bg-accent rounded text-[10px]">Ctrl+S</kbd> to save draft
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
          {saved}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-accent">
        <div className="flex items-center gap-3 flex-wrap">
          {isModifiedFromDefault && !showResetConfirm && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-muted-foreground hover:text-foreground/90 px-3 py-1.5 rounded hover:bg-accent transition-colors"
            >
              Reset to default
            </button>
          )}
          {showResetConfirm && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">This will overwrite the published body and any draft with the original. Continue?</span>
              <button
                onClick={() => void handleReset()}
                disabled={resetting}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                {resetting ? "Resetting…" : "Yes, reset"}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="text-xs text-muted-foreground hover:text-foreground/90 px-2 py-1 rounded hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground/90 px-3 py-1.5 rounded hover:bg-accent transition-colors inline-flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {showHistory ? "Hide version history" : `Version history (${versions.length})`}
          </button>
          {canTestDraft && (
            <button
              onClick={() => setShowTestPanel((v) => !v)}
              className="text-xs text-[#00B4D8] hover:text-[#7EE0F2] px-3 py-1.5 rounded hover:bg-[#00B4D8]/10 transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {showTestPanel ? "Hide Test Draft" : "Test Draft"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/prompt-center">
            <span className="text-xs text-muted-foreground hover:text-foreground/90 px-3 py-1.5 rounded hover:bg-accent transition-colors cursor-pointer">
              {isDirty ? "Discard changes" : "Back"}
            </span>
          </Link>
          <button
            onClick={() => void handleSaveDraft()}
            disabled={!isDirty || saving}
            className="flex items-center gap-1.5 bg-accent border border-border text-foreground text-xs font-semibold px-4 py-1.5 rounded-lg hover:border-muted-foreground/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              "Save draft"
            )}
          </button>
          <button
            onClick={() => void handlePublish()}
            disabled={publishing || (!isDirty && !hasDraft)}
            className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#006CBE] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishing ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Publish
              </>
            )}
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-semibold text-foreground mb-1">Version history</h2>
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved versions yet — save a draft or publish to create the first one.</p>
          ) : (
            <div className="divide-y divide-accent">
              {versions.map((v) => (
                <div key={v.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">v{v.versionNumber}</span>
                      <span className={`text-[10px] font-medium ${ACTION_COLORS[v.action]}`}>{ACTION_LABELS[v.action]}</span>
                      <span className="text-[10px] text-muted-foreground/60">{new Date(v.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                      {v.body.slice(0, 140)}{v.body.length > 140 ? "…" : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleRevert(v.id)}
                    disabled={revertingId === v.id}
                    className="shrink-0 text-xs text-primary hover:text-[#006CBE] px-2 py-1 rounded hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {revertingId === v.id ? "Reverting…" : "Revert to this"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showTestPanel && canTestDraft && (
        <div className="bg-card border border-[#00B4D8]/25 rounded-xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Test Draft</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Runs the real generation flow using the text currently in the editor above — nothing is saved to the client's documents.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Client User ID</label>
              <input
                type="number"
                value={testClientUserId}
                onChange={(e) => setTestClientUserId(e.target.value)}
                placeholder="e.g. 42"
                className="w-32 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-[#00B4D8]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Project ID (optional)</label>
              <input
                type="number"
                value={testProjectId}
                onChange={(e) => setTestProjectId(e.target.value)}
                placeholder="e.g. 7"
                className="w-32 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-[#00B4D8]"
              />
            </div>
            <button
              onClick={() => void handleTestDraft()}
              disabled={testing || !testClientUserId.trim()}
              className="flex items-center gap-1.5 bg-[#00B4D8] text-[#0A2540] text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#22C6E8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? (
                <>
                  <div className="w-3 h-3 border-2 border-[#0A2540]/30 border-t-[#0A2540] rounded-full animate-spin" />
                  Generating…
                </>
              ) : (
                "Run Test Draft"
              )}
            </button>
          </div>

          {testError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-sm text-red-400">{testError}</div>
          )}

          {testResult && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Result</h3>
                {typeof testResult.sowTotal === "number" && testResult.sowTotal > 0 && (
                  <span className="text-xs text-[#00B4D8] font-semibold">Computed total: ${testResult.sowTotal.toLocaleString()}</span>
                )}
              </div>
              <div className="bg-white rounded-lg p-4 max-h-[600px] overflow-y-auto text-black text-sm">
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(testResult.htmlContent) }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

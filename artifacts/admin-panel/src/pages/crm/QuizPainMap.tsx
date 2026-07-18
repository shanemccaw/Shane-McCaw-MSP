import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface PainMapConfig {
  quizTypePainMap: Record<string, string[]>;
  categoryPainMap: [string, string][];
  isDefault?: boolean;
  updatedAt?: string;
}

const ALL_QUIZ_TYPES = [
  "sharepoint",
  "migration",
  "security-compliance",
  "copilot",
  "teams",
  "power-platform",
  "governance",
  "m365-health",
];

const QUIZ_TYPE_LABELS: Record<string, string> = {
  sharepoint: "SharePoint",
  migration: "Migration",
  "security-compliance": "Security & Compliance",
  copilot: "Copilot Readiness",
  teams: "Teams",
  "power-platform": "Power Platform",
  governance: "Governance",
  "m365-health": "M365 Health",
};

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 hover:text-red-400 transition-colors leading-none"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

function AddInput({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
}) {
  const [val, setVal] = useState("");
  const commit = () => {
    const trimmed = val.trim();
    if (trimmed) {
      onAdd(trimmed);
      setVal("");
    }
  };
  return (
    <div className="flex gap-1.5 mt-2">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === "Enter" && (e.preventDefault(), commit())}
        placeholder={placeholder}
        className="flex-1 bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <button
        type="button"
        onClick={commit}
        className="text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
      >
        Add
      </button>
    </div>
  );
}

export default function QuizPainMapPage() {
  const { fetchWithAuth } = useAuth();

  const [config, setConfig] = useState<PainMapConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local editable state
  const [quizTypePainMap, setQuizTypePainMap] = useState<Record<string, string[]>>({});
  const [categoryPainMap, setCategoryPainMap] = useState<[string, string][]>([]);
  const [newQuizType, setNewQuizType] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/admin/quiz-pain-map");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json() as PainMapConfig;
      setConfig(data);
      setQuizTypePainMap(data.quizTypePainMap);
      setCategoryPainMap(data.categoryPainMap);
    } catch {
      setError("Could not load mappings. Check the API server.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/admin/quiz-pain-map", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizTypePainMap, categoryPainMap }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!confirm("Reset all mappings to the built-in defaults? This cannot be undone.")) return;
    setSaving(true);
    try {
      await fetchWithAuth("/api/admin/quiz-pain-map", { method: "DELETE" });
      await load();
    } catch {
      setError("Reset failed.");
    } finally {
      setSaving(false);
    }
  };

  // --- Quiz Type Pain Map handlers ---
  const addPainToQuizType = (quizType: string, pain: string) => {
    setQuizTypePainMap(prev => ({
      ...prev,
      [quizType]: [...(prev[quizType] ?? []).filter(p => p !== pain), pain],
    }));
  };

  const removePainFromQuizType = (quizType: string, pain: string) => {
    setQuizTypePainMap(prev => ({
      ...prev,
      [quizType]: (prev[quizType] ?? []).filter(p => p !== pain),
    }));
  };

  const addNewQuizTypeRow = () => {
    const key = newQuizType.trim().toLowerCase().replace(/\s+/g, "-");
    if (!key || quizTypePainMap[key] !== undefined) return;
    setQuizTypePainMap(prev => ({ ...prev, [key]: [] }));
    setNewQuizType("");
  };

  const removeQuizTypeRow = (quizType: string) => {
    setQuizTypePainMap(prev => {
      const next = { ...prev };
      delete next[quizType];
      return next;
    });
  };

  // --- Category Pain Map handlers ---
  const addCategoryRow = (keyword: string, signal: string) => {
    const kw = keyword.trim().toLowerCase();
    const sig = signal.trim();
    if (!kw || !sig) return;
    setCategoryPainMap(prev => [...prev, [kw, sig]]);
  };

  const removeCategoryRow = (idx: number) => {
    setCategoryPainMap(prev => prev.filter((_, i) => i !== idx));
  };

  const updateCategoryRow = (idx: number, field: 0 | 1, value: string) => {
    setCategoryPainMap(prev => prev.map((row, i) =>
      i === idx ? (field === 0 ? [value, row[1]] : [row[0], value]) as [string, string] : row
    ));
  };

  const [newCatKeyword, setNewCatKeyword] = useState("");
  const [newCatSignal, setNewCatSignal] = useState("");

  const commitNewCategory = () => {
    addCategoryRow(newCatKeyword, newCatSignal);
    setNewCatKeyword("");
    setNewCatSignal("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const quizTypeKeys = Object.keys(quizTypePainMap);

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Quiz Signal Mappings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure which quiz types and category scores map to pain signals on lead profiles.
            Changes take effect immediately for new quiz-to-lead imports.
          </p>
          {config?.isDefault && (
            <p className="text-xs text-amber-400 mt-1.5">
              Showing built-in defaults — no custom mappings saved yet.
            </p>
          )}
          {config?.updatedAt && !config.isDefault && (
            <p className="text-xs text-muted-foreground mt-1">
              Last saved {new Date(config.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetToDefaults}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="text-xs px-4 py-1.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Section 1: Quiz Type → Pain Signals */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent">
          <h2 className="text-sm font-bold text-foreground">Quiz Type → Pain Signals</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            When a lead completes a quiz of this type, these pain signals are automatically added to their profile.
          </p>
        </div>
        <div className="divide-y divide-border">
          {quizTypeKeys.map(qt => (
            <div key={qt} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <span className="text-xs font-semibold text-foreground">
                    {QUIZ_TYPE_LABELS[qt] ?? qt}
                  </span>
                  <span className="ml-2 text-[10px] text-muted-foreground font-mono">{qt}</span>
                </div>
                {!ALL_QUIZ_TYPES.includes(qt) && (
                  <button
                    type="button"
                    onClick={() => removeQuizTypeRow(qt)}
                    className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    Remove type
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(quizTypePainMap[qt] ?? []).map(pain => (
                  <Chip key={pain} label={pain} onRemove={() => removePainFromQuizType(qt, pain)} />
                ))}
              </div>
              <AddInput
                placeholder='Add pain signal, e.g. "Governance"'
                onAdd={pain => addPainToQuizType(qt, pain)}
              />
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-border bg-accent/40">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Add a new quiz type</p>
          <div className="flex gap-1.5">
            <input
              value={newQuizType}
              onChange={e => setNewQuizType(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addNewQuizTypeRow())}
              placeholder='e.g. "viva-engage"'
              className="flex-1 bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={addNewQuizTypeRow}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
            >
              Add type
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Category Keyword → Pain Signal */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent">
          <h2 className="text-sm font-bold text-foreground">Category Keyword → Pain Signal</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            When a quiz category name contains the keyword AND its score is ≤ 5/10,
            the pain signal is added to the lead. Keyword matching is case-insensitive.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-accent/60">
                <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider w-1/2">
                  Category keyword
                </th>
                <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider w-1/2">
                  Pain signal added
                </th>
                <th className="px-4 py-2.5 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categoryPainMap.map(([kw, sig], idx) => (
                <tr key={idx} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <input
                      value={kw}
                      onChange={e => updateCategoryRow(idx, 0, e.target.value)}
                      className="w-full bg-card border border-border rounded-md px-2 py-1 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={sig}
                      onChange={e => updateCategoryRow(idx, 1, e.target.value)}
                      className="w-full bg-card border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeCategoryRow(idx)}
                      className="text-muted-foreground hover:text-red-400 transition-colors text-base leading-none"
                      aria-label="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-border bg-accent/40">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Add a new mapping</p>
          <div className="flex gap-2 flex-wrap">
            <input
              value={newCatKeyword}
              onChange={e => setNewCatKeyword(e.target.value)}
              placeholder="Keyword (e.g. viva)"
              className="flex-1 min-w-[140px] bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground font-mono placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              value={newCatSignal}
              onChange={e => setNewCatSignal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), commitNewCategory())}
              placeholder="Pain signal (e.g. Viva Engage)"
              className="flex-1 min-w-[140px] bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={commitNewCategory}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
            >
              Add row
            </button>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-accent border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider mb-2">How signal derivation works</p>
        <p><span className="text-primary">1. Quiz type pains</span> — all signals listed for that quiz type are added unconditionally.</p>
        <p><span className="text-primary">2. Category keyword pains</span> — for each quiz category with a score ≤ 5/10, the category name is matched against the keyword list; on match, the corresponding pain signal is added.</p>
        <p><span className="text-primary">3. Transcript keywords</span> — maturity and urgency signals are derived from the raw conversation text (not configurable here).</p>
        <p className="text-amber-400/80">Changes only affect leads imported after saving — existing lead profiles are not retroactively updated until an admin clicks "Re-import from quiz" on the Lead Detail page.</p>
      </div>
    </div>
  );
}

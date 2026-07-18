import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_QUIZ_TYPE_PAIN_MAP: Record<string, string[]> = {
  sharepoint: ["SharePoint", "Governance"],
  migration: ["Migration"],
  "security-compliance": ["Security", "Compliance", "Governance"],
  copilot: ["Copilot", "AI Readiness"],
  teams: ["Teams"],
  "power-platform": ["Power Platform", "Governance"],
  governance: ["Governance", "Compliance"],
  "m365-health": ["Security", "Compliance", "Governance"],
};

const DEFAULT_CATEGORY_PAIN_MAP: [string, string][] = [
  ["sharepoint", "SharePoint"],
  ["teams", "Teams"],
  ["powerplatform", "Power Platform"],
  ["power", "Power Platform"],
  ["security", "Security"],
  ["compliance", "Compliance"],
  ["governance", "Governance"],
  ["copilot", "Copilot"],
  ["migration", "Migration"],
  ["adoption", "Adoption"],
  ["training", "Training"],
];

interface Config {
  quizTypePainMap: Record<string, string[]>;
  categoryPainMap: [string, string][];
  isDefault?: boolean;
  updatedAt?: string;
}

interface RecalcResult {
  updated: number;
  total: number;
}

export default function QuizPainConfigPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [quizTypeMap, setQuizTypeMap] = useState<[string, string[]][]>([]);
  const [categoryMap, setCategoryMap] = useState<[string, string][]>([]);

  const [newQtKey, setNewQtKey] = useState("");
  const [newQtPains, setNewQtPains] = useState("");
  const [newCatKey, setNewCatKey] = useState("");
  const [newCatPain, setNewCatPain] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/quiz-pain-config");
      if (!res.ok) throw new Error("Failed to load");
      const data: Config = await res.json();
      setIsDefault(data.isDefault ?? false);
      setUpdatedAt(data.updatedAt ?? null);
      setQuizTypeMap(Object.entries(data.quizTypePainMap));
      setCategoryMap(data.categoryPainMap);
    } catch {
      toast({ title: "Error", description: "Failed to load quiz pain config", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const quizTypePainMap = Object.fromEntries(quizTypeMap);
      const res = await fetchWithAuth("/api/admin/quiz-pain-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizTypePainMap, categoryPainMap: categoryMap }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Saved", description: "Quiz pain signal mappings saved." });
      setIsDefault(false);
      setUpdatedAt(new Date().toISOString());
    } catch {
      toast({ title: "Error", description: "Failed to save config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset to hardcoded defaults? This will delete your custom mappings.")) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/quiz-pain-config", { method: "DELETE" });
      if (!res.ok) throw new Error("Server reset failed");
      setQuizTypeMap(Object.entries(DEFAULT_QUIZ_TYPE_PAIN_MAP));
      setCategoryMap([...DEFAULT_CATEGORY_PAIN_MAP]);
      setIsDefault(true);
      setUpdatedAt(null);
      setRecalcResult(null);
      toast({ title: "Reset", description: "Mappings reset to defaults." });
    } catch {
      toast({ title: "Error", description: "Failed to reset config", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRecalculate() {
    if (!confirm(
      "Re-derive pain signals for all leads that have quiz submissions?\n\n" +
      "This will overwrite the painPoints, maturityIndicators, engagementSignals, and urgencySignals " +
      "on those leads using the current saved mappings. Proceed?"
    )) return;

    setRecalculating(true);
    setRecalcResult(null);
    try {
      const res = await fetchWithAuth("/api/admin/quiz-pain-config/recalculate", { method: "POST" });
      if (!res.ok) throw new Error("Recalculate failed");
      const data: RecalcResult = await res.json();
      setRecalcResult(data);
      toast({
        title: "Re-scoring complete",
        description: `Updated ${data.updated} of ${data.total} lead${data.total !== 1 ? "s" : ""} with quiz matches.`,
      });
    } catch {
      toast({ title: "Error", description: "Failed to recalculate lead signals", variant: "destructive" });
    } finally {
      setRecalculating(false);
    }
  }

  function updateQtPains(idx: number, raw: string) {
    const pains = raw.split(",").map(s => s.trim()).filter(Boolean);
    setQuizTypeMap(prev => prev.map((row, i) => i === idx ? [row[0], pains] : row));
  }

  function updateQtKey(idx: number, key: string) {
    setQuizTypeMap(prev => prev.map((row, i) => i === idx ? [key, row[1]] : row));
  }

  function removeQtRow(idx: number) {
    setQuizTypeMap(prev => prev.filter((_, i) => i !== idx));
  }

  function addQtRow() {
    const key = newQtKey.trim();
    const pains = newQtPains.split(",").map(s => s.trim()).filter(Boolean);
    if (!key || pains.length === 0) return;
    setQuizTypeMap(prev => [...prev, [key, pains]]);
    setNewQtKey("");
    setNewQtPains("");
  }

  function updateCatKey(idx: number, key: string) {
    setCategoryMap(prev => prev.map((row, i) => i === idx ? [key, row[1]] : row));
  }

  function updateCatPain(idx: number, pain: string) {
    setCategoryMap(prev => prev.map((row, i) => i === idx ? [row[0], pain] : row));
  }

  function removeCatRow(idx: number) {
    setCategoryMap(prev => prev.filter((_, i) => i !== idx));
  }

  function addCatRow() {
    const key = newCatKey.trim();
    const pain = newCatPain.trim();
    if (!key || !pain) return;
    setCategoryMap(prev => [...prev, [key, pain]]);
    setNewCatKey("");
    setNewCatPain("");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Quiz Pain Signal Mappings</h1>
          <p className="text-sm text-gray-400 mt-1">
            Controls how quiz types and low category scores translate into pain points on lead profiles.
          </p>
          {isDefault ? (
            <span className="inline-block mt-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded">
              Using built-in defaults — no custom config saved yet
            </span>
          ) : updatedAt ? (
            <span className="inline-block mt-2 text-xs text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded">
              Custom config · last saved {new Date(updatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <button
            onClick={handleReset}
            disabled={saving || isDefault}
            className="px-3 py-1.5 text-sm rounded border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded bg-primary hover:bg-primary/90 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Quiz Type → Pain Points */}
      <section className="bg-card border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">Quiz Type → Pain Points</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            When a lead's quiz type matches a key, those pain point tags are added to their profile.
          </p>
        </div>
        <div className="divide-y divide-gray-700/50">
          {quizTypeMap.map(([key, pains], idx) => (
            <div key={idx} className="flex items-center gap-3 px-5 py-3">
              <input
                type="text"
                value={key}
                onChange={e => updateQtKey(idx, e.target.value)}
                placeholder="quiz-type"
                className="w-40 shrink-0 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
              />
              <span className="text-gray-500 text-sm shrink-0">→</span>
              <input
                type="text"
                value={pains.join(", ")}
                onChange={e => updateQtPains(idx, e.target.value)}
                placeholder="Pain Tag, Another Tag"
                className="flex-1 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
              />
              <button
                onClick={() => removeQtRow(idx)}
                className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                title="Remove row"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3 px-5 py-3 bg-background/40">
            <input
              type="text"
              value={newQtKey}
              onChange={e => setNewQtKey(e.target.value)}
              placeholder="new-quiz-type"
              className="w-40 shrink-0 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
            />
            <span className="text-gray-500 text-sm shrink-0">→</span>
            <input
              type="text"
              value={newQtPains}
              onChange={e => setNewQtPains(e.target.value)}
              placeholder="Pain Tag, Another Tag"
              onKeyDown={e => e.key === "Enter" && addQtRow()}
              className="flex-1 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
            />
            <button
              onClick={addQtRow}
              className="text-primary hover:text-primary/80 transition-colors shrink-0 font-medium text-sm"
            >
              + Add
            </button>
          </div>
        </div>
      </section>

      {/* Category Key → Pain Tag */}
      <section className="bg-card border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">Category Score → Pain Tag</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            When a category's score is ≤ 5, its normalized key is matched (substring) against these entries to assign a pain tag.
            Entries are checked in order — first match wins.
          </p>
        </div>
        <div className="divide-y divide-gray-700/50">
          {categoryMap.map(([key, pain], idx) => (
            <div key={idx} className="flex items-center gap-3 px-5 py-3">
              <input
                type="text"
                value={key}
                onChange={e => updateCatKey(idx, e.target.value)}
                placeholder="category-substring"
                className="w-40 shrink-0 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
              />
              <span className="text-gray-500 text-sm shrink-0">→</span>
              <input
                type="text"
                value={pain}
                onChange={e => updateCatPain(idx, e.target.value)}
                placeholder="Pain Tag"
                className="flex-1 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
              />
              <button
                onClick={() => removeCatRow(idx)}
                className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                title="Remove row"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3 px-5 py-3 bg-background/40">
            <input
              type="text"
              value={newCatKey}
              onChange={e => setNewCatKey(e.target.value)}
              placeholder="category-substring"
              className="w-40 shrink-0 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
            />
            <span className="text-gray-500 text-sm shrink-0">→</span>
            <input
              type="text"
              value={newCatPain}
              onChange={e => setNewCatPain(e.target.value)}
              placeholder="Pain Tag"
              onKeyDown={e => e.key === "Enter" && addCatRow()}
              className="flex-1 bg-background border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary"
            />
            <button
              onClick={addCatRow}
              className="text-primary hover:text-primary/80 transition-colors shrink-0 font-medium text-sm"
            >
              + Add
            </button>
          </div>
        </div>
      </section>

      {/* Bulk Recalculate */}
      <section className="bg-card border border-gray-700 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-white">Re-score Existing Leads</h2>
            <p className="text-sm text-gray-400 mt-1">
              After saving new mappings, click this to apply them retroactively to every lead that has a quiz
              submission. Pain points, maturity indicators, engagement signals, and urgency signals will be
              overwritten with freshly derived values.
            </p>
            {recalcResult !== null && (
              <p className="mt-2 text-sm text-green-400">
                ✓ Updated {recalcResult.updated} of {recalcResult.total} lead{recalcResult.total !== 1 ? "s" : ""} with quiz matches.
              </p>
            )}
          </div>
          <button
            onClick={handleRecalculate}
            disabled={recalculating || saving}
            className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm rounded bg-[#1C2A1A] border border-green-700 text-green-400 hover:bg-green-900/30 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {recalculating ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Recalculating…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-score All Leads
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

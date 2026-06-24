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

export default function QuizPainConfigPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      toast({ title: "Reset", description: "Mappings reset to defaults." });
    } catch {
      toast({ title: "Error", description: "Failed to reset config", variant: "destructive" });
    } finally {
      setSaving(false);
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
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
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
        <div className="flex gap-2 shrink-0">
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
            className="px-4 py-1.5 text-sm rounded bg-[#0078D4] hover:bg-[#0078D4]/90 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Quiz Type → Pain Points */}
      <section className="bg-[#161B22] border border-gray-700 rounded-lg overflow-hidden">
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
                className="w-40 shrink-0 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
              />
              <span className="text-gray-500 text-sm shrink-0">→</span>
              <input
                type="text"
                value={pains.join(", ")}
                onChange={e => updateQtPains(idx, e.target.value)}
                placeholder="Pain Tag, Another Tag"
                className="flex-1 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
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
          <div className="flex items-center gap-3 px-5 py-3 bg-[#0D1117]/40">
            <input
              type="text"
              value={newQtKey}
              onChange={e => setNewQtKey(e.target.value)}
              placeholder="new-quiz-type"
              className="w-40 shrink-0 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
            />
            <span className="text-gray-500 text-sm shrink-0">→</span>
            <input
              type="text"
              value={newQtPains}
              onChange={e => setNewQtPains(e.target.value)}
              placeholder="Pain Tag, Another Tag"
              onKeyDown={e => e.key === "Enter" && addQtRow()}
              className="flex-1 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
            />
            <button
              onClick={addQtRow}
              className="text-[#0078D4] hover:text-[#0078D4]/80 transition-colors shrink-0 font-medium text-sm"
            >
              + Add
            </button>
          </div>
        </div>
      </section>

      {/* Category Key → Pain Tag */}
      <section className="bg-[#161B22] border border-gray-700 rounded-lg overflow-hidden">
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
                className="w-40 shrink-0 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
              />
              <span className="text-gray-500 text-sm shrink-0">→</span>
              <input
                type="text"
                value={pain}
                onChange={e => updateCatPain(idx, e.target.value)}
                placeholder="Pain Tag"
                className="flex-1 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
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
          <div className="flex items-center gap-3 px-5 py-3 bg-[#0D1117]/40">
            <input
              type="text"
              value={newCatKey}
              onChange={e => setNewCatKey(e.target.value)}
              placeholder="category-substring"
              className="w-40 shrink-0 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
            />
            <span className="text-gray-500 text-sm shrink-0">→</span>
            <input
              type="text"
              value={newCatPain}
              onChange={e => setNewCatPain(e.target.value)}
              placeholder="Pain Tag"
              onKeyDown={e => e.key === "Enter" && addCatRow()}
              className="flex-1 bg-[#0D1117] border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-[#0078D4]"
            />
            <button
              onClick={addCatRow}
              className="text-[#0078D4] hover:text-[#0078D4]/80 transition-colors shrink-0 font-medium text-sm"
            >
              + Add
            </button>
          </div>
        </div>
      </section>

      <p className="text-xs text-gray-500">
        Changes take effect immediately for any lead detail page loaded after saving. Existing lead profiles are not retroactively updated — re-open a lead to recalculate signals.
      </p>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Link } from "wouter";
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
  insights:       "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
};

const CATEGORIES = ["all", "scripting", "marketing", "advisory", "inbox", "classification", "artifacts", "insights"] as const;

function isModified(prompt: AiPrompt): boolean {
  return prompt.promptBody !== prompt.defaultBody;
}

export default function PromptCenter() {
  const { fetchWithAuth } = useAuth();
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/ai-prompts");
        if (!res.ok) throw new Error("Failed to load prompts");
        const data = await res.json() as { prompts: AiPrompt[] };
        setPrompts(data.prompts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load prompts");
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchWithAuth]);

  const filtered = prompts.filter((p) => {
    const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.featureArea.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#E6EDF3]">AI Prompt Center</h1>
        <p className="text-sm text-[#7D8590] mt-1">
          View and edit every AI prompt used across the admin panel. Changes take effect on the next AI call — no redeploy needed.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7D8590]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search prompts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[#1C2128] border border-[#30363D] rounded-lg text-sm text-[#E6EDF3] placeholder:text-[#484F58] focus:outline-none focus:border-[#0078D4]"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${
                categoryFilter === cat
                  ? "bg-[#0078D4] text-white border-[#0078D4]"
                  : "text-[#7D8590] border-[#30363D] hover:border-[#484F58] hover:text-[#C9D1D9]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-[#7D8590]">{filtered.length} prompt{filtered.length !== 1 ? "s" : ""}</div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-[#7D8590]">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p>No prompts match your filters.</p>
        </div>
      ) : (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363D]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wider">Prompt</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wider hidden lg:table-cell">Feature Area</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wider hidden xl:table-cell">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262D]">
              {filtered.map((prompt) => (
                <tr key={prompt.id} className="hover:bg-[#1C2128] transition-colors group">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#E6EDF3]">{prompt.name}</div>
                    <div className="text-xs text-[#484F58] mt-0.5 hidden sm:block">{prompt.description.slice(0, 80)}{prompt.description.length > 80 ? "…" : ""}</div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border capitalize ${CATEGORY_COLORS[prompt.category] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
                      {prompt.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5 text-xs text-[#7D8590]">
                      {prompt.featureArea}
                      {prompt.featureRoute && (
                        <a href={`/admin-panel${prompt.featureRoute}`} className="text-[#0078D4] hover:text-[#006CBE] opacity-0 group-hover:opacity-100 transition-opacity" title="Go to feature">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden xl:table-cell">
                    {isModified(prompt) ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        Customised
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#484F58]">Default</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/prompt-center/${prompt.id}`}>
                      <span className="inline-flex items-center gap-1 text-xs text-[#0078D4] hover:text-[#006CBE] font-medium cursor-pointer">
                        Edit
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {prompts.length === 0 && !loading && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          No prompts found in the database. The API server seeds them automatically on startup — try restarting the API server workflow.
        </div>
      )}
    </div>
  );
}

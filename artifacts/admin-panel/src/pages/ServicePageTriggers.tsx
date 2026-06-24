import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Save, Loader2, X, Plus } from "lucide-react";

interface ServicePageMapping {
  id: number;
  pageSlug: string;
  triggerKeys: string[];
  updatedAt: string;
}

const PAGE_LABELS: Record<string, string> = {
  "microsoft-365": "Microsoft 365",
  "copilot-ai": "Copilot AI",
  "sharepoint": "SharePoint",
  "power-platform": "Power Platform",
  "governance": "Governance",
  "cloud-migration": "Cloud Migration",
};

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setDraft("");
  };

  const remove = (i: number) => onChange(tags.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2 min-h-[32px]">
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-[#0078D4]/10 text-[#E6EDF3] text-sm font-medium px-3 py-1 rounded-full border border-[#0078D4]/20"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-[#7D8590] hover:text-red-500 ml-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="text-sm text-[#7D8590] italic">No trigger keys — this page won't show any engagement projects</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
          placeholder="Add a trigger key…"
          className="flex-1 border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="flex items-center gap-1 px-3 py-2 bg-[#0078D4] text-white rounded-lg text-sm font-medium hover:bg-[#0069BD] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}

export default function ServicePageTriggersPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [mappings, setMappings] = useState<ServicePageMapping[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/service-page-triggers");
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as ServicePageMapping[];
      setMappings(data);
      const initial: Record<string, string[]> = {};
      for (const m of data) {
        initial[m.pageSlug] = [...m.triggerKeys];
      }
      setDrafts(initial);
    } catch {
      toast({ title: "Failed to load trigger key mappings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async (pageSlug: string) => {
    setSaving((s) => ({ ...s, [pageSlug]: true }));
    try {
      const res = await fetchWithAuth(`/api/admin/service-page-triggers/${pageSlug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerKeys: drafts[pageSlug] ?? [] }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = (await res.json()) as ServicePageMapping;
      setMappings((prev) =>
        prev.map((m) => (m.pageSlug === pageSlug ? updated : m))
      );
      toast({ title: `Saved trigger keys for ${PAGE_LABELS[pageSlug] ?? pageSlug}` });
    } catch {
      toast({ title: "Failed to save trigger keys", variant: "destructive" });
    } finally {
      setSaving((s) => ({ ...s, [pageSlug]: false }));
    }
  };

  const isDirty = (pageSlug: string) => {
    const original = mappings.find((m) => m.pageSlug === pageSlug)?.triggerKeys ?? [];
    const draft = drafts[pageSlug] ?? [];
    return JSON.stringify(original) !== JSON.stringify(draft);
  };

  const slugOrder = ["microsoft-365", "copilot-ai", "sharepoint", "power-platform", "governance", "cloud-migration"];
  const orderedMappings = slugOrder.map((slug) => mappings.find((m) => m.pageSlug === slug)).filter(Boolean) as ServicePageMapping[];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#E6EDF3] mb-2">Service Triggers</h1>
        <p className="text-[#7D8590] text-sm leading-relaxed">
          Control which engagement projects appear in the "Common Project Engagements" section on each service page.
          Trigger keys are matched against the <strong>Triggered By</strong> field on each engagement project — any project
          whose trigger keys overlap with this list will be shown on that service page.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[#0078D4]" />
        </div>
      ) : (
        <div className="space-y-4">
          {orderedMappings.length === 0 ? (
            <p className="text-[#7D8590] text-sm text-center py-10">
              No mappings found. They will appear here after the server seeds the defaults on next restart.
            </p>
          ) : (
            orderedMappings.map((mapping) => (
              <div
                key={mapping.pageSlug}
                className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h2 className="font-semibold text-[#E6EDF3] text-base">
                      {PAGE_LABELS[mapping.pageSlug] ?? mapping.pageSlug}
                    </h2>
                    <p className="text-xs text-[#7D8590] font-mono mt-0.5">/services/{mapping.pageSlug}</p>
                  </div>
                  <button
                    onClick={() => handleSave(mapping.pageSlug)}
                    disabled={!isDirty(mapping.pageSlug) || saving[mapping.pageSlug]}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#0078D4] text-white rounded-lg text-sm font-medium hover:bg-[#0069BD] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {saving[mapping.pageSlug] ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save
                  </button>
                </div>
                <TagEditor
                  tags={drafts[mapping.pageSlug] ?? mapping.triggerKeys}
                  onChange={(tags) =>
                    setDrafts((d) => ({ ...d, [mapping.pageSlug]: tags }))
                  }
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

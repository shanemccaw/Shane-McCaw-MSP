import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { SIGNAL_CATEGORY_PREFIXES } from "@workspace/db/schema";

// Drop-in replacement for the raw JSON CodeMirror textboxes previously used
// for `includedProfileKeyPatterns` / `includedSignalCategories` (Phase 2 of
// #70). `sections` is NOT covered here — that stays the existing structured
// editor at every call site. Props in, array out, same controlled shape the
// CodeMirror editors already used, so this can swap in directly.
//
// AI Suggest (Phase 5) calls the Phase 4 constrained-suggestion endpoint and
// merges the returned profileKeyPatterns/signalCategories on top of whatever
// is already checked — it never wipes existing selections. `sections` from
// the same response is ignored here; each call site wires its own separate
// AI Suggest trigger for that field, since this component doesn't own it.

interface ProfileKeyDomain {
  domain: string;
  keys: string[];
}

interface DocumentScopingEditorProps {
  profileKeyPatterns: string[];
  onProfileKeyPatternsChange: (v: string[]) => void;
  signalCategories: string[];
  onSignalCategoriesChange: (v: string[]) => void;
  /** Existing saved document type's key — omit for the pre-save (New Document Type) case. */
  docTypeKey?: string;
  label: string;
  category: "report" | "consulting";
  serviceId?: number | null;
}

interface SuggestScopingResponse {
  profileKeyPatterns: string[];
  signalCategories: string[];
}

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md pl-7 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";

export default function DocumentScopingEditor({
  profileKeyPatterns,
  onProfileKeyPatternsChange,
  signalCategories,
  onSignalCategoriesChange,
  docTypeKey,
  label,
  category,
  serviceId,
}: DocumentScopingEditorProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [domains, setDomains] = useState<ProfileKeyDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchWithAuth("/api/admin/document-generator/profile-keys")
      .then(async res => {
        if (!res.ok) throw new Error("Failed to load profile key registry");
        const data = (await res.json()) as ProfileKeyDomain[];
        if (!cancelled) setDomains(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load profile key registry");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  // All real keys across every domain, for splitting incoming patterns into
  // checkbox-driven values vs. custom/wildcard chips.
  const allRealKeys = useMemo(() => {
    const s = new Set<string>();
    for (const d of domains) for (const k of d.keys) s.add(k);
    return s;
  }, [domains]);

  // Wildcard/custom patterns don't have checkbox state to derive from, so once
  // the registry has loaded, anything in profileKeyPatterns that isn't a real
  // key is preserved as a read-only chip rather than silently dropped.
  const customPatterns = useMemo(() => {
    if (loading) return [];
    return profileKeyPatterns.filter(p => !allRealKeys.has(p));
  }, [profileKeyPatterns, allRealKeys, loading]);

  const checkedKeys = useMemo(() => new Set(profileKeyPatterns.filter(p => allRealKeys.has(p))), [profileKeyPatterns, allRealKeys]);

  const toggleKey = (key: string, checked: boolean) => {
    if (checked) {
      if (!profileKeyPatterns.includes(key)) onProfileKeyPatternsChange([...profileKeyPatterns, key]);
    } else {
      onProfileKeyPatternsChange(profileKeyPatterns.filter(p => p !== key));
    }
  };

  const removeCustomPattern = (pattern: string) => {
    onProfileKeyPatternsChange(profileKeyPatterns.filter(p => p !== pattern));
  };

  const toggleDomain = useCallback((domain: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const searchTerm = search.trim().toLowerCase();
  const visibleDomains = useMemo(() => {
    if (!searchTerm) return domains;
    return domains
      .map(d => ({ domain: d.domain, keys: d.keys.filter(k => k.toLowerCase().includes(searchTerm)) }))
      .filter(d => d.keys.length > 0);
  }, [domains, searchTerm]);

  const isDomainExpanded = (domain: string) => (searchTerm ? true : expanded.has(domain));

  const toggleSignalCategory = (cat: string, checked: boolean) => {
    if (checked) {
      if (!signalCategories.includes(cat)) onSignalCategoriesChange([...signalCategories, cat]);
    } else {
      onSignalCategoriesChange(signalCategories.filter(c => c !== cat));
    }
  };

  const runAiSuggest = async () => {
    setSuggesting(true);
    try {
      const url = docTypeKey
        ? `/api/admin/document-generator/document-types/${encodeURIComponent(docTypeKey)}/suggest-scoping`
        : "/api/admin/document-generator/document-types/suggest-scoping";
      const res = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, category, ...(serviceId != null ? { serviceId } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? "Failed to generate scoping suggestion");
      }
      const suggestion = data as SuggestScopingResponse;
      const mergedKeys = [...profileKeyPatterns, ...suggestion.profileKeyPatterns.filter(k => !profileKeyPatterns.includes(k))];
      const mergedCategories = [...signalCategories, ...suggestion.signalCategories.filter(c => !signalCategories.includes(c))];
      onProfileKeyPatternsChange(mergedKeys);
      onSignalCategoriesChange(mergedCategories);
      toast({ title: "AI suggestions applied", description: "Review the pre-checked boxes before saving." });
    } catch (err) {
      toast({
        title: "AI Suggest failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void runAiSuggest()}
          disabled={suggesting || !label.trim()}
          title={!label.trim() ? "Enter a label first" : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
        >
          {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          AI Suggest
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">Profile Key Patterns</label>

        {customPatterns.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {customPatterns.map(pattern => (
              <span
                key={pattern}
                title="Custom pattern"
                className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-mono text-amber-400"
              >
                {pattern}
                <button
                  type="button"
                  onClick={() => removeCustomPattern(pattern)}
                  className="text-amber-400/70 hover:text-amber-400"
                  aria-label={`Remove custom pattern ${pattern}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading profile key registry…
          </div>
        ) : loadError ? (
          <p className="text-xs text-red-400 py-1">{loadError}</p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <input
                className={inputCls}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search profile keys…"
              />
            </div>

            <div className="border border-border rounded-md max-h-64 overflow-y-auto divide-y divide-border/60">
              {visibleDomains.length === 0 ? (
                <p className="text-xs italic text-muted-foreground/70 px-3 py-2">
                  {searchTerm ? "No matching keys." : "No profile keys available."}
                </p>
              ) : (
                visibleDomains.map(d => {
                  const domainExpanded = isDomainExpanded(d.domain);
                  return (
                    <div key={d.domain}>
                      <button
                        type="button"
                        onClick={() => toggleDomain(d.domain)}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-accent"
                      >
                        {domainExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-xs font-mono text-foreground/90">{d.domain}</span>
                        <span className="text-[10px] text-muted-foreground/60 ml-auto">{d.keys.length}</span>
                      </button>
                      {domainExpanded && (
                        <div className="px-2.5 pb-2 space-y-1">
                          {d.keys.map(key => (
                            <label key={key} className="flex items-center gap-2 text-[11px] font-mono text-foreground/80 pl-5 py-0.5 hover:text-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checkedKeys.has(key)}
                                onChange={e => toggleKey(key, e.target.checked)}
                              />
                              {key}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-muted-foreground">Signal Categories</label>
        <div className="border border-border rounded-md px-2.5 py-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {SIGNAL_CATEGORY_PREFIXES.map(category => (
            <label key={category} className="flex items-center gap-2 text-xs text-foreground/80 py-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={signalCategories.includes(category)}
                onChange={e => toggleSignalCategory(category, e.target.checked)}
              />
              {category}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

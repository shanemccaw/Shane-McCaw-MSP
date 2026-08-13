// EngageBay Tags page (#107) — list only.
//
// Deliberately its own simple view, not EngageBayEntityPage.tsx: tags have no
// create/edit/detail (per the #107 audit, no confirmed REST endpoint exists
// for creating, removing, or deleting a tag independently of tagging a
// contact — github.com/engagebay/restapi only confirms list + the existing
// add-tag-to-contact action). Adding tags to a contact already works from the
// Contacts page's detail view (#106); this page is read-only.
//
// The response shape for GET /engagebay/tags beyond "a list of tags" is
// unconfirmed, so each row renders whatever fields the record actually has
// rather than assuming an `id`/`count` field exists.

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface EngageBayTagRecord {
  [key: string]: unknown;
}

/** Best-effort tag name — EngageBay's other tag endpoints use `tag`, some list APIs use `name`. */
function tagName(record: EngageBayTagRecord): string {
  if (typeof record.tag === "string" && record.tag) return record.tag;
  if (typeof record.name === "string" && record.name) return record.name;
  return "(unnamed tag)";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: string; code?: string };
    if (body.code === "engagebay_not_connected") {
      return "EngageBay is not connected. Connect it from Settings before using this page.";
    }
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export default function EngageBayTagsPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [tags, setTags] = useState<EngageBayTagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithAuth("/api/engagebay/tags");
        if (!res.ok) {
          if (!cancelled) setError(await readError(res, "Failed to load tags from EngageBay"));
          return;
        }
        const data = await res.json() as { tags: EngageBayTagRecord[] };
        if (!cancelled) setTags(data.tags ?? []);
      } catch {
        if (!cancelled) setError("Failed to load tags from EngageBay");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchWithAuth]);

  // Extra fields beyond the tag name itself, gathered per-row rather than
  // from a fixed schema — the real response shape hasn't been observed yet.
  const extraKeys = (record: EngageBayTagRecord): string[] =>
    Object.keys(record).filter((k) => k !== "tag" && k !== "name");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">EngageBay Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tags read live from EngageBay. Creating, removing, or deleting a tag isn't supported here — EngageBay's
          REST API has no confirmed endpoint for any of those. To tag a contact, use the "Add a tag" action on the
          Contacts page.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Tag</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Details</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Search contacts</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Loading from EngageBay…</td></tr>
              )}
              {!loading && tags.length === 0 && !error && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No tags found in EngageBay.</td></tr>
              )}
              {!loading && tags.map((record, i) => {
                const name = tagName(record);
                const extras = extraKeys(record);
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-3 text-foreground font-medium">{name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {extras.length === 0 ? "—" : extras.map((k) => `${k}: ${displayValue(record[k])}`).join(", ")}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/pipeline/engagebay-contacts?search=${encodeURIComponent(name)}`)}
                        disabled={name === "(unnamed tag)"}
                        title="Convenience shortcut — EngageBay's search endpoint isn't confirmed to filter by tag name, so this isn't guaranteed to return only tagged contacts."
                        className="px-3 py-1.5 rounded-lg border border-border text-xs text-foreground disabled:opacity-40"
                      >
                        Search contacts
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

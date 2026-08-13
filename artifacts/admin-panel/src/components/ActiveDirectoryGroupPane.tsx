// artifacts/admin-panel/src/components/ActiveDirectoryGroupPane.tsx
//
// Phase 4 of the Active Directory admin surface: the RBAC/Group Object detail
// pane, wired into ActiveDirectoryCenterCanvas.tsx's dispatch-by-selected-type
// mechanism for type "group". Renders every real account holding the
// selected role, with a live member count and a search-within-members box —
// from the single GET /admin/active-directory/group/:role?q= payload.
// Clicking a member dispatches ad-select-object to open their User Object
// pane (Phase 6); if that phase hasn't shipped yet, ActiveDirectoryCenterCanvas
// still shows the Phase-1 stub, which is fine — this pane never blocks on it.
// Read-only: no role reassignment here (Issue #64; that's Phase 7).

import { useEffect, useState } from "react";
import { Search, Users, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AD_SELECT_EVENT, type AdSelectedObject } from "./ActiveDirectoryTree";

interface GroupMember {
  id: number;
  email: string;
  name: string | null;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface GroupDetail {
  role: string;
  members: GroupMember[];
  memberCount: number;
}

function dispatchSelect(detail: AdSelectedObject) {
  window.dispatchEvent(new CustomEvent<AdSelectedObject>(AD_SELECT_EVENT, { detail }));
}

export function ActiveDirectoryGroupPane({ role }: { role: string }) {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery("");
  }, [role]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await fetchWithAuth(
            `/api/admin/active-directory/group/${encodeURIComponent(role)}?q=${encodeURIComponent(query)}`,
          );
          if (cancelled) return;
          if (!res.ok) {
            setError("Failed to load group members.");
            return;
          }
          setDetail((await res.json()) as GroupDetail);
        } catch {
          if (!cancelled) setError("Failed to load group members.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [role, query, fetchWithAuth]);

  return (
    <div className="h-full overflow-y-auto p-4 text-sm">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Users className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-foreground">{role}</h2>
          <p className="text-xs text-muted-foreground">RBAC Group</p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded border border-border bg-card/50 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members by name or email…"
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <p>{error}</p>
        </div>
      ) : loading && !detail ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading members…</div>
      ) : (
        <>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
            Members ({detail?.memberCount ?? 0})
          </div>
          <div className="rounded border border-border bg-card/50 px-3 py-2">
            {(detail?.members.length ?? 0) === 0 ? (
              <p className="italic text-muted-foreground">
                {query.trim() ? "No members match this search." : `0 accounts hold the ${role} role.`}
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {detail!.members.map((m) => (
                  <li
                    key={m.id}
                    onClick={() => dispatchSelect({ type: "user", id: m.id, label: m.name || m.email })}
                    className="flex cursor-pointer items-center justify-between gap-2 py-1.5 hover:text-primary"
                    title="View this account's User Object detail"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{m.name || m.email}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {m.email}
                        {m.mspName ? ` · ${m.mspName}` : ""}
                        {m.customerName ? ` · ${m.customerName}` : ""}
                      </div>
                    </div>
                    {!m.isActive && <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">inactive</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

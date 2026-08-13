/**
 * RBAC/Group Object canvas — every real account holding one role, a live
 * member count, and a search-within-members box. Read-only (Phase 4); role
 * reassignment lives on the User Object canvas, not here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../../shell/ContextMenu";
import { fetchAdGroup } from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import type { AdGroupDetail, DirectoryGroupRole } from "../adTypes";
import { AdCanvasBody, AdCanvasColumn, AdCanvasHeader, AdChip, AdEmptyRow, AdListRow, AdListRowGroup, AdLoadError, AdLoading, AdSection, AdTile, AdTileGrid } from "../adKit";

function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AdGroupCanvas({ role }: { role: DirectoryGroupRole }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<AdGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const debounceRef = useRef<number | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAdGroup(fetchWithAuth, role, query);
        setDetail(data);
        setAdCachedRecord("group", role, { title: role, sub: `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}` });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load this group.");
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, role],
  );

  useEffect(() => {
    setQ("");
    void load("");
  }, [load]);

  function onQueryChange(next: string) {
    setQ(next);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void load(next), 250);
  }

  if (loading && !detail) return (
    <AdCanvasColumn>
      <AdLoading />
    </AdCanvasColumn>
  );
  if (error && !detail) return (
    <AdCanvasColumn>
      <AdLoadError message={error} />
    </AdCanvasColumn>
  );
  if (!detail) return null;

  return (
    <AdCanvasColumn>
      <AdCanvasHeader icon={ShieldCheck} name={role} kindLabel="RBAC group" chips={<AdChip label={`${detail.memberCount} member${detail.memberCount === 1 ? "" : "s"}`} />} />

      <AdCanvasBody>
        <AdSection title="Role">
          <AdTileGrid>
            <AdTile label="Role key" value={role} />
            <AdTile label="Live member count" value={String(detail.memberCount)} accent={ACCENT_TEXT.green} />
          </AdTileGrid>
        </AdSection>

        <AdSection title="Members">
          <input
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search members by name or email"
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 5,
              border: `1px solid ${LINE.control}`,
              background: SURFACE.well,
              color: TEXT.primary,
              fontSize: 12,
              maxWidth: 320,
            }}
          />
          <AdListRowGroup>
            {detail.members.length === 0 ? (
              <AdEmptyRow label={q ? "No members match this search." : "No accounts hold this role."} />
            ) : (
              detail.members.map((m) => (
                <AdListRow
                  key={m.id}
                  label={m.name || m.email}
                  detail={`${m.email}${m.mspName ? ` · ${m.mspName}` : m.customerName ? ` · ${m.customerName}` : ""}`}
                  meta={m.isActive ? fmtDateTime(m.lastLoginAt) : "disabled"}
                  metaAccent={m.isActive ? undefined : ACCENT_TEXT.danger}
                  dot={m.isActive ? "#6ccb96" : "#e57a7a"}
                  onClick={() => shell.openDoc({ kind: "user", id: String(m.id), screenId: "ad", label: m.name || m.email })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "user", id: String(m.id), screenId: "ad", label: m.name || m.email }) },
                        { label: "Copy email", onSelect: () => void navigator.clipboard.writeText(m.email).catch(() => {}) },
                      ],
                      `Actions for ${m.name || m.email}`,
                    )
                  }
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>
      </AdCanvasBody>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </AdCanvasColumn>
  );
}

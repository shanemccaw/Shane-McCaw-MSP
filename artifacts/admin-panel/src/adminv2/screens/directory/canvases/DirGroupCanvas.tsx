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
import { fetchDirGroup } from "../dirApi";
import { setDirCachedRecord } from "../dirNameCache";
import type { DirGroupDetail, DirectoryGroupRole } from "../dirTypes";
import { DirCanvasBody, DirCanvasColumn, DirCanvasHeader, DirChip, DirEmptyRow, DirListRow, DirListRowGroup, DirLoadError, DirLoading, DirSection, DirTile, DirTileGrid } from "../dirKit";

function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function DirGroupCanvas({ role }: { role: DirectoryGroupRole }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<DirGroupDetail | null>(null);
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
        const data = await fetchDirGroup(fetchWithAuth, role, query);
        setDetail(data);
        setDirCachedRecord("group", role, { title: role, sub: `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}` });
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
    <DirCanvasColumn>
      <DirLoading />
    </DirCanvasColumn>
  );
  if (error && !detail) return (
    <DirCanvasColumn>
      <DirLoadError message={error} />
    </DirCanvasColumn>
  );
  if (!detail) return null;

  return (
    <DirCanvasColumn>
      <DirCanvasHeader icon={ShieldCheck} name={role} kindLabel="RBAC group" chips={<DirChip label={`${detail.memberCount} member${detail.memberCount === 1 ? "" : "s"}`} />} />

      <DirCanvasBody>
        <DirSection title="Role">
          <DirTileGrid>
            <DirTile label="Role key" value={role} />
            <DirTile label="Live member count" value={String(detail.memberCount)} accent={ACCENT_TEXT.green} />
          </DirTileGrid>
        </DirSection>

        <DirSection title="Members">
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
          <DirListRowGroup>
            {detail.members.length === 0 ? (
              <DirEmptyRow label={q ? "No members match this search." : "No accounts hold this role."} />
            ) : (
              detail.members.map((m) => (
                <DirListRow
                  key={m.id}
                  label={m.name || m.email}
                  detail={`${m.email}${m.mspName ? ` · ${m.mspName}` : m.customerName ? ` · ${m.customerName}` : ""}`}
                  meta={m.isActive ? fmtDateTime(m.lastLoginAt) : "disabled"}
                  metaAccent={m.isActive ? undefined : ACCENT_TEXT.danger}
                  dot={m.isActive ? "#6ccb96" : "#e57a7a"}
                  onClick={() => shell.openDoc({ kind: "user", id: String(m.id), screenId: "msp-directory", label: m.name || m.email })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "user", id: String(m.id), screenId: "msp-directory", label: m.name || m.email }) },
                        { label: "Copy email", onSelect: () => void navigator.clipboard.writeText(m.email).catch(() => {}) },
                      ],
                      `Actions for ${m.name || m.email}`,
                    )
                  }
                />
              ))
            )}
          </DirListRowGroup>
        </DirSection>
      </DirCanvasBody>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </DirCanvasColumn>
  );
}

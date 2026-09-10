/**
 * RBAC management panels (#2461, part of #1696) — the front end for the
 * roles/user_roles/feature_role_mapping tables #2455 landed.
 *
 * Two panels, both additive alongside the existing DirectoryGroupRole ladder
 * UI (AdUserCanvas's "Role" section, AdGroupCanvas):
 *
 * - `AdRbacUserRolesSection` — embedded in AdUserCanvas. Shows/manages the
 *   roles ONE user holds in one system (msp or customer), scoped to their own
 *   org (or the platform scope for an org-less PlatformAdmin).
 * - `AdRbacOrgRolesPanel` — embedded in AdMspCanvas / AdCustomerCanvas. Manages
 *   the org's own named roles (create/rename/delete) and each catalogued
 *   capability's allow/deny mapping for that org.
 *
 * Neither panel changes what the route gates actually enforce today
 * — that cutover is #2457/#2458, still pending. This is the management surface
 * for the new model, built ahead of that cutover per #2461's own contract.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../theme";
import {
  createAdRbacRole,
  deleteAdRbacRole,
  fetchAdRbacCapabilities,
  fetchAdRbacMappings,
  fetchAdRbacRoles,
  fetchAdUserRbacRoles,
  grantAdUserRbacRole,
  renameAdRbacRole,
  revokeAdUserRbacRole,
  setAdRbacMapping,
} from "./adApi";
import type { RbacMappingRow, RbacRoleSummary, RbacSystem } from "./adTypes";
import { AdArmedButton, AdButton, AdEmptyRow, AdListRow, AdListRowGroup, AdOutcome, AdSection } from "./adKit";

const inputStyle = {
  height: 26,
  padding: "0 9px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.card,
  color: TEXT.primary,
  fontSize: 11.5,
};

function roleLabel(role: RbacRoleSummary): string {
  return role.orgId == null ? `${role.name} (platform)` : role.name;
}

// ── User's own role memberships ───────────────────────────────────────────

export function AdRbacUserRolesSection({
  userId,
  system,
}: {
  userId: number;
  /** Which system this user's roles live in — msp for staff, customer for tenant users. */
  system: RbacSystem;
}) {
  const { fetchWithAuth } = useAuth();
  const [held, setHeld] = useState<RbacRoleSummary[] | null>(null);
  const [orgId, setOrgId] = useState<number | null>(null);
  const [available, setAvailable] = useState<RbacRoleSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [heldRes, allRoles] = await Promise.all([
        fetchAdUserRbacRoles(fetchWithAuth, userId, system),
        fetchAdRbacRoles(fetchWithAuth, system, null),
      ]);
      setHeld(heldRes.roles);
      setOrgId(heldRes.orgId);
      const orgRoles = heldRes.orgId == null ? allRoles : await fetchAdRbacRoles(fetchWithAuth, system, heldRes.orgId);
      setAvailable(orgRoles);
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to load RBAC roles." });
    }
  }, [fetchWithAuth, userId, system]);

  useEffect(() => {
    void load();
  }, [load]);

  const heldIds = useMemo(() => new Set((held ?? []).map((r) => r.id)), [held]);
  const grantable = available.filter((r) => !heldIds.has(r.id));

  const grant = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await grantAdUserRbacRole(fetchWithAuth, userId, system, selected);
      setHeld(res.roles);
      setSelected("");
      setOutcome({ tone: "ok", message: "Role granted." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to grant this role." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, userId, system, selected]);

  const revoke = useCallback(
    async (roleId: string) => {
      setBusy(true);
      setOutcome(null);
      try {
        const res = await revokeAdUserRbacRole(fetchWithAuth, userId, system, roleId);
        setHeld(res.roles);
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to revoke this role." });
      } finally {
        setBusy(false);
      }
    },
    [fetchWithAuth, userId, system],
  );

  return (
    <AdSection
      title={`RBAC roles (${system})`}
      note="New roles/user_roles model (#2455/#2461) — additive alongside the Role section above. Not yet what enforces access; see #2458."
    >
      {held == null ? (
        <span style={{ fontSize: 11.5, color: TEXT.label }}>Loading…</span>
      ) : (
        <AdListRowGroup>
          {held.length === 0 ? (
            <AdEmptyRow label={`No ${system} roles held under the new model yet.`} />
          ) : (
            held.map((r) => (
              <AdListRow
                key={r.id}
                label={roleLabel(r)}
                detail={r.description || undefined}
                actions={<AdButton label="Revoke" tone="danger" disabled={busy} onClick={() => void revoke(r.id)} />}
              />
            ))
          )}
        </AdListRowGroup>
      )}
      {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}
      {grantable.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={inputStyle}>
            <option value="">Grant a role…</option>
            {grantable.map((r) => (
              <option key={r.id} value={r.id}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <AdButton label="Grant" disabled={!selected || busy} onClick={() => void grant()} />
        </div>
      )}
      {orgId == null && system === "msp" && (
        <span style={{ fontSize: 11, color: TEXT.label }}>
          This account has no MSP linkage — only platform-scoped roles can be granted.
        </span>
      )}
    </AdSection>
  );
}

// ── Org-level role + capability-mapping management ────────────────────────

export function AdRbacOrgRolesPanel({ system, orgId }: { system: RbacSystem; orgId: number }) {
  const { fetchWithAuth } = useAuth();
  const [roles, setRoles] = useState<RbacRoleSummary[] | null>(null);
  const [mappings, setMappings] = useState<RbacMappingRow[] | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingCapability, setEditingCapability] = useState<string | null>(null);
  const [editAllow, setEditAllow] = useState<Set<string>>(new Set());
  const [editDeny, setEditDeny] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [roleRows, mappingRows] = await Promise.all([
        fetchAdRbacRoles(fetchWithAuth, system, orgId),
        fetchAdRbacMappings(fetchWithAuth, system, orgId),
      ]);
      setRoles(roleRows);
      setMappings(mappingRows);
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to load RBAC data." });
    }
  }, [fetchWithAuth, system, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createRole = useCallback(async () => {
    if (!newKey.trim() || !newName.trim()) return;
    setBusy(true);
    setOutcome(null);
    try {
      await createAdRbacRole(fetchWithAuth, { system, orgId, key: newKey.trim(), name: newName.trim() });
      setNewKey("");
      setNewName("");
      await load();
      setOutcome({ tone: "ok", message: "Role created." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to create this role." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, system, orgId, newKey, newName, load]);

  const removeRole = useCallback(
    async (roleId: string) => {
      setBusy(true);
      setOutcome(null);
      try {
        await deleteAdRbacRole(fetchWithAuth, roleId, system);
        await load();
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to delete this role." });
      } finally {
        setBusy(false);
      }
    },
    [fetchWithAuth, system, load],
  );

  const rename = useCallback(
    async (roleId: string, name: string) => {
      setBusy(true);
      setOutcome(null);
      try {
        await renameAdRbacRole(fetchWithAuth, roleId, { system, name });
        await load();
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to rename this role." });
      } finally {
        setBusy(false);
      }
    },
    [fetchWithAuth, system, load],
  );

  const openMappingEditor = useCallback((row: RbacMappingRow) => {
    setEditingCapability(row.capability.key);
    setEditAllow(new Set(row.org?.allow ?? []));
    setEditDeny(new Set(row.org?.deny ?? []));
  }, []);

  const saveMapping = useCallback(async () => {
    if (!editingCapability) return;
    setBusy(true);
    setOutcome(null);
    try {
      await setAdRbacMapping(fetchWithAuth, {
        system,
        orgId,
        capabilityKey: editingCapability,
        allow: [...editAllow],
        deny: [...editDeny],
      });
      setEditingCapability(null);
      await load();
      setOutcome({ tone: "ok", message: "Mapping saved." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to save this mapping." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, system, orgId, editingCapability, editAllow, editDeny, load]);

  const roleNameById = useMemo(() => new Map((roles ?? []).map((r) => [r.id, roleLabel(r)])), [roles]);

  return (
    <>
      <AdSection
        title={`RBAC roles (${system})`}
        note="New roles/user_roles model (#2455/#2461). Platform-scoped roles are read-only here — only this org's own roles can be renamed or deleted."
      >
        {roles == null ? (
          <span style={{ fontSize: 11.5, color: TEXT.label }}>Loading…</span>
        ) : (
          <AdListRowGroup>
            {roles.length === 0 ? (
              <AdEmptyRow label="No roles defined yet." />
            ) : (
              roles.map((r) => (
                <AdListRow
                  key={r.id}
                  label={roleLabel(r)}
                  detail={`${r.description || "no description"} · ${r.memberCount} member${r.memberCount === 1 ? "" : "s"}`}
                  actions={
                    r.orgId == null ? undefined : (
                      <>
                        <AdButton
                          label="Rename"
                          disabled={busy}
                          onClick={() => {
                            const next = window.prompt("New name", r.name);
                            if (next && next.trim()) void rename(r.id, next.trim());
                          }}
                        />
                        <AdArmedButton label="Delete" tone="danger" onConfirm={() => void removeRole(r.id)} />
                      </>
                    )
                  }
                />
              ))
            )}
          </AdListRowGroup>
        )}
        {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="role key (e.g. engineer)" style={{ ...inputStyle, fontFamily: "monospace", minWidth: 160 }} />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="display name" style={{ ...inputStyle, minWidth: 140 }} />
          <AdButton label="Create role" disabled={!newKey.trim() || !newName.trim() || busy} onClick={() => void createRole()} />
        </div>
      </AdSection>

      <AdSection title="Capability mapping" note="Allow/deny per capability. Deny wins across every role a user holds (#1696).">
        {mappings == null ? (
          <span style={{ fontSize: 11.5, color: TEXT.label }}>Loading…</span>
        ) : (
          <AdListRowGroup>
            {mappings.map((row) => {
              const allowNames = row.org?.allow.map((id) => roleNameById.get(id) ?? id) ?? [];
              const denyNames = row.org?.deny.map((id) => roleNameById.get(id) ?? id) ?? [];
              return (
                <AdListRow
                  key={row.capability.key}
                  label={row.capability.label}
                  detail={`${row.capability.key} · allow: ${allowNames.join(", ") || "none"} · deny: ${denyNames.join(", ") || "none"}`}
                  actions={<AdButton label="Edit" disabled={!roles?.length} onClick={() => openMappingEditor(row)} />}
                />
              );
            })}
          </AdListRowGroup>
        )}

        {editingCapability && roles && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, border: `1px solid ${LINE.control}`, borderRadius: 6 }}>
            <span style={{ fontSize: 11.5, color: TEXT.strong, fontFamily: "monospace" }}>{editingCapability}</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: ACCENT_TEXT.green, marginBottom: 4 }}>Allow</div>
                {roles.map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: TEXT.body }}>
                    <input
                      type="checkbox"
                      checked={editAllow.has(r.id)}
                      onChange={(e) =>
                        setEditAllow((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                    {roleLabel(r)}
                  </label>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: ACCENT_TEXT.danger, marginBottom: 4 }}>Deny</div>
                {roles.map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: TEXT.body }}>
                    <input
                      type="checkbox"
                      checked={editDeny.has(r.id)}
                      onChange={(e) =>
                        setEditDeny((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                    {roleLabel(r)}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <AdButton label="Save mapping" tone="primary" disabled={busy} onClick={() => void saveMapping()} />
              <AdButton label="Cancel" onClick={() => setEditingCapability(null)} disabled={busy} />
            </div>
          </div>
        )}
      </AdSection>
    </>
  );
}

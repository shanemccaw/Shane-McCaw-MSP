/**
 * User Object canvas — full profile, RBAC role + MSP/tenant linkage,
 * inherited entitlements + per-user overrides, session summary, MFA status,
 * and every real Phase 7/8/9 write action: role change, MSP/tenant
 * reassignment, entitlement grant/revoke, forced password reset, admin MFA
 * reset, impersonation launch into /portal/, and the dev-only cascading
 * hard delete. Every action posts straight to the same
 * `/admin/active-directory/user/:id/*` routes `ActiveDirectoryUserPane.tsx`
 * already uses — same endpoints, same request shapes, new shell chrome.
 */

import { useCallback, useEffect, useState } from "react";
import { UserCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT_TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import {
  fetchAdUser,
  fetchAdUserEntitlements,
  forceAdPasswordReset,
  hardDeleteAdUser,
  impersonateAdUser,
  resetAdUserMfa,
  setAdUserAssignment,
  setAdUserEntitlement,
  setAdUserRole,
} from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import { onAdRecordAction, requestAdTreeRefresh } from "../adEvents";
import { DIRECTORY_GROUP_ROLES, type AdEntitlementsView, type AdUserDetail, type DirectoryGroupRole } from "../adTypes";
import {
  AdArmedButton,
  AdButton,
  AdCanvasBody,
  AdCanvasColumn,
  AdCanvasHeader,
  AdChip,
  AdEmptyRow,
  AdListRow,
  AdListRowGroup,
  AdLoadError,
  AdLoading,
  AdOutcome,
  AdSection,
  AdTile,
  AdTileGrid,
} from "../adKit";

function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function roleLinkageRequirement(role: DirectoryGroupRole): "none" | "msp" | "customer" {
  if (role === "MSPAdmin" || role === "MSPOperator" || role === "ServiceAccount") return "msp";
  if (role === "CustomerUser" || role === "Free" || role === "Assessment") return "customer";
  return "none";
}

export function AdUserCanvas({ userId }: { userId: number }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<AdUserDetail | null>(null);
  const [entitlements, setEntitlements] = useState<AdEntitlementsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [newCapabilityKey, setNewCapabilityKey] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, ent] = await Promise.all([
        fetchAdUser(fetchWithAuth, userId),
        fetchAdUserEntitlements(fetchWithAuth, userId).catch(() => null),
      ]);
      setDetail(data);
      setEntitlements(ent);
      setAdCachedRecord("user", String(userId), {
        title: data.profile.name || data.profile.email,
        sub: data.linkage?.mspRole,
        tag: data.linkage?.isActive === false ? "disabled" : undefined,
        tagTone: "bad",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this user.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, userId]);

  useEffect(() => {
    setOutcome(null);
    setDeleteArmed(false);
    setDeleteConfirmText("");
    setDeleted(false);
    void load();
  }, [load]);

  const changeRole = useCallback(
    async (role: DirectoryGroupRole) => {
      setOutcome(null);
      try {
        await setAdUserRole(fetchWithAuth, userId, role);
        setOutcome({ tone: "ok", message: `Role changed to ${role}. Takes effect at their next page load.` });
        requestAdTreeRefresh();
        await load();
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to change the role." });
      }
    },
    [fetchWithAuth, userId, load],
  );

  const runForcePasswordReset = useCallback(async () => {
    setOutcome(null);
    try {
      const res = await forceAdPasswordReset(fetchWithAuth, userId);
      setOutcome({
        tone: "ok",
        message: `${res.flow === "account_setup" ? "Account-setup" : "Password reset"} link emailed to ${res.emailedTo}. ${res.revokedSessionCount} session${res.revokedSessionCount === 1 ? "" : "s"} invalidated.`,
      });
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to force a password reset." });
    }
  }, [fetchWithAuth, userId, load]);

  const runMfaReset = useCallback(async () => {
    setOutcome(null);
    try {
      const res = await resetAdUserMfa(fetchWithAuth, userId);
      setOutcome({
        tone: "ok",
        message: res.clearedMethods.length ? `MFA reset — un-enrolled: ${res.clearedMethods.join(", ")}.` : "This account had no enrolled MFA methods to clear.",
      });
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to reset MFA." });
    }
  }, [fetchWithAuth, userId, load]);

  const runImpersonate = useCallback(async () => {
    setOutcome(null);
    try {
      const res = await impersonateAdUser(fetchWithAuth, userId);
      const params = new URLSearchParams({ impersonation_token: res.token });
      if (res.targetSlug) params.set("target_slug", res.targetSlug);
      window.open(`${window.location.origin}/portal/?${params.toString()}`, "_blank", "noopener");
      setOutcome({
        tone: "ok",
        message: res.targetSlug
          ? `Impersonation session opened in a new tab as ${res.user.email} (expires in 30 minutes).`
          : "Impersonation session opened, but this account has no owning MSP — the new tab cannot auto-navigate to a tenant.",
      });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to start impersonation." });
    }
  }, [fetchWithAuth, userId]);

  const toggleEntitlement = useCallback(
    async (capabilityKey: string, enabled: boolean | null) => {
      setOutcome(null);
      try {
        const view = await setAdUserEntitlement(fetchWithAuth, userId, capabilityKey, enabled);
        setEntitlements(view);
        setOutcome({ tone: "ok", message: "Entitlement override saved." });
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to change the entitlement." });
      }
    },
    [fetchWithAuth, userId],
  );

  const runHardDelete = useCallback(async () => {
    setOutcome(null);
    try {
      await hardDeleteAdUser(fetchWithAuth, userId);
      setDeleted(true);
      requestAdTreeRefresh();
      setOutcome({ tone: "ok", message: "Account and every related row removed. There is no undo." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to delete the account." });
    }
  }, [fetchWithAuth, userId]);

  useEffect(
    () =>
      onAdRecordAction("user", String(userId), (action) => {
        if (action === "impersonate") void runImpersonate();
        if (action === "force-password-reset") void runForcePasswordReset();
        if (action === "reset-mfa") void runMfaReset();
      }),
    [userId, runImpersonate, runForcePasswordReset, runMfaReset],
  );

  if (loading) return (
    <AdCanvasColumn>
      <AdLoading />
    </AdCanvasColumn>
  );
  if (error || !detail) return (
    <AdCanvasColumn>
      <AdLoadError message={error ?? "This user could not be loaded."} />
    </AdCanvasColumn>
  );

  if (deleted) {
    return (
      <AdCanvasColumn>
        <div style={{ padding: 24, fontSize: 12.5, color: ACCENT_TEXT.green }}>
          This account was permanently deleted. Close this tab — it no longer exists.
        </div>
      </AdCanvasColumn>
    );
  }

  const { profile, linkage, sessions, mfa } = detail;
  const linkageRequirement = linkage ? roleLinkageRequirement(linkage.mspRole) : "none";

  return (
    <AdCanvasColumn>
      <AdCanvasHeader
        icon={UserCircle}
        name={profile.name || profile.email}
        kindLabel="User"
        chips={
          <>
            {linkage && <AdChip label={linkage.isActive ? "enabled" : "disabled"} tone={linkage.isActive ? "good" : "bad"} />}
            {linkage && <AdChip label={linkage.mspRole} />}
            <AdChip label={mfa.enrolled ? `${mfa.methods.length} MFA method${mfa.methods.length === 1 ? "" : "s"}` : "no MFA"} tone={mfa.enrolled ? "good" : "warn"} />
          </>
        }
        actions={
          <>
            <AdButton label="Impersonate" tone="primary" onClick={() => void runImpersonate()} />
            <AdButton label="Force password reset" onClick={() => void runForcePasswordReset()} />
          </>
        }
      />

      {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}

      <AdCanvasBody>
        <AdSection title="Identity">
          <AdTileGrid>
            <AdTile label="Email" value={profile.email} />
            <AdTile label="Belongs to" value={(linkage?.mspName ?? linkage?.customerName) ?? "—"} />
            <AdTile label="Last sign-in" value={fmtDateTime(linkage?.lastLoginAt ?? null)} />
            <AdTile label="Created" value={fmtDateTime(profile.createdAt)} />
          </AdTileGrid>
          {(linkage?.mspId != null || linkage?.customerId != null) && (
            <div>
              <AdButton
                label={`Open ${linkage.mspName ?? linkage.customerName}`}
                onClick={() =>
                  linkage.mspId != null
                    ? shell.openDoc({ kind: "msp", id: String(linkage.mspId), screenId: "ad", label: linkage.mspName ?? "" })
                    : shell.openDoc({ kind: "customer", id: String(linkage.customerId), screenId: "ad", label: linkage.customerName ?? "" })
                }
              />
            </div>
          )}
        </AdSection>

        <AdSection title="Role" note="Reassigning role/linkage takes effect at the account's next JWT refresh.">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DIRECTORY_GROUP_ROLES.map((role) => (
              <AdButton
                key={role}
                label={role}
                tone={linkage?.mspRole === role ? "primary" : "default"}
                onClick={() => void changeRole(role)}
                disabled={linkage?.mspRole === role}
              />
            ))}
          </div>
          {linkageRequirement !== "none" && (
            <span style={{ fontSize: 11, color: ACCENT_TEXT.neutral }}>
              {linkageRequirement === "msp" ? "This role requires an MSP linkage." : "This role requires a tenant linkage."} Reassign via the MSP/Tenant tree to move it.
            </span>
          )}
        </AdSection>

        <AdSection title="Credential ops" note="Every action here is written to the audit log with your name against it.">
          <AdListRowGroup>
            {(mfa.methods.length ? mfa.methods : [{ method: "No methods enrolled", createdAt: "" }]).map((m) => (
              <AdListRow key={m.method} label={m.method} detail={mfa.methods.length ? undefined : "This account can sign in with a password alone."} dot={mfa.methods.length ? "#6ccb96" : "#e9b949"} />
            ))}
          </AdListRowGroup>
          <div style={{ display: "flex", gap: 8 }}>
            <AdArmedButton label="Reset all MFA" tone="danger" onConfirm={() => void runMfaReset()} />
          </div>
        </AdSection>

        <AdSection title="Access overrides" note="Overrides sit on top of whatever the plan grants — they follow the user, not the tenant.">
          <AdListRowGroup>
            {!entitlements || entitlements.overrides.length === 0 ? (
              <AdEmptyRow label="No overrides — this account gets exactly what its plan grants." />
            ) : (
              entitlements.overrides.map((o) => (
                <AdListRow
                  key={o.capabilityKey}
                  label={o.capabilityKey}
                  detail={o.enabled ? "granted by override" : "withheld by override"}
                  dot={o.enabled ? "#6ccb96" : "#e57a7a"}
                  actions={
                    <>
                      <AdButton label={o.enabled ? "Withhold" : "Grant"} onClick={() => void toggleEntitlement(o.capabilityKey, !o.enabled)} />
                      <AdButton label="Clear" onClick={() => void toggleEntitlement(o.capabilityKey, null)} />
                    </>
                  }
                />
              ))
            )}
          </AdListRowGroup>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={newCapabilityKey}
              onChange={(e) => setNewCapabilityKey(e.target.value)}
              placeholder="capability key"
              style={{
                height: 26,
                padding: "0 9px",
                borderRadius: 5,
                border: "1px solid #3b3b3b",
                background: "#1b1b1b",
                color: "#e6e4e2",
                fontFamily: "monospace",
                fontSize: 11.5,
                minWidth: 180,
              }}
            />
            <AdButton
              label="Grant override"
              disabled={!newCapabilityKey.trim()}
              onClick={() => {
                void toggleEntitlement(newCapabilityKey.trim(), true);
                setNewCapabilityKey("");
              }}
            />
          </div>
        </AdSection>

        <AdSection title="Session">
          <AdTileGrid>
            <AdTile label="Active sessions" value={String(sessions.activeSessionCount)} />
            <AdTile label="Total sessions" value={String(sessions.totalSessionCount)} />
            <AdTile label="Last activity" value={fmtDateTime(sessions.mostRecentSession?.lastActiveAt ?? null)} />
          </AdTileGrid>
        </AdSection>

        <AdSection title="Delete" note="Removes the account and every row tied to it. There is no undo — the server refuses this outside a non-production environment.">
          {!deleteArmed ? (
            <div>
              <AdButton label="Permanently delete" tone="danger" onClick={() => setDeleteArmed(true)} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
              <span style={{ fontSize: 11.5, color: ACCENT_TEXT.danger }}>Type &ldquo;{profile.email}&rdquo; to confirm.</span>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={profile.email}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  border: "1px solid #5a3232",
                  background: "#1b1b1b",
                  color: "#eda3a3",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <AdButton label="Delete permanently" tone="danger" disabled={deleteConfirmText !== profile.email} onClick={() => void runHardDelete()} />
                <AdButton label="Cancel" onClick={() => { setDeleteArmed(false); setDeleteConfirmText(""); }} />
              </div>
            </div>
          )}
        </AdSection>
      </AdCanvasBody>
    </AdCanvasColumn>
  );
}

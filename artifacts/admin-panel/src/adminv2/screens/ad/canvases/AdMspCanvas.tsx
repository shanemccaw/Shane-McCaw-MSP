/**
 * MSP Object canvas — profile, subscription/plan + dunning state, derived
 * entitlements, linked customers, linked staff, and platform agreement
 * acceptance. Phase 2 (docs/build-plans/active-directory.md) shipped this
 * read-only plus suspend/reactivate; Git #1672 (rehoming the archived
 * msp-portal msps.tsx / msp-detail.tsx admin pages before deletion) added
 * profile edit, MSP-level impersonation, and the primary-contact/notes
 * fields those pages edited — all against the same real msp-admin-settings.ts
 * endpoints.
 */

import { useCallback, useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../../shell/ContextMenu";
import { fetchAdMsp, impersonateAdMsp, reactivateAdMsp, suspendAdMsp, updateAdMspProfile } from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import { onAdRecordAction, requestAdTreeRefresh } from "../adEvents";
import type { AdMspDetail } from "../adTypes";
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

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function usd(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const fieldStyle = {
  padding: "6px 10px",
  borderRadius: 6,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.card,
  color: TEXT.primary,
  fontSize: 12.5,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box" as const,
};

function AdEditField({
  label,
  value,
  onChange,
  area,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
  type?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: TEXT.label }}>
      {label}
      {area ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />
      ) : (
        <input type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />
      )}
    </label>
  );
}

export function AdMspCanvas({ mspId }: { mspId: number }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<AdMspDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  // Profile edit — Git #1672, rehomed from the archived msp-portal msps.tsx /
  // msp-detail.tsx edit dialogs. `status` is intentionally not part of this
  // form; Suspend/Reactivate above are the only sanctioned way to change it.
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    domain: "",
    isTestbed: false,
    primaryContactName: "",
    primaryContactEmail: "",
    primaryContactPhone: "",
    address: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdMsp(fetchWithAuth, mspId);
      setDetail(data);
      setAdCachedRecord("msp", String(mspId), {
        title: data.msp.name,
        sub: data.msp.domain ?? data.msp.slug,
        tag: data.msp.status,
        tagTone: data.msp.status === "active" ? "good" : data.msp.status === "suspended" ? "bad" : "warn",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this MSP.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, mspId]);

  useEffect(() => {
    setOutcome(null);
    void load();
  }, [load]);

  const runSuspend = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      await suspendAdMsp(fetchWithAuth, mspId);
      setOutcome({ tone: "ok", message: "MSP suspended. Every user under it loses portal access immediately." });
      requestAdTreeRefresh();
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to suspend the MSP." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, mspId, load]);

  const runReactivate = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      await reactivateAdMsp(fetchWithAuth, mspId);
      setOutcome({ tone: "ok", message: "MSP reactivated." });
      requestAdTreeRefresh();
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to reactivate the MSP." });
    } finally {
      setBusy(false);
    }
  }, [fetchWithAuth, mspId, load]);

  const openEdit = useCallback(() => {
    if (!detail) return;
    const { msp } = detail;
    setEditForm({
      name: msp.name,
      domain: msp.domain ?? "",
      isTestbed: msp.isTestbed,
      primaryContactName: msp.primaryContactName ?? "",
      primaryContactEmail: msp.primaryContactEmail ?? "",
      primaryContactPhone: msp.primaryContactPhone ?? "",
      address: msp.address ?? "",
      notes: msp.notes ?? "",
    });
    setSaveError(null);
    setEditing(true);
  }, [detail]);

  const saveEdit = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateAdMspProfile(fetchWithAuth, mspId, {
        name: editForm.name.trim(),
        domain: editForm.domain.trim() || null,
        isTestbed: editForm.isTestbed,
        primaryContactName: editForm.primaryContactName.trim() || null,
        primaryContactEmail: editForm.primaryContactEmail.trim() || null,
        primaryContactPhone: editForm.primaryContactPhone.trim() || null,
        address: editForm.address.trim() || null,
        notes: editForm.notes.trim() || null,
      });
      requestAdTreeRefresh();
      setEditing(false);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save these changes.");
    } finally {
      setSaving(false);
    }
  }, [fetchWithAuth, mspId, editForm, load]);

  const runImpersonate = useCallback(async () => {
    setOutcome(null);
    try {
      const res = await impersonateAdMsp(fetchWithAuth, mspId);
      const params = new URLSearchParams({ impersonation_token: res.token, target_slug: res.targetSlug });
      window.open(`${window.location.origin}/portal/?${params.toString()}`, "_blank", "noopener");
      setOutcome({ tone: "ok", message: `Impersonation session opened in a new tab as ${res.msp.name}'s MSPAdmin (expires in 30 minutes).` });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to impersonate this MSP." });
    }
  }, [fetchWithAuth, mspId]);

  useEffect(
    () =>
      onAdRecordAction("msp", String(mspId), (action) => {
        if (action === "suspend-msp") void runSuspend();
        if (action === "reactivate-msp") void runReactivate();
        if (action === "impersonate") void runImpersonate();
      }),
    [mspId, runSuspend, runReactivate, runImpersonate],
  );

  if (loading) return (
    <AdCanvasColumn>
      <AdLoading />
    </AdCanvasColumn>
  );
  if (error || !detail) return (
    <AdCanvasColumn>
      <AdLoadError message={error ?? "This MSP could not be loaded."} />
    </AdCanvasColumn>
  );

  const { msp, subscription, entitlements, customers, users, agreementAcceptances, hasAcceptedCurrentAgreement } = detail;
  const pastDue = subscription?.dunningState != null && subscription.dunningState !== "current";

  return (
    <AdCanvasColumn>
      <AdCanvasHeader
        icon={Briefcase}
        name={msp.name}
        kindLabel="MSP"
        chips={
          <>
            <AdChip label={msp.status} tone={msp.status === "active" ? "good" : msp.status === "suspended" ? "bad" : "warn"} />
            {msp.isDirectBusiness && <AdChip label="direct business" />}
            {pastDue && <AdChip label="past due" tone="warn" />}
          </>
        }
        actions={
          <>
            <AdButton label="Edit profile" onClick={openEdit} disabled={editing} />
            <AdButton label="Impersonate" onClick={() => void runImpersonate()} title="Opens a new tab signed in as this MSP's MSPAdmin (expires in 30 minutes)." />
            {msp.status === "active" ? (
              <AdArmedButton
                label="Suspend"
                tone="danger"
                onConfirm={() => void runSuspend()}
                title="Every user under this MSP loses portal access immediately. Billing continues."
              />
            ) : msp.status === "suspended" ? (
              <AdButton label="Reactivate" tone="primary" onClick={() => void runReactivate()} disabled={busy} />
            ) : undefined}
          </>
        }
      />

      {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}

      <AdCanvasBody>
        {editing ? (
          <AdSection title="Edit profile">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              <AdEditField label="Name" value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
              <AdEditField label="Domain" value={editForm.domain} onChange={(v) => setEditForm((f) => ({ ...f, domain: v }))} />
              <AdEditField
                label="Primary contact name"
                value={editForm.primaryContactName}
                onChange={(v) => setEditForm((f) => ({ ...f, primaryContactName: v }))}
              />
              <AdEditField
                label="Primary contact email"
                type="email"
                value={editForm.primaryContactEmail}
                onChange={(v) => setEditForm((f) => ({ ...f, primaryContactEmail: v }))}
              />
              <AdEditField
                label="Primary contact phone"
                value={editForm.primaryContactPhone}
                onChange={(v) => setEditForm((f) => ({ ...f, primaryContactPhone: v }))}
              />
              <AdEditField label="Address" value={editForm.address} onChange={(v) => setEditForm((f) => ({ ...f, address: v }))} />
            </div>
            <AdEditField label="Internal notes" area value={editForm.notes} onChange={(v) => setEditForm((f) => ({ ...f, notes: v }))} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: TEXT.body }}>
              <input
                type="checkbox"
                checked={editForm.isTestbed}
                onChange={(e) => setEditForm((f) => ({ ...f, isTestbed: e.target.checked }))}
              />
              Testbed partner environment (is_testbed)
            </label>
            {saveError && <span style={{ fontSize: 11.5, color: ACCENT_TEXT.danger }}>{saveError}</span>}
            <div style={{ display: "flex", gap: 8 }}>
              <AdButton label={saving ? "Saving…" : "Save changes"} tone="primary" onClick={() => void saveEdit()} disabled={saving} />
              <AdButton label="Cancel" onClick={() => setEditing(false)} disabled={saving} />
            </div>
          </AdSection>
        ) : (
          <AdSection title="Profile">
            <AdTileGrid>
              <AdTile label="Slug" value={msp.slug} />
              <AdTile label="Domain" value={msp.domain ?? "none"} />
              <AdTile label="Customer since" value={fmtDate(msp.createdAt)} />
              <AdTile label="Testbed" value={msp.isTestbed ? "yes" : "no"} />
            </AdTileGrid>
          </AdSection>
        )}

        {!editing && (msp.primaryContactName || msp.primaryContactEmail || msp.primaryContactPhone || msp.address || msp.notes) && (
          <AdSection title="Contact">
            <AdTileGrid>
              <AdTile label="Contact name" value={msp.primaryContactName ?? "none"} />
              <AdTile label="Contact email" value={msp.primaryContactEmail ?? "none"} />
              <AdTile label="Contact phone" value={msp.primaryContactPhone ?? "none"} />
              <AdTile label="Address" value={msp.address ?? "none"} />
            </AdTileGrid>
            {msp.notes && (
              <div style={{ fontSize: 12, color: TEXT.body, whiteSpace: "pre-wrap" }}>{msp.notes}</div>
            )}
          </AdSection>
        )}

        {subscription && (
          <AdSection title="Subscription" note={pastDue ? "Payment failed — access is unaffected until suspended." : undefined}>
            <AdTileGrid>
              <AdTile label="Plan" value={subscription.tierName} />
              <AdTile label="Status" value={subscription.status} accent={subscription.status === "active" ? ACCENT_TEXT.green : undefined} />
              <AdTile label="Billing" value={subscription.billingInterval} />
              <AdTile label="Dunning" value={subscription.dunningState ?? "current"} accent={pastDue ? ACCENT_TEXT.danger : undefined} />
              <AdTile label="Tenant count" value={String(subscription.tenantCountSnapshot)} />
              <AdTile label="Contact" value={subscription.contactEmail ?? "none"} />
            </AdTileGrid>
          </AdSection>
        )}

        {entitlements && (
          <AdSection title="Entitlements" note="Derived from the subscription tier — not editable here.">
            <AdTileGrid>
              <AdTile label="Tenant allowance" value={entitlements.tenantAllowance != null ? String(entitlements.tenantAllowance) : "unlimited"} />
              <AdTile label="AI credit allowance" value={entitlements.aiCreditAllowance != null ? String(entitlements.aiCreditAllowance) : "unlimited"} />
              <AdTile label="Overage rate" value={usd(entitlements.overageRateCents)} />
            </AdTileGrid>
          </AdSection>
        )}

        <AdSection title="Customers" note={`${detail.customerCount} tenant${detail.customerCount === 1 ? "" : "s"}`}>
          <AdListRowGroup>
            {customers.length === 0 ? (
              <AdEmptyRow label="No customers yet." />
            ) : (
              customers.map((c) => (
                <AdListRow
                  key={c.id}
                  label={c.name}
                  detail={c.domain ?? undefined}
                  meta={c.status}
                  onClick={() => shell.openDoc({ kind: "customer", id: String(c.id), screenId: "ad", label: c.name })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "customer", id: String(c.id), screenId: "ad", label: c.name }) },
                        { label: "Copy name", onSelect: () => void navigator.clipboard.writeText(c.name).catch(() => {}) },
                      ],
                      `Actions for ${c.name}`,
                    )
                  }
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>

        <AdSection title="Staff" note={`${detail.userCount} account${detail.userCount === 1 ? "" : "s"}`}>
          <AdListRowGroup>
            {users.length === 0 ? (
              <AdEmptyRow label="No staff accounts yet." />
            ) : (
              users.map((u) => (
                <AdListRow
                  key={u.id}
                  label={u.name || u.email}
                  detail={`${u.email} · ${u.mspRole}`}
                  meta={u.isActive ? "active" : "disabled"}
                  metaAccent={u.isActive ? undefined : ACCENT_TEXT.danger}
                  dot={u.isActive ? "#6ccb96" : "#e57a7a"}
                  onClick={() => shell.openDoc({ kind: "user", id: String(u.id), screenId: "ad", label: u.name || u.email })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "user", id: String(u.id), screenId: "ad", label: u.name || u.email }) },
                        { label: "Copy email", onSelect: () => void navigator.clipboard.writeText(u.email).catch(() => {}) },
                      ],
                      `Actions for ${u.name || u.email}`,
                    )
                  }
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>

        <AdSection title="Platform agreement" note={hasAcceptedCurrentAgreement ? undefined : "The current agreement version has not been accepted."}>
          <AdListRowGroup>
            {agreementAcceptances.length === 0 ? (
              <AdEmptyRow label="No agreement acceptances on file." />
            ) : (
              agreementAcceptances.map((a) => (
                <AdListRow key={a.agreementVersion} label={`v${a.agreementVersion}`} detail={a.checkboxConfirmed ? "checkbox confirmed" : "not confirmed"} meta={fmtDate(a.acceptedAt)} />
              ))
            )}
          </AdListRowGroup>
        </AdSection>
      </AdCanvasBody>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </AdCanvasColumn>
  );
}

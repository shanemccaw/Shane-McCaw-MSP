/**
 * Customer (Tenant) Object canvas — profile, owning MSP, linked users,
 * Graph/SharePoint/write consent status with real revoke actions, purchased
 * services, and recent diagnostic runs with a real "run a scan now" action.
 * Phase 3 was read-only; Phase 10 (Issue #91) added the three real actions
 * this canvas exposes — consent revoke reuses the platform's one unified
 * `PATCH /admin/consent/:tenantId/revoke` (key-selected), scanning reuses
 * `POST /msp/customers/:id/diagnostics/run` (msp-diagnostics.ts), unchanged
 * from what customer-facing "run a scan" already calls.
 */

import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../../shell/ContextMenu";
import {
  createAdConsentInviteLink,
  fetchAdCustomer,
  fetchAdCustomerWriteConsent,
  hardDeleteAdCustomer,
  revokeAdTenantConsent,
  runAdCustomerDiagnostics,
  startAdCustomerWriteConsent,
  updateAdCustomerBusinessUnit,
  type ConsentKey,
} from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import { onAdRecordAction, requestAdTreeRefresh } from "../adEvents";
import type { AdConsentStatus, AdCustomerDetail, AdWriteConsentStatus } from "../adTypes";
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
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const CONSENT_ROWS: Array<{ key: ConsentKey; label: string; get: (d: AdCustomerDetail) => AdConsentStatus | null }> = [
  { key: "graph", label: "Microsoft Graph", get: (d) => d.graphConsent },
  { key: "sharepoint", label: "SharePoint sites", get: (d) => d.sharePointConsent },
  { key: "writeBack", label: "Write-back", get: (d) => d.writeConsent },
];

export function AdCustomerCanvas({ customerId }: { customerId: number }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<AdCustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  // Write-back consent (admin) — Git #1672, rehomed from the archived
  // msp-portal customer-detail.tsx's WriteBackConsentCard.
  const [writeConsentStatus, setWriteConsentStatus] = useState<AdWriteConsentStatus | null>(null);
  const [writeConsentLoading, setWriteConsentLoading] = useState(true);
  const [writeConsentGenerating, setWriteConsentGenerating] = useState(false);

  // ── Hard delete — self-contained state, same convention as the User
  // canvas's own delete flow: an explicit "arm" click is confirmation #1,
  // typing the tenant's own name exactly is confirmation #2. Neither request
  // is sent until both are complete.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  // Business Unit (#2085) — the one editable field on this pane. Backs the Security
  // Plan assembly's `businessUnit` scope dimension the same way pillar/framework do.
  const [businessUnitDraft, setBusinessUnitDraft] = useState("");
  const [businessUnitSaving, setBusinessUnitSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdCustomer(fetchWithAuth, customerId);
      setDetail(data);
      setBusinessUnitDraft(data.customer.businessUnit ?? "");
      setAdCachedRecord("customer", String(customerId), {
        title: data.customer.name,
        sub: data.customer.domain ?? data.owningMsp?.name,
        tag: data.customer.status,
        tagTone: data.customer.status === "active" ? "good" : "warn",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this tenant.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, customerId]);

  useEffect(() => {
    setOutcome(null);
    setDeleteArmed(false);
    setDeleteConfirmText("");
    setDeleted(false);
    void load();
  }, [load]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setOutcome(null);
    try {
      await runAdCustomerDiagnostics(fetchWithAuth, customerId);
      setOutcome({ tone: "ok", message: "Scan started. It runs in the background — reopen this tenant in a minute to see results." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to start the scan." });
    } finally {
      setScanning(false);
    }
  }, [fetchWithAuth, customerId]);

  const saveBusinessUnit = useCallback(async () => {
    setBusinessUnitSaving(true);
    setOutcome(null);
    try {
      const res = await updateAdCustomerBusinessUnit(fetchWithAuth, customerId, businessUnitDraft.trim() || null);
      setBusinessUnitDraft(res.businessUnit ?? "");
      setDetail((prev) => (prev ? { ...prev, customer: { ...prev.customer, businessUnit: res.businessUnit } } : prev));
      setOutcome({ tone: "ok", message: "Business unit saved." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to save the business unit." });
    } finally {
      setBusinessUnitSaving(false);
    }
  }, [fetchWithAuth, customerId, businessUnitDraft]);

  const loadWriteConsent = useCallback(async () => {
    setWriteConsentLoading(true);
    try {
      const data = await fetchAdCustomerWriteConsent(fetchWithAuth, customerId);
      setWriteConsentStatus(data);
    } catch {
      setWriteConsentStatus(null);
    } finally {
      setWriteConsentLoading(false);
    }
  }, [fetchWithAuth, customerId]);

  useEffect(() => {
    void loadWriteConsent();
  }, [loadWriteConsent]);

  const startWriteConsent = useCallback(async () => {
    setWriteConsentGenerating(true);
    setOutcome(null);
    try {
      const { consentUrl } = await startAdCustomerWriteConsent(fetchWithAuth, customerId);
      window.open(consentUrl, "_blank", "noopener,noreferrer");
      setOutcome({ tone: "ok", message: "Write-back consent link opened in a new tab." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to generate the write-consent link." });
    } finally {
      setWriteConsentGenerating(false);
    }
  }, [fetchWithAuth, customerId]);

  const revoke = useCallback(
    async (key: ConsentKey, label: string) => {
      if (!detail?.customer.tenantId) return;
      setOutcome(null);
      try {
        await revokeAdTenantConsent(fetchWithAuth, detail.customer.tenantId, key);
        setOutcome({ tone: "ok", message: `${label} consent revoked. Checks that depend on it stop until the tenant re-consents.` });
        await load();
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : `Failed to revoke ${label} consent.` });
      }
    },
    [fetchWithAuth, detail, load],
  );

  const copyReconsentLink = useCallback(async () => {
    setOutcome(null);
    try {
      const link = await createAdConsentInviteLink(fetchWithAuth, {
        customerId,
        tenantId: detail?.customer.tenantId ?? undefined,
      });
      await navigator.clipboard.writeText(link.consentUrl);
      setOutcome({ tone: "ok", message: `Re-consent link copied. It expires ${fmtDate(link.expiresAt)}.` });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to create a re-consent link." });
    }
  }, [fetchWithAuth, customerId, detail]);

  const runHardDelete = useCallback(async () => {
    setDeleteBusy(true);
    setOutcome(null);
    try {
      const res = await hardDeleteAdCustomer(fetchWithAuth, customerId);
      setDeleted(true);
      requestAdTreeRefresh();
      setOutcome({
        tone: "ok",
        message: `${res.deletedCustomerName} and ${res.usersDeleted} user${res.usersDeleted === 1 ? "" : "s"} permanently removed. There is no undo.`,
      });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to delete the tenant." });
    } finally {
      setDeleteBusy(false);
    }
  }, [fetchWithAuth, customerId]);

  useEffect(
    () =>
      onAdRecordAction("customer", String(customerId), (action) => {
        if (action === "run-scan") void runScan();
        if (action === "revoke-graph-consent") void revoke("graph", "Microsoft Graph");
        if (action === "copy-reconsent-link") void copyReconsentLink();
      }),
    [customerId, runScan, revoke, copyReconsentLink],
  );

  if (loading) return (
    <AdCanvasColumn>
      <AdLoading />
    </AdCanvasColumn>
  );
  if (error || !detail) return (
    <AdCanvasColumn>
      <AdLoadError message={error ?? "This tenant could not be loaded."} />
    </AdCanvasColumn>
  );

  if (deleted) {
    return (
      <AdCanvasColumn>
        <div style={{ padding: 24, fontSize: 12.5, color: ACCENT_TEXT.green }}>
          This tenant and everything tied to it was permanently deleted. Close this tab — it no longer exists.
        </div>
      </AdCanvasColumn>
    );
  }

  const { customer, owningMsp, users, purchasedServices, recentDiagnosticRuns } = detail;
  const connected = !!customer.tenantId;

  return (
    <AdCanvasColumn>
      <AdCanvasHeader
        icon={Users}
        name={customer.name}
        kindLabel="Tenant"
        chips={
          <>
            <AdChip label={connected ? "connected" : "not connected"} tone={connected ? "good" : "warn"} />
            {customer.domain && <AdChip label={customer.domain} />}
          </>
        }
        actions={<AdButton label={scanning ? "Scanning…" : "Run scan"} tone="primary" onClick={() => void runScan()} disabled={scanning || !connected} title={connected ? undefined : "Tenant is not connected — nothing to scan."} />}
      />

      {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}

      <AdCanvasBody>
        <AdSection title="Profile">
          <AdTileGrid>
            <AdTile label="Tenant GUID" value={customer.tenantId ? `${customer.tenantId.slice(0, 8)}…` : "none"} accent={customer.tenantId ? undefined : ACCENT_TEXT.danger} hint={customer.tenantUrl ?? undefined} copyValue={customer.tenantId ?? undefined} />
            <AdTile label="Industry" value={customer.industry ?? "—"} />
            <AdTile label="Status" value={customer.status} />
            <div
              style={{
                minWidth: 0,
                padding: "10px 12px",
                borderRadius: 7,
                border: `1px solid ${LINE.base}`,
                background: SURFACE.card,
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  letterSpacing: ".05em",
                  textTransform: "uppercase",
                  color: TEXT.label,
                }}
              >
                Business Unit
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={businessUnitDraft}
                  onChange={(e) => setBusinessUnitDraft(e.target.value)}
                  placeholder="—"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-.01em",
                    color: TEXT.primary,
                  }}
                />
                {businessUnitDraft.trim() !== (customer.businessUnit ?? "").trim() && (
                  <AdButton label={businessUnitSaving ? "Saving…" : "Save"} tone="primary" onClick={() => void saveBusinessUnit()} disabled={businessUnitSaving} />
                )}
              </div>
            </div>
            <AdTile
              label="Owning MSP"
              value={owningMsp?.name ?? "—"}
            />
          </AdTileGrid>
          {owningMsp && (
            <div>
              <AdButton
                label={`Open ${owningMsp.name}`}
                onClick={() => shell.openDoc({ kind: "msp", id: String(owningMsp.id), screenId: "ad", label: owningMsp.name })}
              />
            </div>
          )}
        </AdSection>

        <AdSection title="Consent" note={connected ? undefined : "This tenant has never completed Graph consent — scanning is unavailable."}>
          <AdListRowGroup>
            {CONSENT_ROWS.map(({ key, label, get }) => {
              const status = get(detail);
              const granted = status?.consentStatus === "granted";
              return (
                <AdListRow
                  key={key}
                  label={label}
                  detail={status ? `${status.consentStatus}${status.adminEmail ? ` · ${status.adminEmail}` : ""}` : "never asked"}
                  meta={status?.consentedAt ? fmtDate(status.consentedAt) : undefined}
                  dot={granted ? "#6ccb96" : status ? "#e9b949" : "#6d6b69"}
                  actions={
                    granted ? (
                      <AdArmedButton label="Revoke" tone="danger" onConfirm={() => void revoke(key, label)} title={`Every check depending on ${label} stops for ${customer.name}.`} />
                    ) : undefined
                  }
                />
              );
            })}
          </AdListRowGroup>
          <div style={{ display: "flex", gap: 8 }}>
            <AdButton label="Copy re-consent link" onClick={() => void copyReconsentLink()} />
          </div>
        </AdSection>

        <AdSection
          title="Write-back consent (admin)"
          note="Admin consent for the dedicated write app — separate from the read-only tenant consent above."
        >
          <AdListRowGroup>
            {writeConsentLoading ? (
              <AdEmptyRow label="Loading…" />
            ) : (
              (() => {
                const wcStatus = writeConsentStatus?.writeConsent?.consentStatus ?? null;
                const granted = wcStatus === "granted";
                return (
                  <AdListRow
                    label="Write app"
                    detail={
                      writeConsentStatus?.tenantId == null
                        ? "No tenant linked"
                        : wcStatus
                          ? wcStatus
                          : "never asked"
                    }
                    meta={writeConsentStatus?.writeConsent?.consentedAt ? fmtDate(writeConsentStatus.writeConsent.consentedAt) : undefined}
                    dot={granted ? "#6ccb96" : wcStatus ? "#e9b949" : "#6d6b69"}
                  />
                );
              })()
            )}
          </AdListRowGroup>
          <div style={{ display: "flex", gap: 8 }}>
            <AdButton
              label={
                writeConsentGenerating
                  ? "Generating…"
                  : writeConsentStatus?.writeConsent?.consentStatus === "granted"
                    ? "Re-run write consent"
                    : "Start write consent"
              }
              onClick={() => void startWriteConsent()}
              disabled={writeConsentGenerating || writeConsentLoading || writeConsentStatus?.tenantId == null}
            />
          </div>
        </AdSection>

        <AdSection title="Recent scans">
          <AdListRowGroup>
            {recentDiagnosticRuns.length === 0 ? (
              <AdEmptyRow label={connected ? "No scans have run yet." : "No scan has ever run against this tenant."} />
            ) : (
              recentDiagnosticRuns.map((r) => (
                <AdListRow
                  key={r.runId}
                  label={r.packageKey}
                  detail={r.status}
                  meta={r.completedAt ? fmtDate(r.completedAt) : r.startedAt ? `started ${fmtDate(r.startedAt)}` : undefined}
                  dot={r.status === "completed" ? "#6ccb96" : r.status === "failed" ? "#e57a7a" : "#e9b949"}
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>

        <AdSection title="Purchased services">
          <AdListRowGroup>
            {purchasedServices.length === 0 ? (
              <AdEmptyRow label="No services purchased." />
            ) : (
              purchasedServices.map((s) => (
                <AdListRow key={s.id} label={s.serviceName} detail={s.billingInterval} meta={s.status} dot={s.status === "active" ? "#6ccb96" : "#8a8886"} />
              ))
            )}
          </AdListRowGroup>
        </AdSection>

        <AdSection title="Users" note={`${detail.userCount} account${detail.userCount === 1 ? "" : "s"}`}>
          <AdListRowGroup>
            {users.length === 0 ? (
              <AdEmptyRow label="No users yet." />
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

        <AdSection
          title="Delete"
          note="Revokes all consent, then removes every user under this tenant and everything tied to it — there is no undo. The server refuses this outside a non-production environment."
        >
          {!deleteArmed ? (
            <div>
              <AdButton label="Permanently delete this tenant" tone="danger" onClick={() => setDeleteArmed(true)} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
              <span style={{ fontSize: 11.5, color: ACCENT_TEXT.danger }}>Type &ldquo;{customer.name}&rdquo; to confirm.</span>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={customer.name}
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
                <AdButton
                  label={deleteBusy ? "Deleting…" : "Delete permanently"}
                  tone="danger"
                  disabled={deleteBusy || deleteConfirmText !== customer.name}
                  onClick={() => void runHardDelete()}
                />
                <AdButton label="Cancel" onClick={() => { setDeleteArmed(false); setDeleteConfirmText(""); }} disabled={deleteBusy} />
              </div>
            </div>
          )}
        </AdSection>
      </AdCanvasBody>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </AdCanvasColumn>
  );
}

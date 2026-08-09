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
import { ACCENT_TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import {
  createAdConsentInviteLink,
  fetchAdCustomer,
  revokeAdTenantConsent,
  runAdCustomerDiagnostics,
  type ConsentKey,
} from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import { onAdRecordAction } from "../adEvents";
import type { AdConsentStatus, AdCustomerDetail } from "../adTypes";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdCustomer(fetchWithAuth, customerId);
      setDetail(data);
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
            <AdTile label="Tenant GUID" value={customer.tenantId ? `${customer.tenantId.slice(0, 8)}…` : "none"} accent={customer.tenantId ? undefined : ACCENT_TEXT.danger} hint={customer.tenantUrl ?? undefined} />
            <AdTile label="Industry" value={customer.industry ?? "—"} />
            <AdTile label="Status" value={customer.status} />
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
                />
              ))
            )}
          </AdListRowGroup>
        </AdSection>
      </AdCanvasBody>
    </AdCanvasColumn>
  );
}

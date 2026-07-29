// artifacts/admin-panel/src/components/ActiveDirectoryCustomerPane.tsx
//
// Phase 3 of the Active Directory admin surface: the Tenant Object detail
// pane (display label "Tenant" — the internal object type stays "customer",
// per the Phase 10 locked decision), wired into
// ActiveDirectoryCenterCanvas.tsx's dispatch-by-selected-type mechanism for
// type "customer". Renders everything the platform holds about one tenant —
// profile, owning MSP (link-out via the existing ad-select-object event, no
// duplicated MSP detail render), linked users with roles, Graph/SharePoint/
// write consent status, purchased services, and a summary of the most recent
// diagnostic runs — from the single GET /admin/active-directory/customer/:id
// payload. Read-only for the Phase 3 profile sections (Issue #63).
//
// Phase 10 (Issue #91) adds real tenant-admin actions on top, each a thin
// wrapper reusing an already-built platform mechanism — no new business
// logic: live pillar/health scores (admin-signal-rules.ts's existing
// customer-pillar-scores endpoint), a tenant telemetry summary
// (admin-monitor-checks.ts's existing tenant-profile-history endpoint, keyed
// by the tenant's AAD GUID), a unified Graph/SharePoint/write-back consent
// revoke (consent.ts's PATCH .../revoke route, extended with a `key`
// selector body param so one action covers all three — see that route's
// header comment), a manual scan trigger (msp-diagnostics.ts's existing
// POST .../diagnostics/run route, already PlatformAdmin-reachable —
// portal-assessment.ts's debug-trigger-scan was audited and rejected for
// this use: it's testbed-only, resolves its target from the CALLER's own
// JWT rather than a parameterized customerId, and requireRole("Assessment")
// would reject a PlatformAdmin caller outright), and a re-consent invite
// link generator (consent.ts's existing POST /consent/invite-link route,
// already requireAdmin-gated, used as-is).

import { useEffect, useState } from "react";
import {
  Building2,
  UserCircle,
  ShieldCheck,
  Package,
  ActivitySquare,
  AlertTriangle,
  Gauge,
  RadioTower,
  ScanLine,
  Link2,
  Copy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AD_SELECT_EVENT, type AdSelectedObject } from "./ActiveDirectoryTree";

interface CustomerDetailOwningMsp {
  id: number;
  name: string;
  slug: string;
}

interface CustomerDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface CustomerConsentStatus {
  tenantId: string;
  consentStatus: string;
  consentedAt: string | null;
  revokedAt: string | null;
  adminEmail: string | null;
}

interface CustomerPurchasedService {
  id: number;
  serviceName: string;
  status: string;
  billingInterval: string;
  purchasedAt: string;
}

interface CustomerDiagnosticRunSummary {
  runId: string;
  packageKey: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface CustomerDetail {
  customer: {
    id: number;
    mspId: number;
    name: string;
    domain: string | null;
    industry: string | null;
    tenantId: string | null;
    // Replaces the dropped `ownerType` — msp_customers carried an owner_type
    // enum, the tenants table that replaced it has no analogue (every tenants
    // row IS a customer), so the pane shows the tenant's URL in that slot.
    tenantUrl: string | null;
    status: string;
    isTestbed: boolean;
    createdAt: string;
  };
  owningMsp: CustomerDetailOwningMsp | null;
  users: CustomerDetailUser[];
  userCount: number;
  graphConsent: CustomerConsentStatus | null;
  sharePointConsent: CustomerConsentStatus | null;
  writeConsent: CustomerConsentStatus | null;
  purchasedServices: CustomerPurchasedService[];
  recentDiagnosticRuns: CustomerDiagnosticRunSummary[];
}

// Phase 10 (Issue #91) — the four new mechanisms this pane wraps.

type ConsentRevokeKey = "graph" | "writeBack" | "sharepoint";

const CONSENT_KEY_LABEL: Record<ConsentRevokeKey, string> = {
  graph: "Graph (read)",
  writeBack: "Write-back",
  sharepoint: "SharePoint",
};
const CONSENT_KEY_OPTIONS: ConsentRevokeKey[] = ["graph", "writeBack", "sharepoint"];

interface PillarScore {
  pillar: string;
  label: string;
  score: number | null;
}

interface PillarScoresResponse {
  customerId: number;
  pillars: PillarScore[];
}

interface TenantMonitorProfile {
  id: number;
  checkKey: string;
  status: string;
  severityMatched: string | null;
  errorMessage: string | null;
  collectedAt: string;
}

interface TenantMonitorProfilesResponse {
  profiles: TenantMonitorProfile[];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function dispatchSelect(detail: AdSelectedObject) {
  window.dispatchEvent(new CustomEvent<AdSelectedObject>(AD_SELECT_EVENT, { detail }));
}

function ConsentField({ label, consent }: { label: string; consent: CustomerConsentStatus | null }) {
  if (!consent) {
    return <Field label={label} value="Not granted" highlight />;
  }
  const granted = consent.consentStatus === "granted";
  return (
    <>
      <Field label={label} value={consent.consentStatus} highlight={!granted} />
      {granted && <Field label={`${label} — consented`} value={formatDate(consent.consentedAt)} />}
      {consent.consentStatus === "revoked" && <Field label={`${label} — revoked`} value={formatDate(consent.revokedAt)} />}
    </>
  );
}

export function ActiveDirectoryCustomerPane({ customerId }: { customerId: number }) {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Phase 10 (Issue #91) — pillar/health scores.
  const [pillars, setPillars] = useState<PillarScore[] | null>(null);
  const [pillarsError, setPillarsError] = useState<string | null>(null);

  // Phase 10 — tenant telemetry (tenant_monitor_profiles, keyed by the
  // tenant's AAD GUID — nothing to fetch when the tenant has none).
  const [telemetry, setTelemetry] = useState<TenantMonitorProfile[] | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  // Phase 10 — consent revoke action.
  const [revokeKey, setRevokeKey] = useState<ConsentRevokeKey>("graph");
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeSuccess, setRevokeSuccess] = useState<string | null>(null);

  // Phase 10 — manual scan trigger.
  const [triggeringScan, setTriggeringScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);

  // Phase 10 — re-consent invite link generator.
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setRevokeError(null);
    setRevokeSuccess(null);
    setScanError(null);
    setScanSuccess(null);
    setInviteError(null);
    setInviteUrl(null);

    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/active-directory/customer/${customerId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "This tenant no longer exists." : "Failed to load tenant detail.");
          return;
        }
        setDetail((await res.json()) as CustomerDetail);
      } catch {
        if (!cancelled) setError("Failed to load tenant detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, fetchWithAuth]);

  // Live pillar/health scores — reuses admin-signal-rules.ts's existing
  // customer-pillar-scores endpoint verbatim, no new scoring logic.
  useEffect(() => {
    let cancelled = false;
    setPillars(null);
    setPillarsError(null);

    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/signal-rules/customer-pillar-scores/${customerId}`);
        if (cancelled) return;
        if (!res.ok) {
          setPillarsError("Failed to load pillar scores.");
          return;
        }
        const data = (await res.json()) as PillarScoresResponse;
        setPillars(data.pillars);
      } catch {
        if (!cancelled) setPillarsError("Failed to load pillar scores.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, fetchWithAuth]);

  // Tenant telemetry — reuses admin-monitor-checks.ts's existing tenant
  // profile history endpoint, keyed by the tenant's AAD GUID. Waits for the
  // main detail fetch to resolve the GUID; a tenant with no GUID yet shows an
  // honest empty state instead of firing a request that can only 404/empty.
  const tenantGuid = detail?.customer.tenantId ?? null;
  useEffect(() => {
    if (!tenantGuid) {
      setTelemetry(null);
      setTelemetryError(null);
      return;
    }
    let cancelled = false;
    setTelemetry(null);
    setTelemetryError(null);

    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/monitor-checks/profiles/${encodeURIComponent(tenantGuid)}?limit=10`);
        if (cancelled) return;
        if (!res.ok) {
          setTelemetryError("Failed to load tenant telemetry.");
          return;
        }
        const data = (await res.json()) as TenantMonitorProfilesResponse;
        setTelemetry(data.profiles);
      } catch {
        if (!cancelled) setTelemetryError("Failed to load tenant telemetry.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantGuid, fetchWithAuth]);

  // Consent revoke — PATCH consent.ts's existing route, now carrying a `key`
  // selector so one action covers Graph/SharePoint/write-back (Phase 10,
  // Issue #91's amended scope). The route itself already audit-logs the
  // action; no second log call belongs here.
  const revokeConsent = async () => {
    if (!tenantGuid) return;
    setRevoking(true);
    setRevokeError(null);
    setRevokeSuccess(null);
    try {
      const res = await fetchWithAuth(`/api/admin/consent/${encodeURIComponent(tenantGuid)}/revoke`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: revokeKey }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRevokeError(body?.error ?? "Failed to revoke consent.");
        return;
      }
      setRevokeSuccess(`${CONSENT_KEY_LABEL[revokeKey]} consent revoked.`);
      const refreshed = await fetchWithAuth(`/api/admin/active-directory/customer/${customerId}`);
      if (refreshed.ok) setDetail((await refreshed.json()) as CustomerDetail);
    } catch {
      setRevokeError("Failed to revoke consent.");
    } finally {
      setRevoking(false);
    }
  };

  // Manual scan trigger — POST msp-diagnostics.ts's existing
  // /msp/customers/:customerId/diagnostics/run route directly; it is already
  // reachable by a PlatformAdmin (requireRole("MSPOperator") +
  // assertCustomerAccess both bypass for PlatformAdmin) and resolves its
  // target from the customerId path param rather than the caller's own JWT,
  // unlike portal-assessment.ts's testbed-only debug-trigger-scan. No wrapper
  // route needed — this pane calls straight through.
  const triggerScan = async () => {
    setTriggeringScan(true);
    setScanError(null);
    setScanSuccess(null);
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as { runId?: string; error?: string } | null;
      if (!res.ok) {
        setScanError(body?.error ?? "Failed to trigger a scan.");
        return;
      }
      setScanSuccess(`Scan started (run ${body?.runId ?? "?"}).`);
    } catch {
      setScanError("Failed to trigger a scan.");
    } finally {
      setTriggeringScan(false);
    }
  };

  // Re-consent invite link — POST consent.ts's existing, already
  // requireAdmin-gated /consent/invite-link route as-is.
  const generateInviteLink = async () => {
    setGeneratingInvite(true);
    setInviteError(null);
    setInviteUrl(null);
    try {
      const res = await fetchWithAuth(`/api/consent/invite-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenantGuid, customerId }),
      });
      const body = (await res.json().catch(() => null)) as { consentUrl?: string; error?: string } | null;
      if (!res.ok) {
        setInviteError(body?.error ?? "Failed to generate an invite link.");
        return;
      }
      if (!body?.consentUrl) {
        setInviteError("Invite link response did not include a URL.");
        return;
      }
      setInviteUrl(body.consentUrl);
    } catch {
      setInviteError("Failed to generate an invite link.");
    } finally {
      setGeneratingInvite(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading tenant…</div>;
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p>{error ?? "Failed to load tenant detail."}</p>
      </div>
    );
  }

  const { customer, owningMsp, users, userCount, graphConsent, sharePointConsent, writeConsent, purchasedServices, recentDiagnosticRuns } = detail;

  // A tenant that has never granted Graph consent, or whose Graph consent has
  // gone revoked/declined, is the honest trigger for offering a fresh invite
  // link — a "pending"/absent record is not itself revoked/declined, but it
  // equally has nothing to re-consent to grant, so the generator stays
  // available for any non-granted state.
  const canReConsent = tenantGuid != null && graphConsent?.consentStatus !== "granted";

  return (
    <div className="h-full overflow-y-auto p-4 text-sm">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Building2 className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-foreground">{customer.name}</h2>
          <p className="text-xs text-muted-foreground">{customer.domain ?? customer.tenantId ?? "—"}</p>
        </div>
      </div>

      {/* Profile */}
      <Section title="Profile" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
        <Field label="Status" value={customer.status} />
        <Field label="Domain" value={customer.domain ?? "—"} />
        <Field label="Industry" value={customer.industry ?? "—"} />
        <Field label="Tenant ID" value={customer.tenantId ?? "Not connected"} highlight={!customer.tenantId} />
        <Field label="Tenant URL" value={customer.tenantUrl ?? "—"} />
        <Field label="Testbed" value={customer.isTestbed ? "Yes" : "No"} />
        <Field label="Created" value={formatDate(customer.createdAt)} />
      </Section>

      {/* Pillar/health scores (Phase 10) */}
      <Section title="Pillar & Health Scores" icon={<Gauge className="h-4 w-4 text-muted-foreground" />}>
        {pillarsError ? (
          <p className="italic text-amber-600 dark:text-amber-400">{pillarsError}</p>
        ) : !pillars ? (
          <p className="italic text-muted-foreground">Loading scores…</p>
        ) : pillars.length === 0 ? (
          <p className="italic text-muted-foreground">No pillar scores available for this tenant.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {pillars.map((p) => (
              <li key={p.pillar} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0 flex-1 truncate">{p.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">
                  {p.score ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Tenant telemetry (Phase 10) */}
      <Section title="Tenant Telemetry" icon={<RadioTower className="h-4 w-4 text-muted-foreground" />}>
        {!tenantGuid ? (
          <p className="italic text-muted-foreground">Tenant is not connected to a Microsoft 365 tenant — no telemetry available.</p>
        ) : telemetryError ? (
          <p className="italic text-amber-600 dark:text-amber-400">{telemetryError}</p>
        ) : !telemetry ? (
          <p className="italic text-muted-foreground">Loading telemetry…</p>
        ) : telemetry.length === 0 ? (
          <p className="italic text-muted-foreground">No monitor check results recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {telemetry.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{t.checkKey}</span>
                <span
                  className={`shrink-0 text-[10px] ${
                    t.status === "ok"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : t.status === "error"
                        ? "text-red-600 dark:text-red-400"
                        : "text-amber-600 dark:text-amber-400"
                  }`}
                  title={t.errorMessage ?? undefined}
                >
                  {t.severityMatched ?? t.status}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateTime(t.collectedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Owning MSP */}
      <Section title="Owning MSP" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
        {!owningMsp ? (
          <p className="italic text-muted-foreground">No owning MSP record found.</p>
        ) : (
          <div
            onClick={() => dispatchSelect({ type: "msp", id: owningMsp.id, label: owningMsp.name })}
            className="flex cursor-pointer items-center justify-between gap-2 hover:text-primary"
            title="View this MSP"
          >
            <span>{owningMsp.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{owningMsp.slug}</span>
          </div>
        )}
      </Section>

      {/* Consent status */}
      <Section title="Tenant Consent" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
        <ConsentField label="Graph (read) consent" consent={graphConsent} />
        <ConsentField label="SharePoint consent" consent={sharePointConsent} />
        <ConsentField label="Write-back consent" consent={writeConsent} />
      </Section>

      {/* Consent + scan actions (Phase 10) */}
      <Section title="Actions" icon={<ScanLine className="h-4 w-4 text-muted-foreground" />}>
        {!tenantGuid ? (
          <p className="italic text-muted-foreground">
            Tenant is not connected to a Microsoft 365 tenant — consent and scan actions are unavailable.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Unified Graph/SharePoint/write-back revoke */}
            <div>
              <div className="flex items-center gap-2">
                <select
                  value={revokeKey}
                  onChange={(e) => setRevokeKey(e.target.value as ConsentRevokeKey)}
                  className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                  disabled={revoking}
                >
                  {CONSENT_KEY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {CONSENT_KEY_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void revokeConsent()}
                  disabled={revoking}
                  className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  {revoking ? "Revoking…" : "Revoke consent"}
                </button>
              </div>
              {revokeError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{revokeError}</p>}
              {revokeSuccess && <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">{revokeSuccess}</p>}
            </div>

            {/* Manual scan trigger */}
            <div>
              <button
                onClick={() => void triggerScan()}
                disabled={triggeringScan}
                className="rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {triggeringScan ? "Starting scan…" : "Trigger manual scan"}
              </button>
              {scanError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{scanError}</p>}
              {scanSuccess && <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">{scanSuccess}</p>}
            </div>

            {/* Re-consent invite link */}
            {canReConsent && (
              <div>
                <button
                  onClick={() => void generateInviteLink()}
                  disabled={generatingInvite}
                  className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <Link2 className="h-3 w-3" />
                  {generatingInvite ? "Generating…" : "Generate re-consent invite link"}
                </button>
                {inviteError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{inviteError}</p>}
                {inviteUrl && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      readOnly
                      value={inviteUrl}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                      className="shrink-0 rounded border border-border p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Copy link"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Linked users */}
      <Section title={`Linked Users (${userCount})`} icon={<UserCircle className="h-4 w-4 text-muted-foreground" />}>
        {userCount === 0 ? (
          <p className="italic text-muted-foreground">0 users linked to this tenant.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {users.map((u) => (
              <li
                key={u.id}
                onClick={() => dispatchSelect({ type: "user", id: u.id, label: u.name || u.email })}
                className="flex cursor-pointer items-center justify-between gap-2 py-1.5 hover:text-primary"
                title="View this user (Active Directory Phase 6)"
              >
                <span className="min-w-0 flex-1 truncate">{u.name || u.email}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{u.mspRole}</span>
                {!u.isActive && <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">inactive</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Purchased services */}
      <Section title={`Purchased Services (${purchasedServices.length})`} icon={<Package className="h-4 w-4 text-muted-foreground" />}>
        {purchasedServices.length === 0 ? (
          <p className="italic text-muted-foreground">No services purchased by this tenant.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {purchasedServices.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{s.serviceName}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {s.status} · {s.billingInterval}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(s.purchasedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Recent diagnostic runs */}
      <Section title="Recent Diagnostic Runs" icon={<ActivitySquare className="h-4 w-4 text-muted-foreground" />}>
        {recentDiagnosticRuns.length === 0 ? (
          <p className="italic text-muted-foreground">No scans yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {recentDiagnosticRuns.map((r) => (
              <li key={r.runId} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{r.packageKey}</span>
                <span
                  className={`shrink-0 text-[10px] ${
                    r.status === "completed"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : r.status === "failed"
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {r.status}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(r.completedAt ?? r.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
        {icon}
        {title}
      </div>
      <div className="rounded border border-border bg-card/50 px-3 py-2">{children}</div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-amber-600 dark:text-amber-400" : "text-foreground"}>{value}</span>
    </div>
  );
}

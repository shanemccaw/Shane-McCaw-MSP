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

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Search, Trash2, Users, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ACCENT, ACCENT_TEXT, LINE, SURFACE, TEXT } from "../../../theme";
import { useShell } from "../../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../../shell/ContextMenu";
import {
  assignDirCustomerPackage,
  createDirConsentInviteLink,
  fetchDirAssignableServices,
  fetchDirCustomer,
  fetchDirCustomerDiagnosticRuns,
  fetchDirCustomerMonitoringPackage,
  fetchDirCustomerWriteConsent,
  fetchDirDiagnosticRunFindings,
  fetchDirMonitoringPackageChecks,
  fetchDirMonitoringPackages,
  fetchDirSimulatorAssessments,
  hardDeleteDirCustomer,
  revokeDirTenantConsent,
  runDirCustomerDiagnostics,
  setDirMonitoringPackageChecks,
  startDirCustomerWriteConsent,
  updateDirCustomerBusinessUnit,
  updateDirCustomerTestbed,
  type ConsentKey,
} from "../dirApi";
import { setDirCachedRecord } from "../dirNameCache";
import { onDirRecordAction, requestDirTreeRefresh } from "../dirEvents";
import type {
  DirAssignableService,
  DirConsentStatus,
  DirCustomerDetail,
  DirDiagnosticFinding,
  DirDiagnosticRunFindingsResponse,
  DirMonitoringPackage,
  DirWriteConsentStatus,
} from "../dirTypes";
import { DirRbacOrgRolesPanel } from "../DirRbacPanels";
import { FailureCategoryChip, SimulatorFailureClassification } from "../../../../components/SimulatorFailureClassification";
import { simulatorStudioCheckPath } from "../../../../components/simulatorDeepLink";
import {
  DirArmedButton,
  DirButton,
  DirCanvasBody,
  DirCanvasColumn,
  DirCanvasHeader,
  DirChip,
  DirEmptyRow,
  DirListRow,
  DirListRowGroup,
  DirLoadError,
  DirLoading,
  DirOutcome,
  DirSection,
  DirSelect,
  DirTile,
  DirTileGrid,
} from "../dirKit";

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const CONSENT_ROWS: Array<{ key: ConsentKey; label: string; get: (d: DirCustomerDetail) => DirConsentStatus | null }> = [
  { key: "graph", label: "Microsoft Graph", get: (d) => d.graphConsent },
  { key: "sharepoint", label: "SharePoint sites", get: (d) => d.sharePointConsent },
  { key: "writeBack", label: "Write-back", get: (d) => d.writeConsent },
];

// ── Diagnostic run findings (#371/#374/#378/#379) — ported from the legacy
// ActiveDirectoryCustomerPane.tsx's own proven data-fetching/business logic.
// Only the rendering below is new (dirKit.tsx primitives / inline theme tokens
// instead of the legacy pane's Tailwind/inline-styled JSX).

const FINDING_SEVERITY_RANK: Record<DirDiagnosticFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  ok: 3,
};

// Errors surface first regardless of severity — the use case is diagnosing
// what went wrong, not reading an alphabetical/severity-only list.
function sortFindings(findings: DirDiagnosticFinding[]): DirDiagnosticFinding[] {
  return [...findings].sort((a, b) => {
    const aErr = a.checkStatus === "error" ? 0 : 1;
    const bErr = b.checkStatus === "error" ? 0 : 1;
    if (aErr !== bErr) return aErr - bErr;
    return FINDING_SEVERITY_RANK[a.severity] - FINDING_SEVERITY_RANK[b.severity];
  });
}

// #374 persists the raw Graph error under extractedProperties._rawGraphError
// alongside the friendly, humanized `description`. Older findings written
// before #374 landed won't carry this key — the raw-error block simply
// doesn't render for them.
function extractRawGraphError(extractedProperties: Record<string, unknown> | null): string | null {
  const raw = extractedProperties?.["_rawGraphError"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function findingSeverityColor(finding: DirDiagnosticFinding): string {
  if (finding.checkStatus === "error" || finding.severity === "critical") return ACCENT_TEXT.danger;
  if (finding.severity === "warning") return ACCENT.amber;
  if (finding.severity === "ok") return ACCENT_TEXT.green;
  return TEXT.label;
}

// #378 — search is scoped to the currently-expanded run only (client-side
// filter over data already fetched by toggleRunExpanded, no new backend
// route). extractedProperties is stringified rather than read field-by-field
// so it also catches endpoint/URL text buried inside a raw Graph error.
function findingMatchesSearch(finding: DirDiagnosticFinding, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  const haystacks = [
    finding.checkKey,
    finding.title,
    finding.description ?? "",
    finding.extractedProperties ? JSON.stringify(finding.extractedProperties) : "",
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

function HighlightMatch({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const needle = term.toLowerCase();
  const parts: ReactNode[] = [];
  let rest = text;
  let offset = 0;
  while (rest.length > 0) {
    const idx = rest.toLowerCase().indexOf(needle);
    if (idx === -1) {
      parts.push(text.slice(offset));
      break;
    }
    if (idx > 0) parts.push(text.slice(offset, offset + idx));
    parts.push(
      <mark key={offset + idx} style={{ borderRadius: 2, background: "rgba(242,202,99,.35)", color: "inherit" }}>
        {text.slice(offset + idx, offset + idx + term.length)}
      </mark>,
    );
    offset += idx + term.length;
    rest = rest.slice(idx + term.length);
  }
  return <>{parts}</>;
}

export function DirCustomerCanvas({ customerId }: { customerId: number }) {
  const { fetchWithAuth } = useAuth();
  const shell = useShell();
  const [detail, setDetail] = useState<DirCustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  // #1770 — run-scan package picker. `packages` is the real catalog an
  // operator can choose from; `defaultPackageKey` is the customer's own
  // resolved active subscription (same value the server would fall back to),
  // used only to pre-select the picker so one-click behavior is unchanged
  // when the default is what the operator wants. The picker itself only
  // opens when there is a genuine choice to make (more than one package).
  const [packages, setPackages] = useState<DirMonitoringPackage[]>([]);
  const [defaultPackageKey, setDefaultPackageKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPackageKey, setSelectedPackageKey] = useState("");

  // Write-back consent (admin) — Git #1672, rehomed from the archived
  // msp-portal customer-detail.tsx's WriteBackConsentCard.
  const [writeConsentStatus, setWriteConsentStatus] = useState<DirWriteConsentStatus | null>(null);
  const [writeConsentLoading, setWriteConsentLoading] = useState(true);
  const [writeConsentGenerating, setWriteConsentGenerating] = useState(false);

  // #371 addendum — refresh just the runs list, not the whole customer detail
  // payload. Hits the dedicated runs-only endpoint (already shipped, dead
  // code before this build — #4493).
  const [refreshingRuns, setRefreshingRuns] = useState(false);
  const [refreshRunsError, setRefreshRunsError] = useState<string | null>(null);

  // #371 — expandable diagnostic run findings. One run expanded at a time;
  // findings are fetched on-demand the first time a run is expanded.
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  // #378 — search is scoped to whichever run is currently expanded.
  const [findingsSearch, setFindingsSearch] = useState("");
  const [runFindings, setRunFindings] = useState<Record<string, DirDiagnosticRunFindingsResponse | "loading" | "error">>({});

  // #376 — "Remove from scan package" on a finding row. Shared-package
  // detection reuses the same GET /api/admin/simulator/assessments filter
  // the legacy pane runs (existingAssessments.filter(a => a.packageKey === key)).
  const [removeConfirm, setRemoveConfirm] = useState<{
    runId: string;
    packageKey: string;
    checkKey: string;
    sharedNames: string[];
  } | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

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

  // Testbed toggle (#4489) — internal-only flag so Shane can flip a tenant
  // across pricing tiers for his own testing without re-consenting or
  // deleting/recreating it. `tenants.is_testbed` already existed and was
  // already read by the GET, just never surfaced or editable here.
  const [testbedSaving, setTestbedSaving] = useState(false);

  // Package Assignment (#4489) — manual Monitoring/Retainer swap, DB-only, no
  // Stripe. `assignableServices` is the real `services` catalog; the picker
  // filters it client-side by deliveryType into the two assignable categories.
  const [assignableServices, setAssignableServices] = useState<DirAssignableService[]>([]);
  const [selectedMonitoringServiceId, setSelectedMonitoringServiceId] = useState("");
  const [selectedRetainerServiceId, setSelectedRetainerServiceId] = useState("");
  const [assigningCategory, setAssigningCategory] = useState<"monitoring" | "retainer" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDirCustomer(fetchWithAuth, customerId);
      setDetail(data);
      setBusinessUnitDraft(data.customer.businessUnit ?? "");
      setDirCachedRecord("customer", String(customerId), {
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

  // #1770 — the real catalog + this customer's resolved default, loaded once
  // per tenant so the picker (below) always reflects real data rather than a
  // hardcoded list. A failure here degrades gracefully: `packages` stays
  // empty, so `runScan()` below falls through to its pre-#1770 one-click
  // behavior (no packageKey override, server resolves the subscription as it
  // always did) instead of blocking the button.
  const loadPackages = useCallback(async () => {
    try {
      const [pkgs, resolved] = await Promise.all([
        fetchDirMonitoringPackages(fetchWithAuth),
        fetchDirCustomerMonitoringPackage(fetchWithAuth, customerId),
      ]);
      setPackages(pkgs);
      setDefaultPackageKey(resolved.packageKey);
    } catch {
      setPackages([]);
      setDefaultPackageKey(null);
    }
  }, [fetchWithAuth, customerId]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const runScan = useCallback(
    async (packageKey?: string) => {
      // More than one real package to choose from, and the operator hasn't
      // picked one yet: open the picker instead of dispatching immediately.
      // Exactly one (or the catalog failed to load): run it, unprompted —
      // the pre-#1770 one-click behavior, unchanged.
      if (!packageKey && packages.length > 1) {
        setSelectedPackageKey(defaultPackageKey ?? packages[0]!.key);
        setPickerOpen(true);
        return;
      }
      setPickerOpen(false);
      setScanning(true);
      setOutcome(null);
      try {
        await runDirCustomerDiagnostics(fetchWithAuth, customerId, packageKey);
        setOutcome({ tone: "ok", message: "Scan started. It runs in the background — reopen this tenant in a minute to see results." });
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to start the scan." });
      } finally {
        setScanning(false);
      }
    },
    [fetchWithAuth, customerId, packages, defaultPackageKey],
  );

  const saveBusinessUnit = useCallback(async () => {
    setBusinessUnitSaving(true);
    setOutcome(null);
    try {
      const res = await updateDirCustomerBusinessUnit(fetchWithAuth, customerId, businessUnitDraft.trim() || null);
      setBusinessUnitDraft(res.businessUnit ?? "");
      setDetail((prev) => (prev ? { ...prev, customer: { ...prev.customer, businessUnit: res.businessUnit } } : prev));
      setOutcome({ tone: "ok", message: "Business unit saved." });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to save the business unit." });
    } finally {
      setBusinessUnitSaving(false);
    }
  }, [fetchWithAuth, customerId, businessUnitDraft]);

  const toggleTestbed = useCallback(async () => {
    if (!detail) return;
    setTestbedSaving(true);
    setOutcome(null);
    try {
      const res = await updateDirCustomerTestbed(fetchWithAuth, customerId, !detail.customer.isTestbed);
      setDetail((prev) => (prev ? { ...prev, customer: { ...prev.customer, isTestbed: res.isTestbed } } : prev));
      setOutcome({ tone: "ok", message: `Testbed ${res.isTestbed ? "enabled" : "disabled"} for this tenant.` });
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to update the testbed flag." });
    } finally {
      setTestbedSaving(false);
    }
  }, [fetchWithAuth, customerId, detail]);

  // #4489 — the real service catalog for the picker, loaded once per tenant.
  // A failure here degrades gracefully: both option lists render empty, so
  // the section shows "No … services in the catalog" instead of blocking.
  const loadAssignableServices = useCallback(async () => {
    try {
      const services = await fetchDirAssignableServices(fetchWithAuth);
      setAssignableServices(services);
      const monitoring = services.filter((s) => s.deliveryType === "bundle_subscription");
      const retainer = services.filter((s) => s.deliveryType === "retainer");
      setSelectedMonitoringServiceId((prev) => prev || (monitoring[0] ? String(monitoring[0].id) : ""));
      setSelectedRetainerServiceId((prev) => prev || (retainer[0] ? String(retainer[0].id) : ""));
    } catch {
      setAssignableServices([]);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadAssignableServices();
  }, [loadAssignableServices]);

  const assignPackage = useCallback(
    async (category: "monitoring" | "retainer", serviceId: string) => {
      if (!serviceId) return;
      setAssigningCategory(category);
      setOutcome(null);
      try {
        const res = await assignDirCustomerPackage(fetchWithAuth, customerId, Number(serviceId));
        setOutcome({
          tone: "ok",
          message:
            res.completedPreviousIds.length > 0
              ? `${res.serviceName} assigned. The previous active package was marked completed.`
              : `${res.serviceName} assigned.`,
        });
        await load();
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to assign the package." });
      } finally {
        setAssigningCategory(null);
      }
    },
    [fetchWithAuth, customerId, load],
  );

  const loadWriteConsent = useCallback(async () => {
    setWriteConsentLoading(true);
    try {
      const data = await fetchDirCustomerWriteConsent(fetchWithAuth, customerId);
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
      const { consentUrl } = await startDirCustomerWriteConsent(fetchWithAuth, customerId);
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
        await revokeDirTenantConsent(fetchWithAuth, detail.customer.tenantId, key);
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
      const link = await createDirConsentInviteLink(fetchWithAuth, {
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
      const res = await hardDeleteDirCustomer(fetchWithAuth, customerId);
      setDeleted(true);
      requestDirTreeRefresh();
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

  // #371 addendum — refresh just the runs list. Closes the gap this canvas's
  // own runScan() success message used to admit ("reopen this tenant in a
  // minute to see results").
  const refreshRuns = useCallback(async () => {
    setRefreshingRuns(true);
    setRefreshRunsError(null);
    try {
      const body = await fetchDirCustomerDiagnosticRuns(fetchWithAuth, customerId);
      setDetail((prev) => (prev ? { ...prev, recentDiagnosticRuns: body.recentDiagnosticRuns } : prev));
    } catch (err) {
      setRefreshRunsError(err instanceof Error ? err.message : "Failed to refresh diagnostic runs.");
    } finally {
      setRefreshingRuns(false);
    }
  }, [fetchWithAuth, customerId]);

  // #371 — expand a run in place, fetching its real findings from the same
  // route the legacy pane uses. Findings are cached per runId once fetched.
  const toggleRunExpanded = useCallback(
    async (runId: string) => {
      setFindingsSearch("");
      if (expandedRunId === runId) {
        setExpandedRunId(null);
        return;
      }
      setExpandedRunId(runId);
      if (runFindings[runId]) return;
      setRunFindings((prev) => ({ ...prev, [runId]: "loading" }));
      try {
        const body = await fetchDirDiagnosticRunFindings(fetchWithAuth, customerId, runId);
        setRunFindings((prev) => ({ ...prev, [runId]: body }));
      } catch {
        setRunFindings((prev) => ({ ...prev, [runId]: "error" }));
      }
    },
    [customerId, fetchWithAuth, expandedRunId, runFindings],
  );

  // #376 — actually remove the check from the package, after shared-package
  // detection (handleRemoveClick below) has either confirmed there's nothing
  // shared or the operator confirmed removing from every assessment sharing it.
  const removeCheckFromPackage = useCallback(
    async (runId: string, packageKey: string, checkKey: string, sharedCount: number) => {
      const inFlightKey = `${runId}:${checkKey}`;
      setRemovingKey(inFlightKey);
      try {
        const current = await fetchDirMonitoringPackageChecks(fetchWithAuth, packageKey);
        const remainingKeys = current.checks.map((c) => c.checkKey).filter((k) => k !== checkKey);
        await setDirMonitoringPackageChecks(fetchWithAuth, packageKey, remainingKeys);
        setRunFindings((prev) => {
          const existing = prev[runId];
          if (!existing || existing === "loading" || existing === "error") return prev;
          return { ...prev, [runId]: { ...existing, findings: existing.findings.filter((f) => f.checkKey !== checkKey) } };
        });
        setOutcome({
          tone: "ok",
          message:
            sharedCount > 0
              ? `Removed "${checkKey}" from "${packageKey}" and the ${sharedCount} other assessment${sharedCount === 1 ? "" : "s"} sharing it.`
              : `Removed "${checkKey}" from "${packageKey}".`,
        });
      } catch (err) {
        setOutcome({ tone: "error", message: err instanceof Error ? err.message : `Failed to remove "${checkKey}" from "${packageKey}".` });
      } finally {
        setRemovingKey(null);
        setRemoveConfirm(null);
      }
    },
    [fetchWithAuth],
  );

  // #376 — checks whether this package is shared with other assessments
  // before removing; fails closed (surfaces the error, does not proceed)
  // rather than risk a silent multi-assessment change.
  const handleRemoveClick = useCallback(
    async (runId: string, packageKey: string, checkKey: string) => {
      try {
        const data = await fetchDirSimulatorAssessments(fetchWithAuth);
        const sharedWith = data.assessments.filter((a) => a.packageKey === packageKey);
        if (sharedWith.length > 0) {
          setRemoveConfirm({ runId, packageKey, checkKey, sharedNames: sharedWith.map((a) => a.name) });
          return;
        }
      } catch {
        setOutcome({ tone: "error", message: "Failed to check whether this package is shared with other assessments. Try again." });
        return;
      }
      void removeCheckFromPackage(runId, packageKey, checkKey, 0);
    },
    [fetchWithAuth, removeCheckFromPackage],
  );

  useEffect(
    () =>
      onDirRecordAction("customer", String(customerId), (action) => {
        if (action === "run-scan") void runScan();
        if (action === "revoke-graph-consent") void revoke("graph", "Microsoft Graph");
        if (action === "copy-reconsent-link") void copyReconsentLink();
      }),
    [customerId, runScan, revoke, copyReconsentLink],
  );

  if (loading) return (
    <DirCanvasColumn>
      <DirLoading />
    </DirCanvasColumn>
  );
  if (error || !detail) return (
    <DirCanvasColumn>
      <DirLoadError message={error ?? "This tenant could not be loaded."} />
    </DirCanvasColumn>
  );

  if (deleted) {
    return (
      <DirCanvasColumn>
        <div style={{ padding: 24, fontSize: 12.5, color: ACCENT_TEXT.green }}>
          This tenant and everything tied to it was permanently deleted. Close this tab — it no longer exists.
        </div>
      </DirCanvasColumn>
    );
  }

  const { customer, owningMsp, users, purchasedServices, recentDiagnosticRuns } = detail;
  const connected = !!customer.tenantId;
  const monitoringServiceOptions = assignableServices.filter((s) => s.deliveryType === "bundle_subscription");
  const retainerServiceOptions = assignableServices.filter((s) => s.deliveryType === "retainer");

  return (
    <DirCanvasColumn>
      <DirCanvasHeader
        icon={Users}
        name={customer.name}
        kindLabel="Tenant"
        chips={
          <>
            <DirChip label={connected ? "connected" : "not connected"} tone={connected ? "good" : "warn"} />
            {customer.domain && <DirChip label={customer.domain} />}
          </>
        }
        actions={<DirButton label={scanning ? "Scanning…" : "Run scan"} tone="primary" onClick={() => void runScan()} disabled={scanning || !connected} title={connected ? undefined : "Tenant is not connected — nothing to scan."} />}
      />

      {outcome && <DirOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}

      {pickerOpen && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "8px 16px",
            borderBottom: `1px solid ${LINE.base}`,
            background: SURFACE.chrome,
          }}
        >
          <span style={{ fontSize: 11.5, color: TEXT.label }}>Package to run:</span>
          <DirSelect
            value={selectedPackageKey}
            onChange={setSelectedPackageKey}
            options={packages.map((p) => ({
              value: p.key,
              label: `${p.label} (${p.checkCount} check${p.checkCount === 1 ? "" : "s"})${p.key === defaultPackageKey ? " · current subscription" : ""}`,
            }))}
            disabled={scanning}
          />
          <DirButton label={scanning ? "Scanning…" : "Run"} tone="primary" onClick={() => void runScan(selectedPackageKey)} disabled={scanning || !selectedPackageKey} />
          <DirButton label="Cancel" onClick={() => setPickerOpen(false)} disabled={scanning} />
        </div>
      )}

      <DirCanvasBody>
        <DirSection title="Profile">
          <DirTileGrid>
            <DirTile label="Tenant GUID" value={customer.tenantId ? `${customer.tenantId.slice(0, 8)}…` : "none"} accent={customer.tenantId ? undefined : ACCENT_TEXT.danger} hint={customer.tenantUrl ?? undefined} copyValue={customer.tenantId ?? undefined} />
            <DirTile label="Industry" value={customer.industry ?? "—"} />
            <DirTile label="Status" value={customer.status} />
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
                  <DirButton label={businessUnitSaving ? "Saving…" : "Save"} tone="primary" onClick={() => void saveBusinessUnit()} disabled={businessUnitSaving} />
                )}
              </div>
            </div>
            <DirTile
              label="Owning MSP"
              value={owningMsp?.name ?? "—"}
            />
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
                Testbed
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-.01em",
                    color: customer.isTestbed ? ACCENT_TEXT.green : TEXT.primary,
                  }}
                >
                  {customer.isTestbed ? "Yes" : "No"}
                </span>
                <DirButton
                  label={testbedSaving ? "Saving…" : customer.isTestbed ? "Disable" : "Enable"}
                  onClick={() => void toggleTestbed()}
                  disabled={testbedSaving}
                />
              </div>
            </div>
          </DirTileGrid>
          {owningMsp && (
            <div>
              <DirButton
                label={`Open ${owningMsp.name}`}
                onClick={() => shell.openDoc({ kind: "msp", id: String(owningMsp.id), screenId: "msp-directory", label: owningMsp.name })}
              />
            </div>
          )}
        </DirSection>

        <DirSection title="Consent" note={connected ? undefined : "This tenant has never completed Graph consent — scanning is unavailable."}>
          <DirListRowGroup>
            {CONSENT_ROWS.map(({ key, label, get }) => {
              const status = get(detail);
              const granted = status?.consentStatus === "granted";
              return (
                <DirListRow
                  key={key}
                  label={label}
                  detail={status ? `${status.consentStatus}${status.adminEmail ? ` · ${status.adminEmail}` : ""}` : "never asked"}
                  meta={status?.consentedAt ? fmtDate(status.consentedAt) : undefined}
                  dot={granted ? "#6ccb96" : status ? "#e9b949" : "#6d6b69"}
                  actions={
                    granted ? (
                      <DirArmedButton label="Revoke" tone="danger" onConfirm={() => void revoke(key, label)} title={`Every check depending on ${label} stops for ${customer.name}.`} />
                    ) : undefined
                  }
                />
              );
            })}
          </DirListRowGroup>
          <div style={{ display: "flex", gap: 8 }}>
            <DirButton label="Copy re-consent link" onClick={() => void copyReconsentLink()} />
          </div>
        </DirSection>

        <DirSection
          title="Write-back consent (admin)"
          note="Admin consent for the dedicated write app — separate from the read-only tenant consent above."
        >
          <DirListRowGroup>
            {writeConsentLoading ? (
              <DirEmptyRow label="Loading…" />
            ) : (
              (() => {
                const wcStatus = writeConsentStatus?.writeConsent?.consentStatus ?? null;
                const granted = wcStatus === "granted";
                return (
                  <DirListRow
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
          </DirListRowGroup>
          <div style={{ display: "flex", gap: 8 }}>
            <DirButton
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
        </DirSection>

        <DirSection
          title="Recent scans"
          actions={
            <DirButton
              label={refreshingRuns ? "Refreshing…" : "Refresh"}
              onClick={() => void refreshRuns()}
              disabled={refreshingRuns}
              title="Refresh recent diagnostic runs"
            />
          }
        >
          {refreshRunsError && <span style={{ fontSize: 11.5, color: ACCENT_TEXT.danger }}>{refreshRunsError}</span>}
          <DirListRowGroup>
            {recentDiagnosticRuns.length === 0 ? (
              <DirEmptyRow label={connected ? "No scans have run yet." : "No scan has ever run against this tenant."} />
            ) : (
              recentDiagnosticRuns.map((r) => {
                const expanded = expandedRunId === r.runId;
                const state = runFindings[r.runId];
                return (
                  <div key={r.runId}>
                    <DirListRow
                      label={r.packageKey}
                      detail={r.status}
                      meta={r.completedAt ? fmtDate(r.completedAt) : r.startedAt ? `started ${fmtDate(r.startedAt)}` : undefined}
                      dot={r.status === "completed" ? "#6ccb96" : r.status === "failed" ? "#e57a7a" : "#e9b949"}
                      onClick={() => void toggleRunExpanded(r.runId)}
                    />
                    {expanded && (
                      <div style={{ padding: "10px 14px 14px", borderBottom: `1px solid ${LINE.subtle}`, background: SURFACE.well }}>
                        {state === "loading" || state === undefined ? (
                          <span style={{ fontSize: 11.5, fontStyle: "italic", color: TEXT.caption }}>Loading findings…</span>
                        ) : state === "error" ? (
                          <span style={{ fontSize: 11.5, fontStyle: "italic", color: ACCENT_TEXT.danger }}>Failed to load findings for this run.</span>
                        ) : state.findings.length === 0 ? (
                          <span style={{ fontSize: 11.5, fontStyle: "italic", color: TEXT.caption }}>No findings recorded for this run.</span>
                        ) : (
                          <>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px", fontSize: 10.5, color: TEXT.label, marginBottom: 8 }}>
                              <span>{state.run.checksTotal} checks</span>
                              <span style={{ color: ACCENT_TEXT.green }}>{state.run.checksOk} ok</span>
                              <span style={{ color: ACCENT_TEXT.danger }}>{state.run.checksError} error</span>
                              <span>{state.run.checksRequiresScript} needs script</span>
                              <span>{state.run.checksLicenseGap} license gap</span>
                            </div>
                            <div style={{ position: "relative", marginBottom: 8 }}>
                              <Search
                                size={13}
                                strokeWidth={1.8}
                                style={{ position: "absolute", left: 8, top: 7, color: TEXT.dim, pointerEvents: "none" }}
                              />
                              <input
                                value={findingsSearch}
                                onChange={(e) => setFindingsSearch(e.target.value)}
                                placeholder="Search findings…"
                                style={{
                                  width: "100%",
                                  height: 28,
                                  padding: "0 26px",
                                  borderRadius: 5,
                                  border: `1px solid ${LINE.control}`,
                                  background: SURFACE.card,
                                  color: TEXT.primary,
                                  fontSize: 11.5,
                                }}
                              />
                              {findingsSearch && (
                                <button
                                  onClick={() => setFindingsSearch("")}
                                  title="Clear search"
                                  style={{ position: "absolute", right: 6, top: 6, border: 0, background: "transparent", color: TEXT.dim, cursor: "pointer", display: "flex" }}
                                >
                                  <X size={13} strokeWidth={1.8} />
                                </button>
                              )}
                            </div>
                            {(() => {
                              const visible = sortFindings(state.findings).filter((f) => findingMatchesSearch(f, findingsSearch));
                              if (visible.length === 0) {
                                return (
                                  <span style={{ fontSize: 11.5, fontStyle: "italic", color: TEXT.caption }}>
                                    No findings match “{findingsSearch}”.
                                  </span>
                                );
                              }
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {visible.map((f) => {
                                    const rawError = extractRawGraphError(f.extractedProperties);
                                    const removeKey = `${r.runId}:${f.checkKey}`;
                                    return (
                                      <div key={f.findingId} style={{ borderTop: `1px solid ${LINE.subtle}`, paddingTop: 8 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                          <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 12, fontWeight: 600, color: TEXT.strong }}>
                                            <HighlightMatch text={f.title} term={findingsSearch} />
                                          </span>
                                          {f.classification && <FailureCategoryChip classification={f.classification} />}
                                          <span style={{ flex: "none", fontSize: 10, textTransform: "uppercase", color: findingSeverityColor(f) }}>
                                            {f.checkStatus === "error" ? "error" : f.severity}
                                          </span>
                                          <button
                                            onClick={() => void handleRemoveClick(r.runId, r.packageKey, f.checkKey)}
                                            disabled={removingKey === removeKey}
                                            title="Remove this check from the scan package"
                                            style={{
                                              flex: "none",
                                              border: 0,
                                              background: "transparent",
                                              color: TEXT.dim,
                                              cursor: removingKey === removeKey ? "default" : "pointer",
                                              opacity: removingKey === removeKey ? 0.5 : 1,
                                              display: "flex",
                                            }}
                                          >
                                            <Trash2 size={13} strokeWidth={1.8} />
                                          </button>
                                        </div>
                                        <div style={{ fontSize: 10.5, color: TEXT.label, marginTop: 2 }}>
                                          <HighlightMatch text={f.checkKey} term={findingsSearch} />
                                        </div>
                                        {removeConfirm && removeConfirm.runId === r.runId && removeConfirm.checkKey === f.checkKey && (
                                          <div
                                            style={{
                                              marginTop: 6,
                                              padding: "6px 8px",
                                              borderRadius: 5,
                                              border: "1px solid rgba(233,185,73,.4)",
                                              background: "rgba(242,202,99,.08)",
                                            }}
                                          >
                                            <span style={{ fontSize: 10.5, color: ACCENT.amber }}>
                                              This check is also used by {removeConfirm.sharedNames.length} other assessment
                                              {removeConfirm.sharedNames.length === 1 ? "" : "s"} ({removeConfirm.sharedNames.join(", ")}) — remove it
                                              from all of them?
                                            </span>
                                            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                                              <DirButton
                                                label={removingKey === removeKey ? "Removing…" : "Remove from all"}
                                                tone="danger"
                                                disabled={removingKey === removeKey}
                                                onClick={() => void removeCheckFromPackage(r.runId, r.packageKey, f.checkKey, removeConfirm.sharedNames.length)}
                                              />
                                              <DirButton label="Cancel" disabled={removingKey === removeKey} onClick={() => setRemoveConfirm(null)} />
                                            </div>
                                          </div>
                                        )}
                                        {f.description && (
                                          <p style={{ marginTop: 4, marginBlockEnd: 0, fontSize: 11, lineHeight: 1.5, color: TEXT.body }}>
                                            <HighlightMatch text={f.description} term={findingsSearch} />
                                          </p>
                                        )}
                                        {rawError && (
                                          <div
                                            style={{
                                              marginTop: 6,
                                              padding: "5px 8px",
                                              borderRadius: 5,
                                              border: "1px solid rgba(229,122,122,.3)",
                                              background: "rgba(229,122,122,.06)",
                                            }}
                                          >
                                            <span style={{ fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word", color: ACCENT_TEXT.danger }}>
                                              <HighlightMatch text={rawError} term={findingsSearch} />
                                            </span>
                                          </div>
                                        )}
                                        {f.classification && (
                                          <div style={{ marginTop: 6 }}>
                                            <SimulatorFailureClassification classification={f.classification} />
                                          </div>
                                        )}
                                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 6 }}>
                                          <Link
                                            href={simulatorStudioCheckPath(f.checkKey)}
                                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: TEXT.dim, textDecoration: "none" }}
                                            title={`Open "${f.checkKey}" in Simulator Studio's endpoint canvas`}
                                          >
                                            <ExternalLink size={11} strokeWidth={1.8} />
                                            Test in Simulator Studio →
                                          </Link>
                                          {(f.classification?.action.kind === "edit_endpoint" || f.classification?.action.kind === "retire_check") && (
                                            <span style={{ fontSize: 10.5, color: TEXT.label }}>
                                              Suggested: {f.classification.action.label} — in Simulator Studio
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </DirListRowGroup>
        </DirSection>

        <DirSection title="Purchased services">
          <DirListRowGroup>
            {purchasedServices.length === 0 ? (
              <DirEmptyRow label="No services purchased." />
            ) : (
              purchasedServices.map((s) => (
                <DirListRow key={s.id} label={s.serviceName} detail={s.billingInterval} meta={s.status} dot={s.status === "active" ? "#6ccb96" : "#8a8886"} />
              ))
            )}
          </DirListRowGroup>
        </DirSection>

        <DirSection
          title="Package Assignment"
          note="Internal-only, DB-only — no Stripe. Assigning a package marks this tenant's current active package of the same type completed; there is no undo."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: TEXT.label, minWidth: 84 }}>Monitoring</span>
              {monitoringServiceOptions.length === 0 ? (
                <span style={{ fontSize: 11.5, color: TEXT.label }}>No Monitoring services in the catalog.</span>
              ) : (
                <>
                  <DirSelect
                    value={selectedMonitoringServiceId}
                    onChange={setSelectedMonitoringServiceId}
                    options={monitoringServiceOptions.map((s) => ({ value: String(s.id), label: s.tier ? `${s.name} (${s.tier})` : s.name }))}
                    disabled={assigningCategory !== null}
                  />
                  <DirArmedButton
                    label={assigningCategory === "monitoring" ? "Assigning…" : "Assign"}
                    tone="primary"
                    onConfirm={() => void assignPackage("monitoring", selectedMonitoringServiceId)}
                    title="Replaces this tenant's current active Monitoring package, if any."
                  />
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: TEXT.label, minWidth: 84 }}>Retainer</span>
              {retainerServiceOptions.length === 0 ? (
                <span style={{ fontSize: 11.5, color: TEXT.label }}>No Retainer services in the catalog.</span>
              ) : (
                <>
                  <DirSelect
                    value={selectedRetainerServiceId}
                    onChange={setSelectedRetainerServiceId}
                    options={retainerServiceOptions.map((s) => ({ value: String(s.id), label: s.tier ? `${s.name} (${s.tier})` : s.name }))}
                    disabled={assigningCategory !== null}
                  />
                  <DirArmedButton
                    label={assigningCategory === "retainer" ? "Assigning…" : "Assign"}
                    tone="primary"
                    onConfirm={() => void assignPackage("retainer", selectedRetainerServiceId)}
                    title="Replaces this tenant's current active Retainer package, if any."
                  />
                </>
              )}
            </div>
          </div>
        </DirSection>

        <DirSection title="Users" note={`${detail.userCount} account${detail.userCount === 1 ? "" : "s"}`}>
          <DirListRowGroup>
            {users.length === 0 ? (
              <DirEmptyRow label="No users yet." />
            ) : (
              users.map((u) => (
                <DirListRow
                  key={u.id}
                  label={u.name || u.email}
                  detail={`${u.email} · ${u.mspRole}`}
                  meta={u.isActive ? "active" : "disabled"}
                  metaAccent={u.isActive ? undefined : ACCENT_TEXT.danger}
                  dot={u.isActive ? "#6ccb96" : "#e57a7a"}
                  onClick={() => shell.openDoc({ kind: "user", id: String(u.id), screenId: "msp-directory", label: u.name || u.email })}
                  onContextMenu={(e) =>
                    openMenu(
                      e,
                      [
                        { label: "Open", onSelect: () => shell.openDoc({ kind: "user", id: String(u.id), screenId: "msp-directory", label: u.name || u.email }) },
                        { label: "Copy email", onSelect: () => void navigator.clipboard.writeText(u.email).catch(() => {}) },
                      ],
                      `Actions for ${u.name || u.email}`,
                    )
                  }
                />
              ))
            )}
          </DirListRowGroup>
        </DirSection>

        <DirRbacOrgRolesPanel system="customer" orgId={customerId} />

        <DirSection
          title="Delete"
          note="Revokes all consent, then removes every user under this tenant and everything tied to it — there is no undo. The server refuses this outside a non-production environment."
        >
          {!deleteArmed ? (
            <div>
              <DirButton label="Permanently delete this tenant" tone="danger" onClick={() => setDeleteArmed(true)} />
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
                <DirButton
                  label={deleteBusy ? "Deleting…" : "Delete permanently"}
                  tone="danger"
                  disabled={deleteBusy || deleteConfirmText !== customer.name}
                  onClick={() => void runHardDelete()}
                />
                <DirButton label="Cancel" onClick={() => { setDeleteArmed(false); setDeleteConfirmText(""); }} disabled={deleteBusy} />
              </div>
            </div>
          )}
        </DirSection>
      </DirCanvasBody>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </DirCanvasColumn>
  );
}

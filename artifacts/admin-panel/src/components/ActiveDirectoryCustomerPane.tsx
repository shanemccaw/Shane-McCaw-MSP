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
//
// #379 bridges this pane to Simulator Studio: every finding inside #371's
// expand-in-place view now carries the server's real failure `classification`
// (api-server's monitor-failure-classifier, run over #374's
// `extractedProperties._rawGraphError`) rendered by Simulator Studio's OWN
// SimulatorFailureClassification component, plus a deep link into that check's
// endpoint canvas. Both directions reuse what already exists — the classifier is
// an unmodified pure function, and the link is the same selection path a manual
// search-and-click takes.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
  Check,
  RefreshCw,
  Trash2,
  Search,
  X,
  ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AD_SELECT_EVENT, type AdSelectedObject } from "./ActiveDirectoryTree";
import type { AssessmentNode } from "./SimulatorLeftTree";
import {
  FailureCategoryChip,
  SimulatorFailureClassification,
  type FailureClassification,
} from "./SimulatorFailureClassification";
import { simulatorStudioCheckPath } from "./simulatorDeepLink";

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

// #371 — expandable diagnostic run findings. Reuses msp-diagnostics.ts's
// existing GET /msp/customers/:customerId/diagnostics/runs/:runId route
// as-is (requireRole("MSPOperator") + assertCustomerAccess both bypass for
// PlatformAdmin, same reuse pattern the manual scan trigger below already
// relies on) — no new admin route needed, since it already returns the run's
// real check counts plus every msp_diagnostic_findings row for that run.
interface DiagnosticRunCounts {
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksRequiresScript: number;
  checksLicenseGap: number;
}

interface DiagnosticFinding {
  findingId: string;
  runId: string;
  checkKey: string;
  checkLabel: string;
  severity: "ok" | "info" | "warning" | "critical";
  title: string;
  description: string | null;
  extractedProperties: Record<string, unknown> | null;
  checkStatus: string | null;
  // #379 — the server's triage verdict for THIS finding, computed on read by
  // api-server's monitor-failure-classifier from this finding's own real error
  // text. Null whenever the finding isn't a real failure, which is what keeps a
  // verdict from ever rendering over a check that passed. Absent entirely on
  // responses from before #379 landed — hence optional.
  classification?: FailureClassification | null;
}

interface DiagnosticRunFindingsResponse {
  run: DiagnosticRunCounts;
  findings: DiagnosticFinding[];
}

const FINDING_SEVERITY_RANK: Record<DiagnosticFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  ok: 3,
};

// Errors surface first regardless of severity — the use case is diagnosing
// what went wrong, not reading an alphabetical/severity-only list.
function sortFindings(findings: DiagnosticFinding[]): DiagnosticFinding[] {
  return [...findings].sort((a, b) => {
    const aErr = a.checkStatus === "error" ? 0 : 1;
    const bErr = b.checkStatus === "error" ? 0 : 1;
    if (aErr !== bErr) return aErr - bErr;
    return FINDING_SEVERITY_RANK[a.severity] - FINDING_SEVERITY_RANK[b.severity];
  });
}

// #374 persists the raw Graph error under extractedProperties._rawGraphError
// alongside the friendly, humanized `description`. Older findings written
// before #374 landed won't carry this key — that's fine, the raw-error block
// simply doesn't render for them.
function extractRawGraphError(extractedProperties: Record<string, unknown> | null): string | null {
  const raw = extractedProperties?.["_rawGraphError"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function findingSeverityClass(finding: DiagnosticFinding): string {
  if (finding.checkStatus === "error" || finding.severity === "critical") {
    return "text-red-600 dark:text-red-400";
  }
  if (finding.severity === "warning") {
    return "text-amber-600 dark:text-amber-400";
  }
  if (finding.severity === "ok") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  return "text-muted-foreground";
}

// #378 — search is scoped to the currently-expanded run only (client-side
// filter over data already fetched by toggleRunExpanded, no new backend
// route). extractedProperties is stringified rather than read field-by-field
// so it also catches endpoint/URL text buried inside a raw Graph error,
// which has no separate structured field of its own.
function findingMatchesSearch(finding: DiagnosticFinding, term: string): boolean {
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
      <mark key={offset + idx} className="rounded-sm bg-amber-300/70 text-inherit dark:bg-amber-500/40">
        {text.slice(offset + idx, offset + idx + term.length)}
      </mark>,
    );
    offset += idx + term.length;
    rest = rest.slice(idx + term.length);
  }
  return <>{parts}</>;
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

// #249 — DLP/Label Purview role-group provisioning state + manual re-trigger.
interface DlpProvisioningLastRun {
  at: string;
  source: string;
  overallStatus: string;
  roleGroupStepStatus: string;
}

interface DlpProvisioningState {
  status: "not_provisioned" | "partially_provisioned" | "provisioned" | "unknown";
  groupExists: boolean;
  servicePrincipalIsMember: boolean;
  // #2166 — which app registration's service principal the membership check ran
  // against, and which env var named it. Shown so a wrong target is visible.
  targetAppId: string | null;
  targetAppIdSource: string | null;
  lastRun: DlpProvisioningLastRun | null;
  reason?: string;
}

interface DlpProvisioningStepResult {
  status: string;
  detail?: string;
}

interface DlpProvisioningTriggerResult {
  overallStatus: string;
  groupId: string | null;
  servicePrincipalId: string | null;
  targetAppId: string | null;
  targetAppIdSource: string | null;
  steps: {
    resolveServicePrincipal: DlpProvisioningStepResult;
    createGroup: DlpProvisioningStepResult;
    addServicePrincipalMember: DlpProvisioningStepResult;
    addRoleGroupMember: DlpProvisioningStepResult;
  };
}

const DLP_STATUS_LABEL: Record<DlpProvisioningState["status"], string> = {
  not_provisioned: "Not provisioned",
  partially_provisioned: "Partially provisioned",
  provisioned: "Provisioned",
  unknown: "Unknown",
};

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

  // #249 — DLP/Label Purview role-group provisioning state + re-trigger.
  const [dlpState, setDlpState] = useState<DlpProvisioningState | null>(null);
  const [dlpStateError, setDlpStateError] = useState<string | null>(null);
  const [triggeringDlp, setTriggeringDlp] = useState(false);
  const [dlpTriggerError, setDlpTriggerError] = useState<string | null>(null);
  const [dlpTriggerResult, setDlpTriggerResult] = useState<DlpProvisioningTriggerResult | null>(null);

  // #371 — expandable diagnostic run findings. One run expanded at a time;
  // findings are fetched on-demand the first time a run is expanded, not
  // preloaded for every row up front.
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  // #378 — search is scoped to whichever run is currently expanded, so one
  // query string covers it (only one run can be expanded at a time).
  const [findingsSearch, setFindingsSearch] = useState("");
  const [runFindings, setRunFindings] = useState<Record<string, DiagnosticRunFindingsResponse | "loading" | "error">>({});

  // #371 addendum — refresh just the runs list, not the whole customer detail
  // payload. Hits the dedicated runs-only endpoint added alongside this.
  const [refreshingRuns, setRefreshingRuns] = useState(false);
  const [refreshRunsError, setRefreshRunsError] = useState<string | null>(null);

  // #376 — "Remove from scan package" on a finding row. Shared-package
  // detection reuses AssessmentCreationWizard.tsx's own `attachSharedWith`
  // concept (existingAssessments.filter(a => a.packageKey === key)) rather
  // than reimplementing it — that wizard is fed its assessment list as a
  // prop from SimulatorLeftTree's already-fetched state, but this pane has
  // no such prop, so it fetches the same GET /api/admin/simulator/assessments
  // this pane doesn't otherwise use, purely to run that filter.
  const [removeConfirm, setRemoveConfirm] = useState<{
    runId: string;
    packageKey: string;
    checkKey: string;
    sharedNames: string[];
  } | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const removeCheckFromPackage = async (runId: string, packageKey: string, checkKey: string, sharedCount: number) => {
    const inFlightKey = `${runId}:${checkKey}`;
    setRemovingKey(inFlightKey);
    try {
      const currentRes = await fetchWithAuth(`/api/admin/monitoring-packages/${encodeURIComponent(packageKey)}/checks`);
      if (!currentRes.ok) {
        toast.error(`Failed to load "${packageKey}"'s current check list.`);
        return;
      }
      const currentBody = (await currentRes.json()) as { checks: { checkKey: string }[] };
      const remainingKeys = currentBody.checks.map((c) => c.checkKey).filter((k) => k !== checkKey);

      const putRes = await fetchWithAuth(`/api/admin/monitoring-packages/${encodeURIComponent(packageKey)}/checks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkKeys: remainingKeys }),
      });
      if (!putRes.ok) {
        const body = (await putRes.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? `Failed to remove "${checkKey}" from "${packageKey}".`);
        return;
      }

      setRunFindings((prev) => {
        const existing = prev[runId];
        if (!existing || existing === "loading" || existing === "error") return prev;
        return {
          ...prev,
          [runId]: { ...existing, findings: existing.findings.filter((f) => f.checkKey !== checkKey) },
        };
      });
      toast.success(
        sharedCount > 0
          ? `Removed "${checkKey}" from "${packageKey}" and the ${sharedCount} other assessment${sharedCount === 1 ? "" : "s"} sharing it.`
          : `Removed "${checkKey}" from "${packageKey}".`,
      );
    } catch {
      toast.error(`Failed to remove "${checkKey}" from "${packageKey}".`);
    } finally {
      setRemovingKey(null);
      setRemoveConfirm(null);
    }
  };

  const handleRemoveClick = async (runId: string, packageKey: string, checkKey: string) => {
    try {
      const res = await fetchWithAuth("/api/admin/simulator/assessments");
      if (!res.ok) {
        // Detection failing open (treat as not-shared) would risk a silent
        // multi-assessment change; fail closed instead — surface the error
        // and let the operator retry rather than proceeding uninformed.
        toast.error("Failed to check whether this package is shared with other assessments. Try again.");
        return;
      }
      const data = (await res.json()) as { assessments: AssessmentNode[] };
      const sharedWith = data.assessments.filter((a) => a.packageKey === packageKey);
      if (sharedWith.length > 0) {
        setRemoveConfirm({ runId, packageKey, checkKey, sharedNames: sharedWith.map((a) => a.name) });
        return;
      }
    } catch {
      toast.error("Failed to check whether this package is shared with other assessments. Try again.");
      return;
    }
    void removeCheckFromPackage(runId, packageKey, checkKey, 0);
  };

  const refreshRuns = async () => {
    setRefreshingRuns(true);
    setRefreshRunsError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/active-directory/customer/${customerId}/diagnostics/runs`);
      if (!res.ok) {
        setRefreshRunsError("Failed to refresh diagnostic runs.");
        return;
      }
      const body = (await res.json()) as { recentDiagnosticRuns: CustomerDiagnosticRunSummary[] };
      setDetail((prev) => (prev ? { ...prev, recentDiagnosticRuns: body.recentDiagnosticRuns } : prev));
    } catch {
      setRefreshRunsError("Failed to refresh diagnostic runs.");
    } finally {
      setRefreshingRuns(false);
    }
  };

  const toggleRunExpanded = async (runId: string) => {
    setFindingsSearch("");
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (runFindings[runId]) return;
    setRunFindings((prev) => ({ ...prev, [runId]: "loading" }));
    try {
      const res = await fetchWithAuth(`/api/msp/customers/${customerId}/diagnostics/runs/${runId}`);
      if (!res.ok) {
        setRunFindings((prev) => ({ ...prev, [runId]: "error" }));
        return;
      }
      const body = (await res.json()) as DiagnosticRunFindingsResponse;
      setRunFindings((prev) => ({ ...prev, [runId]: body }));
    } catch {
      setRunFindings((prev) => ({ ...prev, [runId]: "error" }));
    }
  };

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
    setDlpStateError(null);
    setDlpTriggerError(null);
    setDlpTriggerResult(null);

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

  // DLP/Label Purview role-group provisioning state (#249) — same
  // "wait for the GUID, honest empty state otherwise" shape as telemetry.
  const refreshDlpState = async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/customers/${customerId}/dlp-provisioning`);
      if (!res.ok) {
        setDlpStateError("Failed to load DLP provisioning state.");
        return;
      }
      setDlpState((await res.json()) as DlpProvisioningState);
    } catch {
      setDlpStateError("Failed to load DLP provisioning state.");
    }
  };

  useEffect(() => {
    if (!tenantGuid) {
      setDlpState(null);
      setDlpStateError(null);
      return;
    }
    setDlpState(null);
    setDlpStateError(null);
    void refreshDlpState();
  }, [tenantGuid, customerId, fetchWithAuth]);

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
        body: JSON.stringify({ packageKey: "assess:copilot-readiness" }),
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

  // Manual re-trigger (#249) — POST admin-dlp-provisioning.ts's
  // /admin/customers/:id/dlp-provisioning/trigger route. Idempotent on the
  // server side (every step checks live/audit state first), so this is safe
  // to click again on an already-provisioned tenant — used for both backfill
  // (tenants that consented before this chain existed) and retrying a
  // partial/blocked run.
  const triggerDlpProvisioning = async () => {
    setTriggeringDlp(true);
    setDlpTriggerError(null);
    setDlpTriggerResult(null);
    try {
      const res = await fetchWithAuth(`/api/admin/customers/${customerId}/dlp-provisioning/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => null)) as (DlpProvisioningTriggerResult & { error?: string }) | null;
      if (!res.ok) {
        setDlpTriggerError(body?.error ?? "Failed to trigger DLP role-group provisioning.");
        return;
      }
      setDlpTriggerResult(body);
      await refreshDlpState();
    } catch {
      setDlpTriggerError("Failed to trigger DLP role-group provisioning.");
    } finally {
      setTriggeringDlp(false);
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

      {/* Toolbar */}
      {tenantGuid && (
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => void triggerScan()}
            disabled={triggeringScan}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {triggeringScan ? "Starting scan…" : "Start Manual Scan"}
          </button>
        </div>
      )}
      {scanError && <p className="mb-4 -mt-2 text-[11px] text-red-600 dark:text-red-400">{scanError}</p>}
      {scanSuccess && <p className="mb-4 -mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">{scanSuccess}</p>}

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

      {/* DLP/Label Purview role-group provisioning (#249) */}
      <Section title="DLP/Label Role-Group Provisioning" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
        {!tenantGuid ? (
          <p className="italic text-muted-foreground">Tenant is not connected to a Microsoft 365 tenant — provisioning is unavailable.</p>
        ) : dlpStateError ? (
          <p className="italic text-amber-600 dark:text-amber-400">{dlpStateError}</p>
        ) : !dlpState ? (
          <p className="italic text-muted-foreground">Loading provisioning state…</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Status</span>
              <span
                className={`shrink-0 text-[11px] font-semibold ${
                  dlpState.status === "provisioned"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : dlpState.status === "partially_provisioned"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                }`}
              >
                {DLP_STATUS_LABEL[dlpState.status]}
              </span>
            </div>
            {dlpState.reason && <Field label="Note" value={dlpState.reason} />}
            <Field label="Security group exists" value={dlpState.groupExists ? "Yes" : "No"} />
            <Field label="Service principal is a member" value={dlpState.servicePrincipalIsMember ? "Yes" : "No"} />
            {dlpState.targetAppId && (
              <Field label="Target app registration" value={`${dlpState.targetAppId} (${dlpState.targetAppIdSource ?? "unknown source"})`} />
            )}
            {dlpState.lastRun && (
              <>
                <Field label="Last run" value={formatDateTime(dlpState.lastRun.at)} />
                <Field label="Last run outcome" value={`${dlpState.lastRun.overallStatus} (role-group step: ${dlpState.lastRun.roleGroupStepStatus})`} highlight={dlpState.lastRun.overallStatus !== "provisioned"} />
                <Field label="Last run source" value={dlpState.lastRun.source} />
              </>
            )}
            {!dlpState.lastRun && <p className="italic text-muted-foreground">No provisioning run recorded yet for this tenant.</p>}

            <div className="pt-1">
              <button
                onClick={() => void triggerDlpProvisioning()}
                disabled={triggeringDlp}
                className="rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {triggeringDlp ? "Provisioning…" : dlpState.status === "provisioned" ? "Re-run (idempotent)" : "Provision now"}
              </button>
              {dlpTriggerError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{dlpTriggerError}</p>}
              {dlpTriggerResult && (
                <div className="mt-1.5 rounded border border-border bg-background p-2">
                  <p className={`text-[11px] font-semibold ${dlpTriggerResult.overallStatus === "provisioned" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {dlpTriggerResult.overallStatus}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                    {Object.entries(dlpTriggerResult.steps).map(([step, r]) => (
                      <li key={step}>
                        {step}: <span className="font-medium text-foreground">{r.status}</span>
                        {r.detail ? ` — ${r.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
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
      <Section
        title="Recent Diagnostic Runs"
        icon={<ActivitySquare className="h-4 w-4 text-muted-foreground" />}
        action={
          <button
            type="button"
            onClick={() => void refreshRuns()}
            disabled={refreshingRuns}
            className="flex shrink-0 items-center gap-1 rounded p-0.5 text-muted-foreground hover:text-primary disabled:opacity-50"
            title="Refresh recent diagnostic runs"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingRuns ? "animate-spin" : ""}`} />
          </button>
        }
      >
        {refreshRunsError && <p className="mb-1.5 text-[11px] italic text-red-600 dark:text-red-400">{refreshRunsError}</p>}
        {recentDiagnosticRuns.length === 0 ? (
          <p className="italic text-muted-foreground">No scans yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {recentDiagnosticRuns.map((r) => {
              const expanded = expandedRunId === r.runId;
              const state = runFindings[r.runId];
              return (
                <li key={r.runId}>
                  <button
                    type="button"
                    onClick={() => void toggleRunExpanded(r.runId)}
                    className="flex w-full items-center justify-between gap-2 py-1.5 text-left hover:text-primary"
                    aria-expanded={expanded}
                    title="View this run's findings"
                  >
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
                  </button>
                  {expanded && (
                    <div className="mb-2 rounded border border-border/60 bg-background/40 px-2 py-2">
                      {state === "loading" || state === undefined ? (
                        <p className="text-[11px] italic text-muted-foreground">Loading findings…</p>
                      ) : state === "error" ? (
                        <p className="text-[11px] italic text-red-600 dark:text-red-400">Failed to load findings for this run.</p>
                      ) : state.findings.length === 0 ? (
                        <p className="text-[11px] italic text-muted-foreground">No findings recorded for this run.</p>
                      ) : (
                        <>
                          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                            <span>{state.run.checksTotal} checks</span>
                            <span className="text-emerald-600 dark:text-emerald-400">{state.run.checksOk} ok</span>
                            <span className="text-red-600 dark:text-red-400">{state.run.checksError} error</span>
                            <span>{state.run.checksRequiresScript} needs script</span>
                            <span>{state.run.checksLicenseGap} license gap</span>
                          </div>
                          <div className="relative mb-2 flex items-center">
                            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
                            <input
                              type="text"
                              value={findingsSearch}
                              onChange={(e) => setFindingsSearch(e.target.value)}
                              placeholder="Search findings…"
                              className="w-full rounded border border-border bg-background py-1 pl-7 pr-6 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                            />
                            {findingsSearch && (
                              <button
                                type="button"
                                onClick={() => setFindingsSearch("")}
                                className="absolute right-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                title="Clear search"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          {(() => {
                            const visibleFindings = sortFindings(state.findings).filter((f) =>
                              findingMatchesSearch(f, findingsSearch),
                            );
                            if (visibleFindings.length === 0) {
                              return <p className="text-[11px] italic text-muted-foreground">No findings match “{findingsSearch}”.</p>;
                            }
                            return (
                          <ul className="divide-y divide-border/60">
                            {visibleFindings.map((f) => (
                              <li key={f.findingId} className="py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                    <HighlightMatch text={f.title} term={findingsSearch} />
                                  </span>
                                  {/* #379 — the compact chip SimulatorFailureClassification
                                      exports for exactly this case ("dense lists"), so a
                                      category is readable while scanning the list, not only
                                      after reading the banner below. */}
                                  {f.classification && <FailureCategoryChip classification={f.classification} />}
                                  <span className={`shrink-0 text-[10px] uppercase ${findingSeverityClass(f)}`}>
                                    {f.checkStatus === "error" ? "error" : f.severity}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-muted-foreground">
                                    <HighlightMatch text={f.checkKey} term={findingsSearch} />
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveClick(r.runId, r.packageKey, f.checkKey)}
                                    disabled={removingKey === `${r.runId}:${f.checkKey}`}
                                    className="flex shrink-0 items-center gap-1 rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                                    title="Remove this check from the scan package"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                                {removeConfirm && removeConfirm.runId === r.runId && removeConfirm.checkKey === f.checkKey && (
                                  <div className="mt-1 rounded border border-amber-600/40 bg-amber-600/5 px-1.5 py-1.5">
                                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                      This check is also used by {removeConfirm.sharedNames.length}{" "}
                                      other assessment{removeConfirm.sharedNames.length === 1 ? "" : "s"}
                                      {" "}({removeConfirm.sharedNames.join(", ")}) — remove it from all of them?
                                    </p>
                                    <div className="mt-1 flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void removeCheckFromPackage(r.runId, r.packageKey, f.checkKey, removeConfirm.sharedNames.length)
                                        }
                                        disabled={removingKey === `${r.runId}:${f.checkKey}`}
                                        className="rounded border border-destructive/40 px-1.5 py-0.5 text-[10px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                                      >
                                        {removingKey === `${r.runId}:${f.checkKey}` ? "Removing…" : "Remove from all"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRemoveConfirm(null)}
                                        disabled={removingKey === `${r.runId}:${f.checkKey}`}
                                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent disabled:opacity-50"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {f.description && (
                                  <div className="mt-0.5 flex items-start justify-between gap-1.5">
                                    <p className="min-w-0 flex-1 text-[11px] text-foreground/80">
                                      <HighlightMatch text={f.description} term={findingsSearch} />
                                    </p>
                                    <CopyButton text={f.description} label="Copy description" />
                                  </div>
                                )}
                                {(() => {
                                  const rawError = extractRawGraphError(f.extractedProperties);
                                  return rawError ? (
                                    <div className="mt-1 flex items-start justify-between gap-1.5 rounded border border-red-600/30 bg-red-600/5 px-1.5 py-1">
                                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[10px] text-red-600 dark:text-red-400">
                                        <HighlightMatch text={rawError} term={findingsSearch} />
                                      </p>
                                      <CopyButton text={rawError} label="Copy raw error" />
                                    </div>
                                  ) : null;
                                })()}
                                {/* #379 — the real category, its literal evidence, the named
                                    permission and the guidance, rendered by the SAME component
                                    Simulator Studio's endpoint canvas uses, rather than a second
                                    UI for the same output. No action handlers are passed, and
                                    that is deliberate: this pane has neither an endpoint edit
                                    form nor an archive action, and the classifier's contract is
                                    that an action opens a reviewable form or a confirmed,
                                    reversible change — never applies one. Both of those really
                                    exist in Simulator Studio, so the link below is the honest
                                    path to acting on the verdict. */}
                                {f.classification && (
                                  <div className="mt-1">
                                    <SimulatorFailureClassification classification={f.classification} />
                                  </div>
                                )}
                                {/* Every finding row is one click from the check's real endpoint
                                    canvas — Part 1's deep link, no manual search. */}
                                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                                  <Link
                                    href={simulatorStudioCheckPath(f.checkKey)}
                                    className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                                    title={`Open "${f.checkKey}" in Simulator Studio's endpoint canvas`}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Test in Simulator Studio →
                                  </Link>
                                  {(f.classification?.action.kind === "edit_endpoint" ||
                                    f.classification?.action.kind === "retire_check") && (
                                    <span className="text-[10px] text-muted-foreground">
                                      Suggested: {f.classification.action.label} — in Simulator Studio
                                    </span>
                                  )}
                                </div>
                                {f.extractedProperties && Object.keys(f.extractedProperties).length > 0 && (
                                  <details className="mt-1 group" open={findingsSearch.length > 0}>
                                    <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-primary">
                                      extractedProperties
                                    </summary>
                                    <div className="mt-1 flex items-start justify-between gap-1.5">
                                      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 px-1.5 py-1 text-[10px] text-foreground/80">
                                        <HighlightMatch text={JSON.stringify(f.extractedProperties, null, 2)} term={findingsSearch} />
                                      </pre>
                                      <CopyButton text={JSON.stringify(f.extractedProperties, null, 2)} label="Copy extractedProperties JSON" />
                                    </div>
                                  </details>
                                )}
                              </li>
                            ))}
                          </ul>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
        {icon}
        <span className="flex-1">{title}</span>
        {action}
      </div>
      <div className="rounded border border-border bg-card/50 px-3 py-2">{children}</div>
    </div>
  );
}

// #371 addendum — copy-to-clipboard affordance for raw JSON/error detail in
// the expanded findings view. Native Clipboard API, no new dependency. Swaps
// to a checkmark for ~1.2s as visual confirmation the copy actually happened.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-primary"
      title={label}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
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

// artifacts/admin-panel/src/components/ActiveDirectoryCustomerPane.tsx
//
// Phase 3 of the Active Directory admin surface: the Customer Object detail
// pane, wired into ActiveDirectoryCenterCanvas.tsx's dispatch-by-selected-type
// mechanism for type "customer". Renders everything the platform holds about
// one customer — profile, owning MSP (link-out via the existing
// ad-select-object event, no duplicated MSP detail render), linked users with
// roles, Graph/SharePoint/write consent status, purchased services, and a
// summary of the most recent diagnostic runs — from the single
// GET /admin/active-directory/customer/:id payload. Read-only: no
// customer-level edit actions belong in this phase (Issue #63).

import { useEffect, useState } from "react";
import { Building2, UserCircle, ShieldCheck, Package, ActivitySquare, AlertTriangle } from "lucide-react";
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

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/active-directory/customer/${customerId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "This customer no longer exists." : "Failed to load customer detail.");
          return;
        }
        setDetail((await res.json()) as CustomerDetail);
      } catch {
        if (!cancelled) setError("Failed to load customer detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [customerId, fetchWithAuth]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading customer…</div>;
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p>{error ?? "Failed to load customer detail."}</p>
      </div>
    );
  }

  const { customer, owningMsp, users, userCount, graphConsent, sharePointConsent, writeConsent, purchasedServices, recentDiagnosticRuns } = detail;

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

      {/* Linked users */}
      <Section title={`Linked Users (${userCount})`} icon={<UserCircle className="h-4 w-4 text-muted-foreground" />}>
        {userCount === 0 ? (
          <p className="italic text-muted-foreground">0 users linked to this customer.</p>
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
          <p className="italic text-muted-foreground">No services purchased by this customer.</p>
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

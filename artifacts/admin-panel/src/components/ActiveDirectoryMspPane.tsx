// artifacts/admin-panel/src/components/ActiveDirectoryMspPane.tsx
//
// Phase 2 of the Active Directory admin surface: the MSP Object detail pane,
// wired into ActiveDirectoryCenterCanvas.tsx's dispatch-by-selected-type
// mechanism for type "msp". Renders everything the platform holds about one
// MSP — profile, subscription/plan + dunning state, entitlements, linked
// customers, linked users with roles, and platform agreement acceptance
// status — from the single GET /admin/active-directory/msp/:id payload.
// Read-only: no MSP-level edit actions belong in this phase (Issue #62).

import { useEffect, useState } from "react";
import { Building2, Users, UserCircle, ShieldCheck, FileText, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AD_SELECT_EVENT, type AdSelectedObject } from "./ActiveDirectoryTree";

interface MspDetailCustomer {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

interface MspDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface MspDetailSubscription {
  status: string;
  tierName: string;
  billingInterval: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  dunningState: string | null;
  paymentFailedAt: string | null;
  tenantCountSnapshot: number;
  contactEmail: string | null;
}

interface MspDetailEntitlements {
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
}

interface MspDetailAgreementAcceptance {
  agreementVersion: string;
  acceptedAt: string;
  checkboxConfirmed: boolean;
}

interface MspDetail {
  msp: {
    id: number;
    name: string;
    slug: string;
    domain: string | null;
    logoUrl: string | null;
    status: string;
    trialEndsAt: string | null;
    suspendedAt: string | null;
    offboardingState: string | null;
    isDirectBusiness: boolean;
    isTestbed: boolean;
    writeBackEnabled: boolean;
    automatedCustomerEmailsEnabled: boolean;
    createdAt: string;
  };
  subscription: MspDetailSubscription | null;
  entitlements: MspDetailEntitlements | null;
  customers: MspDetailCustomer[];
  customerCount: number;
  users: MspDetailUser[];
  userCount: number;
  agreementAcceptances: MspDetailAgreementAcceptance[];
  currentAgreementVersion: string | null;
  hasAcceptedCurrentAgreement: boolean;
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

export function ActiveDirectoryMspPane({ mspId }: { mspId: number }) {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<MspDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/active-directory/msp/${mspId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "This MSP no longer exists." : "Failed to load MSP detail.");
          return;
        }
        setDetail((await res.json()) as MspDetail);
      } catch {
        if (!cancelled) setError("Failed to load MSP detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mspId, fetchWithAuth]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading MSP…</div>;
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p>{error ?? "Failed to load MSP detail."}</p>
      </div>
    );
  }

  const { msp, subscription, entitlements, customers, customerCount, users, userCount, agreementAcceptances, hasAcceptedCurrentAgreement } =
    detail;

  return (
    <div className="h-full overflow-y-auto p-4 text-sm">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Building2 className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-foreground">{msp.name}</h2>
          <p className="text-xs text-muted-foreground">{msp.slug}</p>
        </div>
      </div>

      {/* Profile */}
      <Section title="Profile" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
        <Field label="Status" value={msp.status} />
        <Field label="Domain" value={msp.domain ?? "—"} />
        <Field label="Direct business (Shane's own MSP)" value={msp.isDirectBusiness ? "Yes" : "No"} />
        <Field label="Testbed" value={msp.isTestbed ? "Yes" : "No"} />
        <Field label="Write-back enabled" value={msp.writeBackEnabled ? "Yes" : "No"} />
        <Field label="Automated customer emails" value={msp.automatedCustomerEmailsEnabled ? "Enabled" : "Disabled"} />
        <Field label="Trial ends" value={formatDate(msp.trialEndsAt)} />
        {msp.status === "suspended" && <Field label="Suspended at" value={formatDate(msp.suspendedAt)} />}
        {msp.offboardingState && <Field label="Offboarding state" value={msp.offboardingState} />}
        <Field label="Created" value={formatDate(msp.createdAt)} />
      </Section>

      {/* Subscription + dunning */}
      <Section title="Subscription / Plan" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
        {!subscription ? (
          <p className="italic text-muted-foreground">No subscription on record for this MSP.</p>
        ) : (
          <>
            <Field label="Tier" value={subscription.tierName} />
            <Field label="Status" value={subscription.status} />
            <Field label="Billing interval" value={subscription.billingInterval} />
            <Field label="Current period" value={`${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`} />
            <Field
              label="Dunning state"
              value={subscription.dunningState ?? "None (fully operational)"}
              highlight={subscription.dunningState != null}
            />
            {subscription.paymentFailedAt && <Field label="Payment failed at" value={formatDate(subscription.paymentFailedAt)} />}
            <Field label="Tenant count snapshot" value={String(subscription.tenantCountSnapshot)} />
            <Field label="Contact email" value={subscription.contactEmail ?? "—"} />
          </>
        )}
      </Section>

      {/* Entitlements */}
      <Section title="Entitlements" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
        {!entitlements ? (
          <p className="italic text-muted-foreground">No entitlements — this MSP has no active subscription tier.</p>
        ) : (
          <>
            <Field label="Tenant allowance" value={entitlements.tenantAllowance != null ? String(entitlements.tenantAllowance) : "Unlimited"} />
            <Field label="AI credit allowance" value={entitlements.aiCreditAllowance != null ? `${entitlements.aiCreditAllowance}¢` : "—"} />
            <Field label="Overage rate" value={entitlements.overageRateCents != null ? `${entitlements.overageRateCents}¢/tenant` : "—"} />
            {Object.keys(entitlements.tierCapabilities).length === 0 ? (
              <p className="mt-1 italic text-muted-foreground">No tier capability overrides recorded (all default-available).</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(entitlements.tierCapabilities).map(([key, enabled]) => (
                  <span
                    key={key}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground line-through"
                    }`}
                  >
                    {key}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {/* Customers */}
      <Section title={`Customers (${customerCount})`} icon={<Users className="h-4 w-4 text-muted-foreground" />}>
        {customerCount === 0 ? (
          <p className="italic text-muted-foreground">0 customers linked to this MSP.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {customers.map((c) => (
              <li
                key={c.id}
                onClick={() => dispatchSelect({ type: "customer", id: c.id, label: c.name })}
                className="flex cursor-pointer items-center justify-between gap-2 py-1.5 hover:text-primary"
                title="View this customer (Active Directory Phase 3)"
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Users */}
      <Section title={`Users (${userCount})`} icon={<UserCircle className="h-4 w-4 text-muted-foreground" />}>
        {userCount === 0 ? (
          <p className="italic text-muted-foreground">0 users linked to this MSP.</p>
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

      {/* Platform agreements */}
      <Section title="Platform Agreements" icon={<FileText className="h-4 w-4 text-muted-foreground" />}>
        <Field
          label="Current version accepted"
          value={hasAcceptedCurrentAgreement ? "Yes" : "No"}
          highlight={!hasAcceptedCurrentAgreement}
        />
        {agreementAcceptances.length === 0 ? (
          <p className="mt-1 italic text-muted-foreground">No agreement acceptances recorded for this MSP.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {agreementAcceptances.map((a, i) => (
              <li key={`${a.agreementVersion}-${i}`} className="flex items-center justify-between gap-2">
                <span>Version {a.agreementVersion}</span>
                <span className="text-[10px] text-muted-foreground">{formatDate(a.acceptedAt)}</span>
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

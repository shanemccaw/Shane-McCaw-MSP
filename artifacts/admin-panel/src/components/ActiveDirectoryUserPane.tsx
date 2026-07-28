// artifacts/admin-panel/src/components/ActiveDirectoryUserPane.tsx
//
// Phase 6 of the Active Directory admin surface: the User Object detail
// pane, wired into ActiveDirectoryCenterCanvas.tsx's dispatch-by-selected-type
// mechanism for type "user" — replaces the Phase-1 stub for this type only.
// Reachable via search, via a Group member link (Phase 4), or via a linked-
// user link from the MSP/Customer panes (Phases 2/3). Renders everything the
// platform holds about one account — full profile, current role (msp_users
// .mspRole, NOT the base users.role which is only ["admin","client"]),
// MSP/customer linkage (link-out via ad-select-object), entitlements
// inherited from the linked MSP's subscription tier, active session
// summary, and MFA enrollment status — from the single
// GET /admin/active-directory/user/:id payload.
//
// Read-only per Issue #66: the RBAC/MSP-reassignment/entitlement-grant
// actions (Phase 7), credential reset/MFA reset/impersonation (Phase 8),
// and delete (Phase 9) are all rendered as visibly-disabled placeholder
// slots below, so those phases are additive to this layout rather than a
// redesign of it.

import { useEffect, useState } from "react";
import {
  UserCircle,
  Building2,
  ShieldCheck,
  MonitorSmartphone,
  KeyRound,
  AlertTriangle,
  Lock,
  UserCog,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AD_SELECT_EVENT, type AdSelectedObject } from "./ActiveDirectoryTree";

interface UserProfile {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  baseRole: string;
  createdAt: string;
}

interface UserLinkage {
  mspId: number | null;
  mspName: string | null;
  mspSlug: string | null;
  customerId: number | null;
  customerName: string | null;
  mspRole: string;
  isActive: boolean;
  mfaEnforced: boolean;
  department: string | null;
  jobTitle: string | null;
  lastLoginAt: string | null;
}

interface UserEntitlements {
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
}

interface UserSessionRow {
  sessionType: string;
  loginMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface UserSessionSummary {
  activeSessionCount: number;
  totalSessionCount: number;
  mostRecentSession: UserSessionRow | null;
}

interface UserMfaEnrollment {
  method: string;
  createdAt: string;
}

interface UserMfaStatus {
  enrolled: boolean;
  methods: UserMfaEnrollment[];
}

interface UserDetail {
  profile: UserProfile;
  linkage: UserLinkage | null;
  entitlements: UserEntitlements | null;
  sessions: UserSessionSummary;
  mfa: UserMfaStatus;
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
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function dispatchSelect(detail: AdSelectedObject) {
  window.dispatchEvent(new CustomEvent<AdSelectedObject>(AD_SELECT_EVENT, { detail }));
}

export function ActiveDirectoryUserPane({ userId }: { userId: number }) {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/active-directory/user/${userId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "This user no longer exists." : "Failed to load user detail.");
          return;
        }
        setDetail((await res.json()) as UserDetail);
      } catch {
        if (!cancelled) setError("Failed to load user detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, fetchWithAuth]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading user…</div>;
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p>{error ?? "Failed to load user detail."}</p>
      </div>
    );
  }

  const { profile, linkage, entitlements, sessions, mfa } = detail;

  return (
    <div className="h-full overflow-y-auto p-4 text-sm">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <UserCircle className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-foreground">{profile.name || profile.email}</h2>
          <p className="text-xs text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      {/* Profile */}
      <Section title="Profile" icon={<UserCircle className="h-4 w-4 text-muted-foreground" />}>
        <Field label="Email" value={profile.email} />
        <Field label="Name" value={profile.name ?? "—"} />
        <Field label="Company" value={profile.company ?? "—"} />
        <Field label="Phone" value={profile.phone ?? "—"} />
        <Field label="Base account role" value={profile.baseRole} />
        <Field label="Created" value={formatDate(profile.createdAt)} />
      </Section>

      {/* Role + MSP/customer linkage */}
      <Section title="Role & Linkage" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
        {!linkage ? (
          <p className="italic text-muted-foreground">No msp_users linkage record — this account holds no platform role.</p>
        ) : (
          <>
            <Field label="Current role" value={linkage.mspRole} />
            <Field label="Account status" value={linkage.isActive ? "Active" : "Inactive"} highlight={!linkage.isActive} />
            <Field label="Department" value={linkage.department ?? "—"} />
            <Field label="Job title" value={linkage.jobTitle ?? "—"} />
            <Field label="MFA enforced" value={linkage.mfaEnforced ? "Yes" : "No"} />
            <Field label="Last login" value={formatDateTime(linkage.lastLoginAt)} />
            <div className="mt-2 border-t border-border/60 pt-2">
              {linkage.mspId != null ? (
                <div
                  onClick={() => dispatchSelect({ type: "msp", id: linkage.mspId!, label: linkage.mspName ?? "MSP" })}
                  className="flex cursor-pointer items-center justify-between gap-2 hover:text-primary"
                  title="View this MSP"
                >
                  <span>{linkage.mspName ?? "—"}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{linkage.mspSlug ?? ""}</span>
                </div>
              ) : (
                <p className="italic text-muted-foreground">Not linked to an MSP.</p>
              )}
              {linkage.customerId != null && (
                <div
                  onClick={() => dispatchSelect({ type: "customer", id: linkage.customerId!, label: linkage.customerName ?? "Customer" })}
                  className="mt-1 flex cursor-pointer items-center justify-between gap-2 hover:text-primary"
                  title="View this customer"
                >
                  <span>{linkage.customerName ?? "—"}</span>
                </div>
              )}
            </div>
          </>
        )}
      </Section>

      {/* Entitlements (inherited from the linked MSP's subscription tier) */}
      <Section title="Entitlements" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
        {!entitlements ? (
          <p className="italic text-muted-foreground">
            No entitlements — this account's MSP has no active subscription tier, or the account is not linked to an MSP.
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] italic text-muted-foreground">Inherited from the linked MSP's subscription tier.</p>
            <Field label="Tenant allowance" value={entitlements.tenantAllowance != null ? String(entitlements.tenantAllowance) : "Unlimited"} />
            <Field label="AI credit allowance" value={entitlements.aiCreditAllowance != null ? `${entitlements.aiCreditAllowance}¢` : "—"} />
            <Field label="Overage rate" value={entitlements.overageRateCents != null ? `${entitlements.overageRateCents}¢/tenant` : "—"} />
            {Object.keys(entitlements.tierCapabilities).length > 0 && (
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

      {/* Active session summary */}
      <Section title="Sessions" icon={<MonitorSmartphone className="h-4 w-4 text-muted-foreground" />}>
        <Field label="Active sessions" value={String(sessions.activeSessionCount)} />
        <Field label="Total sessions on record" value={String(sessions.totalSessionCount)} />
        {!sessions.mostRecentSession ? (
          <p className="mt-1 italic text-muted-foreground">No sessions on record for this account.</p>
        ) : (
          <div className="mt-2 border-t border-border/60 pt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">Most recent session</p>
            <Field label="Type" value={sessions.mostRecentSession.sessionType} />
            <Field label="Login method" value={sessions.mostRecentSession.loginMethod} />
            <Field label="Last active" value={formatDateTime(sessions.mostRecentSession.lastActiveAt)} />
            <Field label="IP address" value={sessions.mostRecentSession.ipAddress ?? "—"} />
            <Field
              label="Status"
              value={sessions.mostRecentSession.revokedAt ? "Revoked" : new Date(sessions.mostRecentSession.expiresAt) > new Date() ? "Active" : "Expired"}
            />
          </div>
        )}
      </Section>

      {/* MFA enrollment status */}
      <Section title="MFA Enrollment" icon={<KeyRound className="h-4 w-4 text-muted-foreground" />}>
        {!mfa.enrolled ? (
          <p className="italic text-muted-foreground">Not enrolled in MFA.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {mfa.methods.map((m, i) => (
              <span key={`${m.method}-${i}`} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                {m.method}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* ── Placeholder action slots for Phases 7/8/9 — not built here ── */}

      <Section title="Account Control (Phase 7)" icon={<UserCog className="h-4 w-4 text-muted-foreground" />}>
        <p className="mb-2 text-[11px] italic text-muted-foreground">Coming soon — RBAC role edit, MSP/customer reassignment, entitlement grant/revoke.</p>
        <div className="flex flex-wrap gap-2">
          <PlaceholderButton label="Edit role" />
          <PlaceholderButton label="Reassign MSP/customer" />
          <PlaceholderButton label="Grant/revoke entitlement" />
        </div>
      </Section>

      <Section title="Credential Ops (Phase 8)" icon={<Lock className="h-4 w-4 text-muted-foreground" />}>
        <p className="mb-2 text-[11px] italic text-muted-foreground">Coming soon — forced credential reset, MFA reset, impersonation into /portal/.</p>
        <div className="flex flex-wrap gap-2">
          <PlaceholderButton label="Reset credentials" />
          <PlaceholderButton label="Reset MFA" />
          <PlaceholderButton label="Impersonate" />
        </div>
      </Section>

      <Section title="Delete (Phase 9)" icon={<Trash2 className="h-4 w-4 text-muted-foreground" />}>
        <p className="mb-2 text-[11px] italic text-muted-foreground">Coming soon — dev-environment-only cascading hard delete.</p>
        <PlaceholderButton label="Delete account" danger />
      </Section>
    </div>
  );
}

function PlaceholderButton({ label, danger }: { label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled
      title="Not yet built — see docs/build-plans/active-directory.md"
      className={`cursor-not-allowed rounded border px-2 py-1 text-[11px] opacity-50 ${
        danger ? "border-red-500/40 text-red-600 dark:text-red-400" : "border-border text-muted-foreground"
      }`}
    >
      {label}
    </button>
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

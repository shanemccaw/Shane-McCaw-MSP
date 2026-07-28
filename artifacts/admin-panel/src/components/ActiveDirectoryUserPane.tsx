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
// Phase 8 (Issue #68) filled the "Credential Ops" placeholder slot below with
// the three real, audited write actions — forced password reset, MFA reset,
// and impersonation launch into /portal/ — each posting to
// /admin/active-directory/user/:id/{force-password-reset,mfa-reset,impersonate}.
// The RBAC/MSP-reassignment/entitlement-grant actions (Phase 7) and delete
// (Phase 9) remain visibly-disabled placeholder slots, so those phases stay
// additive to this layout rather than a redesign of it.

import { useCallback, useEffect, useState } from "react";
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
  Loader2,
  LogIn,
  ShieldOff,
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

/** Which Phase 8 action is awaiting an explicit confirm, if any. */
type PendingAction =
  | { kind: "password" }
  | { kind: "mfa"; method?: string }
  | { kind: "impersonate" };

interface ActionOutcome {
  tone: "ok" | "error";
  message: string;
}

export function ActiveDirectoryUserPane({ userId }: { userId: number }) {
  const { fetchWithAuth } = useAuth();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const load = useCallback(async () => {
    const res = await fetchWithAuth(`/api/admin/active-directory/user/${userId}`);
    if (!res.ok) throw new Error(res.status === 404 ? "This user no longer exists." : "Failed to load user detail.");
    return (await res.json()) as UserDetail;
  }, [userId, fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    // Credential-op state is per-account — never carry a previous account's
    // confirm prompt or result over when the tree selection changes.
    setPending(null);
    setOutcome(null);

    (async () => {
      try {
        const next = await load();
        if (!cancelled) setDetail(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load user detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  // ── Phase 8 credential ops ─────────────────────────────────────────────────
  // Every action is a POST behind an explicit confirm step, and every one
  // refreshes the pane afterwards so the Sessions / MFA sections reflect what
  // just happened rather than pre-action state.
  async function runAction(action: PendingAction) {
    setBusy(true);
    setOutcome(null);
    try {
      const base = `/api/admin/active-directory/user/${userId}`;
      const path =
        action.kind === "password" ? "force-password-reset" : action.kind === "mfa" ? "mfa-reset" : "impersonate";
      const res = await fetchWithAuth(`${base}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.kind === "mfa" && action.method ? { method: action.method } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        setOutcome({ tone: "error", message: (data.error as string) ?? "The action failed. Nothing was changed." });
        return;
      }

      if (action.kind === "impersonate") {
        // Same launch convention as the shell's View-As switcher: hand the
        // single-use token to /portal/ in a new tab, where auth-context
        // exchanges it and the amber "Admin Preview Mode" banner marks the
        // session as an impersonation rather than a real login.
        const token = String(data.token ?? "");
        const targetSlug = data.targetSlug as string | null;
        const params = new URLSearchParams({ impersonation_token: token });
        if (targetSlug) params.set("target_slug", targetSlug);
        window.open(`${window.location.origin}/portal/?${params.toString()}`, "_blank", "noopener");
        setOutcome({
          tone: "ok",
          message: targetSlug
            ? `Impersonation session opened in a new tab as ${detail?.profile.email ?? "this account"} (expires in 30 minutes).`
            : `Impersonation session opened, but this account has no owning MSP — the new tab cannot auto-navigate to a tenant.`,
        });
        return;
      }

      if (action.kind === "password") {
        const revoked = Number(data.revokedSessionCount ?? 0);
        const flow = String(data.flow ?? "password_reset");
        setOutcome({
          tone: "ok",
          message:
            `${flow === "account_setup" ? "Account-setup" : "Password reset"} link emailed to ${String(data.emailedTo ?? "the account")}. ` +
            `${revoked} existing session${revoked === 1 ? "" : "s"} invalidated.`,
        });
      } else {
        const cleared = Array.isArray(data.clearedMethods) ? (data.clearedMethods as string[]) : [];
        setOutcome({
          tone: "ok",
          message: cleared.length
            ? `MFA reset — un-enrolled: ${cleared.join(", ")}.`
            : "MFA reset — this account had no enrolled methods to clear.",
        });
      }

      try {
        setDetail(await load());
      } catch {
        // A stale pane is not worth overwriting a successful action's result.
      }
    } catch {
      setOutcome({ tone: "error", message: "The action failed. Nothing was changed." });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

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

      <Section title="Credential Ops" icon={<Lock className="h-4 w-4 text-muted-foreground" />}>
        <p className="mb-2 text-[11px] italic text-muted-foreground">
          Security-sensitive. Every action here is audit-logged with your identity, this account, and a timestamp.
        </p>

        {outcome && (
          <div
            className={`mb-2 rounded border px-2 py-1.5 text-[11px] ${
              outcome.tone === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
            }`}
          >
            {outcome.message}
          </div>
        )}

        {pending ? (
          <ConfirmRow
            busy={busy}
            prompt={
              pending.kind === "password"
                ? `Force a password reset for ${profile.email}? This emails a reset link and immediately signs the account out of every device.`
                : pending.kind === "impersonate"
                  ? `Open a 30-minute impersonation session in /portal/ as ${profile.email}? The session is marked as admin preview, not a real login.`
                  : pending.method
                    ? `Un-enroll the "${pending.method}" MFA method for ${profile.email}? They will be emailed and must set it up again.`
                    : `Reset ALL MFA methods for ${profile.email}? Every enrolled method, pending challenge, and unused emergency bypass code is cleared.`
            }
            confirmLabel={pending.kind === "impersonate" ? "Impersonate" : "Confirm reset"}
            onConfirm={() => void runAction(pending)}
            onCancel={() => setPending(null)}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={<KeyRound className="h-3 w-3" />}
              label="Force password reset"
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setPending({ kind: "password" });
              }}
            />
            <ActionButton
              icon={<ShieldOff className="h-3 w-3" />}
              label={mfa.enrolled ? "Reset all MFA" : "Reset MFA"}
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setPending({ kind: "mfa" });
              }}
            />
            <ActionButton
              icon={<LogIn className="h-3 w-3" />}
              label="Impersonate in /portal/"
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setPending({ kind: "impersonate" });
              }}
            />
          </div>
        )}

        {!pending && mfa.enrolled && (
          <div className="mt-2 border-t border-border/60 pt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Un-enroll a single method</p>
            <div className="flex flex-wrap gap-1.5">
              {mfa.methods.map((m, i) => (
                <button
                  key={`unenroll-${m.method}-${i}`}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOutcome(null);
                    setPending({ kind: "mfa", method: m.method });
                  }}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-amber-500/60 hover:text-amber-600 disabled:opacity-50 dark:hover:text-amber-400"
                >
                  {m.method}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Delete (Phase 9)" icon={<Trash2 className="h-4 w-4 text-muted-foreground" />}>
        <p className="mb-2 text-[11px] italic text-muted-foreground">Coming soon — dev-environment-only cascading hard delete.</p>
        <PlaceholderButton label="Delete account" danger />
      </Section>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-amber-500/40 px-2 py-1 text-[11px] text-amber-700 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400"
    >
      {icon}
      {label}
    </button>
  );
}

function ConfirmRow({
  prompt,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  prompt: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-2">
      <p className="mb-2 text-[11px] text-amber-800 dark:text-amber-200">{prompt}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
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

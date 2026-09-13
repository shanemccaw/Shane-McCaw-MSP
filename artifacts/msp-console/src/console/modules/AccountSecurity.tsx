/**
 * Account Security — MSP Console module page (Git #2624, Feature #2562).
 * Mounts into the shell's `ScreenSlot` at `/ops/acctsec` (Operations, MSP-wide
 * — `console/nav.ts`), wiring the real six-route surface from `msp-settings.ts`
 * documented in full at
 * `docs/msp-console/account-security-msp-console-contract-pack.md`
 * (`Design/MSP_Console/design_handoff_msp_console/Account Security.dc.html`,
 * README screen 39): password reset email, temporary password, MFA clear,
 * MFA enforcement, suspend/reactivate, and session revoke against another
 * account.
 *
 * **The target-role ceiling is real and server-side, not a UI-only guard.**
 * The design's own copy — "The target-role ceiling is enforced by this
 * screen only... the server checks the caller's tier, never the target's" —
 * described the state before Git #3032 landed (commit `fcb16b522`,
 * 2026-09-06). All six of these routes now really 403 a caller acting on an
 * equal-or-higher-privileged target (the session-revoke route was the one
 * #3032 missed; closed as #3896 in this same build). This page does not
 * recompute its own role-order guess to fake that protection — it sends the
 * action and renders whatever the server actually decides, including a real
 * 403 when it happens. The role-pill permission simulator the design carries
 * for its own review purposes is not reproduced here; it has nothing left to
 * simulate.
 *
 * Honest departures from the design's fixture-driven mock are documented in
 * full in `@/api/account-security-api`'s header. No fixture module, no
 * fabricated row — every value here comes from a real server response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  AccountSecurityApiError,
  useAccountAuditTrail,
  useAccountRoster,
  useMspSessions,
  useResetAccountMfa,
  useRevokeAccountSessions,
  useSendAccountPasswordReset,
  useSetAccountMfaEnforcement,
  useSetAccountStatus,
  useSetAccountTempPassword,
  type AccountSecurityRole,
  type AccountSecurityUser,
} from "@/api/account-security-api";

type Tone = { strong: string; text?: string; tint: string; border: string };

const STAFF_TIERS: ReadonlySet<AccountSecurityRole> = new Set(["PlatformAdmin", "MSPAdmin", "MSPOperator", "ServiceAccount"]);

const ROLE_TONE: Record<AccountSecurityRole, Tone> = {
  PlatformAdmin: signal.critical,
  MSPAdmin: signal.warning,
  MSPOperator: signal.info,
  ServiceAccount: signal.info,
  CustomerUser: signal.neutral,
  Free: signal.neutral,
  Assessment: signal.neutral,
};

/** Notes shown at the bottom of the page — real, current documentation of
 * what this surface can and cannot do, kept honest against the routes it
 * calls (see the file header for why note 2 differs from the design's copy). */
const NOTES: ReadonlyArray<{ dot: string; text: string }> = [
  {
    dot: signal.critical.strong,
    text: "The five credential routes and the session revoke are the entire surface — one file, six routes, shared verbatim with the MSP Staff roster feature. A fix to one changes both.",
  },
  {
    dot: signal.ok.strong,
    text: "A target-role ceiling is enforced server-side on every one of these six routes (Git #3032, #3896): a caller cannot act on a target at an equal or higher tier. The server returns a real 403 — nothing here is a UI-only guard.",
  },
  {
    dot: signal.critical.strong,
    text: "Nothing here is scoped by tenant. No route resolves a managed-tenant customer's account for any of these actions — only accounts carrying this MSP's own mspId are reachable.",
  },
  {
    dot: signal.warning.strong,
    text: "A row that also carries a real tenant id is a customer user caught by a legacy id from the pre-merge users table, not one of this MSP's own staff — check each row's scope before acting on it.",
  },
  {
    dot: signal.warning.strong,
    text: "The temporary password is handed to you, not the account, and nothing forces a change at next sign-in — the response's requireChange flag is advisory only. Prefer the emailed reset link, which never exposes a credential.",
  },
  {
    dot: signal.warning.strong,
    text: "MFA reset is a hard delete across four tables with no undo, and its notice email is inline HTML rather than the platform's templated mail.",
  },
  {
    dot: signal.info.strong,
    text: "Every action here writes a real audit row naming the actor, the target and what changed — including the enforcement toggle, which logs even when its update matched zero rows.",
  },
  {
    dot: signal.neutral.strong,
    text: "Suspension is a boolean. No reason, no expiry, no scheduled reactivation, and no separate suspended state to distinguish it from an account that was never activated.",
  },
  {
    dot: signal.neutral.strong,
    text: "Impersonation exists elsewhere and is deliberately out of scope here — it is a shared/bypass credential mechanism, a different trust model from performing one named, audited action.",
  },
];

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatePanel({ icon, tone, title, body, wire }: { icon: IconName; tone: Tone; title: string; body: string; wire: string }) {
  return (
    <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 22, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 13, background: tone.tint, border: `1px solid ${tone.border}` }}>
        <Icon name={icon} size={20} color={tone.text ?? tone.strong} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color: text.title }}>{title}</span>
      <span style={{ fontSize: 13, color: text.muted, textWrap: "pretty", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontFamily: "Menlo, monospace", fontSize: 10.5, color: text.faint, wordBreak: "break-all" }}>{wire}</span>
    </div>
  );
}

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
      height: 20, padding: "0 9px", borderRadius: 999, background: tone.tint, border: `1px solid ${tone.border}`,
      fontSize: 10.5, fontWeight: 600, color: tone.text ?? tone.strong,
    }}>
      {label}
    </span>
  );
}

interface LastResult { code: string; text: string; tone: Tone }

export function AccountSecurity() {
  const rosterQuery = useAccountRoster();
  const sessionsQuery = useMspSessions();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const auditQuery = useAccountAuditTrail(selectedUserId);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const passwordResetMutation = useSendAccountPasswordReset();
  const tempPasswordMutation = useSetAccountTempPassword();
  const resetMfaMutation = useResetAccountMfa();
  const mfaEnforcementMutation = useSetAccountMfaEnforcement();
  const statusMutation = useSetAccountStatus();
  const revokeSessionsMutation = useRevokeAccountSessions();

  const roster = rosterQuery.data ?? [];
  const selected = selectedUserId != null ? roster.find((u) => u.id === selectedUserId) ?? null : null;

  const selectUser = (userId: number) => {
    setSelectedUserId(userId);
    setLastResult(null);
    setTempPassword(null);
  };

  const onError = (err: unknown) => {
    const apiErr = err instanceof AccountSecurityApiError ? err : null;
    const tone = apiErr?.status === 403 ? signal.critical : signal.warning;
    setLastResult({ code: apiErr ? String(apiErr.status) : "error", text: apiErr?.message ?? "Request failed", tone });
    toast.error(apiErr?.message ?? "Request failed");
  };

  const doResetPassword = () => {
    if (!selected) return;
    passwordResetMutation.mutate(selected.id, {
      onSuccess: (data) => {
        setLastResult({ code: "200", text: data.message, tone: signal.ok });
        toast.success(data.message);
      },
      onError,
    });
  };

  const doTempPassword = () => {
    if (!selected) return;
    tempPasswordMutation.mutate(selected.id, {
      onSuccess: (data) => {
        setTempPassword(data.tempPassword);
        setLastResult(null);
      },
      onError,
    });
  };

  const doResetMfa = () => {
    if (!selected) return;
    resetMfaMutation.mutate(selected.id, {
      onSuccess: (data) => {
        setLastResult({ code: "200", text: data.message, tone: signal.warning });
        toast.success(data.message);
      },
      onError,
    });
  };

  const doToggleEnforcement = () => {
    if (!selected) return;
    mfaEnforcementMutation.mutate(
      { userId: selected.id, enforced: !selected.mfaEnforced },
      {
        onSuccess: (data) => {
          setLastResult({ code: "200", text: `mfa_enforced set to ${data.enforced}.`, tone: signal.info });
          toast.success(data.enforced ? "MFA is now required on this account." : "MFA enforcement turned off for this account.");
        },
        onError,
      },
    );
  };

  const doToggleStatus = () => {
    if (!selected) return;
    statusMutation.mutate(
      { userId: selected.id, isActive: !selected.isActive },
      {
        onSuccess: (data) => {
          setLastResult({ code: "200", text: data.isActive ? "Reactivated." : "Suspended.", tone: signal.warning });
          toast.success(data.isActive ? "Account reactivated." : "Account suspended.");
        },
        onError,
      },
    );
  };

  const doRevokeSessions = () => {
    if (!selected) return;
    revokeSessionsMutation.mutate(selected.id, {
      onSuccess: (data) => {
        setLastResult({ code: "200", text: `revokedCount ${data.revokedCount}.`, tone: data.revokedCount > 0 ? signal.ok : signal.neutral });
        toast.success(`Revoked ${data.revokedCount} session${data.revokedCount === 1 ? "" : "s"}.`);
      },
      onError,
    });
  };

  const rosterRows = useMemo(() => roster.map((u) => {
    const tone = ROLE_TONE[u.mspRole ?? "CustomerUser"];
    const isStaff = u.mspRole != null && STAFF_TIERS.has(u.mspRole);
    const scope = u.tenantId != null ? `id ${u.id} · tenantId ${u.tenantId}` : `id ${u.id} · no tenant`;
    const flag = !isStaff && u.tenantId != null
      ? "Real customer account — reachable only via a legacy mspId shared with MSP staff (pre-merge users table)."
      : u.mspRole === "PlatformAdmin"
        ? "Owns the platform; reachable here only because this account also carries this MSP's own id."
        : null;
    return { user: u, tone, scope, flag };
  }), [roster]);

  const selectedSessions = useMemo(
    () => (selected ? (sessionsQuery.data ?? []).filter((s) => s.userId === selected.id) : []),
    [sessionsQuery.data, selected],
  );

  const anyMutating = passwordResetMutation.isPending || tempPasswordMutation.isPending || resetMfaMutation.isPending
    || mfaEnforcementMutation.isPending || statusMutation.isPending;

  if (rosterQuery.isError) {
    const status = rosterQuery.error instanceof AccountSecurityApiError ? rosterQuery.error.status : null;
    return (
      <StatePanel
        icon={status === 403 ? "shield-alert" : "triangle-alert"}
        tone={status === 403 ? signal.critical : signal.warning}
        title={status === 403 ? "MSPAdmin or above is required" : "The account roster could not be loaded"}
        body={rosterQuery.error.message}
        wire={`GET /api/msp/settings/users · ${status ?? "error"}`}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }} />
        <Pill label="MSPAdmin or above" tone={signal.warning} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start", minWidth: 0 }}>

        {/* Roster */}
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title }}>Accounts this surface can reach</span>
            <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>Resolved by the mspId on the account and nothing else. No role filter, no tenant filter.</span>
          </div>

          {rosterQuery.isLoading ? (
            <div style={{ fontSize: 11.5, color: text.muted }}>Loading the reachable roster…</div>
          ) : rosterRows.length === 0 ? (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>No accounts carry this MSP's id</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              {rosterRows.map(({ user, tone, scope, flag }) => {
                const on = user.id === selectedUserId;
                return (
                  <button
                    key={user.id}
                    onClick={() => selectUser(user.id)}
                    style={{
                      display: "flex", flexDirection: "column", gap: 5, textAlign: "left",
                      border: `1px solid ${on ? border.hover : border.soft}`, borderRadius: 10,
                      background: on ? "rgba(96,165,250,.09)" : "rgba(2,6,23,.4)", padding: 11, cursor: "pointer",
                      font: "inherit", minWidth: 0,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", width: "100%" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong, flex: 1, minWidth: 120, wordBreak: "break-all" }}>{user.email}</span>
                      <Pill label={user.mspRole ?? "unknown"} tone={tone} />
                    </span>
                    <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>{scope}</span>
                    {flag && <span style={{ fontSize: 10.5, color: signal.warning.strong, textWrap: "pretty" }}>{flag}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions on the selected account */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {selected ? (
            <>
              <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 180, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: text.title, wordBreak: "break-all" }}>{selected.email}</span>
                    <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                      id {selected.id} · {selected.mspRole ?? "unknown"} · {selected.mfaEnforced ? "MFA required" : "MFA not required"}
                    </span>
                  </span>
                  <Pill label={selected.isActive ? "Active" : "Suspended"} tone={selected.isActive ? signal.ok : signal.warning} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                  {[
                    { name: "Send a password reset email", detail: "They set their own password from a one-hour link. The only action here that never puts a credential in your hands.", route: `POST /msp/settings/users/${selected.id}/reset-password`, btnLabel: "Send link", run: doResetPassword, pending: passwordResetMutation.isPending, danger: false },
                    { name: "Set a temporary password", detail: "Generated, hashed and written directly to their account. Returned to you in plaintext, once.", route: `POST /msp/settings/users/${selected.id}/temp-password`, btnLabel: "Generate", run: doTempPassword, pending: tempPasswordMutation.isPending, danger: true },
                    { name: "Clear their MFA", detail: "Deletes every enrollment, challenge and passkey credential so they can start again.", route: `POST /msp/settings/users/${selected.id}/reset-mfa`, btnLabel: "Clear MFA", run: doResetMfa, pending: resetMfaMutation.isPending, danger: true },
                    { name: "Require MFA on this account", detail: selected.mfaEnforced ? "On. Sign-in is gated until a method is enrolled." : "Off. They can sign in with a password alone outside production.", route: `PATCH /msp/settings/users/${selected.id}/mfa-enforcement`, btnLabel: selected.mfaEnforced ? "Turn off" : "Turn on", run: doToggleEnforcement, pending: mfaEnforcementMutation.isPending, danger: false },
                    { name: selected.isActive ? "Suspend the account" : "Reactivate the account", detail: selected.isActive ? "A boolean flag. No reason field, no expiry, no scheduled restore." : "Currently suspended. Reactivating restores access immediately.", route: `PATCH /msp/settings/users/${selected.id}/status`, btnLabel: selected.isActive ? "Suspend" : "Reactivate", run: doToggleStatus, pending: statusMutation.isPending, danger: selected.isActive },
                  ].map((a) => (
                    <div key={a.route} style={{ border: `1px solid ${a.danger ? signal.critical.border : border.soft}`, borderRadius: 10, background: "rgba(2,6,23,.4)", padding: 13, display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170, flex: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>{a.name}</span>
                          <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{a.detail}</span>
                        </span>
                        <button
                          onClick={a.run}
                          disabled={anyMutating}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
                            height: 30, padding: "0 12px", borderRadius: 6,
                            border: `1px solid ${a.danger ? signal.critical.border : "#2563eb"}`,
                            background: anyMutating ? "rgba(148,163,184,.06)" : a.danger ? signal.critical.tint : "#2563eb",
                            color: anyMutating ? text.faint : a.danger ? signal.critical.strong : "#fff",
                            fontSize: 12, fontWeight: 600, cursor: anyMutating ? "not-allowed" : "pointer", font: "inherit",
                          }}
                        >
                          {a.pending ? "Working…" : a.btnLabel}
                        </button>
                      </div>
                      <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.faint, wordBreak: "break-all" }}>{a.route}</span>
                    </div>
                  ))}
                </div>

                {tempPassword && (
                  <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 10, background: signal.warning.tint, padding: 13, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: signal.warning.strong }}>Shown once — the response is the only copy</span>
                    <span style={{ fontSize: 17, fontFamily: "Menlo, monospace", color: text.title, wordBreak: "break-all", letterSpacing: ".02em" }}>{tempPassword}</span>
                    <span style={{ fontSize: 11, color: text.secondary, textWrap: "pretty" }}>
                      Written straight to the password hash, no email sent. You relay it out of band. Nothing enforces a change at next sign-in.
                    </span>
                  </div>
                )}

                {lastResult && (
                  <div style={{ border: `1px solid ${lastResult.tone.border}`, borderRadius: 10, background: lastResult.tone.tint, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: lastResult.tone.text ?? lastResult.tone.strong }}>{lastResult.code}</span>
                    <span style={{ fontSize: 12, color: text.secondary, textWrap: "pretty" }}>{lastResult.text}</span>
                  </div>
                )}
              </div>

              {/* Sessions */}
              <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 170, flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>Their sessions</span>
                    <span style={{ fontSize: 11, color: text.label, textWrap: "pretty" }}>
                      {selectedSessions.length > 0 ? `${selectedSessions.length} live session${selectedSessions.length === 1 ? "" : "s"} · user agent and IP as captured at issue` : "Nothing live"}
                    </span>
                  </span>
                  <button
                    onClick={doRevokeSessions}
                    disabled={revokeSessionsMutation.isPending}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
                      height: 30, padding: "0 12px", borderRadius: 6, border: `1px solid ${signal.critical.border}`,
                      background: signal.critical.tint, color: signal.critical.strong, fontSize: 12, fontWeight: 600,
                      cursor: revokeSessionsMutation.isPending ? "not-allowed" : "pointer", font: "inherit",
                    }}
                  >
                    {revokeSessionsMutation.isPending ? "Working…" : "Revoke all"}
                  </button>
                </div>
                {selectedSessions.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
                    {selectedSessions.map((s) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap", borderBottom: `1px solid ${border.faint}`, paddingBottom: 7 }}>
                        <span style={{ fontSize: 11.5, color: text.secondary, flex: 1, minWidth: 140, textWrap: "pretty" }}>{s.userAgent ?? "Unknown device"} · {s.ipAddress ?? "unknown IP"}</span>
                        <span style={{ fontSize: 10.5, fontFamily: "Menlo, monospace", color: text.label }}>{formatWhen(s.issuedAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
                    No live sessions. The revoke call still succeeds and returns revokedCount 0 — the count is the only feedback, so a wrong target reads identically to one who was already signed out.
                  </span>
                )}
                <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty", borderTop: `1px solid ${border.soft}`, paddingTop: 10 }}>
                  Revoke closes every session row and cascades the refresh tokens, so their next token refresh fails. A userId from another MSP 404s without touching anyone's sessions.
                </span>
              </div>
            </>
          ) : (
            <div style={{ border: "1px dashed rgba(148,163,184,.25)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", textAlign: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: text.secondary }}>Pick an account</span>
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", maxWidth: 340 }}>Every action here is irreversible and audited against your name. Nothing is pre-selected on purpose.</span>
            </div>
          )}

          {/* Audit trail */}
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.strong }}>Audit trail</span>
            {!selected ? (
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>Pick an account to see its real audit history.</span>
            ) : auditQuery.isLoading ? (
              <span style={{ fontSize: 11.5, color: text.muted }}>Loading…</span>
            ) : (auditQuery.data ?? []).length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
                {(auditQuery.data ?? []).map((l) => (
                  <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 3, borderLeft: `2px solid ${signal.info.strong}`, paddingLeft: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontFamily: "Menlo, monospace", color: signal.info.strong, wordBreak: "break-all" }}>{l.action}</span>
                    <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>
                      {formatWhen(l.createdAt)} · {l.actorEmail ?? l.actorRole ?? "unknown actor"}{l.outcome !== "success" ? ` · ${l.outcome}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty" }}>
                No audit history yet for this account. Every action here writes a real row naming you, the target and what changed — including the enforcement toggle when it silently matched no rows.
              </span>
            )}
          </div>

          {/* Notes */}
          <div style={{ border: `1px solid ${border.card}`, borderRadius: 14, background: surface.card, padding: 16, display: "flex", flexDirection: "column", gap: 11, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: text.strong }}>What this surface can and cannot do</span>
            {NOTES.map((n) => (
              <div key={n.text} style={{ display: "flex", gap: 9, alignItems: "flex-start", minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: n.dot, marginTop: 6, flex: "none" }} />
                <span style={{ fontSize: 11.5, color: text.secondary, lineHeight: 1.55, textWrap: "pretty", minWidth: 0 }}>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

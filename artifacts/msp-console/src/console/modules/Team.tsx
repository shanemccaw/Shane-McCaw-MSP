/**
 * Team — MSP Console module page (Git #2640, Feature #2567). Mounts into the
 * shell's `ScreenSlot` at `/tenants/:id/team`
 * (`Design/MSP_Console/design_handoff_msp_console/Team.dc.html`, README
 * screen 17), wiring the real, previously-orphaned operator backend
 * documented in full at
 * `docs/msp-console/team-management-and-invitations-msp-console-contract-pack.md`.
 *
 * Real, honest departures from the design's fixture-driven mock (see
 * `@/api/team-api` for the full list, and the contract pack sections cited
 * there):
 *   - No "role" facet exists on the wire — the design's "PERSON / ROLE"
 *     column split renders `jobTitle` / `department` instead, and every
 *     invited teammate is written with the flat `CustomerUser` tier. There is
 *     no invite-time role picker to wire, because there is no invite-time
 *     role parameter on the real route.
 *   - The roster has no server-side sort, filter or pagination — every row
 *     the backend returns renders, in whatever order it comes back.
 *   - The design's per-row "locked" state and MFA method are hardcoded
 *     fixture fields; here they are `isLockedOut` (derived server-side from
 *     `lockedUntil`) and `mfaStatus` (one of `TOTP | FIDO2 | SMS | Disabled`).
 *   - "Managed by their own admin later" (the invite drawer's copy, carried
 *     over verbatim) reflects a real gap: this router has no route to grant
 *     `canManageTeam` at invite time, same open question the Portal-side
 *     contract pack already flagged.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import {
  TeamApiError,
  useGenerateEmergencyBypass,
  useInviteTeammate,
  useResetMfa,
  useSendPasswordReset,
  useSetMemberStatus,
  useSetMfaEnforcement,
  useSetTempPassword,
  useSignOutSessions,
  useTeamRoster,
  useUnlockMember,
  type MfaStatus,
  type TeamMember,
} from "@/api/team-api";

type Tone = { strong: string; text?: string; tint: string; border: string };

const MFA_TONE: Record<MfaStatus, { tone: Tone; icon: IconName; label: string }> = {
  FIDO2: { tone: signal.ok, icon: "key-round", label: "passkey" },
  TOTP: { tone: signal.ok, icon: "smartphone", label: "app code" },
  SMS: { tone: signal.warning, icon: "message-square", label: "text message" },
  Disabled: { tone: signal.critical, icon: "shield-off", label: "none" },
};

function initialsFor(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join("").slice(0, 2).toUpperCase() || "?";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatePanel({
  icon, tone, title, body, wire,
}: {
  icon: IconName;
  tone: Tone;
  title: string;
  body: string;
  wire: string;
}) {
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
      display: "inline-flex", justifySelf: "start", padding: "3px 10px", borderRadius: 999,
      background: tone.tint, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 600, color: tone.text ?? tone.strong, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

export function Team({ customerId, customerName }: { customerId: number; customerName?: string }) {
  const rosterQuery = useTeamRoster(customerId);
  const inviteMutation = useInviteTeammate(customerId);
  const statusMutation = useSetMemberStatus(customerId);
  const mfaEnforcementMutation = useSetMfaEnforcement(customerId);
  const unlockMutation = useUnlockMember(customerId);
  const passwordResetMutation = useSendPasswordReset();
  const tempPasswordMutation = useSetTempPassword();
  const resetMfaMutation = useResetMfa(customerId);
  const signOutMutation = useSignOutSessions(customerId);
  const emergencyBypassMutation = useGenerateEmergencyBypass();

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inEmail, setInEmail] = useState("");
  const [inName, setInName] = useState("");
  const [inDept, setInDept] = useState("");
  const [inTitle, setInTitle] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string; note: string } | null>(null);

  const rows = rosterQuery.data ?? [];
  const selected = selectedUserId != null ? rows.find((r) => r.userId === selectedUserId) ?? null : null;

  const noMfa = rows.filter((r) => r.mfaStatus === "Disabled").length;
  const lockedOut = rows.filter((r) => r.isLockedOut).length;
  const suspended = rows.filter((r) => !r.isActive).length;

  const emailTaken = rows.some((r) => r.email.toLowerCase() === inEmail.trim().toLowerCase());
  const canInvite = inEmail.trim().includes("@") && !emailTaken;

  const closeDrawer = () => setSelectedUserId(null);
  const closeInvite = () => { setInviteOpen(false); setInEmail(""); setInName(""); setInDept(""); setInTitle(""); };

  const submitInvite = () => {
    if (!canInvite) return;
    inviteMutation.mutate(
      { email: inEmail.trim(), name: inName.trim() || undefined, department: inDept.trim() || undefined, jobTitle: inTitle.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Invited ${inEmail.trim()}. They'll get a setup link that works for 72 hours.`);
          closeInvite();
        },
        onError: (err) => toast.error(err instanceof TeamApiError ? err.message : "Failed to send the invitation."),
      },
    );
  };

  if (rosterQuery.isError) {
    const status = rosterQuery.error instanceof TeamApiError ? rosterQuery.error.status : null;
    return (
      <StatePanel
        icon={status === 403 ? "shield-alert" : "triangle-alert"}
        tone={status === 403 ? signal.critical : signal.warning}
        title={status === 403 ? "Access to this customer is not permitted" : "Team roster could not be loaded"}
        body={rosterQuery.error.message}
        wire={`GET /api/msp/customers/${customerId}/team · ${status ?? "error"}`}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
        {[
          { label: rows.length === 1 ? "person" : "people", value: rows.length, icon: "users" as IconName, tone: signal.info },
          { label: "without a second factor", value: noMfa, icon: "shield-off" as IconName, tone: noMfa ? signal.critical : signal.ok },
          { label: "locked out", value: lockedOut, icon: "lock" as IconName, tone: lockedOut ? signal.warning : signal.neutral },
          { label: "suspended", value: suspended, icon: "user-minus" as IconName, tone: signal.neutral },
        ].map((c) => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px", borderRadius: 9, border: `1px solid ${c.tone.border}`, background: c.tone.tint, minWidth: 0 }}>
            <Icon name={c.icon} size={13} color={c.tone.strong} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text.strong }}>{c.value}</span>
            <span style={{ fontSize: 11.5, color: text.muted, whiteSpace: "nowrap" }}>{c.label}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setInviteOpen(true)}
          style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", borderRadius: 8, border: `1px solid ${signal.info.border}`, background: "#2563eb", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <Icon name="user-plus" size={14} />
          Invite someone
        </button>
      </div>

      {rosterQuery.isLoading ? (
        <div style={{ fontSize: 11.5, color: text.muted }}>Loading this tenant's team roster…</div>
      ) : rows.length === 0 ? (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={{ width: 42, height: 42, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="users" size={20} color={signal.info.strong} />
          </span>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: text.title }}>No one has a portal account yet</span>
          <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 440, textWrap: "pretty" }}>
            Invite the first teammate for this customer to get them a login.
          </span>
        </div>
      ) : (
        <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, overflowX: "auto" }}>
          <div style={{ minWidth: 1040 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 1.2fr 1.1fr 1.2fr 1.1fr 90px", gap: 12, padding: "11px 16px", borderBottom: `1px solid ${border.soft}`, fontSize: 10, fontWeight: 700, letterSpacing: ".1em", color: text.label }}>
              <span>PERSON</span><span>ROLE</span><span>SECOND FACTOR</span><span>ACCOUNT</span><span>LAST SIGN-IN</span><span>SESSIONS</span><span style={{ textAlign: "right" }}>MANAGE</span>
            </div>
            {rows.map((r) => {
              const mfa = MFA_TONE[r.mfaStatus];
              const stateTone = r.isLockedOut ? signal.warning : r.isActive ? signal.ok : signal.neutral;
              const stateLabel = r.isLockedOut ? "locked out" : r.isActive ? "active" : "suspended";
              const displayName = r.name ?? r.email;
              return (
                <div key={r.userId} style={{ display: "grid", gridTemplateColumns: "2fr 1.3fr 1.2fr 1.1fr 1.2fr 1.1fr 90px", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${border.faint}`, opacity: r.isActive ? 1 : 0.7 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                    <span style={{ width: 32, height: 32, flex: "0 0 32px", borderRadius: 9, background: "rgba(96,165,250,.14)", border: "1px solid rgba(96,165,250,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#93c5fd" }}>
                      {initialsFor(displayName)}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: text.title, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
                      <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.email}</span>
                    </span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: text.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.jobTitle || "—"}</span>
                    <span style={{ fontSize: 11, color: text.label, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.department || "—"}</span>
                  </span>
                  <span style={{ display: "inline-flex", justifySelf: "start", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: mfa.tone.tint, border: `1px solid ${mfa.tone.border}`, fontSize: 11, fontWeight: 600, color: mfa.tone.text ?? mfa.tone.strong, whiteSpace: "nowrap" }}>
                    <Icon name={mfa.icon} size={11} />
                    {mfa.label}
                  </span>
                  <Pill label={stateLabel} tone={stateTone} />
                  <span style={{ fontSize: 12, color: r.lastLoginAt ? text.muted : "#fcd34d", whiteSpace: "nowrap" }}>{formatWhen(r.lastLoginAt)}</span>
                  <span style={{ fontSize: 12, color: r.activeSessionsCount > 0 ? text.secondary : text.label, whiteSpace: "nowrap" }}>
                    {r.activeSessionsCount === 0 ? "none" : r.activeSessionsCount === 1 ? "1 signed in" : `${r.activeSessionsCount} signed in`}
                  </span>
                  <button
                    onClick={() => setSelectedUserId(r.userId)}
                    style={{ justifySelf: "end", height: 30, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Manage
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <ManageDrawer
          member={selected}
          onClose={closeDrawer}
          statusMutation={statusMutation}
          mfaEnforcementMutation={mfaEnforcementMutation}
          unlockMutation={unlockMutation}
          passwordResetMutation={passwordResetMutation}
          tempPasswordMutation={tempPasswordMutation}
          resetMfaMutation={resetMfaMutation}
          signOutMutation={signOutMutation}
          emergencyBypassMutation={emergencyBypassMutation}
          secret={secret}
          onSecret={setSecret}
        />
      )}

      {inviteOpen && (
        <InviteDrawer
          customerName={customerName}
          inEmail={inEmail} onEmail={setInEmail}
          inName={inName} onName={setInName}
          inTitle={inTitle} onTitle={setInTitle}
          inDept={inDept} onDept={setInDept}
          emailTaken={emailTaken}
          canInvite={canInvite}
          submitting={inviteMutation.isPending}
          onClose={closeInvite}
          onSubmit={submitInvite}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          Who reports to whom can be set on the customer's own portal but not from here, and the roster comes back
          unsorted and unpaged.
        </span>
      </div>
    </div>
  );
}

// ── Manage drawer ─────────────────────────────────────────────────────────────

type MutationLike<TVars> = { mutate: (vars: TVars, opts?: { onSuccess?: (data: any) => void; onError?: (err: unknown) => void }) => void; isPending: boolean };

function ManageDrawer({
  member, onClose, statusMutation, mfaEnforcementMutation, unlockMutation,
  passwordResetMutation, tempPasswordMutation, resetMfaMutation, signOutMutation, emergencyBypassMutation,
  secret, onSecret,
}: {
  member: TeamMember;
  onClose: () => void;
  statusMutation: MutationLike<{ userId: number; isActive: boolean }>;
  mfaEnforcementMutation: MutationLike<{ userId: number; enforced: boolean }>;
  unlockMutation: MutationLike<number>;
  passwordResetMutation: MutationLike<number>;
  tempPasswordMutation: MutationLike<number>;
  resetMfaMutation: MutationLike<number>;
  signOutMutation: MutationLike<number>;
  emergencyBypassMutation: MutationLike<number>;
  secret: { label: string; value: string; note: string } | null;
  onSecret: (s: { label: string; value: string; note: string } | null) => void;
}) {
  const displayName = member.name ?? member.email;
  const mfa = MFA_TONE[member.mfaStatus];

  const fail = (err: unknown, fallback: string) => toast.error(err instanceof TeamApiError ? err.message : fallback);

  const facts = [
    { label: "ACCOUNT", value: member.isLockedOut ? "locked out" : member.isActive ? "active" : "suspended", color: member.isLockedOut ? "#fcd34d" : member.isActive ? signal.ok.text : text.muted },
    { label: "SECOND FACTOR", value: mfa.label, color: member.mfaStatus === "Disabled" ? signal.critical.text : signal.ok.text },
    { label: "LAST SIGN-IN", value: formatWhen(member.lastLoginAt), color: member.lastLoginAt ? text.secondary : "#fcd34d" },
    { label: "SIGNED IN NOW", value: member.activeSessionsCount === 0 ? "nowhere" : `${member.activeSessionsCount} places`, color: text.secondary },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px,95%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <span style={{ width: 38, height: 38, flex: "0 0 38px", borderRadius: 11, background: "rgba(96,165,250,.14)", border: "1px solid rgba(96,165,250,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#93c5fd" }}>
            {initialsFor(displayName)}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>{displayName}</span>
            <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
              {[member.jobTitle, member.department, member.email].filter(Boolean).join(" · ")}
            </span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 11 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".1em", color: text.faint }}>{f.label}</span>
              <span style={{ fontSize: 12.5, color: f.color, textWrap: "pretty" }}>{f.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>SETTINGS</span>

          <button
            onClick={() => {
              const next = !member.isActive;
              statusMutation.mutate({ userId: member.userId, isActive: next }, {
                onSuccess: () => toast.success(next ? `${displayName} can sign in again.` : `${displayName} is suspended and signed out everywhere.`),
                onError: (err) => fail(err, "Failed to update the account status."),
              });
            }}
            disabled={statusMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 10, border: `1px solid ${member.isActive ? signal.ok.border : border.card}`, background: member.isActive ? signal.ok.tint : surface.card, cursor: statusMutation.isPending ? "wait" : "pointer", minWidth: 0, textAlign: "left" }}
          >
            <Icon name={member.isActive ? "user-check" : "user-minus"} size={16} color={member.isActive ? signal.ok.strong : text.muted} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>
                {member.isActive ? "Account is active" : "Account is suspended"}
              </span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                {member.isActive ? "Suspending them signs them out everywhere immediately." : "They cannot sign in. Their data and history are untouched."}
              </span>
            </div>
            <Pill label={member.isActive ? "ACTIVE" : "SUSPENDED"} tone={member.isActive ? signal.ok : signal.neutral} />
          </button>

          <button
            onClick={() => {
              const next = !member.mfaEnforced;
              mfaEnforcementMutation.mutate({ userId: member.userId, enforced: next }, {
                onSuccess: () => toast.success(next ? "They will be asked to set up a second factor next time they sign in." : "Second factor is no longer required for them."),
                onError: (err) => fail(err, "Failed to update MFA enforcement."),
              });
            }}
            disabled={mfaEnforcementMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 10, border: `1px solid ${member.mfaEnforced ? signal.ok.border : signal.warning.border}`, background: member.mfaEnforced ? signal.ok.tint : signal.warning.tint, cursor: mfaEnforcementMutation.isPending ? "wait" : "pointer", minWidth: 0, textAlign: "left" }}
          >
            <Icon name={member.mfaEnforced ? "shield-check" : "shield"} size={16} color={member.mfaEnforced ? signal.ok.strong : signal.warning.strong} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>
                {member.mfaEnforced ? "Second factor is required" : "Second factor is optional"}
              </span>
              <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
                {member.mfaEnforced ? "They must set one up. Takes effect the next time they sign in, not on their current session." : "They can sign in with a password alone."}
              </span>
            </div>
            <Pill label={member.mfaEnforced ? "REQUIRED" : "OPTIONAL"} tone={member.mfaEnforced ? signal.ok : signal.warning} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: text.faint }}>GET THEM BACK IN</span>

          <ActionRow
            icon="lock-open" color={member.isLockedOut ? signal.ok.strong : text.faint}
            label={member.isLockedOut ? "Clear the lockout" : "Not locked out"}
            body={member.isLockedOut ? "Wipes the failed attempts and lets them try again now." : "Nothing to clear — they have no failed attempts standing against them."}
            disabled={!member.isLockedOut || unlockMutation.isPending}
            onClick={() => unlockMutation.mutate(member.userId, {
              onSuccess: () => toast.success("Lockout cleared. They can sign in again."),
              onError: (err) => fail(err, "Failed to clear the lockout."),
            })}
          />

          <ActionRow
            icon="mail" color={signal.info.strong}
            label="Email them a reset link"
            body="One hour to use it. We never see the password they choose."
            disabled={passwordResetMutation.isPending}
            onClick={() => passwordResetMutation.mutate(member.userId, {
              onSuccess: () => { onSecret(null); toast.success(`Reset link sent to ${member.email}. It expires in an hour.`); },
              onError: (err) => fail(err, "Failed to send the reset link."),
            })}
          />

          <ActionRow
            icon="key" color={signal.warning.strong}
            label="Set a temporary password"
            body="Shown once, on this screen. Read it to them — it is not emailed."
            disabled={tempPasswordMutation.isPending}
            onClick={() => tempPasswordMutation.mutate(member.userId, {
              onSuccess: (data) => onSecret({ label: "TEMPORARY PASSWORD", value: data.tempPassword, note: "Say it to them directly. It replaces their password immediately, so they cannot sign in with the old one." }),
              onError: (err) => fail(err, "Failed to set a temporary password."),
            })}
          />

          <ActionRow
            icon="shield-off" color={signal.notice.strong}
            label="Clear their second factor"
            body="Removes their app codes and passkeys so they can enrol again from scratch."
            disabled={resetMfaMutation.isPending}
            onClick={() => resetMfaMutation.mutate(member.userId, {
              onSuccess: (data) => { onSecret(null); toast.success(`Cleared their second factor (${(data.clearedMethods as string[]).join(", ") || "none"}). They have been emailed and can enrol again.`); },
              onError: (err) => fail(err, "Failed to reset their second factor."),
            })}
          />

          <ActionRow
            icon="log-out" color={member.activeSessionsCount > 0 ? signal.critical.strong : text.faint}
            label={member.activeSessionsCount > 0 ? "Sign them out everywhere" : "Not signed in anywhere"}
            body={member.activeSessionsCount > 0 ? `Ends all ${member.activeSessionsCount} of their sessions. Not recorded on the audit trail.` : "No live sessions to end."}
            disabled={member.activeSessionsCount === 0 || signOutMutation.isPending}
            onClick={() => signOutMutation.mutate(member.userId, {
              onSuccess: () => { onSecret(null); toast.success("Signed out of every session."); },
              onError: (err) => fail(err, "Failed to sign them out."),
            })}
          />

          <ActionRow
            icon="siren" color={signal.critical.strong}
            label="Generate an emergency code"
            body="Skips their second factor once, for 24 hours. Replaces any code already issued."
            title="The strongest thing on this panel — it bypasses their second factor entirely"
            disabled={emergencyBypassMutation.isPending}
            onClick={() => emergencyBypassMutation.mutate(member.userId, {
              onSuccess: (data) => onSecret({ label: "EMERGENCY CODE · EXPIRES IN 24 HOURS", value: data.bypassCode, note: "This skips their second factor entirely. Read it to them, and only to them." }),
              onError: (err) => fail(err, "Failed to generate an emergency code."),
            })}
          />
        </div>

        {secret && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 11, border: `1px solid ${signal.warning.border}`, background: signal.warning.tint }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.warning.strong }}>{secret.label}</span>
            <span style={{ fontFamily: "Menlo, monospace", fontSize: 14, fontWeight: 600, color: text.title, wordBreak: "break-all" }}>{secret.value}</span>
            <span style={{ fontSize: 11.5, color: text.secondary, textWrap: "pretty" }}>{secret.note}</span>
            <button onClick={() => onSecret(null)} style={{ alignSelf: "flex-start", height: 28, padding: "0 11px", borderRadius: 7, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        )}

        <span style={{ fontSize: 11.5, color: text.label, textWrap: "pretty", paddingTop: 11, borderTop: `1px solid ${border.soft}` }}>
          Everything on this panel is recorded against the customer with our name on it, so their own admin can see it was us.
        </span>
      </div>
    </div>
  );
}

function ActionRow({
  icon, color, label, body, onClick, disabled, title,
}: {
  icon: IconName;
  color: string;
  label: string;
  body: string;
  onClick: () => void;
  disabled: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 10, border: `1px solid ${border.card}`, background: "rgba(2,6,23,.4)", cursor: disabled ? "not-allowed" : "pointer", textAlign: "left", opacity: disabled ? 0.65 : 1, minWidth: 0 }}
    >
      <Icon name={icon} size={16} color={color} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>{label}</span>
        <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>{body}</span>
      </div>
    </button>
  );
}

// ── Invite drawer ─────────────────────────────────────────────────────────────

function InviteDrawer({
  customerName, inEmail, onEmail, inName, onName, inTitle, onTitle, inDept, onDept, emailTaken, canInvite, submitting, onClose, onSubmit,
}: {
  customerName?: string;
  inEmail: string; onEmail: (v: string) => void;
  inName: string; onName: (v: string) => void;
  inTitle: string; onTitle: (v: string) => void;
  inDept: string; onDept: (v: string) => void;
  emailTaken: boolean;
  canInvite: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const fields: { label: string; value: string; onChange: (v: string) => void; ph: string; hint?: string; hintTone?: Tone }[] = [
    { label: "Work email", value: inEmail, onChange: onEmail, ph: "name@company.com", hint: emailTaken ? "Someone already has an account with this email." : undefined, hintTone: signal.critical },
    { label: "Name", value: inName, onChange: onName, ph: "Optional" },
    { label: "Job title", value: inTitle, onChange: onTitle, ph: "Optional" },
    { label: "Department", value: inDept, onChange: onDept, ph: "Optional" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px,94%)", height: "100%", background: "#0b1728", borderLeft: `1px solid ${border.card}`, padding: 20, display: "flex", flexDirection: "column", gap: 15, overflowY: "auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.text }}>INVITE</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: text.title, letterSpacing: "-.01em", textWrap: "pretty" }}>
              Add someone to {customerName ?? "this customer"}
            </span>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, flex: "0 0 28px", borderRadius: 8, border: "none", background: "transparent", color: text.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {fields.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: text.secondary }}>{f.label}</span>
            <input
              value={f.value}
              onChange={(e) => f.onChange(e.target.value)}
              placeholder={f.ph}
              style={{ height: 36, padding: "0 11px", borderRadius: 8, border: `1px solid ${f.hint ? f.hintTone?.border : border.card}`, background: "rgba(2,6,23,.6)", color: text.strong, fontSize: 13, outline: "none" }}
            />
            {f.hint && <span style={{ fontSize: 11, color: f.hintTone?.text, textWrap: "pretty" }}>{f.hint}</span>}
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, padding: "12px 13px", borderRadius: 10, border: `1px solid ${signal.info.border}`, background: "rgba(37,99,235,.07)" }}>
          <Icon name="mail" size={15} color={signal.info.strong} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: text.strong, textWrap: "pretty" }}>They get a setup link, not a password</span>
            <span style={{ fontSize: 11.5, color: text.muted, textWrap: "pretty" }}>
              The link works for 72 hours. They join as a standard portal user — being able to manage their own team is
              something their own admin grants later.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 13, borderTop: `1px solid ${border.soft}` }}>
          <button
            onClick={onSubmit}
            disabled={!canInvite || submitting}
            title={canInvite ? "" : emailTaken ? "That email is already in use" : "A work email is needed"}
            style={{
              flex: 1, height: 38, borderRadius: 8,
              border: `1px solid ${canInvite ? "#2563eb" : border.card}`,
              background: canInvite ? "#2563eb" : "transparent",
              color: canInvite ? "#fff" : text.muted,
              fontSize: 13, fontWeight: 600, cursor: !canInvite || submitting ? "not-allowed" : "pointer",
              opacity: canInvite ? 1 : 0.6,
            }}
          >
            {submitting ? "Sending…" : "Send the invitation"}
          </button>
          <button onClick={onClose} style={{ height: 38, padding: "0 15px", borderRadius: 8, border: `1px solid ${border.card}`, background: "transparent", color: text.secondary, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

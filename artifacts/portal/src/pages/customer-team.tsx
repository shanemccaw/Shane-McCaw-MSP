import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTeamLive } from "@/components/team/useTeamLive";
import {
  mfaPresentation,
  nameOf,
  roleLineOf,
  wouldCreateManagerCycle,
  type AssignableRole,
  type TeamMember,
} from "@/components/team/teamWire";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const RED = "#f87171";
const CYAN = "#00B4D8";
const VIOLET = "#a78bfa";

/**
 * Team Management and Invitations (#3996, part of #1656; role surface #4013).
 * Adapted from `Design/portal/design_handoff_billing_roles_and_new_modules/
 * screens/Team Management.dc.html` using this codebase's existing
 * React + Vite + Tailwind v4 + shadcn/ui + lucide-react patterns, not the
 * reference markup — same discipline as `billing.tsx` / `account-security.tsx`.
 *
 * Wired against all 13 real routes on `portal-team.ts` via
 * `useTeamLive`/`teamWire` (see those files' own headers) — invite, roster
 * read, suspend/reactivate, sign-out-everywhere, MFA enforcement toggle,
 * unlock, password reset email, temp password, MFA reset, emergency bypass,
 * "reports to" (manager) assignment, and the two-role (Customer Admin /
 * Billing) grant/revoke surface #4013 adds.
 */
export default function CustomerTeamPage() {
  const { can, user } = useAuth();
  const live = useTeamLive();
  const canManage = can("customer", "team.manage");

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const members = live.members;

  useEffect(() => {
    if (!members || members.length === 0) return;
    if (selectedUserId !== null && members.some((m) => m.userId === selectedUserId)) return;
    const self = members.find((m) => m.userId === user?.id);
    setSelectedUserId((self ?? members[0]).userId);
  }, [members, selectedUserId, user?.id]);

  const selected = useMemo(
    () => members?.find((m) => m.userId === selectedUserId) ?? null,
    [members, selectedUserId],
  );

  const isLoading = live.loading;
  const isFixture = live.readFailed;
  const isLive = !isLoading && !isFixture && members !== null;
  const isEmpty = isLive && members.length <= 1;
  const activeCount = members?.filter((m) => m.isActive).length ?? 0;

  const stateLine = isLoading
    ? "Reading your team"
    : isFixture
      ? "Could not read your team"
      : isEmpty
        ? "Live — only you"
        : `Live — ${members!.length} members · ${activeCount} active`;
  const stateDot = isFixture ? RED : isLoading ? "#475569" : "#34d399";

  function closeModal() {
    setModal(null);
    setActionError(null);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5" style={{ color: "#cbd5e1" }} data-testid="team-page">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          Team
        </span>
        <span
          title="Everyone who can sign in to your organisation's portal, with their sign-in security at a glance. Managing them — inviting, suspending, resetting — needs the team-management grant; everyone can view."
          className="flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-[#64748b]"
          style={{ border: "1px solid rgba(148,163,184,.35)", cursor: "help" }}
        >
          i
        </span>
        <span className="flex items-center gap-[6px] text-[11px]" style={{ color: isFixture ? RED : "#64748b" }}>
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
        </span>
        {canManage ? (
          <button
            type="button"
            onClick={() => setModal({ kind: "invite" })}
            className="ml-auto whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "#0078D4" }}
            data-testid="team-invite-button"
          >
            Invite a teammate
          </button>
        ) : (
          <span
            title="Your account can view the roster but does not hold the team-management grant. Ask a team manager to add it — it takes effect on your next request, no sign-out needed."
            className="ml-auto rounded-full px-[9px] py-[3px] text-[10px] font-semibold text-[#94a3b8]"
            style={{ border: "1px solid rgba(148,163,184,.22)", background: "rgba(148,163,184,.08)", cursor: "help" }}
          >
            View only
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          {[
            { w1: "34%", w2: "58%" },
            { w1: "28%", w2: "46%" },
            { w1: "31%", w2: "52%" },
          ].map((s, i) => (
            <div
              key={i}
              className="flex animate-pulse flex-col gap-[9px] rounded-[14px] p-4"
              style={{ border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)" }}
            >
              <div className="h-[10px] rounded-full" style={{ width: s.w1, background: "rgba(255,255,255,.07)" }} />
              <div className="h-[9px] rounded-full" style={{ width: s.w2, background: "rgba(255,255,255,.05)" }} />
            </div>
          ))}
        </div>
      ) : null}

      {isFixture ? (
        <div
          className="flex gap-[10px] rounded-xl px-4 py-[14px]"
          style={{ border: "1px dashed rgba(248,113,113,.45)", background: "rgba(248,113,113,.06)" }}
        >
          <AlertCircle className="mt-[2px] size-[15px] shrink-0" color={RED} />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#f8fafc]">Your team roster could not be read</span>
            <span className="max-w-[620px] text-[12px] leading-[1.55] text-[#94a3b8]">
              This is a failed read, not an empty team. Nothing is listed below because nothing could be fetched.
            </span>
            <button
              type="button"
              onClick={live.refetch}
              className="w-fit pt-[2px] text-left text-[11.5px] font-semibold text-[#60a5fa] hover:text-[#93c5fd]"
              data-testid="team-retry"
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div
          className="flex flex-col gap-2 rounded-[14px] px-[22px] py-5"
          style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
        >
          <span className="text-[13.5px] font-semibold text-[#f8fafc]">No one else is on your team yet</span>
          <span className="max-w-[660px] text-[12px] leading-[1.6] text-[#94a3b8]">
            A real read: your organisation has no other portal logins. Invite a colleague and they receive a setup
            link that works for 72 hours.
          </span>
        </div>
      ) : null}

      {isLive && !isEmpty ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
          <RosterCard
            members={members!}
            selectedUserId={selectedUserId}
            currentUserId={user?.id ?? null}
            onSelect={setSelectedUserId}
          />
          {selected ? (
            <DetailCard
              member={selected}
              members={members!}
              isYou={selected.userId === user?.id}
              canManage={canManage}
              onOpenModal={setModal}
            />
          ) : null}
        </div>
      ) : null}

      {/* What this page deliberately does not do */}
      <div
        className="flex flex-col gap-[9px] rounded-[14px] px-5 pb-[15px] pt-4"
        style={{ border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}
      >
        <div className="flex items-baseline gap-[10px]">
          <span className="text-[13px] font-semibold text-[#f8fafc]">What this page deliberately does not do</span>
          <button
            type="button"
            onClick={() => setLedgerOpen((v) => !v)}
            className="ml-auto text-[11.5px] font-semibold text-[#64748b] hover:text-[#cbd5e1]"
            data-testid="team-ledger-toggle"
          >
            {ledgerOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {ledgerOpen ? (
          <div className="flex flex-col">
            {LEDGER.map((l) => (
              <div key={l.where} className="flex items-start gap-3 border-t py-2" style={{ borderColor: "rgba(255,255,255,.05)" }}>
                <span className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-[#cbd5e1]">{l.gap}</span>
                <span
                  className="shrink-0 whitespace-nowrap text-[10.5px] text-[#475569]"
                  style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
                >
                  {l.where}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {modal && selected && modal.kind !== "invite" ? (
        <ActionModal
          modal={modal}
          member={selected}
          members={members ?? []}
          live={live}
          actionError={actionError}
          setActionError={setActionError}
          onClose={closeModal}
          onChangeModal={setModal}
        />
      ) : null}
      {modal?.kind === "invite" ? (
        <InviteModal live={live} actionError={actionError} setActionError={setActionError} onClose={closeModal} onChangeModal={setModal} />
      ) : null}
    </div>
  );
}

function RosterCard({
  members,
  selectedUserId,
  currentUserId,
  onSelect,
}: {
  members: TeamMember[];
  selectedUserId: number | null;
  currentUserId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div
      className="self-start rounded-[14px] px-4 pb-3 pt-[6px]"
      style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
      data-testid="team-roster"
    >
      <div className="flex items-center gap-[10px] py-3 pb-2">
        <span className="text-[13px] font-semibold text-[#f8fafc]">Members</span>
        <span className="text-[11px] text-[#64748b]">everyone on your portal · read as stored, unsorted</span>
      </div>
      {members.map((m) => {
        const isYou = m.userId === currentUserId;
        const mfa = mfaPresentation(m.mfaStatus);
        const active = m.userId === selectedUserId;
        return (
          <div
            key={m.userId}
            onClick={() => onSelect(m.userId)}
            className="mx-[-10px] flex cursor-pointer items-center gap-[11px] rounded-lg border-t px-[10px] py-[10px]"
            style={{ borderColor: "rgba(255,255,255,.06)", background: active ? "rgba(255,255,255,.04)" : "transparent" }}
            data-testid={`team-roster-row-${m.userId}`}
          >
            <span
              className="flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[#f8fafc]"
              style={{ background: m.isActive ? "#0A2540" : "#1e293b", opacity: m.isActive ? 1 : 0.6 }}
            >
              {m.initials}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <div className="flex flex-wrap items-center gap-[7px]">
                <span className="text-[12.5px] font-semibold text-[#e2e8f0]">{m.name ?? m.email}</span>
                {isYou ? (
                  <span
                    className="rounded-full px-[6px] py-[1px] text-[9.5px] font-semibold text-[#60a5fa]"
                    style={{ border: "1px solid rgba(96,165,250,.3)" }}
                  >
                    You
                  </span>
                ) : null}
                {m.isCustomerAdmin ? (
                  <span
                    className="rounded-full px-[6px] py-[1px] text-[9.5px] font-semibold"
                    style={{ color: CYAN, border: "1px solid rgba(0,180,216,.35)" }}
                  >
                    Customer Admin
                  </span>
                ) : null}
                {m.hasBillingRole ? (
                  <span
                    className="rounded-full px-[6px] py-[1px] text-[9.5px] font-semibold"
                    style={{ color: VIOLET, border: "1px solid rgba(167,139,250,.35)" }}
                  >
                    Billing
                  </span>
                ) : null}
                {!m.isActive ? (
                  <span
                    className="rounded-full px-[6px] py-[1px] text-[9.5px] font-semibold text-[#94a3b8]"
                    style={{ border: "1px solid rgba(148,163,184,.3)" }}
                  >
                    Suspended
                  </span>
                ) : null}
                {m.isLockedOut ? (
                  <span
                    className="rounded-full px-[6px] py-[1px] text-[9.5px] font-semibold text-[#f87171]"
                    style={{ border: "1px solid rgba(248,113,113,.3)" }}
                  >
                    Locked out
                  </span>
                ) : null}
              </div>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[#64748b]">
                {m.subLine}
              </span>
            </div>
            <span
              className="shrink-0 rounded-full px-2 py-[2px] text-[10px] font-semibold"
              style={{ color: mfa.ink, border: `1px solid ${mfa.bd}` }}
            >
              {mfa.label}
            </span>
          </div>
        );
      })}
      <span
        className="mt-[2px] block border-t pt-[10px] text-[10.5px] leading-[1.5] text-[#475569]"
        style={{ borderColor: "rgba(255,255,255,.06)" }}
      >
        Sign-in security shows one reduced status: a passkey outranks an authenticator app, which outranks SMS. Last
        sign-in is derived from session history.
      </span>
    </div>
  );
}

function DetailCard({
  member,
  members,
  isYou,
  canManage,
  onOpenModal,
}: {
  member: TeamMember;
  members: TeamMember[];
  isYou: boolean;
  canManage: boolean;
  onOpenModal: (m: ModalState) => void;
}) {
  const mfa = mfaPresentation(member.mfaStatus);
  const managerName = nameOf(members, member.managerUserId);
  const lastLogin = member.lastLoginAt
    ? `${formatDistanceToNowStrict(new Date(member.lastLoginAt))} ago`
    : "Never";

  return (
    <div
      className="flex flex-col gap-3 self-start rounded-[14px] px-5 pb-4 pt-4"
      style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
      data-testid="team-detail"
    >
      <div className="flex flex-col gap-[3px]">
        <span className="text-[15px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          {member.name ?? member.email}
        </span>
        <span className="text-[11.5px] text-[#94a3b8]">
          {member.email}
          {member.phone ? ` · ${member.phone}` : ""}
        </span>
        <span className="text-[11px] text-[#64748b]">{roleLineOf(member)}</span>
      </div>

      <div
        className="grid gap-[10px] border-t pt-3"
        style={{ borderColor: "rgba(255,255,255,.07)", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
      >
        <DetailField
          label="SIGN-IN SECURITY"
          value={mfa.label}
          valueColor={mfa.ink}
          sub={member.mfaEnforced ? "MFA required at sign-in" : "MFA not required"}
        />
        <DetailField
          label="LAST SIGN-IN"
          value={lastLogin}
          sub={`${member.activeSessionsCount} live session${member.activeSessionsCount === 1 ? "" : "s"}`}
        />
        <DetailField
          label="REPORTS TO"
          value={managerName ?? "No one on file"}
          sub="used when they decline an ownership role"
        />
        <DetailField
          label="MEMBER SINCE"
          value={format(new Date(member.createdAt), "d MMM yyyy")}
          sub={member.isActive ? "Active" : "Suspended"}
        />
      </div>

      <RolesBlock member={member} isYou={isYou} canManage={canManage} onOpenModal={onOpenModal} />

      {canManage ? (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
          <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
            ACCESS
          </span>
          <div className="flex flex-wrap gap-[7px]">
            {member.isActive ? (
              <ActionChip
                label="Suspend"
                title="Blocks sign-in and ends every live session now"
                danger
                disabled={isYou}
                onClick={() => onOpenModal({ kind: "suspend" })}
                testId="team-action-suspend"
              />
            ) : (
              <ActionChip
                label="Reactivate"
                title="Allows sign-in again"
                onClick={() => onOpenModal({ kind: "reactivate" })}
                testId="team-action-reactivate"
              />
            )}
            <ActionChip
              label="Sign out everywhere"
              title="Ends all live sessions · no audit entry"
              disabled={member.activeSessionsCount === 0}
              onClick={() => onOpenModal({ kind: "sessions" })}
              testId="team-action-sessions"
            />
            <ActionChip
              label="Reports to…"
              title="Sets who a declined ownership role escalates to"
              onClick={() => onOpenModal({ kind: "manager" })}
              testId="team-action-manager"
            />
          </div>
          <span className="pt-1 text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
            SIGN-IN RECOVERY
          </span>
          <div className="flex flex-wrap gap-[7px]">
            <ActionChip
              label={member.mfaEnforced ? "Stop requiring MFA" : "Require MFA"}
              title="Takes effect at their next sign-in"
              onClick={() => onOpenModal({ kind: "enforce" })}
              testId="team-action-enforce"
            />
            <ActionChip
              label="Unlock"
              title="Clears the failed-attempt lock"
              disabled={!member.isLockedOut}
              onClick={() => onOpenModal({ kind: "unlock" })}
              testId="team-action-unlock"
            />
            <ActionChip
              label="Email password reset"
              title="One-hour link, sent to them"
              onClick={() => onOpenModal({ kind: "reset" })}
              testId="team-action-reset"
            />
            <ActionChip
              label="Set temporary password"
              title="Shown to you once, never emailed"
              onClick={() => onOpenModal({ kind: "temp" })}
              testId="team-action-temp"
            />
            <ActionChip
              label="Reset all MFA"
              title="Removes every enrolled method"
              danger
              disabled={member.mfaStatus === "Disabled"}
              onClick={() => onOpenModal({ kind: "resetMfa" })}
              testId="team-action-reset-mfa"
            />
            <ActionChip
              label="Emergency bypass code"
              title="24-hour one-time MFA bypass · highest privilege"
              danger
              onClick={() => onOpenModal({ kind: "bypass" })}
              testId="team-action-bypass"
            />
          </div>
          <span className="pt-[2px] text-[10.5px] leading-[1.5] text-[#475569]">
            Every action is written to the audit trail with your name — except revoking sessions, which leaves none.
            A temporary password or emergency code is shown to you once, here, and never emailed; you pass it on.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RolesBlock({
  member,
  isYou,
  canManage,
  onOpenModal,
}: {
  member: TeamMember;
  isYou: boolean;
  canManage: boolean;
  onOpenModal: (m: ModalState) => void;
}) {
  const adminSelfLock = isYou && member.isCustomerAdmin;
  const cards: {
    key: string;
    name: string;
    grants: string;
    held: boolean;
    stLabel: string;
    ink: string;
    bd: string;
    bg: string;
    note: string | null;
    action: { label: string; title: string; disabled: boolean; onClick: () => void };
  }[] = [
    {
      key: "customer-admin",
      name: "Customer Admin",
      grants: "Everything on the customer side: billing view and manage, team management, change approval, the full marketplace.",
      held: member.isCustomerAdmin,
      stLabel: member.isCustomerAdmin ? "Held" : "Not held",
      ink: CYAN,
      bd: member.isCustomerAdmin ? "rgba(0,180,216,.25)" : "rgba(255,255,255,.07)",
      bg: member.isCustomerAdmin ? "rgba(0,180,216,.04)" : "transparent",
      note: adminSelfLock ? "Your own admin role cannot be removed from here — the server refuses it." : null,
      action: {
        label: member.isCustomerAdmin ? "Remove" : "Grant",
        title: member.isCustomerAdmin
          ? adminSelfLock
            ? "You cannot remove your own Customer Admin role"
            : "Removes every admin capability"
          : "Grants every customer capability",
        disabled: adminSelfLock,
        onClick: () => onOpenModal({ kind: member.isCustomerAdmin ? "revokeAdmin" : "grantAdmin" }),
      },
    },
    {
      key: "billing",
      name: "Billing",
      grants: "Billing view and manage only — invoices, subscriptions, payment methods. No admin rights.",
      held: member.hasBillingRole,
      stLabel: member.hasBillingRole ? (member.isBilledParty ? "Held · a bill is addressed to them" : "Held") : "Not held",
      ink: VIOLET,
      bd: member.hasBillingRole ? "rgba(167,139,250,.25)" : "rgba(255,255,255,.07)",
      bg: member.hasBillingRole ? "rgba(167,139,250,.04)" : "transparent",
      note: member.isBilledParty
        ? "Granted automatically to whoever an invoice or service is addressed to, because billing routes read that person's own rows. A removal stands until their next bill."
        : null,
      action: {
        label: member.hasBillingRole ? "Remove" : "Grant",
        title: member.hasBillingRole ? "Removes billing access" : "Grants billing access without admin rights",
        disabled: false,
        onClick: () => onOpenModal({ kind: member.hasBillingRole ? "revokeBilling" : "grantBilling" }),
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,.07)" }}>
      <div className="flex flex-wrap items-baseline gap-[10px]">
        <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
          ROLES
        </span>
        <span className="text-[10.5px] text-[#64748b]">
          {canManage ? "granted here by a team manager · read live on every request" : "read live · only a team manager can change them"}
        </span>
      </div>
      {cards.map((c) => (
        <div
          key={c.key}
          className="flex items-start gap-3 rounded-[10px] px-3 py-[10px]"
          style={{ border: `1px solid ${c.bd}`, background: c.bg }}
          data-testid={`team-role-card-${c.key}`}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-[#f8fafc]">{c.name}</span>
              <span
                className="rounded-full px-2 py-[1px] text-[10px] font-semibold"
                style={{ color: c.held ? c.ink : "#64748b", border: `1px solid ${c.held ? c.ink + "66" : "rgba(100,116,139,.35)"}` }}
              >
                {c.stLabel}
              </span>
            </div>
            <span className="text-[11px] leading-[1.5] text-[#94a3b8]">{c.grants}</span>
            {c.note ? <span className="text-[10.5px] leading-[1.5] text-[#64748b]">{c.note}</span> : null}
          </div>
          {canManage ? (
            <button
              type="button"
              title={c.action.title}
              disabled={c.action.disabled}
              onClick={c.action.onClick}
              className="shrink-0 whitespace-nowrap rounded-md px-[11px] py-[6px] text-[11.5px] font-semibold"
              style={{
                color: c.action.disabled ? "#475569" : c.held ? RED : "#cbd5e1",
                border: `1px solid ${c.action.disabled ? "rgba(255,255,255,.07)" : c.held ? "rgba(248,113,113,.4)" : "rgba(255,255,255,.14)"}`,
                cursor: c.action.disabled ? "not-allowed" : "pointer",
              }}
              data-testid={`team-role-action-${c.key}`}
            >
              {c.action.label}
            </button>
          ) : null}
        </div>
      ))}
      <span className="text-[10.5px] leading-[1.5] text-[#475569]">
        Only these two platform roles can be assigned here. A role your organisation defines itself is not offered; the server refuses any other key.
      </span>
    </div>
  );
}

function DetailField({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
        {label}
      </span>
      <span className="text-[12px]" style={{ color: valueColor ?? "#e2e8f0" }}>
        {value}
      </span>
      <span className="text-[10.5px] text-[#64748b]">{sub}</span>
    </div>
  );
}

function ActionChip({
  label,
  title,
  danger,
  disabled,
  onClick,
  testId,
}: {
  label: string;
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  const ink = disabled ? "#475569" : danger ? "#f87171" : "#cbd5e1";
  const bd = disabled ? "rgba(255,255,255,.07)" : danger ? "rgba(248,113,113,.4)" : "rgba(255,255,255,.14)";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="whitespace-nowrap rounded-md px-[11px] py-[6px] text-[11.5px] font-semibold"
      style={{ color: ink, border: `1px solid ${bd}`, cursor: disabled ? "not-allowed" : "pointer" }}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

type ModalState =
  | { kind: "invite" }
  | { kind: "invited" }
  | { kind: "suspend" }
  | { kind: "reactivate" }
  | { kind: "sessions" }
  | { kind: "sessionsDone"; revokedCount: number }
  | { kind: "enforce" }
  | { kind: "unlock" }
  | { kind: "reset" }
  | { kind: "resetSent" }
  | { kind: "temp"; secret?: string }
  | { kind: "resetMfa" }
  | { kind: "mfaCleared"; clearedMethods: string[] }
  | { kind: "bypass"; secret?: string; expiresAt?: string }
  | { kind: "manager" }
  | { kind: "grantAdmin" }
  | { kind: "revokeAdmin" }
  | { kind: "grantBilling" }
  | { kind: "revokeBilling" }
  | null;

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(2,6,23,.72)" }}
      onClick={onClose}
    >
      <div
        className="flex w-[490px] max-w-full flex-col gap-[11px] rounded-2xl px-[22px] pb-[18px] pt-5"
        style={{ background: "#0b1120", border: "1px solid rgba(255,255,255,.12)", boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}
        onClick={(e) => e.stopPropagation()}
        data-testid="team-modal"
      >
        {children}
      </div>
    </div>
  );
}

function InviteModal({
  live,
  actionError,
  setActionError,
  onClose,
  onChangeModal,
}: {
  live: ReturnType<typeof useTeamLive>;
  actionError: string | null;
  setActionError: (e: string | null) => void;
  onClose: () => void;
  onChangeModal: (m: ModalState) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  async function handleSubmit() {
    setActionError(null);
    const err = await live.invite({
      email,
      name: name || undefined,
      department: department || undefined,
      jobTitle: jobTitle || undefined,
    });
    if (err) {
      setActionError(err);
      return;
    }
    onChangeModal({ kind: "invited" });
  }

  return (
    <ModalShell onClose={onClose}>
      <span className="text-[14.5px] font-bold text-[#f8fafc]">Invite a teammate</span>
      <span className="text-[12.5px] leading-[1.6] text-[#94a3b8]">
        They receive a setup link that works for 72 hours and join as a standard member. Making them a team manager
        is a separate step afterwards.
      </span>
      <div className="flex flex-col gap-[8px]">
        <Field label="EMAIL · REQUIRED" value={email} onChange={setEmail} placeholder="new.colleague@company.com" testId="team-invite-email" />
        <Field label="NAME" value={name} onChange={setName} placeholder="Optional" testId="team-invite-name" />
        <Field label="DEPARTMENT" value={department} onChange={setDepartment} placeholder="Optional" testId="team-invite-department" />
        <Field label="JOB TITLE" value={jobTitle} onChange={setJobTitle} placeholder="Optional" testId="team-invite-job-title" />
      </div>
      {actionError ? <span className="text-[11.5px] text-[#f87171]">{actionError}</span> : null}
      <span className="text-[11.5px] leading-[1.55]" style={{ color: "#c2a63d" }}>
        An email already holding an account anywhere on the platform is refused (409).
      </span>
      <div className="flex items-center gap-[9px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-[#cbd5e1] hover:bg-white/[.05]"
          style={{ border: "1px solid rgba(255,255,255,.14)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!email.trim() || live.inviting}
          className="rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-white"
          style={{ background: "#0078D4" }}
          data-testid="team-invite-submit"
        >
          {live.inviting ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </ModalShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-[4px]">
      <span className="text-[9px] font-bold text-[#475569]" style={{ letterSpacing: ".09em" }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md px-[11px] py-[9px] text-[12.5px] text-[#e2e8f0] outline-none"
        style={{ border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.02)" }}
        data-testid={testId}
      />
    </div>
  );
}

function ActionModal({
  modal,
  member,
  members,
  live,
  actionError,
  setActionError,
  onClose,
  onChangeModal,
}: {
  modal: NonNullable<ModalState>;
  member: TeamMember;
  members: TeamMember[];
  live: ReturnType<typeof useTeamLive>;
  actionError: string | null;
  setActionError: (e: string | null) => void;
  onClose: () => void;
  onChangeModal: (m: ModalState) => void;
}) {
  const name = member.name ?? member.email;

  // Fetch-on-open for the two secret-bearing actions, matching the design's
  // own "shown once" framing — the secret is generated server-side the
  // instant the modal opens, not on a separate confirm step.
  useEffect(() => {
    if (modal.kind === "temp" && !modal.secret) {
      void live.setTempPassword(member.userId).then((res) => {
        if (typeof res === "string") setActionError(res);
        else onChangeModal({ kind: "temp", secret: res.tempPassword });
      });
    }
    if (modal.kind === "bypass" && !modal.secret) {
      void live.generateBypassCode(member.userId).then((res) => {
        if (typeof res === "string") setActionError(res);
        else onChangeModal({ kind: "bypass", secret: res.bypassCode, expiresAt: res.expiresAt });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.kind]);

  async function confirm() {
    setActionError(null);
    switch (modal.kind) {
      case "suspend": {
        const err = await live.setStatus(member.userId, false);
        if (err) return setActionError(err);
        return onClose();
      }
      case "reactivate": {
        const err = await live.setStatus(member.userId, true);
        if (err) return setActionError(err);
        return onClose();
      }
      case "sessions": {
        const res = await live.signOutEverywhere(member.userId);
        if (typeof res === "string") return setActionError(res);
        return onChangeModal({ kind: "sessionsDone", revokedCount: res.revokedCount });
      }
      case "enforce": {
        const err = await live.setMfaEnforced(member.userId, !member.mfaEnforced);
        if (err) return setActionError(err);
        return onClose();
      }
      case "unlock": {
        const err = await live.unlock(member.userId);
        if (err) return setActionError(err);
        return onClose();
      }
      case "reset": {
        const err = await live.sendPasswordReset(member.userId);
        if (err) return setActionError(err);
        return onChangeModal({ kind: "resetSent" });
      }
      case "resetMfa": {
        const res = await live.resetMfa(member.userId);
        if (typeof res === "string") return setActionError(res);
        return onChangeModal({ kind: "mfaCleared", clearedMethods: res.clearedMethods });
      }
      case "grantAdmin":
      case "revokeAdmin": {
        const err = await live.setRole(member.userId, "customer-admin", modal.kind === "grantAdmin");
        if (err) return setActionError(err);
        return onClose();
      }
      case "grantBilling":
      case "revokeBilling": {
        const err = await live.setRole(member.userId, "billing", modal.kind === "grantBilling");
        if (err) return setActionError(err);
        return onClose();
      }
      default:
        return;
    }
  }

  if (modal.kind === "manager") {
    const options = [{ label: "No one", id: null as number | null, note: "clears the reporting line", disabled: false }].concat(
      members
        .filter((m) => m.userId !== member.userId)
        .map((m) => {
          const cycle = wouldCreateManagerCycle(members, member.userId, m.userId);
          return {
            label: m.name ?? m.email,
            id: m.userId,
            note: cycle ? "would create a loop" : m.isActive ? "" : "suspended",
            disabled: cycle,
          };
        }),
    );
    return (
      <ModalShell onClose={onClose}>
        <span className="text-[14.5px] font-bold text-[#f8fafc]">Who does {name} report to?</span>
        <span className="text-[12.5px] leading-[1.6] text-[#94a3b8]">
          Used when they decline an ownership role: the decline is escalated to the person chosen here, then up
          their chain.
        </span>
        <div className="flex flex-col gap-[5px]">
          {options.map((o) => (
            <span
              key={o.id ?? "none"}
              onClick={async () => {
                if (o.disabled) return;
                setActionError(null);
                const err = await live.setManager(member.userId, o.id);
                if (err) setActionError(err);
                else onClose();
              }}
              className="flex items-center gap-2 rounded-md px-[11px] py-[8px] text-[12px]"
              style={{
                color: o.disabled ? "#475569" : member.managerUserId === o.id ? "#f8fafc" : "#cbd5e1",
                border: `1px solid ${member.managerUserId === o.id ? "rgba(0,120,212,.55)" : "rgba(255,255,255,.1)"}`,
                cursor: o.disabled ? "not-allowed" : "pointer",
              }}
              data-testid={`team-manager-option-${o.id ?? "none"}`}
            >
              <span className="flex-1">{o.label}</span>
              <span className="text-[10.5px] text-[#64748b]">{o.note}</span>
            </span>
          ))}
        </div>
        {actionError ? <span className="text-[11.5px] text-[#f87171]">{actionError}</span> : null}
        <span className="text-[11.5px] leading-[1.55]" style={{ color: "#c2a63d" }}>
          Must be a member of this team, not themselves, and must not create a loop.
        </span>
      </ModalShell>
    );
  }

  const spec = SPECS[modal.kind](member, modal);

  return (
    <ModalShell onClose={onClose}>
      <span className="text-[14.5px] font-bold text-[#f8fafc]">{spec.title}</span>
      <span className="text-[12.5px] leading-[1.6] text-[#94a3b8]">{spec.body}</span>
      {modal.kind === "temp" || modal.kind === "bypass" ? (
        <span
          className="text-center text-[15px] text-[#f8fafc]"
          style={{
            border: "1px solid rgba(251,191,36,.4)",
            borderRadius: 8,
            padding: "12px 14px",
            background: "rgba(251,191,36,.06)",
            fontFamily: "ui-monospace, Menlo, monospace",
            letterSpacing: ".04em",
          }}
          data-testid="team-secret-value"
        >
          {("secret" in modal && modal.secret) || "Generating…"}
        </span>
      ) : null}
      {actionError ? <span className="text-[11.5px] text-[#f87171]">{actionError}</span> : null}
      {spec.note ? (
        <span className="text-[11.5px] leading-[1.55]" style={{ color: "#c2a63d" }}>
          {spec.note}
        </span>
      ) : null}
      <div className="flex items-center gap-[9px] border-t pt-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        {spec.confirmable ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-[#cbd5e1] hover:bg-white/[.05]"
              style={{ border: "1px solid rgba(255,255,255,.14)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={live.actionPending}
              className="rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-white"
              style={{ background: spec.danger ? "#dc2626" : "#0078D4" }}
              data-testid="team-modal-confirm"
            >
              {spec.cta}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-[14px] py-[8px] text-[12px] font-semibold text-white"
            style={{ background: "#0078D4" }}
            data-testid="team-modal-close"
          >
            Close
          </button>
        )}
      </div>
    </ModalShell>
  );
}

interface Spec {
  title: string;
  body: string;
  note?: string;
  cta?: string;
  danger?: boolean;
  confirmable?: boolean;
}

const SPECS: Record<string, (member: TeamMember, modal: NonNullable<ModalState>) => Spec> = {
  invited: () => ({
    title: "Invitation sent",
    body: "The account exists now, without a password, and the setup email is on its way. If the email fails the account still exists — you can send a password reset instead.",
    note: "Recorded on the audit trail as team_member_invited.",
  }),
  suspend: (m) => ({
    title: `Suspend ${m.name ?? m.email}?`,
    body: "They cannot sign in from this moment and every live session is ended immediately. Their account, history and data are kept; you can reactivate later.",
    note: "You cannot suspend your own account from here.",
    cta: "Suspend",
    danger: true,
    confirmable: true,
  }),
  reactivate: (m) => ({
    title: `Reactivate ${m.name ?? m.email}?`,
    body: "They can sign in again with their existing password and MFA.",
    cta: "Reactivate",
    confirmable: true,
  }),
  sessions: (m) => ({
    title: `Sign ${m.name ?? m.email} out everywhere?`,
    body: "Ends every one of their live sessions. They simply sign in again; nothing else changes.",
    note: "This is the one action here that leaves no audit entry — it looks the same as sessions expiring.",
    cta: "Sign out all sessions",
    confirmable: true,
  }),
  sessionsDone: (_m, modal) => ({
    title: "Sessions revoked",
    body: `revokedCount: ${modal.kind === "sessionsDone" ? modal.revokedCount : 0}`,
  }),
  enforce: (m) => ({
    title: `${m.mfaEnforced ? "Stop requiring" : "Require"} MFA for ${m.name ?? m.email}?`,
    body: m.mfaEnforced
      ? "They will be able to sign in without a second factor from their next sign-in."
      : "From their next sign-in they must set up a second factor before they get in. Their current session is unaffected.",
    cta: m.mfaEnforced ? "Stop requiring" : "Require MFA",
    confirmable: true,
  }),
  unlock: (m) => ({
    title: `Unlock ${m.name ?? m.email}?`,
    body: "Clears the failed-attempt counter and the lock entirely, not just the timer.",
    cta: "Unlock",
    confirmable: true,
  }),
  reset: (m) => ({
    title: `Email a password reset to ${m.name ?? m.email}?`,
    body: 'They receive the same reset link the sign-in page\'s "forgot password" sends, valid for one hour. Nothing is shown to you.',
    cta: "Send reset email",
    confirmable: true,
  }),
  resetSent: (m) => ({
    title: "Reset email sent",
    body: `Valid for one hour, to ${m.email}.`,
  }),
  temp: (m) => ({
    title: `Temporary password for ${m.name ?? m.email}`,
    body: "Their password has been replaced with this one. Pass it on out of band — it is not emailed and will not be shown again.",
    note: "Fixed pattern, generated server-side. Ask them to change it at first sign-in.",
  }),
  resetMfa: (m) => ({
    title: `Reset all MFA for ${m.name ?? m.email}?`,
    body: "Removes every second factor they have — authenticator app, SMS and passkeys — so they enrol again at next sign-in. They are emailed a list of what was cleared.",
    note: "This is a full teardown, not a per-method reset.",
    cta: "Reset MFA",
    danger: true,
    confirmable: true,
  }),
  mfaCleared: (m, modal) => ({
    title: "MFA cleared",
    body: `clearedMethods: ${modal.kind === "mfaCleared" ? modal.clearedMethods.join(", ") || "None" : "None"}. An email listing these has gone to ${m.email}.`,
  }),
  bypass: (m) => ({
    title: `Emergency bypass code for ${m.name ?? m.email}`,
    body: "Lets its holder skip MFA on this account for 24 hours, once. Any earlier code for them is now invalid. Pass it on out of band — it is not emailed and will not be shown again.",
    note: "The highest-privilege action on this page. It is recorded with its expiry.",
  }),
  grantAdmin: (m) => ({
    title: `Make ${m.name ?? m.email} a Customer Admin?`,
    body: "They gain every customer capability at once: billing view and manage, team management (everything on this page, including granting these roles), approving change requests, and the full marketplace. This is the top of your organisation, parallel to your MSP's own admin role.",
    note: "Recorded on the audit trail as team_member_role_granted with the role key. Takes effect on their next request — nothing waits for a token refresh.",
    cta: "Grant Customer Admin",
    confirmable: true,
  }),
  revokeAdmin: (m) => ({
    title: `Remove Customer Admin from ${m.name ?? m.email}?`,
    body: "They lose team management, change approval and the full marketplace. Billing access goes too unless they hold the Billing role separately.",
    note: "You cannot remove your own Customer Admin role — the server refuses it, so the organisation always keeps at least the admin doing the removal.",
    cta: "Remove Customer Admin",
    danger: true,
    confirmable: true,
  }),
  grantBilling: (m) => ({
    title: `Give ${m.name ?? m.email} the Billing role?`,
    body: "They can see and act on your organisation's billing — invoices, subscriptions, payment methods — without any admin rights. Built for the finance person who should see bills while engineers should not.",
    note: "Recorded on the audit trail as team_member_role_granted with the role key.",
    cta: "Grant Billing",
    confirmable: true,
  }),
  revokeBilling: (m) => ({
    title: `Remove the Billing role from ${m.name ?? m.email}?`,
    body: m.isBilledParty
      ? "They lose billing access now. Because an invoice or service is addressed to them personally, the platform will grant Billing back automatically the next time a bill is issued to them — the revoke stands until then."
      : "They lose billing access from their next request.",
    note: "Recorded on the audit trail as team_member_role_revoked with the role key.",
    cta: "Remove Billing",
    danger: true,
    confirmable: true,
  }),
};

const LEDGER = [
  {
    gap: "Viewing and managing are separate. Anyone on the organisation sees the roster; the actions appear only with the team-management grant, which is read live on every call.",
    where: "§0 · §1",
  },
  {
    gap: "Invites create a standard member only. There is no \"invite as admin\"; the role is granted afterwards under Roles, which is what the route takes.",
    where: "§2 · §5",
  },
  {
    gap: "Temporary passwords and bypass codes are shown once, to you, and never emailed. The page states that the relay is yours.",
    where: "§4f · §4h",
  },
  {
    gap: "Sign-out-everywhere is labelled as leaving no audit entry, because it is the one mutating action that writes none.",
    where: "§4a · §5",
  },
  {
    gap: "One reduced MFA status per member — passkey over app over SMS — not a list of every method.",
    where: "§1 · §3",
  },
  {
    gap: "\"Reports to\" is written by its own route; the roster read carries managerUserId too, so the page shows what is stored rather than only what it set.",
    where: "§1 · §4i · #3996",
  },
  {
    gap: "The manager picker refuses self, other organisations and loops, mirroring the three server checks; the page cannot show the before/after in the audit because the audit row carries none.",
    where: "§4i",
  },
  {
    gap: "You cannot suspend yourself here; the button is disabled on your own row.",
    where: "§4b",
  },
  {
    gap: "Resetting MFA is a full teardown of every method, drawn with that warning, not a per-method toggle.",
    where: "§4g",
  },
  {
    gap: "The roster is unsorted because the read is; the page keeps the server's order rather than inventing one.",
    where: "§1",
  },
  {
    gap: "Two roles, no more. Only the platform keys customer-admin and billing can be granted here; an organisation's own custom roles and every other key are refused by the server (400) and not offered.",
    where: "#3629 · #3647",
  },
  {
    gap: "Granting roles is gated exactly like every other action here — the team-management grant, read live. A Customer Admin holds it by role; a plain member with the grant holds it too.",
    where: "#3647 · #2460",
  },
  {
    gap: "You cannot remove your own Customer Admin role; the button is disabled with the server's reason. Removing someone else's is allowed even if they are the last one — the page does not add a floor the server lacks.",
    where: "#3647",
  },
  {
    gap: "Billing is also granted by the platform, not only by people: whoever an invoice or service is addressed to gets it automatically, and a removal stands only until their next bill. Drawn on the role card rather than hidden.",
    where: "#3629",
  },
  {
    gap: "Roles take effect on the next request. Nothing here waits for a sign-out or token refresh, and a 503 (role model unreadable) is drawn as unavailable, never as denied.",
    where: "#2460 · #3647",
  },
] as const;

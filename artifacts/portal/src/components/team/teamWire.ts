/**
 * Wire shape + pure formatting for the Team Management page (#3996, part of
 * #1656). Contract cited against `docs/portal/team-management-and-invitations-
 * contract-pack.md` (#2895) and the live route source
 * (`artifacts/api-server/src/routes/portal-team.ts`) — the pack predates
 * #3647's `PATCH /portal/team/:userId/role` and the `isCustomerAdmin`/
 * `hasBillingRole` roster fields, so those two are read straight from the
 * current route rather than the pack.
 *
 * `managerUserId` on the roster read is new this pass (Git #3996) — the
 * pack's own §5 finding noted the roster route never projected it even
 * though the manager-assignment route (§4i) had existed since #2527; it is
 * now selected and returned so this page's "Reports to" panel has something
 * real to read instead of a second, unbuilt lookup.
 *
 * Pure functions only, no React — unit-testable directly.
 */

export type MfaStatus = "TOTP" | "FIDO2" | "SMS" | "Disabled";

/** `GET /api/portal/team` response row, exactly as the route returns it. */
export interface WireTeamMember {
  id: number;
  userId: number;
  email: string;
  name: string | null;
  phone: string | null;
  isActive: boolean;
  isLockedOut: boolean;
  mfaStatus: MfaStatus;
  mfaEnforced: boolean;
  department: string;
  jobTitle: string;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessionsCount: number;
  isCustomerAdmin: boolean;
  hasBillingRole: boolean;
  /**
   * #4013 — whether this member is the real, current #3629 "billed party"
   * (an `invoices`/`client_services` row addressed to them), the condition
   * `rbac_grant_billing_to_billed_party()` auto-grants Billing on. Distinct
   * from `hasBillingRole` itself: a member can hold Billing by manual grant
   * without being the billed party, in which case a manual revoke sticks.
   */
  isBilledParty: boolean;
  managerUserId: number | null;
}

/** The two `customer_roles.key` values assignable from this page (#3629, #3647). */
export type AssignableRole = "customer-admin" | "billing";

export interface TeamMember extends WireTeamMember {
  readonly initials: string;
  readonly subLine: string;
}

const MFA_PRESENTATION: Record<MfaStatus, { label: string; ink: string; bd: string }> = {
  FIDO2: { label: "Passkey", ink: "#34d399", bd: "rgba(52,211,153,.3)" },
  TOTP: { label: "Authenticator app", ink: "#34d399", bd: "rgba(52,211,153,.3)" },
  SMS: { label: "SMS", ink: "#fbbf24", bd: "rgba(251,191,36,.3)" },
  Disabled: { label: "No MFA", ink: "#f87171", bd: "rgba(248,113,113,.3)" },
};

export function mfaPresentation(status: MfaStatus): { label: string; ink: string; bd: string } {
  return MFA_PRESENTATION[status];
}

export function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function toTeamMember(row: WireTeamMember): TeamMember {
  return {
    ...row,
    initials: initialsOf(row.name, row.email),
    subLine: subLineOf(row),
  };
}

function subLineOf(row: WireTeamMember): string {
  const parts = [row.jobTitle || null, row.department || null].filter((p): p is string => !!p);
  if (!row.lastLoginAt) parts.push("never signed in");
  return parts.join(" · ");
}

export function roleLineOf(member: TeamMember): string {
  return [member.jobTitle || null, member.department || null].filter(Boolean).join(" · ") || "No title or department on file";
}

export function nameOf(members: readonly TeamMember[], userId: number | null): string | null {
  if (userId === null) return null;
  return members.find((m) => m.userId === userId)?.name ?? null;
}

/**
 * Cycle guard for the client-side manager picker — mirrors the server's own
 * `PATCH /portal/team/:userId/manager` walk (§4i) so a disabled/loop option
 * can be shown before the user picks it, not only refused after the fact.
 * Capped at the same 50 hops as the server (§4i / §5's cross-reference note).
 */
export function wouldCreateManagerCycle(
  members: readonly TeamMember[],
  targetUserId: number,
  candidateUserId: number,
): boolean {
  let cursor: number | null = candidateUserId;
  let hops = 0;
  while (cursor !== null && hops < 50) {
    if (cursor === targetUserId) return true;
    cursor = members.find((m) => m.userId === cursor)?.managerUserId ?? null;
    hops++;
  }
  return false;
}

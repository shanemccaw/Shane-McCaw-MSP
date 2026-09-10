/**
 * The directory's role vocabulary, read from the server (#2459, part of #1696).
 *
 * ── What this replaces, and the real bug it closes ──────────────────────────
 *
 * Two AD panes each carried their own hardcoded copy of this:
 *
 *   - `components/ActiveDirectoryUserPane.tsx` — a seven-literal `ROLE_OPTIONS`
 *     array, plus a `roleLinkageRequirement()` whose own comment conceded it was
 *     *"a small intentional duplicate"* of the server's.
 *   - `adminv2/screens/ad/canvases/AdUserCanvas.tsx` — a third copy of the same
 *     function, over `DIRECTORY_GROUP_ROLES` re-declared in `adTypes.ts`.
 *
 * The two copies had already drifted, from the server and from each other. The
 * server (`api-server/src/lib/active-directory.ts:701-713`) returns `"customer"`
 * for `Free` and `Assessment`; the v1 pane's copy fell through to `"none"` for
 * both. So for two of the seven roles the pane silently did not show the "this
 * role requires a tenant linkage" hint the server's own rule says applies.
 *
 * That is precisely the failure #1696 predicts for an authorization-shaped rule
 * transcribed into a component — *"a rule that exists nowhere the server can
 * enforce it"*, which then drifts. One endpoint, `GET
 * /admin/active-directory/roles`, is now the only source, and it is generated
 * from the server's own `DIRECTORY_GROUP_ROLES` + `roleLinkageRequirement()`.
 *
 * ── Why role NAMES still appear on screen here, legitimately ────────────────
 *
 * #2459 removes role-string COMPARISONS, not the directory's ability to display
 * its own contents. AdminV2 is the platform-admin console: a group named
 * "MSPAdmin" is a real object an administrator browses and assigns, the same way
 * an AD console shows real group names. What changed is that the list and its
 * semantics are read from the server rather than transcribed — nothing in this
 * module or its callers compares a role name against a literal.
 */

import { useEffect, useState } from "react";

export interface DirectoryRole {
  role: string;
  /** What the server says this role requires: `"none" | "msp" | "customer"`. */
  linkageRequirement: "none" | "msp" | "customer";
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DirectoryRolesState {
  roles: DirectoryRole[];
  /**
   * What linkage `role` requires, per the server.
   *
   * Returns `"none"` for a role the server did not list — including while the
   * fetch is still in flight. `"none"` means "show no linkage hint", so an
   * unresolved list renders the pane without the hint rather than with a wrong
   * one. It is a hint, not a gate: `PATCH .../user/:id/role` re-validates the
   * linkage server-side (`planRoleChange`) regardless of what this returned.
   */
  linkageRequirementFor: (role: string | null | undefined) => "none" | "msp" | "customer";
}

export function useDirectoryRoles(adminFetch: Fetcher): DirectoryRolesState {
  const [roles, setRoles] = useState<DirectoryRole[]>([]);

  useEffect(() => {
    let cancelled = false;
    adminFetch("/api/admin/active-directory/roles")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { roles: DirectoryRole[] } | null) => {
        if (!cancelled && data) setRoles(data.roles);
      })
      .catch(() => {
        // Non-fatal: the pane still renders, minus the role buttons and the
        // linkage hint. Failing loudly here would take down a whole user pane
        // over a list, and every write it guards is re-validated server-side.
      });
    return () => {
      cancelled = true;
    };
  }, [adminFetch]);

  return {
    roles,
    linkageRequirementFor: (role) => roles.find((r) => r.role === role)?.linkageRequirement ?? "none",
  };
}

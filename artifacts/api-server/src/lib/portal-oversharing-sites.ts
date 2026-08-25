/**
 * portal-oversharing-sites.ts — the pure derivations behind the Overshared
 * SharePoint drill-down's per-site "Affected Sites" list (#1286).
 *
 * Reads the SAME `overshared_items` rows the bulk page (#1275) reads, grouped
 * by site, to answer the drill-down's actual question: "which named people —
 * not just a claim-level count — hold broad access to this site". Kept out of
 * `routes/portal-oversharing-sites.ts` for the same reason `portal-sops.ts` is
 * kept out of its route file: a decision about how a stored row becomes a
 * sentence on screen is worth a unit test that does not need a database.
 *
 * ── What "admin" honestly means here ─────────────────────────────────────────
 * There is no Graph surface this platform holds a scope for that enumerates a
 * site's real SharePoint "Site Collection Administrators" (that needs
 * Sites.FullControl.All — the same wall `sharepoint-sharing.ts`'s own header
 * documents this platform deliberately does not hold). What IS resolvable off
 * `Sites.Read.All`'s `/drive/root/permissions` read is a NAMED user granted
 * `owner`-level access directly on the site's document library root. That is a
 * real, narrower signal than "site admin" — it will read as fewer admins than
 * SharePoint's own admin list for a site whose owners are granted through the
 * "Site Owners" SharePoint GROUP rather than individually (the common case;
 * see sharepoint-sharing.ts's header on why a group grant cannot be resolved
 * to named people without further, larger collection work). Documented here so
 * a site the SPO admin center calls "3 admins" can honestly read as 0 here.
 *
 * ── Site visibility (Public/Private) stays uncaptured ────────────────────────
 * `overshared_items.site_visibility` is a real column, always NULL today (a
 * separate, not-yet-built #1262 follow-up — not part of #1286's scope). Never
 * inferred from grant data; a row's `visibility` field passes the NULL through
 * honestly rather than guessing Public/Private from what permissions exist.
 */

export interface OversharedSiteGrantRow {
  readonly siteId: string;
  readonly siteName: string | null;
  readonly siteUrl: string | null;
  readonly siteVisibility: string | null;
  readonly isPersonalSite: boolean;
  readonly grantKind: string;
  readonly principalLabel: string | null;
  readonly principalUpn: string | null;
  readonly roles: readonly string[];
  readonly remediationState: string;
}

export interface WireOversharingPerson {
  readonly name: string;
  readonly upn: string;
  readonly role?: string;
}

export interface WireOversharingSite {
  readonly id: string;
  readonly name: string | null;
  readonly url: string | null;
  readonly visibility: string | null;
  readonly isPersonalSite: boolean;
  readonly context: string;
  readonly sharingLevels: readonly string[];
  readonly admins: readonly WireOversharingPerson[];
  readonly guests: readonly WireOversharingPerson[];
  readonly status: "open" | "accepted";
}

const BROAD_GRANT_KINDS = ["anonymous_link", "everyone", "eeeu", "organization_link"] as const;

const BROAD_KIND_LABEL: Record<string, string> = {
  anonymous_link: "an anonymous link",
  everyone: "Everyone access",
  eeeu: "Everyone except external users",
  organization_link: "an organization-wide link",
};

/** A named person's UPN when Graph's claim resolved one, honest fallback otherwise. */
function personUpn(row: OversharedSiteGrantRow): string {
  return row.principalUpn ?? "UPN not resolved";
}

function personName(row: OversharedSiteGrantRow): string {
  return (row.principalLabel ?? "").trim() || "Unnamed";
}

/**
 * The row list's real broad-access description, e.g. "Everyone except
 * external users and an anonymous link have access" — every clause is a kind
 * actually present on this site, never a guessed severity.
 */
export function siteContextLine(sharingLevels: readonly string[]): string {
  if (sharingLevels.length === 0) return "No broad sharing found on this site.";
  const labels = sharingLevels.map((k) => BROAD_KIND_LABEL[k] ?? k);
  if (labels.length === 1) return `${labels[0]} has access.`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} have access.`;
}

/**
 * Groups a run's flat `overshared_items` rows (one per site x grant) into the
 * drill-down's per-site shape, resolving named admins/guests off the `user`/
 * `guest` grant rows landed alongside the broad ones.
 */
export function buildOversharingSites(rows: readonly OversharedSiteGrantRow[]): WireOversharingSite[] {
  const bySite = new Map<string, OversharedSiteGrantRow[]>();
  for (const row of rows) {
    const list = bySite.get(row.siteId) ?? [];
    list.push(row);
    bySite.set(row.siteId, list);
  }

  const sites: WireOversharingSite[] = [];
  for (const [siteId, siteRows] of bySite) {
    const first = siteRows[0];

    const sharingLevels = BROAD_GRANT_KINDS.filter((k) => siteRows.some((r) => r.grantKind === k));

    // See the header: "owner"-role named user is the real, narrower signal
    // this platform can resolve — not SharePoint's own site-admin list.
    const admins = siteRows
      .filter((r) => r.grantKind === "user" && r.roles.includes("owner"))
      .map((r) => ({ name: personName(r), upn: personUpn(r), role: "Owner" }));

    const guests = siteRows
      .filter((r) => r.grantKind === "guest")
      .map((r) => ({ name: personName(r), upn: personUpn(r), role: r.roles[0] ?? "Read" }));

    // A site reads as accepted only once EVERY broad grant on it has been
    // marked accepted — a partially-accepted site is still an open finding.
    const broadRows = siteRows.filter((r) => (BROAD_GRANT_KINDS as readonly string[]).includes(r.grantKind));
    const status: "open" | "accepted" =
      broadRows.length > 0 && broadRows.every((r) => r.remediationState === "risk_accepted") ? "accepted" : "open";

    sites.push({
      id: siteId,
      name: first.siteName,
      url: first.siteUrl,
      visibility: first.siteVisibility,
      isPersonalSite: first.isPersonalSite,
      context: siteContextLine(sharingLevels),
      sharingLevels,
      admins,
      guests,
      status,
    });
  }

  return sites;
}

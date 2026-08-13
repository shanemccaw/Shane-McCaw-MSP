/**
 * sharepoint-sharing.ts
 *
 * Turns raw Microsoft Graph SharePoint permission payloads into a REAL per-site
 * broad-sharing record — site name, site URL, and the sharing level(s) actually
 * granted — so a document or a War Room card can name the affected sites
 * instead of quoting a tenant-wide count (#357).
 *
 * ── The Graph shape, confirmed against the live v1.0 reference (2026-08-03) ───
 * Per-site sharing enumeration is NOT a single flat call, and the obvious
 * endpoint is the wrong one. Three routes were checked before this one was
 * chosen:
 *
 *   1. GET /sites/{siteId}/permissions — REJECTED. The v1.0 reference's own
 *      example returns nothing but `grantedToIdentitiesV2[].application`
 *      entries: this is the Sites.Selected APP-grant collection, not the site's
 *      user/group ACL. It also demands Sites.FullControl.All (delegated AND
 *      application), which this platform deliberately does not hold — the same
 *      wall `sharepoint-admin.ts` is already blocked behind. It can never
 *      surface "Everyone except external users".
 *
 *   2. The SharePoint Advanced Management "Data access governance" EEEU report
 *      — REJECTED. It is admin-centre/SPO-PowerShell only
 *      (Start-SPODataAccessGovernanceInsight), has no Graph API, requires the
 *      separately-licensed SharePoint Advanced Management add-on, covers only
 *      the top 100 sites over a trailing 28 days, and lags up to 24 hours. None
 *      of that is a basis for a per-tenant assessment we can run on demand.
 *
 *   3. GET /sites/{siteId}/drive/root/permissions — CHOSEN. The driveItem
 *      permission list is documented as "the effective sharing permissions on a
 *      driveItem", inherited grants included, and is the one v1.0 surface that
 *      actually returns SharePoint principals: `grantedToV2.siteUser` /
 *      `grantedToV2.siteGroup` carry the raw claim in `loginName`, and sharing
 *      links arrive as a `link` facet carrying `scope`. Application permission
 *      Sites.Read.All is sufficient — and Sites.Read.All is ALREADY in
 *      REQUIRED_MT_SCOPES (graph.ts), so no tenant re-consent is needed.
 *
 * Site enumeration is GET /sites/getAllSites (v1.0, Sites.Read.All,
 * @odata.nextLink-paginated), which is documented as the way to enumerate every
 * site including in a non-multi-geo tenant. It also returns every user's
 * OneDrive as `isPersonalSite: true`, which is why the check carries a fan-out
 * item filter — see the migration.
 *
 * ── What counts as "broad" ───────────────────────────────────────────────────
 * EEEU is the headline, but a report that named only EEEU would under-report:
 * the same site is equally exposed by an "Anyone with the link" grant. Four
 * kinds are recognised, and each is derived from a field Graph really returns —
 * never inferred from a site name or a role:
 *
 *   anonymous_link     link.scope === "anonymous"      — no sign-in at all
 *   everyone           claim c:0(.s|true               — INCLUDES external users
 *   eeeu               claim c:0-.f|rolemanager|spo-grid-all-users/{tenantId}
 *   organization_link  link.scope === "organization"   — whole tenant, link-gated
 *
 * link.scope values "users" and "existingAccess" are NOT broad (a named list,
 * and a link that grants nothing new respectively) and are deliberately not
 * classified — treating them as findings would inflate every tenant's count.
 *
 * The EEEU claim's trailing GUID is the tenant id. It is matched by PREFIX, not
 * equality: the claim resolves to "all members of the tenant that owns the
 * site" regardless of which tenant GUID is stamped on it (older tenants carry a
 * different one), so pinning the GUID would silently miss real EEEU grants.
 */

import { logger } from "./logger";

const log = logger.child({ channel: "engine.monitor" });

/** The "Everyone except external users" SharePoint claim, minus its tenant GUID. */
export const EEEU_LOGIN_NAME_PREFIX = "c:0-.f|rolemanager|spo-grid-all-users";

/** The "Everyone" claim — the strictly broader one; it INCLUDES external users. */
export const EVERYONE_LOGIN_NAME_PREFIX = "c:0(.s|true";

/**
 * Display-name fallbacks, lowercased. Used only when a grant carries no
 * loginName (Graph omits it on some identity sets). The claim is authoritative
 * whenever it is present — a display name is tenant-localisable and renameable.
 */
const EEEU_DISPLAY_NAME = "everyone except external users";
const EVERYONE_DISPLAY_NAME = "everyone";

/**
 * The four broad-access kinds, in the order this module treats as most→least
 * severe (see `highestSharingLevel`):
 *
 *   anonymous_link    — needs no sign-in and travels by URL alone; a leaked link
 *                       is a leak to the open internet.
 *   everyone          — standing access for signed-in users INCLUDING external
 *                       guests; broader than EEEU by definition.
 *   eeeu              — standing access for every internal user. The Copilot
 *                       oversharing case: Copilot grounds on whatever the asker
 *                       can already reach.
 *   organization_link — same tenant-wide reach as EEEU but gated behind holding
 *                       the link, so it is the narrowest of the four.
 */
export const BROAD_SHARING_KINDS = [
  "anonymous_link",
  "everyone",
  "eeeu",
  "organization_link",
] as const;

export type BroadSharingKind = typeof BROAD_SHARING_KINDS[number];

/** One broad grant found on a site, kept whole so a report can cite it. */
export interface SiteSharingGrant {
  /** Graph's permission id, as returned. Null when the payload omitted it. */
  permissionId: string | null;
  kind: BroadSharingKind;
  /** Human-readable principal or link description, for a report line. */
  principal: string;
  /** The raw SharePoint claim, when the grant is a principal rather than a link. */
  loginName: string | null;
  /** permission.roles verbatim — "read" | "write" | "owner" | ... */
  roles: string[];
  /** True when Graph reported the grant as inherited from an ancestor item. */
  inherited: boolean;
}

/** The per-site record this module produces — one row per enumerated site. */
export interface SiteSharingSummary {
  siteId: string | null;
  siteName: string | null;
  siteUrl: string | null;
  isPersonalSite: boolean;
  /** Permissions Graph returned for the site's default document library root. */
  permissionCount: number;
  /** True when ANY of the four broad kinds was found. The headline flag. */
  broadAccess: boolean;
  hasEeeu: boolean;
  hasEveryone: boolean;
  hasAnonymousLink: boolean;
  hasOrganizationLink: boolean;
  eeeuGrantCount: number;
  everyoneGrantCount: number;
  anonymousLinkCount: number;
  organizationLinkCount: number;
  /** The most severe kind present, per BROAD_SHARING_KINDS order. Null if none. */
  highestSharingLevel: BroadSharingKind | null;
  /** Every distinct kind present, in BROAD_SHARING_KINDS order. */
  sharingLevels: BroadSharingKind[];
  /** Every broad grant, whole — what lets a document name the principal. */
  grants: SiteSharingGrant[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function rolesOf(permission: Record<string, unknown>): string[] {
  const raw = permission.roles;
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Classifies ONE identity out of a sharePointIdentitySet-shaped object.
 * Returns null for every ordinary user/group — only the two tenant-wide
 * principals are broad.
 */
function classifyIdentity(
  identity: unknown,
): { kind: Extract<BroadSharingKind, "eeeu" | "everyone">; principal: string; loginName: string | null } | null {
  if (!isRecord(identity)) return null;

  // Every slot a sharePointIdentitySet can carry. siteUser/siteGroup are the
  // ones that actually carry the SharePoint claim in loginName; the rest are
  // checked by display name so a differently-shaped payload still classifies.
  const slots = ["siteUser", "siteGroup", "sharePointGroup", "group", "user"] as const;

  for (const slot of slots) {
    const node = identity[slot];
    if (!isRecord(node)) continue;

    const loginName = stringOrNull(node.loginName);
    const displayName = stringOrNull(node.displayName);

    // The claim is authoritative when present — display names are renameable
    // and localised, claims are not.
    if (loginName) {
      if (loginName.startsWith(EEEU_LOGIN_NAME_PREFIX)) {
        return { kind: "eeeu", principal: displayName ?? "Everyone except external users", loginName };
      }
      if (loginName.startsWith(EVERYONE_LOGIN_NAME_PREFIX)) {
        return { kind: "everyone", principal: displayName ?? "Everyone", loginName };
      }
      continue;
    }

    const lowered = displayName?.toLowerCase();
    if (lowered === EEEU_DISPLAY_NAME) {
      return { kind: "eeeu", principal: displayName!, loginName: null };
    }
    if (lowered === EVERYONE_DISPLAY_NAME) {
      return { kind: "everyone", principal: displayName!, loginName: null };
    }
  }

  return null;
}

/**
 * Classifies one Graph `permission` object into a broad grant, or null when the
 * permission grants nothing broad (a named user, a "specific people" link, an
 * existingAccess link, an application grant).
 *
 * A permission is either a LINK (it carries a `link` facet) or a direct grant —
 * the sharingLink reference states exactly that — so the link facet is checked
 * first and the identity sets are only consulted for non-link permissions.
 */
export function classifySharingPermission(permission: unknown): SiteSharingGrant | null {
  if (!isRecord(permission)) return null;

  const permissionId = stringOrNull(permission.id);
  const roles = rolesOf(permission);
  const inherited = isRecord(permission.inheritedFrom);

  const link = permission.link;
  if (isRecord(link)) {
    const scope = stringOrNull(link.scope);
    const linkType = stringOrNull(link.type) ?? "link";
    if (scope === "anonymous") {
      return {
        permissionId,
        kind: "anonymous_link",
        principal: `Anyone with the link (${linkType})`,
        loginName: null,
        roles,
        inherited,
      };
    }
    if (scope === "organization") {
      return {
        permissionId,
        kind: "organization_link",
        principal: `Anyone in the organization with the link (${linkType})`,
        loginName: null,
        roles,
        inherited,
      };
    }
    // "users" / "existingAccess" / anything unrecognised: not broad. A link
    // permission never also carries a broad principal, so stop here rather than
    // falling through to the identity sets.
    return null;
  }

  // Direct grants. grantedToV2 is the single-identity form; grantedToIdentitiesV2
  // is the multi-identity form the site/list permission surfaces use. Both are
  // read — a payload may carry either.
  const candidates: unknown[] = [permission.grantedToV2];
  const many = permission.grantedToIdentitiesV2;
  if (Array.isArray(many)) candidates.push(...many);

  for (const candidate of candidates) {
    const hit = classifyIdentity(candidate);
    if (hit) {
      return { permissionId, kind: hit.kind, principal: hit.principal, loginName: hit.loginName, roles, inherited };
    }
  }

  return null;
}

/**
 * Rolls one site's permission list up into the per-site record.
 *
 * `site` is the object Graph returned from the enumeration (`/sites/getAllSites`),
 * so the name and URL on the output are the tenant's REAL values — the whole
 * point of #357 — rather than anything reconstructed from an id.
 */
export function summarizeSiteSharing(site: unknown, permissions: unknown[]): SiteSharingSummary {
  const s = isRecord(site) ? site : {};

  const grants: SiteSharingGrant[] = [];
  for (const permission of permissions) {
    const grant = classifySharingPermission(permission);
    if (grant) grants.push(grant);
  }

  const countOf = (kind: BroadSharingKind) => grants.filter((g) => g.kind === kind).length;
  const eeeuGrantCount = countOf("eeeu");
  const everyoneGrantCount = countOf("everyone");
  const anonymousLinkCount = countOf("anonymous_link");
  const organizationLinkCount = countOf("organization_link");

  const sharingLevels = BROAD_SHARING_KINDS.filter((kind) => grants.some((g) => g.kind === kind));

  return {
    siteId: stringOrNull(s.id),
    // `displayName` is the human title where Graph supplies it; `name` is the
    // URL-ish short name and is what /sites/getAllSites actually returns.
    siteName: stringOrNull(s.displayName) ?? stringOrNull(s.name),
    siteUrl: stringOrNull(s.webUrl),
    isPersonalSite: s.isPersonalSite === true,
    permissionCount: permissions.length,
    broadAccess: grants.length > 0,
    hasEeeu: eeeuGrantCount > 0,
    hasEveryone: everyoneGrantCount > 0,
    hasAnonymousLink: anonymousLinkCount > 0,
    hasOrganizationLink: organizationLinkCount > 0,
    eeeuGrantCount,
    everyoneGrantCount,
    anonymousLinkCount,
    organizationLinkCount,
    // BROAD_SHARING_KINDS is declared most→least severe, so the first present
    // kind IS the highest.
    highestSharingLevel: sharingLevels[0] ?? null,
    sharingLevels: [...sharingLevels],
    grants,
  };
}

/**
 * The registry key this module registers under in monitor-executor's code-owned
 * fan-out normalizer table. Stored in `monitor_checks.fan_out_item_normalizer`
 * as an identifier only — never a script — exactly like `ps_cmdlet_key`.
 */
export const SHAREPOINT_SITE_SHARING_NORMALIZER = "sharepoint:site-sharing";

/**
 * Fan-out normalizer: collapses one site's permission list into exactly ONE
 * summary row.
 *
 * Without this, the fan-out's flattened union would be a bag of permission
 * objects with no site attached — a count, which is precisely what #357 exists
 * to replace. Emitting one row per site means the check's ordinary mapping
 * rules count SITES (`countTruthy` over `broadAccess`), and the full-item
 * detail collector persists a real, nameable site list.
 *
 * A site with no broad sharing still emits its row: "we looked at this site and
 * it is clean" is a different, and necessary, statement from "we never looked",
 * and the denominator has to be real for any ratio built on it to be.
 */
export function normalizeSiteSharing(site: Record<string, unknown>, permissions: unknown[]): unknown[] {
  const summary = summarizeSiteSharing(site, permissions);
  if (summary.siteId == null) {
    // The enumeration guarantees an id (it is the fan-out key), so this means a
    // reshaped payload, not an ordinary empty tenant. Say so rather than
    // emitting a row whose site cannot be identified in a report.
    log.warn(
      { siteUrl: summary.siteUrl, permissionCount: summary.permissionCount },
      "sharepoint-sharing: enumerated site carried no id — dropping its summary row",
    );
    return [];
  }
  return [summary];
}

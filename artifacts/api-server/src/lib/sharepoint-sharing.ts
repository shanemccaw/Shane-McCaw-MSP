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
 *
 * ── Named-identity resolution (#1286, #1262 follow-up #3) ───────────────────
 * The SAME permission list already fetched above also carries named,
 * non-broad grants — a specific person's `siteUser` identity rather than the
 * EEEU/Everyone claim or a link. Those were previously discarded entirely by
 * `classifySharingPermission` (it returns null for anything that isn't broad).
 * `classifyNamedSharingGrant` below classifies that SAME payload a second way,
 * with no extra Graph call, into `SiteSharingSummary.namedGrants`.
 *
 * Two things this can genuinely resolve, and one it cannot:
 *   - A GUEST granted access directly (the design's "Manage guest access"
 *     scenario) almost always shows up as a named `siteUser` grant, because
 *     ad-hoc external sharing grants the individual, not a group. Their real
 *     UPN is recoverable from the claim (see `extractUpnFromLoginName`).
 *   - An internal user granted access directly (uncommon, but real) resolves
 *     the same way.
 *   - What this CANNOT resolve: a site's actual "Site Owners"/"Members" —
 *     SharePoint grants those to a GROUP (`siteGroup`), not to named
 *     individuals, and resolving a group's membership is a further Graph call
 *     per group that #1262 scoped as separate, larger collection work. A
 *     `siteGroup`/`sharePointGroup`/`group` grant is classified as
 *     `kind: "group"` — a real principal, but not a person to name — never
 *     guessed at as an admin.
 *
 * A named grant's `loginName` uses the same claims-based membership-provider
 * shape SharePoint has used for years: `i:0#.f|membership|user@domain.com` for
 * an internal member, and `i:0#.f|membership|user_partnerdomain.com#ext#@tenant
 * .onmicrosoft.com` for a B2B guest (the guest's own home email, `@` swapped
 * for `_`, ahead of the `#ext#` marker). `extractUpnFromLoginName` only ever
 * returns a value it can derive with confidence from that exact shape — an
 * unrecognised shape returns null rather than a guessed string.
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

/** A named-individual grant, beyond the four tenant-wide broad kinds. See the header. */
export type NamedSharingKind = "user" | "guest";

export type SiteSharingGrantKind = BroadSharingKind | NamedSharingKind;

/** One grant found on a site, kept whole so a report can cite it. */
export interface SiteSharingGrant {
  /** Graph's permission id, as returned. Null when the payload omitted it. */
  permissionId: string | null;
  kind: SiteSharingGrantKind;
  /** Human-readable principal or link description, for a report line. */
  principal: string;
  /** The raw SharePoint claim, when the grant is a principal rather than a link. */
  loginName: string | null;
  /** Real UPN, resolved only for a named `user`/`guest` grant. Null otherwise. */
  principalUpn: string | null;
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
  /**
   * Named individuals (`kind: "user"` / `"guest"`) resolved off the same
   * permission list, with a real UPN where the claim shape allows one. See
   * the header for what this can and cannot resolve. Does NOT include group
   * grants (`siteGroup`/`sharePointGroup`/`group` principals) — those name a
   * SharePoint or Entra group, not a person.
   */
  namedGrants: SiteSharingGrant[];
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
        principalUpn: null,
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
        principalUpn: null,
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
      return {
        permissionId,
        kind: hit.kind,
        principal: hit.principal,
        loginName: hit.loginName,
        principalUpn: null,
        roles,
        inherited,
      };
    }
  }

  return null;
}

/** SharePoint's claims-based membership-provider prefix for a real Entra identity. */
const MEMBERSHIP_LOGIN_PREFIX = "i:0#.f|membership|";

/** The marker SharePoint appends to a B2B guest's login name before its home tenant suffix. */
const GUEST_LOGIN_MARKER = "#ext#";

/**
 * Recovers a real UPN from a SharePoint claims-based membership login name.
 * Internal member: `i:0#.f|membership|user@domain.com` → `user@domain.com`.
 * B2B guest: `i:0#.f|membership|user_partnerdomain.com#ext#@tenant.onmicrosoft.com`
 * → `user@partnerdomain.com` (the guest's own home email, `@` escaped to `_`
 * ahead of the `#ext#` marker — SharePoint's documented guest login shape).
 * Returns null for anything that does not match this exact shape — a group
 * claim, an app claim, or a guest claim whose escaping doesn't decode cleanly
 * — rather than emitting a guessed string.
 */
export function extractUpnFromLoginName(loginName: string | null): string | null {
  if (!loginName || !loginName.startsWith(MEMBERSHIP_LOGIN_PREFIX)) return null;
  const claim = loginName.slice(MEMBERSHIP_LOGIN_PREFIX.length);

  const extIndex = claim.indexOf(GUEST_LOGIN_MARKER);
  if (extIndex === -1) {
    // Internal member — the claim IS the UPN already.
    return claim.includes("@") ? claim : null;
  }

  const guestPart = claim.slice(0, extIndex);
  if (guestPart.includes("@")) return guestPart;
  const lastUnderscore = guestPart.lastIndexOf("_");
  if (lastUnderscore === -1) return null;
  return `${guestPart.slice(0, lastUnderscore)}@${guestPart.slice(lastUnderscore + 1)}`;
}

/** True when the claim carries SharePoint's `#ext#` B2B-guest marker. */
export function isGuestLoginName(loginName: string | null): boolean {
  return !!loginName && loginName.startsWith(MEMBERSHIP_LOGIN_PREFIX) && loginName.includes(GUEST_LOGIN_MARKER);
}

/**
 * Classifies ONE identity as a named individual. Only the `siteUser` slot ever
 * carries a single person's own claim — `siteGroup`/`sharePointGroup`/`group`
 * are real principals but name a GROUP, not a person, and are deliberately not
 * consulted here (see the file header on what this cannot resolve).
 */
function classifyNamedUser(
  identity: unknown,
): { principal: string; loginName: string | null; upn: string | null; isGuest: boolean } | null {
  if (!isRecord(identity)) return null;
  const node = identity.siteUser;
  if (!isRecord(node)) return null;

  const loginName = stringOrNull(node.loginName);
  const displayName = stringOrNull(node.displayName);
  const email = stringOrNull(node.email);

  if (loginName) {
    // The two tenant-wide broad principals are not a named person.
    if (loginName.startsWith(EEEU_LOGIN_NAME_PREFIX) || loginName.startsWith(EVERYONE_LOGIN_NAME_PREFIX)) {
      return null;
    }
    const upn = email ?? extractUpnFromLoginName(loginName);
    return { principal: displayName ?? upn ?? "Unnamed user", loginName, upn, isGuest: isGuestLoginName(loginName) };
  }

  // Graph sometimes omits loginName; a broad claim always carries one, so a
  // displayName-only siteUser here is still a named person, just with no
  // resolvable UPN.
  if (displayName) {
    return { principal: displayName, loginName: null, upn: email, isGuest: false };
  }
  return null;
}

/**
 * Classifies one Graph `permission` object into a named (`user`/`guest`)
 * grant, or null when it is a link, a group grant, an app grant, or one of the
 * two broad tenant-wide principals. Reads the SAME payload
 * `classifySharingPermission` reads — no extra Graph call.
 */
export function classifyNamedSharingGrant(permission: unknown): SiteSharingGrant | null {
  if (!isRecord(permission)) return null;
  if (isRecord(permission.link)) return null; // a link never carries a named individual

  const permissionId = stringOrNull(permission.id);
  const roles = rolesOf(permission);
  const inherited = isRecord(permission.inheritedFrom);

  const candidates: unknown[] = [permission.grantedToV2];
  const many = permission.grantedToIdentitiesV2;
  if (Array.isArray(many)) candidates.push(...many);

  for (const candidate of candidates) {
    const hit = classifyNamedUser(candidate);
    if (hit) {
      return {
        permissionId,
        kind: hit.isGuest ? "guest" : "user",
        principal: hit.principal,
        loginName: hit.loginName,
        principalUpn: hit.upn,
        roles,
        inherited,
      };
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
  const namedGrants: SiteSharingGrant[] = [];
  for (const permission of permissions) {
    const grant = classifySharingPermission(permission);
    if (grant) grants.push(grant);

    const named = classifyNamedSharingGrant(permission);
    if (named) namedGrants.push(named);
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
    namedGrants,
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

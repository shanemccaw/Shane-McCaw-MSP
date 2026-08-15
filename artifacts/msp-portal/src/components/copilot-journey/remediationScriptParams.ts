/**
 * remediationScriptParams.ts — Git #782 (Phase 2 of 2, sub-issue of epic #647).
 * Substitutes real per-tenant values into `LIVE_STEP_SCRIPTS`' `<placeholder>`
 * brackets, using Phase 1's real endpoint (#776, `GET /api/portal/tenant-check-
 * items`) reading `tenant_check_item_details`.
 *
 * A separate module from `remediationLiveGuide.ts` on purpose: that file's own
 * job is resolving a step against the JOURNEY VIEW (findings, stats, evidence),
 * which is synchronous and already on hand by render time. This one resolves a
 * step's script against RAW PER-ITEM DATA, which has to be fetched — the two
 * stay decoupled so `remediationLiveGuide.ts` never grows an async dependency.
 * `RemediationGuideBody.tsx` composes them: `buildLiveRemediationSteps()` first,
 * then `applyLiveScriptParams()` on top for the five fillable steps.
 *
 * ══ CONFIRMED SCOPE (#782's own table, closed 2026-08-11) ═══════════════════
 *   s1  — 4 SharePoint site URLs  ← sharepoint:orgwide-links
 *   s9  — CA policy id            ← identity:ca-policy-count
 *   s11 — admin object id         ← identity:global-admin-count
 *   s12 — Safe Links policy name  ← security:safe-links-coverage
 *   s22 — department name         ← cost:group-based-licensing-adoption
 *
 * s5 and s14 are OUT OF SCOPE — Shane's own policy decisions, never filled from
 * a scan. They are not named anywhere in this file, on purpose: STEP_CHECK_KEYS
 * in remediationLiveGuide.ts is the evidence-matching map (and legitimately
 * carries more than one check for some steps, e.g. s9: ["identity:ca-policy-
 * count","identity:ca-report-only"]); FILLABLE_STEP_CHECK_KEYS below is a
 * DELIBERATELY NARROWER, single-check map — #782's own table, not a derivation
 * of the evidence map — because a script placeholder needs exactly one item
 * list to read a literal off, not "whichever of two checks fired a finding".
 *
 * ══ HOW MUCH OF EACH ITEM'S SHAPE IS ACTUALLY CONFIRMED ═════════════════════
 * `monitor_checks.properties` / `.mapping` / `.endpoint` (what Graph field
 * names a check's raw items really carry) is DB-only runtime data — it is not
 * in this repo (confirmed repeatedly across this codebase's own migrations;
 * see e.g. the #357 and #551 migration files' own callouts). Grepping the repo
 * can confirm a check's shape only where a migration or executor file happens
 * to document it. That happened for exactly one of the five:
 *
 *   s11 (identity:global-admin-count) — CONFIRMED. The #551 migration
 *   (lib/db/migrations/manual/2026-08-07-global-admin-count-role-members-
 *   551.sql) sets this check's `properties` to
 *   ["id","displayName","userPrincipalName","mail","@odata.type"] against
 *   `GET /directoryRoles(roleTemplateId='...')/members` — a real, in-repo,
 *   byte-quoted field list.
 *
 * The other four (s1, s9, s12, s22) have no in-repo migration or executor code
 * naming their real field list — `docs/endpoints.json` (a live catalog dump)
 * confirms only their coarse `endpoint`, not `properties`/`mapping`. Rather
 * than invent a single field name for these, each resolver below tries a short
 * list of the REAL field names Microsoft's own documented schema (or this
 * platform's own established PowerShell-cmdlet convention, evidenced by each
 * step's own script — e.g. s1/s2's `Get-SPOSite | Select-Object Url,...`, s12's
 * `Get-SafeLinksPolicy | Select-Object Name,...`) would actually use for that
 * resource — and substitutes ONLY when one of those fields is actually present
 * with a real value on a real item. Finding none is treated exactly like "no
 * collection ever ran": the placeholder stays. This never fabricates a value —
 * it only ever reads a value that is really there — but Shane should confirm
 * each of these four against a live `SELECT properties FROM monitor_checks
 * WHERE key = '...'` before trusting the substitution rate is as high as it
 * could be.
 */

import type { RemediationCode } from "./previewRemediationGuide.ts";

/* ------------------------------------------------------------------ *
 * 1 · The wire shape (mirrors portal-tenant-check-items.ts's WireCheckItemDetail)
 * ------------------------------------------------------------------ */

/**
 * Duplicated rather than imported — msp-portal carries no dependency on
 * api-server, the same reason useRemediationTracker.ts keeps its own copy of
 * the tracker wire shape.
 */
export interface CheckItemDetail {
  readonly checkKey: string;
  readonly status: string;
  readonly itemCount: number;
  readonly items: readonly unknown[] | null;
  readonly itemsOmitted: boolean;
  readonly itemsOmittedReason: string | null;
  readonly collectedAt: string;
}

/** `GET /api/portal/tenant-check-items`'s `items` map, keyed by check key. */
export type CheckItemsByKey = Readonly<Record<string, CheckItemDetail>>;

/** #782's own table — one check per fillable step. See this file's header. */
export const FILLABLE_STEP_CHECK_KEYS: Readonly<Record<string, string>> = {
  s1: "sharepoint:orgwide-links",
  s9: "identity:ca-policy-count",
  s11: "identity:global-admin-count",
  s12: "security:safe-links-coverage",
  s22: "cost:group-based-licensing-adoption",
};

/* ------------------------------------------------------------------ *
 * 2 · Shared extraction helpers
 * ------------------------------------------------------------------ */

function asItem(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

/**
 * The real, usable item list for a check, or `null` for every reason a script
 * must fall back to its placeholder: no collection ever ran (the key is absent
 * from the map), the check didn't succeed (anything but `status: "ok"` —
 * error/consent_revoked/requires_script/license_gap all persist a row with no
 * trustworthy `items`, see item-detail-collector.ts), the payload was too large
 * to store (`itemsOmitted`), or it collected zero items.
 *
 * `status !== "ok"` is deliberately the ONLY status trusted here, even though
 * CheckResult also has a `"partial"` value — item-detail-collector.ts writes
 * `partial` at the RUN level (some checks in the run failed), not as a promise
 * about any one check's own row, so there is no in-repo confirmation that a
 * single row carrying `status: "partial"` has a complete, trustworthy item
 * list. Treating only `"ok"` as usable is the conservative reading.
 */
function usableItems(detail: CheckItemDetail | undefined): readonly Record<string, unknown>[] | null {
  if (!detail) return null;
  if (detail.status !== "ok") return null;
  if (detail.itemsOmitted) return null;
  if (!Array.isArray(detail.items) || detail.items.length === 0) return null;
  const items = detail.items.map(asItem).filter((x): x is Record<string, unknown> => x !== null);
  return items.length > 0 ? items : null;
}

/** First non-blank string across a candidate field-name list, tried in order. */
function firstString(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** First non-blank string at a candidate DOTTED-PATH list, e.g. "conditions.users.excludeGroups". */
function firstPath(item: Record<string, unknown>, paths: readonly string[]): unknown {
  for (const path of paths) {
    let cur: unknown = item;
    for (const part of path.split(".")) {
      if (cur === null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur !== undefined) return cur;
  }
  return undefined;
}

function isNonEmptyArray(v: unknown): v is readonly unknown[] {
  return Array.isArray(v) && v.length > 0;
}

/* ------------------------------------------------------------------ *
 * 3 · Per-check resolvers — each returns the real value(s) to substitute,
 *     or null/[] when nothing in the item shape cleanly maps.
 * ------------------------------------------------------------------ */

/**
 * s1 — sharepoint:orgwide-links → up to 4 real site URLs.
 *
 * Field candidates cover both plausible sources: `Url`/`SiteUrl` (the PowerShell
 * SPO Admin cmdlet convention this exact step's Step-2 sibling script already
 * uses — `Get-SPOSite | Select-Object Url,...`) and `webUrl`/`siteUrl` (Graph's
 * own `site` resource field, learn.microsoft.com/graph/api/resources/site).
 * Order as returned — there is no severity/sensitivity signal on a raw site
 * item to rank "most sensitive" by, so the first four are used rather than an
 * invented ordering.
 */
const SITE_URL_FIELDS = ["Url", "SiteUrl", "webUrl", "siteUrl", "url"] as const;

function resolveOrgwideSiteUrls(items: readonly Record<string, unknown>[]): readonly string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const url = firstString(item, SITE_URL_FIELDS);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
      if (urls.length === 4) break;
    }
  }
  return urls;
}

/**
 * s9 — identity:ca-policy-count → the id of a policy that is disabled OR
 * carries an exclusion (the placeholder's own fill-in text, byte-matched: "the
 * id of the policy the first command lists as disabled or carrying an
 * exclusion"). `id` is the confirmed, stable Graph `conditionalAccessPolicy`
 * field (learn.microsoft.com/graph/api/resources/conditionalaccesspolicy);
 * `Id` covers the Microsoft Graph PowerShell SDK's PascalCase convention in
 * case this check is collected through Get-MgIdentityConditionalAccessPolicy
 * (the same cmdlet this very step's script opens with) rather than raw REST.
 *
 * Deliberately does NOT fall back to "the first policy" when none is disabled
 * or excluded — that would be a real id, but not one matching what the
 * placeholder actually asks for, which is worse than leaving it as a
 * placeholder (#441 is the record of exactly that class of mistake).
 */
const CA_ID_FIELDS = ["id", "Id"] as const;
const CA_STATE_FIELDS = ["state", "State"] as const;
const CA_EXCLUDE_GROUP_PATHS = ["conditions.users.excludeGroups", "Conditions.Users.ExcludeGroups"] as const;
const CA_EXCLUDE_USER_PATHS = ["conditions.users.excludeUsers", "Conditions.Users.ExcludeUsers"] as const;

function resolveCaPolicyId(items: readonly Record<string, unknown>[]): string | null {
  for (const item of items) {
    const state = firstString(item, CA_STATE_FIELDS);
    const disabled = state !== null && state.toLowerCase() !== "enabled";
    const excluded = isNonEmptyArray(firstPath(item, CA_EXCLUDE_GROUP_PATHS)) || isNonEmptyArray(firstPath(item, CA_EXCLUDE_USER_PATHS));
    if (disabled || excluded) {
      const id = firstString(item, CA_ID_FIELDS);
      if (id) return id;
    }
  }
  return null;
}

/**
 * s11 — identity:global-admin-count → one administrator's object id.
 *
 * CONFIRMED shape (#551 migration, see this file's header): `id`,
 * `displayName`, `userPrincipalName`, `mail`, `"@odata.type"`. Prefers a real
 * human (`#microsoft.graph.user`) over a role-assignable group or service
 * principal, matching the fill-in text ("one administrator's object id") and
 * Step 7's own script, which lists administrators by name — a group or app
 * identity id would not be something the reader could cross-reference there.
 * Falls back to the first member of any type if no human member is present
 * (a real id is still better than none when the whole point of Step 11 is
 * reducing every standing member, not only human ones).
 */
const ADMIN_ID_FIELDS = ["id"] as const;
const ADMIN_ODATA_TYPE_FIELD = "@odata.type";

function resolveGlobalAdminObjectId(items: readonly Record<string, unknown>[]): string | null {
  let fallback: string | null = null;
  for (const item of items) {
    const id = firstString(item, ADMIN_ID_FIELDS);
    if (!id) continue;
    if (fallback === null) fallback = id;
    if (item[ADMIN_ODATA_TYPE_FIELD] === "#microsoft.graph.user") return id;
  }
  return fallback;
}

/**
 * s12 — security:safe-links-coverage → the name of a policy that is switched
 * OFF (`IsEnabled` false), matching the step's own purpose ("Reinstate any
 * Safe Links policy that has been switched off") and fill-in text ("the policy
 * name the first command returns"). Safe Links policies have no Graph v1.0
 * surface at all (Security & Compliance PowerShell only), and this step's own
 * script opens with `Get-SafeLinksPolicy | Select-Object Name, IsEnabled,
 * WhenChangedUTC` — the exact cmdlet a PowerShell-backed collection of this
 * check would run, so `Name`/`IsEnabled` (its own real output columns) are the
 * primary candidates, with lowercase fallbacks in case of a normalised store.
 *
 * Does NOT fall back to "the first policy" when none is disabled — a name
 * substituted onto an already-enabled policy would tell the reader to
 * "reinstate" something that was never off, which is a plausible-but-wrong
 * instruction, not a neutral placeholder.
 */
const SAFE_LINKS_NAME_FIELDS = ["Name", "name", "Identity", "identity"] as const;
const SAFE_LINKS_ENABLED_FIELDS = ["IsEnabled", "isEnabled", "Enabled", "enabled"] as const;

function resolveDisabledSafeLinksPolicyName(items: readonly Record<string, unknown>[]): string | null {
  for (const item of items) {
    const isEnabled = SAFE_LINKS_ENABLED_FIELDS.map((f) => item[f]).find((v) => typeof v === "boolean");
    if (isEnabled === false) {
      const name = firstString(item, SAFE_LINKS_NAME_FIELDS);
      if (name) return name;
    }
  }
  return null;
}

/**
 * s22 — cost:group-based-licensing-adoption → one real department name.
 *
 * The check's confirmed endpoint is `GET /groups` (2026-07-26 cost-waste-and-
 * heatmap-check-audit.sql), returning raw Graph `group` objects — which carry
 * no native "department" field; a group has members, not a department of its
 * own. There is no confirmed field this can read a department off DIRECTLY.
 *
 * What IS real: `displayName` is a guaranteed, always-present Graph group
 * field, and this exact step's own script creates FUTURE group-based-licensing
 * groups following a fixed name pattern — `New-MgGroup -DisplayName
 * "LIC-E5-<Department>"`. If this tenant has ALREADY adopted group-based
 * licensing (which is the entire premise of this check), an existing group
 * following that same convention is real evidence of a real department name in
 * this tenant's own directory — not an invented one. Only a `displayName`
 * matching that exact `LIC-<sku>-<department>` shape is used; anything else
 * (a group with assignedLicenses but an unrelated name) correctly leaves the
 * placeholder in place, since there would be nothing to read a department
 * value FROM.
 */
const LICENSING_GROUP_NAME_RE = /^LIC-[^-]+-(.+)$/i;
const GROUP_DISPLAY_NAME_FIELDS = ["displayName", "DisplayName"] as const;

function resolveDepartmentFromLicensingGroups(items: readonly Record<string, unknown>[]): string | null {
  for (const item of items) {
    const name = firstString(item, GROUP_DISPLAY_NAME_FIELDS);
    if (!name) continue;
    const m = LICENSING_GROUP_NAME_RE.exec(name);
    if (m && m[1].trim().length > 0) return m[1].trim();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 4 · Composition — apply a step's real values onto its already-resolved code
 * ------------------------------------------------------------------ */

/**
 * `baseCode` is the step's ALREADY-RESOLVED script (`LiveRemediationStep.code`)
 * — `LIVE_STEP_SCRIPTS[stepId]` when one exists, or the design's own step code
 * when it doesn't (s11's case — see remediationLiveGuide.ts's own comment on
 * why it carries no `LIVE_STEP_SCRIPTS` entry). Passing it in rather than
 * re-authoring each script here means this file can never drift from the
 * script text either of those two sources actually renders.
 *
 * Returns `null` — meaning "render `baseCode` unchanged" — for every step not
 * in `FILLABLE_STEP_CHECK_KEYS`, and for a fillable step when nothing usable
 * was found. Never returns a code object with a `<placeholder>` PARTIALLY
 * replaced: either every value that step's script needs was found, or nothing
 * about it changes.
 */
export function applyLiveScriptParams(
  stepId: string,
  baseCode: RemediationCode,
  checkItems: CheckItemsByKey,
): RemediationCode | null {
  const checkKey = FILLABLE_STEP_CHECK_KEYS[stepId];
  if (!checkKey) return null;
  const items = usableItems(checkItems[checkKey]);
  if (!items) return null;

  switch (stepId) {
    case "s1": {
      const urls = resolveOrgwideSiteUrls(items);
      if (urls.length === 0) return null;
      const block = `$sites = @(\n${urls.map((u) => `  "${u}"`).join(",\n")}\n)\n`;
      const ARRAY_BLOCK_RE = /\$sites = @\(\n[\s\S]*?\n\)\n/;
      if (!ARRAY_BLOCK_RE.test(baseCode.script)) return null;
      return { ...baseCode, script: baseCode.script.replace(ARRAY_BLOCK_RE, block) };
    }
    case "s9": {
      const id = resolveCaPolicyId(items);
      if (!id || !baseCode.script.includes("<ca-policy-id>")) return null;
      return { ...baseCode, script: baseCode.script.split("<ca-policy-id>").join(id) };
    }
    case "s11": {
      const id = resolveGlobalAdminObjectId(items);
      if (!id || !baseCode.script.includes("<user-object-id>")) return null;
      return { ...baseCode, script: baseCode.script.split("<user-object-id>").join(id) };
    }
    case "s12": {
      const name = resolveDisabledSafeLinksPolicyName(items);
      if (!name || !baseCode.script.includes("<your-safe-links-policy>")) return null;
      return { ...baseCode, script: baseCode.script.split("<your-safe-links-policy>").join(name) };
    }
    case "s22": {
      const dept = resolveDepartmentFromLicensingGroups(items);
      if (!dept || !baseCode.script.includes("<Department>") || !baseCode.script.includes("<department>")) return null;
      const nickname = dept.toLowerCase().replace(/\s+/g, "");
      return {
        ...baseCode,
        script: baseCode.script.split("<Department>").join(dept).split("<department>").join(nickname),
      };
    }
    default:
      return null;
  }
}

/**
 * Git #1042 — fills the `<your-tenant>` SharePoint-subdomain placeholder
 * wherever it appears in a script, given the tenant's real SharePoint admin
 * prefix (`GET /api/portal/tenant-check-items`'s `sharePointTenantPrefix`,
 * resolved server-side the same way `resolveSharePointTenantRef` in
 * monitor-executor.ts resolves it for the live SharePoint-admin check path).
 *
 * Deliberately separate from `applyLiveScriptParams` above: that function's
 * per-step resolvers each read a specific CHECK's item data (s1's own site
 * URLs already carry a real `<your-tenant>` value once any of those resolve),
 * but the tenant's SharePoint prefix is a single tenant-wide fact, not tied to
 * any one check's collection succeeding — s1's `<your-tenant>` fragments still
 * need filling when `sharePointwide-links` never collected any usable items,
 * and `LIVE_PRELUDE`'s connect block (rendered outside `LIVE_STEP_SCRIPTS`
 * entirely — see `RemediationGuideBody.tsx`) needs the same fill with no step
 * or check involved at all. Same discipline as everything else in this file:
 * substitutes only when the prefix is really there, never fabricates one.
 */
export function applyLiveTenantDomain(script: string, sharePointTenantPrefix: string | null): string {
  if (!sharePointTenantPrefix || !script.includes("<your-tenant>")) return script;
  return script.split("<your-tenant>").join(sharePointTenantPrefix);
}

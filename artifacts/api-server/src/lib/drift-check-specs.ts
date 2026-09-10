/**
 * drift-check-specs.ts — the per-check drift specification registry (Git #1287).
 *
 * #1283 wired the Configuration Drift engine (#1270, drift-collector.ts) into a
 * SINGLE check, Conditional Access, inline in the graph executor path. #1287
 * generalises that: instead of one hard-coded call, a check is drift-tracked iff
 * it has an entry here, and the entry knows how to turn that check's completed
 * scan into a STABLE comparable config object (or an honest reason it can't).
 * `maybeCollectDriftForCheck` (drift-collector.ts) is the impure half that reads
 * a spec from here and drives collectDrift + the honest status record; this file
 * is pure and unit-tested without a database.
 *
 * ── Why this is executor-agnostic ────────────────────────────────────────────
 * Every executor path in monitor-executor.ts (graph / powershell /
 * sharepoint-admin / dns / fan-out) converges on the same trio — a collected
 * `items` list, the mapped `extracted` properties, and an honest run `status` —
 * before it persists. A `DriftScanContext` is exactly that trio, so ONE spec
 * shape works for a domain regardless of which executor produced it. The domains
 * below deliberately span four of the five executor types (graph, fan-out,
 * sharepoint-admin, dns) to prove the mechanism is not Graph-specific.
 *
 * ── The array footgun this file exists to avoid ──────────────────────────────
 * `detectDrift` (pcc/drift-detector.ts) diffs arrays POSITIONALLY and collapses
 * any length change into a single whole-array `replace`. Diffing a raw site or
 * team LIST would therefore report "everything changed" the moment one row is
 * added or reordered. So every builder here emits an object keyed by a STABLE
 * identity (site id, team id) — a new site becomes an `add` at `/sites/<id>`, a
 * revoked share a `replace` at `/sites/<id>/highestSharingLevel`, a removed site
 * a `remove` — which is the real per-entity drift the UI wants.
 *
 * Conditional Access was the one exception, kept on #1283's positional
 * `{ policies: [...] }` array so already-captured baselines stayed valid. #3089
 * closed it: a policy being CREATED or DELETED is the most security-relevant
 * Conditional Access change there is, and the length change collapsed it into one
 * opaque `/policies` replace carrying the whole before/after array — no policy id,
 * no display name, and (since #2819) nothing an attribution scope could match to
 * an object, so an unapproved deletion could still be absorbed by an unrelated
 * approved policy edit. CA is now id-keyed like every other domain. The baselines
 * that exception protected are handled by a real, versioned migration rather than
 * by keeping the wrong shape — see {@link DriftCheckSpec.configVersion}.
 *
 * ── Reshaping a builder is a MIGRATION, never just an edit ───────────────────
 * A stored baseline is diffed against whatever the builder emits today, so the
 * two must speak the same dialect. Changing a builder's shape without migrating
 * would report the entire tenant as drifted on the next scan. A spec that has
 * reshaped therefore declares a `configVersion` and a `migrateBaselineConfig`
 * that upgrades an older snapshot (and rewrites the setting paths of the drift
 * events already recorded against it); `drift-collector.ts` applies it in place
 * before it diffs. Bumping the version without supplying the migration is caught
 * by the collector, which refuses to diff across shapes.
 *
 * ── Honest not_comparable ────────────────────────────────────────────────────
 * Where a scan genuinely can't yield a trustworthy diff — a fan-out that hit its
 * coverage cap (un-scanned sites would look "removed"), or a run that didn't
 * complete — the builder returns `{ comparable: false, reason }` with a SPECIFIC
 * reason string. The collector persists that to drift_collection_status so the UI
 * shows why drift isn't tracked this run rather than a silent gap or a fabricated
 * "no drift detected".
 */

/** Honest outcome of trying to build a comparable drift config from a completed scan. */
export type DriftConfigOutcome =
  | { comparable: true; config: unknown }
  | { comparable: false; reason: string };

/**
 * The executor-agnostic view of a completed check a spec builds its config from.
 * Populated identically by every path in monitor-executor.ts right before persist.
 */
export interface DriftScanContext {
  /** The collected items: Graph items, normalised fan-out rows, or the single dns/sp item. */
  items: unknown[];
  /** The mapped extracted_properties for the run (carries `_fanOut` on fan-out checks). */
  extracted: Record<string, unknown>;
  /** Honest run status from the executor ("ok" | "partial" | "error" | ...). */
  status: string;
}

/**
 * Attribution strategy tag; the executor resolves it to a per-setting attribution fn.
 *
 * #2819 renamed the one live value from `ca-change-request` (a CATEGORY blanket —
 * any recent completed ConditionalAccess CR marked every drifted setting
 * `approved`) to `change-request-scope`: attribution now goes through #2759's real
 * `config_change_scopes` bridge and matches per resource / object / property. The
 * strategy is no longer Conditional-Access-specific, which is why the tag is not
 * either — any domain that declares an {@link DriftSettingIdentity} can use it.
 */
export type DriftAttributionKind = "change-request-scope";

/**
 * How a drift `setting` path resolves to the OBJECT the change touched (#2819,
 * re-grounded by #3089).
 *
 * Per-setting attribution has to answer "which Conditional Access policy is this
 * drift event about?". Under #2819 that answer had to be reconstructed: the
 * config was a positional array, so the path said `/policies/3/state` and the
 * only thing that could turn `3` into a policy id was the scan's own item list —
 * plus a guard checking the baseline agreed that index 3 was the same object,
 * because `detectDrift` walks arrays positionally and Graph does not promise a
 * stable order. #3089 removed the reconstruction entirely by keying the config
 * itself: the path is now `/policies/<policyId>/state` and the identity IS the
 * path segment.
 *
 * So a domain only declares WHERE its objects live in the comparable config it
 * builds, and the builder must key that collection by the object's own stable id
 * (the Graph `id`, a site id, a team id). `drift-change-attribution.ts` does the
 * rest — with no scan items, no baseline items and no positional guard, because
 * there is no longer a position to be wrong about.
 *
 * A domain WITHOUT this cannot be attributed per setting, and therefore is not
 * attributed at all rather than attributed by category — which is the whole
 * point of #2819.
 */
export interface DriftSettingIdentity {
  /**
   * Top-level property of the comparable config holding the objects, keyed by
   * their own stable id (e.g. `policies` for `{ policies: { "<policyId>": … } }`).
   */
  collection: string;
}

/**
 * The outcome of upgrading a stored baseline snapshot to the spec's current
 * config shape (#3089).
 *
 * `migrated` carries the reshaped config plus, optionally, a rewrite for the
 * setting paths of drift events already recorded against that snapshot — those
 * paths address the OLD shape, and leaving them would make the next scan read
 * them as "returned to baseline" (a resolution that never happened) while the
 * same drift reappears under a new path.
 *
 * `impossible` is the honest answer when the stored config cannot be expressed
 * in the new shape at all (e.g. a legacy CA baseline holding a policy with no
 * usable id). The collector then supersedes it and captures a fresh baseline,
 * recording the specific reason — a re-baseline, which does lose the old
 * reference point, but is the only alternative to diffing two dialects.
 */
export type BaselineMigrationOutcome =
  | { migrated: true; config: unknown; rewriteSetting?: (setting: string) => string | null }
  | { migrated: false; reason: string };

/**
 * How to recover a human display name for the object a drift `setting` path
 * names, for the timeline label (Git #3364).
 *
 * #3089 keyed every domain's comparable config by the object's own stable id
 * (`/policies/<policyId>/state`, `/teams/<teamId>/visibility`, …), which is the
 * right fix for attribution but left the RENDERED label reading the raw id —
 * `/policies/aaaaaaaa-1111-.../state changed` names the right object and
 * communicates nothing to whoever reads the timeline.
 *
 * `displayNameProperty` says which property of the object VALUE the builder
 * stores (see `DriftSettingIdentity.collection`) carries a human name — e.g.
 * `displayName` for CA policies/Teams, `url` for a SharePoint site with no
 * friendlier name. A domain without this hint (or without `identity` at all)
 * falls back to the raw setting path, same as before — see
 * {@link resolveDriftEventLabel}.
 */
export interface DriftLabelHint {
  /** Property on the object at `identity.collection[<id>]` holding the display name. */
  displayNameProperty: string;
}

export interface DriftCheckSpec {
  /** Bare drift domain slug stored on drift_events.domain_key (metric sourceKey minus "drift:"). */
  domainKey: string;
  /** Human label for logs / status rows. */
  label: string;
  /** Optional attribution strategy the executor wires in (only CA has one today). */
  attribution?: DriftAttributionKind;
  /**
   * Required alongside `attribution` — without it a setting path cannot be tied
   * to an object and nothing can be attributed. See {@link DriftSettingIdentity}.
   */
  identity?: DriftSettingIdentity;
  /**
   * Optional alongside `identity` — how to recover a display name for the
   * object a setting path names, for the rendered timeline label. See
   * {@link DriftLabelHint} and {@link resolveDriftEventLabel}.
   */
  labelHint?: DriftLabelHint;
  /**
   * #3089 — the SHAPE version `buildConfig` currently emits. Omitted means 1 (the
   * original shape); every stored snapshot predating versioning is version 1 too,
   * so an unreshaped domain compares equal and nothing runs.
   *
   * Bumping this is the ONLY sanctioned way to change a builder's config shape,
   * and it obliges `migrateBaselineConfig`: the collector refuses to diff a
   * baseline whose version is behind the spec's without one, rather than
   * silently reporting a whole tenant as drifted.
   */
  configVersion?: number;
  /**
   * Pure: upgrade a stored baseline `config` captured at `fromVersion` to the
   * shape `buildConfig` emits today. Called once, on read, only while
   * `fromVersion < configVersion`; the collector persists the result in place.
   */
  migrateBaselineConfig?(config: unknown, fromVersion: number): BaselineMigrationOutcome;
  /** Pure: a completed scan → a stable comparable config, or an honest reason it isn't. */
  buildConfig(ctx: DriftScanContext): DriftConfigOutcome;
}

/** The shape version a spec's `buildConfig` emits (1 when it has never been reshaped). */
export function specConfigVersion(spec: DriftCheckSpec): number {
  return spec.configVersion ?? 1;
}

// ── small pure helpers ────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** True only for a run that completed cleanly enough to trust its full item set. */
function isCompleteRun(status: string): boolean {
  return status === "ok";
}

/** The _fanOut coverage block a fan-out run stamps onto its extracted properties. */
function fanOutCoverage(extracted: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(extracted._fanOut) ? extracted._fanOut : undefined;
}

// ── config builders (one per domain) ──────────────────────────────────────────

/** The shape version {@link buildCaPolicyDriftConfig} emits: 1 = #1283's positional array, 2 = #3089's id-keyed map. */
export const CA_POLICY_CONFIG_VERSION = 2;

/**
 * Conditional Access (graph) — id-keyed since #3089, `{ policies: { "<id>": <policy> } }`.
 *
 * #1283 emitted `{ policies: ctx.items }`, the raw array. Because `detectDrift`
 * collapses any array LENGTH change into a single whole-array `replace`, creating
 * or deleting a policy — the most security-relevant Conditional Access change
 * there is — landed as one opaque `/policies` event carrying the entire before and
 * after array, with no policy id and no display name. Worse, #2819's per-setting
 * attribution can only resolve such a path to `objectIdentity: null`, so it
 * matched at RESOURCE precision: an unapproved deletion could be explained away by
 * an unrelated approved edit to a different policy. Keying by the policy's own
 * Graph id makes a creation an `add` at `/policies/<id>`, a deletion a `remove`,
 * and a state flip a `replace` at `/policies/<id>/state` — each naming the object
 * it is about, which is exactly what makes it attributable per policy.
 *
 * The VALUE is the scan item verbatim, unchanged from #1283, so the migration
 * from the old shape is a pure re-key that loses nothing (see
 * {@link migrateCaPolicyBaselineConfig}).
 *
 * A policy with no usable id, or two policies sharing one id, is refused rather
 * than dropped: silently omitting a policy from the keyed config would surface on
 * the next scan as a `remove` — a deletion that never happened, which is the same
 * class of fabricated finding the fan-out coverage guard below exists to prevent.
 * (Contrast the teams/sites builders, which skip an id-less item: those enumerate
 * a broad population where an id-less row is noise, whereas a CA policy set is
 * small, wholly security-relevant, and always id-bearing in Graph.)
 */
export function buildCaPolicyDriftConfig(ctx: DriftScanContext): DriftConfigOutcome {
  if (!isCompleteRun(ctx.status)) {
    return { comparable: false, reason: `Conditional Access scan did not complete (status "${ctx.status}") — no policy set to compare` };
  }
  const keyed = keyPoliciesById(ctx.items);
  if (!keyed.ok) {
    return { comparable: false, reason: `Conditional Access policy set could not be keyed by policy id (${keyed.reason}) — an unkeyable policy would read as a deletion on the next scan` };
  }
  return { comparable: true, config: { policies: keyed.policies } };
}

/** Pure: raw CA policy items → an id-keyed map, or the specific reason they cannot be keyed. */
function keyPoliciesById(
  items: readonly unknown[],
): { ok: true; policies: Record<string, unknown> } | { ok: false; reason: string } {
  const policies: Record<string, unknown> = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!isRecord(it)) return { ok: false, reason: `item at index ${i} is not an object` };
    const id = strOrNull(it.id);
    if (!id) return { ok: false, reason: `policy at index ${i} has no "id"` };
    if (id in policies) return { ok: false, reason: `policy id "${id}" appears more than once` };
    policies[id] = it;
  }
  return { ok: true, policies };
}

/**
 * Upgrade a stored Conditional Access baseline from #1283's positional array to
 * #3089's id-keyed map (#3089).
 *
 * This is a pure RE-KEY, not a re-capture: every policy object is carried across
 * byte-for-byte, so the upgraded snapshot is the same approved reference state
 * expressed under a different address — which is why the collector applies it in
 * place, keeping the snapshot id, its `capturedAt`, its `signed` flag and the
 * drift events already attached to it.
 *
 * `rewriteSetting` moves those events' paths with the config. A stored
 * `/policies/3/state` indexes the BASELINE array (that is the side the diff walked
 * from), so index 3's id in this very config is the policy that event is about.
 * Paths that cannot move — `/policies` itself, the opaque whole-collection event
 * this issue is about — return null, since the per-policy events replacing them
 * are not derivable from a stored index.
 */
export function migrateCaPolicyBaselineConfig(config: unknown, fromVersion: number): BaselineMigrationOutcome {
  if (fromVersion !== 1) {
    return { migrated: false, reason: `no Conditional Access baseline migration from shape version ${fromVersion}` };
  }
  const legacy = isRecord(config) ? config.policies : undefined;
  if (!Array.isArray(legacy)) {
    return { migrated: false, reason: `version 1 baseline does not hold a "policies" array (found ${describeShape(isRecord(config) ? config.policies : config)})` };
  }
  const keyed = keyPoliciesById(legacy);
  if (!keyed.ok) {
    return { migrated: false, reason: `stored baseline cannot be keyed by policy id (${keyed.reason})` };
  }
  const idAt = (index: number): string | null => {
    const it = legacy[index];
    return isRecord(it) ? strOrNull(it.id) : null;
  };
  return {
    migrated: true,
    config: { policies: keyed.policies },
    rewriteSetting: (setting: string) => {
      const m = /^\/policies\/(\d+)(\/.*)?$/.exec(setting);
      if (!m) return null;
      const id = idAt(Number(m[1]));
      return id ? `/policies/${id}${m[2] ?? ""}` : null;
    },
  };
}

/** Short human description of a value's shape, for an honest migration-refusal reason. */
function describeShape(v: unknown): string {
  if (v === undefined) return "nothing";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return typeof v === "object" ? "an object" : typeof v;
}

/**
 * Public/discoverable Teams (graph). Items are `{ id, displayName, visibility }`.
 * Keyed by team id → a team flipping Public↔Private is a precise `replace` at
 * `/teams/<id>/visibility`; a newly-created public team is an `add`.
 */
export function buildPublicTeamsDriftConfig(ctx: DriftScanContext): DriftConfigOutcome {
  if (!isCompleteRun(ctx.status)) {
    return { comparable: false, reason: `Teams enumeration did not complete (status "${ctx.status}") — a partial team list would falsely report the un-enumerated teams as removed` };
  }
  const teams: Record<string, unknown> = {};
  for (const it of ctx.items) {
    if (!isRecord(it)) continue;
    const id = strOrNull(it.id);
    if (!id) continue;
    teams[id] = {
      displayName: strOrNull(it.displayName),
      visibility: strOrNull(it.visibility),
    };
  }
  return { comparable: true, config: { teams } };
}

/**
 * SharePoint external site sharing (fan-out). Items are the normalised
 * per-site summaries (sharepoint-sharing.ts). Keyed by site id → a newly
 * overshared site is an `add`, a revoked share a `replace`, a site whose sharing
 * dropped to clean a `replace` on the booleans.
 *
 * COVERAGE GUARD: this is the concrete honest-fallback case. A fan-out that hit
 * its item cap (`truncated`) or didn't fully succeed would diff a PARTIAL site
 * set against a full baseline, reporting every un-scanned site as a `remove` —
 * a fabricated "shares were revoked" that never happened. So an incomplete run
 * is refused with a specific reason instead of writing false drift.
 */
export function buildEeeuSiteSharingDriftConfig(ctx: DriftScanContext): DriftConfigOutcome {
  const fo = fanOutCoverage(ctx.extracted);
  if (fo?.truncated === true) {
    const scanned = fo.sourceItemsScanned ?? "?";
    const eligible = fo.sourceItemsEligible ?? "?";
    return {
      comparable: false,
      reason: `site scan truncated at the fan-out cap (${scanned}/${eligible} eligible sites scanned) — diffing a partial site set would falsely report the un-scanned sites as removed shares`,
    };
  }
  if (!isCompleteRun(ctx.status)) {
    const succeeded = fo?.sourceItemsSucceeded ?? "?";
    const scannedCount = fo?.sourceItemsScanned ?? "?";
    return {
      comparable: false,
      reason: `site scan coverage incomplete (status "${ctx.status}", ${succeeded}/${scannedCount} sites returned data) — diffing an incomplete site set would falsely report the un-scanned sites as removed shares`,
    };
  }
  const sites: Record<string, unknown> = {};
  for (const it of ctx.items) {
    if (!isRecord(it)) continue;
    const id = strOrNull(it.siteId);
    if (!id) continue;
    sites[id] = {
      url: strOrNull(it.siteUrl),
      broadAccess: it.broadAccess === true,
      highestSharingLevel: strOrNull(it.highestSharingLevel),
      hasEeeu: it.hasEeeu === true,
      hasEveryone: it.hasEveryone === true,
      hasAnonymousLink: it.hasAnonymousLink === true,
      hasOrganizationLink: it.hasOrganizationLink === true,
    };
  }
  return { comparable: true, config: { sites } };
}

/**
 * SharePoint tenant sharing capability (sharepoint-admin). A single tenant-wide
 * setting — the most stable drift signal of all: the whole "can this tenant
 * share externally at all, and how far" posture in one enum. A change here is a
 * `replace` at `/sharingCapability`.
 */
export function buildTenantSharingCapabilityDriftConfig(ctx: DriftScanContext): DriftConfigOutcome {
  if (!isCompleteRun(ctx.status)) {
    return { comparable: false, reason: `SharePoint tenant sharing capability could not be read this run (status "${ctx.status}")` };
  }
  const it = ctx.items.find(isRecord);
  if (!it) {
    return { comparable: false, reason: "SharePoint tenant sharing capability scan returned no setting to compare" };
  }
  return {
    comparable: true,
    config: {
      sharingCapability: typeof it.sharingCapability === "number" ? it.sharingCapability : null,
      sharingCapabilityName: strOrNull(it.sharingCapabilityName),
    },
  };
}

/**
 * Email authentication posture (dns) — SPF / DKIM / DMARC. A single deterministic
 * item (public DNS). The raw SPF and DMARC record strings and the DKIM selectors
 * found are the honest comparison surface; a record edit or a DKIM key vanishing
 * is a `replace`. Selectors are sorted for a stable positional diff.
 */
export function buildEmailAuthDriftConfig(ctx: DriftScanContext): DriftConfigOutcome {
  const it = ctx.items.find(isRecord);
  if (!it) {
    return { comparable: false, reason: "DNS posture scan returned no record set to compare" };
  }
  const dkim = Array.isArray(it.dkimFoundAtDefaultSelectors)
    ? [...(it.dkimFoundAtDefaultSelectors as unknown[])].map((s) => String(s)).sort()
    : [];
  return {
    comparable: true,
    config: {
      spfRecord: strOrNull(it.spfRecord),
      dmarcRecord: strOrNull(it.dmarcRecord),
      dkimFoundAtDefaultSelectors: dkim,
    },
  };
}

// ── the registry ──────────────────────────────────────────────────────────────

/**
 * The drift-tracked checks. A check NOT in this map is intentionally not
 * drift-tracked — that is not a silent gap: drift tracking is opt-in per domain
 * with a real consumer, and a domain only owes a "why not tracked" reason once it
 * IS tracked but a given run can't diff (the not_comparable path above).
 *
 * PowerShell (executorType "powershell") is deliberately absent for now. Its 17
 * checks split between deterministic policy config (DLP/label/transport-rule
 * definitions — genuinely driftable) and non-deterministic operational readings
 * (DLP incident counts, mailbox quota utilisation — a diff of these is churn, not
 * drift). Wiring real PowerShell specs needs a per-cmdlet determinism review of
 * the PS container's output shapes; the universal hook is already present in the
 * powershell path (monitor-executor.ts), so adding one is a one-line registry
 * entry once a cmdlet's output is confirmed stable. Registering a guessed diff
 * now would manufacture exactly the false churn this file's array note warns of.
 */
export const DRIFT_CHECK_SPECS: Record<string, DriftCheckSpec> = {
  // graph
  "identity:ca-policy-count": {
    domainKey: "ca-policy",
    label: "Conditional Access policy",
    attribution: "change-request-scope",
    // #3089 — `buildCaPolicyDriftConfig` keys by the policy's own Graph id, so the
    // object identity IS the path segment (`/policies/<policyId>/state`). Nothing
    // positional is left to agree about; reshaping the builder again means bumping
    // `configVersion` and extending the migration below, never an edit in place.
    identity: { collection: "policies" },
    // #3364 — the policy object stored verbatim at `policies[<id>]` carries
    // Graph's own `displayName`.
    labelHint: { displayNameProperty: "displayName" },
    configVersion: CA_POLICY_CONFIG_VERSION,
    migrateBaselineConfig: migrateCaPolicyBaselineConfig,
    buildConfig: buildCaPolicyDriftConfig,
  },
  "governance:public-teams-discoverable": {
    domainKey: "public-teams-discoverable",
    label: "Public / discoverable Teams",
    identity: { collection: "teams" },
    // #3364
    labelHint: { displayNameProperty: "displayName" },
    buildConfig: buildPublicTeamsDriftConfig,
  },
  // fan-out (graph, per-site)
  "compliance:eeeu-site-sharing": {
    domainKey: "eeeu-site-sharing",
    label: "SharePoint external site sharing",
    identity: { collection: "sites" },
    // #3364 — a SharePoint site has no separate friendly name in this config;
    // its `url` is the closest thing to one.
    labelHint: { displayNameProperty: "url" },
    buildConfig: buildEeeuSiteSharingDriftConfig,
  },
  // sharepoint-admin
  "sharepoint:tenant-sharing-capability": {
    domainKey: "tenant-sharing-capability",
    label: "SharePoint tenant sharing capability",
    buildConfig: buildTenantSharingCapabilityDriftConfig,
  },
  // dns
  "exchange:dkim-spf-dmarc-status": {
    domainKey: "email-authentication",
    label: "Email authentication (SPF / DKIM / DMARC)",
    buildConfig: buildEmailAuthDriftConfig,
  },
};

/** The drift spec for a check key, or undefined when the check isn't drift-tracked. */
export function driftSpecForCheck(checkKey: string): DriftCheckSpec | undefined {
  return DRIFT_CHECK_SPECS[checkKey];
}

/**
 * The check key that produced a given drift domain (Git #1544 — reverse of
 * `driftSpecForCheck`). A `drift_events` row only ever carries `domain_key`,
 * never the check key that produced it, so anything that needs to route a
 * drift event back to the check-category-owning workload (#1544's
 * "accountable owner for the affected object") starts here. Undefined for a
 * domain with no live spec — the same "silence is the honest answer" the
 * check-key lookups in `tenant-workloads.ts` already follow.
 */
export function checkKeyForDriftDomain(domainKey: string): string | undefined {
  return Object.entries(DRIFT_CHECK_SPECS).find(([, spec]) => spec.domainKey === domainKey)?.[0];
}

/** The drift spec for a domain key (`drift_events.domain_key`), via {@link checkKeyForDriftDomain}. */
export function driftSpecForDomain(domainKey: string): DriftCheckSpec | undefined {
  const checkKey = checkKeyForDriftDomain(domainKey);
  return checkKey ? driftSpecForCheck(checkKey) : undefined;
}

// ── timeline label resolution (Git #3364) ──────────────────────────────────────

/**
 * Object id named by a drift `setting` path in this spec's identity collection,
 * or null when the path isn't about one identifiable object — a whole-collection
 * event (`/policies`), or a domain with no `identity` declared at all. Mirrors
 * `resolveDriftSettingTarget` (drift-change-attribution.ts) but stays local and
 * DB-free — this file is pure and unit-tested without a database (see the file
 * header), and that file pulls in the real `db` client to resolve attribution.
 */
function objectIdFromSetting(setting: string, identity: DriftSettingIdentity | undefined): string | null {
  if (!identity) return null;
  const segments = setting.split("/").filter((s) => s.length > 0);
  if (segments.length < 2 || segments[0] !== identity.collection) return null;
  return segments[1].length > 0 ? segments[1] : null;
}

/**
 * A domain's `identity.collection[<id>][labelHint.displayNameProperty]` values,
 * keyed by object id — built once from a domain's own captured baseline config
 * (`drift_baseline_snapshots.config`), which is the one place a keyed config's
 * full objects (Graph `displayName`, a site `url`, …) live. `drift_events.
 * old_value`/`new_value` only carry the display name for a whole-object add or
 * remove; a nested property replace (`/policies/<id>/state`, the common case)
 * carries just the changed leaf value, so the baseline is the honest source for
 * a name that also has to cover that case. Returns an empty map when the spec
 * has no `identity`/`labelHint`, the config isn't the expected shape, or the
 * collection is empty/missing — callers fall back to the raw setting path.
 */
export function driftDisplayNamesFromBaselineConfig(
  spec: Pick<DriftCheckSpec, "identity" | "labelHint">,
  config: unknown,
): Map<string, string> {
  const names = new Map<string, string>();
  const { identity, labelHint } = spec;
  if (!identity || !labelHint) return names;
  if (typeof config !== "object" || config === null) return names;
  const collection = (config as Record<string, unknown>)[identity.collection];
  if (typeof collection !== "object" || collection === null) return names;
  for (const [id, item] of Object.entries(collection as Record<string, unknown>)) {
    if (typeof item !== "object" || item === null) continue;
    const name = (item as Record<string, unknown>)[labelHint.displayNameProperty];
    if (typeof name === "string" && name.length > 0) names.set(id, name);
  }
  return names;
}

/**
 * The human timeline label for a drift event (Git #3364) — the fix for the
 * display-layer gap #3089's id-keyed diff shape surfaced: `drift_events.setting`
 * rendered verbatim reads as a bare GUID (`/policies/<policyId>/state changed`)
 * even though the object it names has a real display name, once one is
 * recoverable (see {@link driftDisplayNamesFromBaselineConfig}).
 *
 * `dashboard-resolvers.ts` (the customer timeline) and `admin-drift.ts` (the
 * operator view) both call this — same resolution, same fallback, so the two
 * surfaces agree on what a drift event is called.
 *
 * Falls back to the original `<setting> <verb>` form whenever a name can't be
 * recovered: no spec for the domain, no `identity`/`labelHint`, the path isn't
 * about one identifiable object, or that object's id isn't in `displayNameById`
 * (not yet captured in the baseline, or genuinely has no name in this domain).
 */
export function resolveDriftEventLabel(params: {
  domainKey: string;
  setting: string;
  op: string;
  displayNameById: ReadonlyMap<string, string>;
}): string {
  const { domainKey, setting, op, displayNameById } = params;
  const verb = op === "add" ? "added" : op === "remove" ? "removed" : "changed";
  const spec = driftSpecForDomain(domainKey);
  const objectId = spec ? objectIdFromSetting(setting, spec.identity) : null;
  const displayName = objectId ? displayNameById.get(objectId) : undefined;
  if (!displayName) return `${setting} ${verb}`;

  const segments = setting.split("/").filter((s) => s.length > 0);
  const propertyPath = segments.slice(2).join(".");
  if (propertyPath.length === 0) return `${displayName} ${verb}`;
  return `${displayName} — ${propertyPath} ${verb}`;
}

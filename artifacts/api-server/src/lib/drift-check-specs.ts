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
 * a `remove` — which is the real per-entity drift the UI wants. (The pre-existing
 * CA spec keeps its original `{ policies: [...] }` array shape so its already
 * captured baselines stay valid; that is #1283's behaviour, preserved verbatim.)
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

/** Attribution strategy tag; the executor resolves it to a per-setting attribution fn. */
export type DriftAttributionKind = "ca-change-request";

export interface DriftCheckSpec {
  /** Bare drift domain slug stored on drift_events.domain_key (metric sourceKey minus "drift:"). */
  domainKey: string;
  /** Human label for logs / status rows. */
  label: string;
  /** Optional attribution strategy the executor wires in (only CA has one today). */
  attribution?: DriftAttributionKind;
  /** Pure: a completed scan → a stable comparable config, or an honest reason it isn't. */
  buildConfig(ctx: DriftScanContext): DriftConfigOutcome;
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

/**
 * Conditional Access — UNCHANGED from #1283: the whole policies array as
 * `{ policies }`. Kept verbatim so baselines captured under #1283 stay valid;
 * do not "improve" this to an id-keyed map without re-baselining every tenant.
 */
export function buildCaPolicyDriftConfig(ctx: DriftScanContext): DriftConfigOutcome {
  if (!isCompleteRun(ctx.status)) {
    return { comparable: false, reason: `Conditional Access scan did not complete (status "${ctx.status}") — no policy set to compare` };
  }
  return { comparable: true, config: { policies: ctx.items } };
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
    attribution: "ca-change-request",
    buildConfig: buildCaPolicyDriftConfig,
  },
  "governance:public-teams-discoverable": {
    domainKey: "public-teams-discoverable",
    label: "Public / discoverable Teams",
    buildConfig: buildPublicTeamsDriftConfig,
  },
  // fan-out (graph, per-site)
  "compliance:eeeu-site-sharing": {
    domainKey: "eeeu-site-sharing",
    label: "SharePoint external site sharing",
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

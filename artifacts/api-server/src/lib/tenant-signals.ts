import {
  db,
  clientM365ProfilesTable,
  insightsGeneratedDocumentsTable,
  scriptRunResultsTable,
  tenantsTable,
  usersTable,
  tenantMonitorProfilesTable,
  signalDerivationRulesTable,
  monitorChecksTable,
  type MonitorCheckFrequency,
} from "@workspace/db";
import { sql, eq, and, asc, desc, inArray } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.signals" });
// Document reuse / drift decisions get the Document Generator's own channel —
// "why did (or didn't) this document regenerate?" must be answerable without
// reading the whole signal-engine log stream.
const docGenLog = logger.child({ channel: "engine.document-generator" });
import { startSlaTimer } from "./sla-engine";

/**
 * Flat fallback stabilization window — used for legacy signals that predate
 * the rule engine and have no `signal_derivation_rules` rows (e.g.
 * `hasLicensingWaste`, `copilotLicenseCount`), and as the per-frequency
 * window for "live" sources. See getSignalStabilizationWindowHours for the
 * per-signal, check-frequency-aware window.
 */
const STABILIZATION_WINDOW_HOURS = 4;

/**
 * How long a signal must stay continuously fired before it's trusted, per
 * the frequency of the monitor check(s) it derives from. Longer for slower
 * checks — a signal that only refreshes daily needs ~2 confirmations before
 * a single day's reading can be ruled out as a one-off blip; an hourly
 * signal needs several; a live/near-real-time source is fine with the same
 * flat default used everywhere else.
 */
const STABILIZATION_WINDOW_HOURS_BY_FREQUENCY: Record<MonitorCheckFrequency, number> = {
  live: STABILIZATION_WINDOW_HOURS,
  hourly: 6,
  daily: 48,
};

/** Slowest (most conservative) window among a signal's derivation-rule check frequencies. */
function slowestStabilizationWindowHours(frequencies: MonitorCheckFrequency[]): number {
  if (frequencies.length === 0) return STABILIZATION_WINDOW_HOURS;
  return frequencies.reduce(
    (slowest, frequency) => Math.max(slowest, STABILIZATION_WINDOW_HOURS_BY_FREQUENCY[frequency] ?? STABILIZATION_WINDOW_HOURS),
    STABILIZATION_WINDOW_HOURS_BY_FREQUENCY.live,
  );
}

/**
 * Resolves the stabilization window for a single signal key by joining its
 * `signal_derivation_rules` rows to the `monitor_checks` they derive from
 * (via `sourceKey` → `monitor_checks.key`) and picking the slowest frequency
 * among them. Signals with no rule rows (legacy, pre-rule-engine signals)
 * fall back to the flat STABILIZATION_WINDOW_HOURS default unchanged.
 */
export async function getSignalStabilizationWindowHours(signalKey: string): Promise<number> {
  try {
    const rows = await db
      .select({ frequency: monitorChecksTable.frequency })
      .from(signalDerivationRulesTable)
      .innerJoin(monitorChecksTable, eq(signalDerivationRulesTable.sourceKey, monitorChecksTable.key))
      .where(eq(signalDerivationRulesTable.signalKey, signalKey));
    return slowestStabilizationWindowHours(rows.map(r => r.frequency));
  } catch (err) {
    log.warn({ err, signalKey }, "getSignalStabilizationWindowHours: failed to resolve per-signal window — using flat default");
    return STABILIZATION_WINDOW_HOURS;
  }
}

// ─── Signal enabled/disabled state ────────────────────────────────────────────
//
// Shared lookup used by every computeTenantSignals call site (admin routes,
// workflow-executor, consolidated-sow-generator, portal pricing adjustments)
// so disabled signals are gated consistently everywhere signals are evaluated.
// A missing row means "enabled" — existing signals are unaffected until an
// admin explicitly disables one.
export async function getDisabledSignalKeys(): Promise<Set<string>> {
  const rows = await db.execute(sql`
    SELECT signal_key AS "signalKey" FROM signal_enabled_state WHERE enabled = false
  `);
  return new Set((rows.rows as Array<{ signalKey: string }>).map(r => r.signalKey));
}

/**
 * Deterministic preference order for picking THE canonical portal user of a
 * customer that has more than one active linked login. A customer's scan
 * results, documents, and SOW are properties of the customer/tenant — the
 * pipeline only collapses to a single users.id where a users.id-shaped FK or a
 * real human recipient genuinely requires one, and when it does, the pick must
 * be stable across runs (an unordered LIMIT 1 resolved a different, wrong user
 * per run — the confirmed customerId=4 → users.id=21 bug):
 *
 *   1. Customer-facing role rank: CustomerUser (full customer account) beats
 *      Assessment beats Free; any MSP-side/service role attached to the
 *      customer ranks last — customer documents and notifications must never
 *      land on MSP staff or machine identities when a real customer login exists.
 *   2. Earliest created_at — the original account-holder (the person who
 *      actually signed up / consented first), not whoever was invited latest.
 *   3. Lowest users.id — a total-order tiebreak so two rows created in the
 *      same instant still resolve identically every time.
 */
// Built lazily (a function, not a module-level const) so importing this module
// never evaluates drizzle operators at load time — several test files partial-
// mock drizzle-orm and import tenant-signals only transitively.
const canonicalPortalUserOrder = () => [
  sql`CASE ${usersTable.mspRole}
    WHEN 'CustomerUser' THEN 0
    WHEN 'Assessment' THEN 1
    WHEN 'Free' THEN 2
    ELSE 3 END`,
  asc(usersTable.createdAt),
  asc(usersTable.id),
];

/**
 * Resolve the canonical active portal user (`usersTable.id`) for an engine
 * customerId (`tenantsTable.id`) via `users.tenantId`. Returns null
 * when the customer has no active portal user — a valid state for an unclaimed
 * customer, not an error.
 *
 * This is the single canonical customer→portal-user resolver. It lives here
 * (rather than per-engine) because `buildTenantProfile` needs it to key the
 * two `users.id`-scoped data tables, and every other consumer (e.g. sales-offer
 * notification routing, the assessment_doc_gate's document-owner identity)
 * should resolve the recipient the exact same way. Deterministic: filtered to
 * active rows and ordered by canonicalPortalUserOrder(), never an arbitrary
 * unordered LIMIT 1.
 */
export async function resolveCustomerPortalUserId(customerId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.tenantId, customerId), eq(usersTable.isActive, true)))
    .orderBy(...canonicalPortalUserOrder())
    .limit(1);
  return row?.userId ?? null;
}

/**
 * ALL portal users (`usersTable.id`) linked to a customer — active AND
 * inactive. This is the customer-scoped read key for the users.id-shaped data
 * tables (`insights_generated_documents.customerId`, `projects.clientUserId`,
 * `client_services.clientUserId`, `client_m365_profiles.clientId`,
 * `user_sessions.userId`, `tenant_signal_history.customer_id`): data written
 * under ANY of a customer's linked logins — including one since deactivated —
 * belongs to the customer, so "the customer's documents/project/purchase/login"
 * must be answered across the full set, never a single arbitrarily-picked row.
 * Deactivated rows are deliberately included: deactivating a login must never
 * make the customer's existing documents or purchase history invisible.
 */
export async function resolveCustomerUserIds(customerId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.tenantId, customerId))
    .orderBy(...canonicalPortalUserOrder());
  return rows.map((r) => r.userId);
}

/**
 * The full users.id set of the CUSTOMER a given portal user belongs to —
 * i.e. the user plus every sibling login linked to the same tenants row.
 * Always includes the input user itself (even when it carries no tenantId
 * or no customer — a direct-business/unclaimed user degrades to a one-element
 * set), so it is always safe as an `inArray` read key wherever a single
 * `eq(column, clientUserId)` used to be. Use this to answer "the customer's
 * documents/purchases/project" from a users.id entry point without collapsing
 * the customer down to one arbitrary login.
 */
export async function resolveSiblingUserIds(clientUserId: number): Promise<number[]> {
  const [bridge] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, clientUserId))
    .limit(1);
  if (bridge?.customerId == null) return [clientUserId];
  const siblings = await resolveCustomerUserIds(bridge.customerId);
  return siblings.includes(clientUserId) ? siblings : [...siblings, clientUserId];
}

/**
 * The engine customerId (`tenantsTable.id`) a portal user (`usersTable.id`)
 * belongs to, read straight off `users.tenantId`. The exact inverse of
 * `resolveCustomerPortalUserId` above, and the single shared implementation of a
 * translation that used to be duplicated privately inside `document-engine.ts`,
 * `document-engine-sow.ts`, and `document-generator.ts`.
 *
 * Lives here, beside the other bridge helpers, because it belongs at a CALLER's
 * boundary, not inside an engine: an engine that takes a users.id and silently
 * translates it can only ever serve user-shaped entry points, which is what kept
 * document generation from being drivable by tenant. Callers holding a
 * `tenantsTable.id` already (an admin tenant picker, a tenant-scoped job)
 * must NOT round-trip through a user id — they pass the customer id straight in.
 *
 * Returns null when the user has no tenantId (a direct-business or unclaimed
 * user with no engine customer) — a real state, not an error, and the caller
 * decides how to report it.
 */
export async function resolveCustomerIdForPortalUser(clientUserId: number): Promise<number | null> {
  const [row] = await db
    .select({ customerId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, clientUserId))
    .limit(1);
  return row?.customerId ?? null;
}

/**
 * The users.id to stamp on a generated document's `insights_generated_documents
 * .customerId` FK for a given engine customer.
 *
 * Prefers the canonical ACTIVE portal user; falls back to the canonical-order
 * first linked login even if deactivated, so a customer whose only logins have
 * been deactivated still OWNS its documents rather than getting a NULL FK that
 * no customer-scoped read (`inArray(customerId, resolveCustomerUserIds(...))`)
 * could ever find again. Null only when the customer has no linked portal user
 * at all — the FK is nullable, so that document is still created, just unowned.
 */
export async function resolveDocumentOwnerUserId(customerId: number): Promise<number | null> {
  const active = await resolveCustomerPortalUserId(customerId);
  if (active != null) return active;
  const all = await resolveCustomerUserIds(customerId);
  return all[0] ?? null;
}

// ─── Document drift gate (cost overrun guard) ────────────────────────────────

/** What `findReusableDocument()` hands back — deliberately the same shape as
 *  `GenerateDocumentResult`, so a reuse hit can be returned from the engine
 *  directly with no adaptation. */
export interface ReusableDocument {
  documentId: number;
  htmlContent: string;
  docTypeKey: string;
}

/**
 * The most recent real generated document for this tenant + document type,
 * but ONLY when none of the tenant's underlying data has moved since it was
 * generated. A hit means the AI would be asked to write the same document from
 * the same inputs, so the caller can skip the AI call entirely.
 *
 * "Real" excludes `generating` (an in-flight placeholder with empty HTML),
 * `failed` (never produced content), and `archived` (deliberately superseded —
 * reusing one would silently resurrect a document an operator or the SOW
 * supersede path retired). `draft` IS reusable: it is a complete document, just
 * one generated in testMode.
 *
 * DRIFT is the MAX of the three timestamps that actually feed a document's
 * inputs, matching what `buildTenantProfile()` reads:
 *   (a) `tenant_monitor_profiles.collectedAt` for the tenant's Graph tenantId,
 *   (b) `client_m365_profiles.updatedAt` across every login linked to the
 *       customer, and
 *   (c) `script_run_results.createdAt` across the same login set.
 * A customer with no linked M365 tenant (`tenants.tenantId` unset) simply
 * skips (a) rather than erroring — (b)/(c) can still be meaningful, and for
 * some document types they are the only inputs there are.
 *
 * NO data at all (a tenant that has never been scanned) is treated as NO drift:
 * nothing has changed since the document was written, because nothing exists to
 * change. Regenerating would burn an AI call to produce the same
 * "no telemetry was captured" document.
 *
 * WHAT THIS DELIBERATELY DOES NOT COVER: inputs that are properties of the
 * REQUEST rather than of the tenant's data — a draft `promptOverride`, a
 * `pricingFormulaOverride`, a customer's changed `selectedWorkstreamTitles` — and
 * inputs owned by other tables (an edited `ai_prompts` body, a changed
 * `document_types` scoping config, new Sales Offer Engine pricing). Those cannot
 * be detected from the three timestamps above, so the two engines refuse to
 * consult this helper at all when a request-level override is present, and any
 * caller that knows its non-data inputs moved passes `forceRegenerate: true`.
 * See the call sites in `document-engine.ts` / `document-engine-sow.ts`.
 *
 * KNOWN TIMESTAMP CAVEAT, stated rather than hidden: `collected_at` is
 * `timestamptz` while `created_at`/`updated_at` on the other three tables are
 * `timestamp` (no zone), so node-postgres parses the latter as local time. If
 * the DB writes those columns in UTC and the api-server process runs at a
 * positive UTC offset, the document's own `createdAt` reads EARLIER than it
 * really is — which biases this comparison toward REGENERATING, the safe
 * direction (a fresh document, not a stale one). At a negative offset the bias
 * inverts, so a same-hour reuse could in principle serve a document a few hours
 * stale. Worth confirming the DB's `TimeZone` on Shane's console; not fixable
 * from here without a schema change to the timestamp types.
 */
export async function findReusableDocument(
  mspCustomerId: number,
  docTypeKey: string,
): Promise<ReusableDocument | null> {
  // Direct tenant-scoped read — `msp_customer_id` is a real column now (Phase
  // 8.5) with a (msp_customer_id, doc_type, created_at) index behind exactly
  // this query, so no per-user fan-out join is involved.
  const [existing] = await db
    .select({
      id: insightsGeneratedDocumentsTable.id,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
      createdAt: insightsGeneratedDocumentsTable.createdAt,
      status: insightsGeneratedDocumentsTable.status,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(and(
      eq(insightsGeneratedDocumentsTable.mspCustomerId, mspCustomerId),
      eq(insightsGeneratedDocumentsTable.docType, docTypeKey),
      inArray(insightsGeneratedDocumentsTable.status, ["approved", "delivered", "draft"]),
    ))
    .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
    .limit(1);

  if (!existing) {
    docGenLog.info({ mspCustomerId, docTypeKey }, "document drift gate: no prior reusable document for this tenant + type — generating");
    return null;
  }

  const [customerRow] = await db
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, mspCustomerId))
    .limit(1);
  const tenantId = customerRow?.tenantId ?? null;

  // Same customer-scoped users.id read key every other document-side read uses:
  // telemetry written under ANY linked login (including a deactivated one)
  // belongs to the tenant, so drift must be answered across the whole set.
  const customerUserIds = await resolveCustomerUserIds(mspCustomerId);

  // Each source is a single indexed "latest row" read rather than an aggregate,
  // so a tenant with no rows in a table costs nothing and contributes nothing.
  const [latestMonitorAt, latestProfileAt, latestScriptRunAt] = await Promise.all([
    tenantId == null
      ? Promise.resolve(null)
      : db
        .select({ collectedAt: tenantMonitorProfilesTable.collectedAt })
        .from(tenantMonitorProfilesTable)
        .where(eq(tenantMonitorProfilesTable.tenantId, tenantId))
        .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
        .limit(1)
        .then((rows) => rows[0]?.collectedAt ?? null),
    customerUserIds.length === 0
      ? Promise.resolve(null)
      : db
        .select({ updatedAt: clientM365ProfilesTable.updatedAt })
        .from(clientM365ProfilesTable)
        .where(inArray(clientM365ProfilesTable.clientId, customerUserIds))
        .orderBy(desc(clientM365ProfilesTable.updatedAt))
        .limit(1)
        .then((rows) => rows[0]?.updatedAt ?? null),
    customerUserIds.length === 0
      ? Promise.resolve(null)
      : db
        .select({ createdAt: scriptRunResultsTable.createdAt })
        .from(scriptRunResultsTable)
        .where(inArray(scriptRunResultsTable.customerId, customerUserIds))
        .orderBy(desc(scriptRunResultsTable.createdAt))
        .limit(1)
        .then((rows) => rows[0]?.createdAt ?? null),
  ]);

  const dataTimestamps = [latestMonitorAt, latestProfileAt, latestScriptRunAt].filter(
    (d): d is Date => d instanceof Date,
  );
  const latestDataAt = dataTimestamps.length === 0
    ? null
    : new Date(Math.max(...dataTimestamps.map((d) => d.getTime())));

  const drifted = latestDataAt != null && latestDataAt.getTime() > existing.createdAt.getTime();

  const logContext = {
    mspCustomerId,
    docTypeKey,
    documentId: existing.id,
    documentStatus: existing.status,
    documentCreatedAt: existing.createdAt,
    latestDataAt,
    latestMonitorAt,
    latestProfileAt,
    latestScriptRunAt,
    tenantIdPresent: tenantId != null,
    linkedUserCount: customerUserIds.length,
  };

  if (drifted) {
    docGenLog.info(logContext, "document drift gate: tenant data is newer than the existing document — regenerating");
    return null;
  }

  docGenLog.info(logContext, "document-engine: reusing existing document, no drift detected, no AI call made");
  return { documentId: existing.id, htmlContent: existing.htmlContent, docTypeKey };
}

// ─── Monitor-profile merge (shared by every signal-evaluation assembly site) ──
//
// The Graph-based diagnostics/monitoring pipeline writes one
// `tenant_monitor_profiles` row per check execution; the latest row per
// checkKey is the tenant's current, real Graph-derived state. The helpers
// below are THE bridge from that data into the `mergedProfile` / `findings`
// that `evaluateRule()` consumes. Three call sites assemble a signal-eval
// profile — `buildTenantProfile()` below, the consolidated SOW generator's
// DB-evaluation path, and the workflow executor's `get_tenant_signals` node
// (the one the seeded Assessment workflow actually uses) — and all three MUST
// route through these helpers. They used to hand-roll the merge separately:
// commit a068f631 added the full extracted-properties merge to
// buildTenantProfile only, leaving the other two merging nothing but
// `__itemCount`, which is why Graph-only assessment tenants fired zero
// signals and produced empty SOW workstream lists.
//
// PRECEDENCE (deliberate, documented): monitor/Graph-derived values are
// merged LAST, so on a key collision they win over `client_m365_profiles` and
// `script_run_results.profileUpdates`. Rationale: monitor rows are refreshed
// continuously by scheduled checks and per-run diagnostics, while script
// uploads are stale point-in-time one-shots; the fresher pipeline is the
// truth. (This was already buildTenantProfile's order and get_tenant_signals'
// stated intent — it is now the single documented contract for all sites.)

export interface TenantMonitorProfileRow {
  checkKey: string;
  status?: string | null;
  severityMatched?: string | null;
  /**
   * The matched `severity_rules` entry's own human-written label, already
   * interpolated against that run's data — persisted at collection time by
   * `persistCheckProfile()` since Git #549.
   *
   * Optional/nullable because it genuinely is: rows collected before #549 have
   * none, and a rule can legitimately carry no label. Consumers must fall back
   * rather than treat its absence as an error.
   */
  severityLabel?: string | null;
  extractedProperties: Record<string, unknown> | null;
}

/** Latest row per checkKey for a tenant — the standard monitor-state fetch. */
export async function fetchLatestMonitorProfileRows(tenantId: string): Promise<TenantMonitorProfileRow[]> {
  return db.selectDistinctOn([tenantMonitorProfilesTable.checkKey], {
    checkKey: tenantMonitorProfilesTable.checkKey,
    status: tenantMonitorProfilesTable.status,
    severityMatched: tenantMonitorProfilesTable.severityMatched,
    severityLabel: tenantMonitorProfilesTable.severityLabel,
    extractedProperties: tenantMonitorProfilesTable.extractedProperties,
  })
    .from(tenantMonitorProfilesTable)
    .where(eq(tenantMonitorProfilesTable.tenantId, tenantId))
    .orderBy(tenantMonitorProfilesTable.checkKey, desc(tenantMonitorProfilesTable.collectedAt));
}

/** First numeric value among the given keys — mirrors dashboard-resolvers' firstNumber. */
function firstNumericProp(props: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

/**
 * The bridged keys below and the single real producer check each is derived
 * from. Lives here, beside the function that writes them, so the consumers that
 * enumerate producible profile keys — `pillar-coverage.ts`'s
 * `buildProducibleProfileKeys()` and the document scoping picker's `_profile`
 * bucket — read this list instead of each restating it. Keys with no real
 * producer are deliberately absent, for the reasons in the doc comment below.
 */
export const BRIDGED_KEY_PRODUCER_CHECK: Record<string, string> = {
  conditionalAccessPolicyCount: "identity:ca-policy-count",
  conditionalAccessPoliciesCount: "identity:ca-policy-count",
  securityScore: "security:secure-score",
};

/**
 * Legacy-vocabulary bridge: derives the handful of script-era profile keys that
 * real seeded `signal_derivation_rules` reference but that the Graph pipeline
 * expresses differently. Runs AFTER the raw merge, and every derivation is
 * absent-only — an explicitly mapped/script-written value always wins.
 *
 * What IS bridged (each has a real, code-verified Graph producer):
 *   • `conditionalAccessPolicyCount` ⇄ `conditionalAccessPoliciesCount` — the
 *     seeded rules use the singular spelling; the M365 script parser and AI
 *     analyzer write the plural. Whichever is present is aliased to the other,
 *     fixing rules that read a key nothing ever wrote.
 *   • CA policy count from `identity:ca-policy-count` — that check fetches the
 *     tenant's CA policies, so its `_itemCount` IS the policy count. Derived
 *     only from a status="ok" row: an errored/license-gapped check must never
 *     be read as "0 policies" (that would falsely fire the eq-0 gap rules).
 *   • `securityScore` from `security:secure-score` — Microsoft Secure Score as
 *     a 0–100 percent, using the exact field fallbacks the dashboard resolver
 *     already uses (currentScore/maxScore → percentage/scorePct). Nothing else
 *     in the platform produces `securityScore`, so the `profile_key_lt
 *     securityScore 60` rules could never fire for any customer before this.
 *
 * What is deliberately NOT bridged (no real producer — fabricating would
 * violate the platform's anti-fabrication stance):
 *   • `mfaEnforced` — `identity:mfa-registration` measures registration, not
 *     enforcement, and deriving enforcement from `identity:ca-mfa-coverage`
 *     would false-flag security-defaults tenants. If the live
 *     `monitor_checks.mapping` emits `mfaEnforced` (PLATFORM_BUILD documents it
 *     as a real targetField), the raw merge above delivers it as-is.
 *   • `governanceScore` — no governance:* check is in the baseline package and
 *     no real score source exists; rules on it stay dormant until one does.
 *   • `dlpPoliciesCount` / `totalUserCount` / `sharepointSiteCount` /
 *     `copilotLicenseCount` — same: raw merge delivers them if a live mapping
 *     emits them; nothing is invented here.
 */
function bridgeLegacyProfileKeys(
  mergedProfile: Record<string, unknown>,
  monitorRows: TenantMonitorProfileRow[],
): void {
  const rowByKey = new Map(monitorRows.map(r => [r.checkKey, r]));
  const okProps = (checkKey: string): Record<string, unknown> | null => {
    const row = rowByKey.get(checkKey);
    if (!row || row.status !== "ok") return null;
    return row.extractedProperties ?? {};
  };

  // conditionalAccessPolicyCount (rules' spelling) ⇄ conditionalAccessPoliciesCount (producers' spelling)
  const RULE_CA_KEY = "conditionalAccessPolicyCount";
  const PRODUCER_CA_KEY = "conditionalAccessPoliciesCount";
  if (RULE_CA_KEY in mergedProfile && !(PRODUCER_CA_KEY in mergedProfile)) {
    mergedProfile[PRODUCER_CA_KEY] = mergedProfile[RULE_CA_KEY];
  } else if (PRODUCER_CA_KEY in mergedProfile && !(RULE_CA_KEY in mergedProfile)) {
    mergedProfile[RULE_CA_KEY] = mergedProfile[PRODUCER_CA_KEY];
  } else if (!(RULE_CA_KEY in mergedProfile)) {
    const caProps = okProps("identity:ca-policy-count");
    const caCount = caProps ? firstNumericProp(caProps, ["_itemCount"]) : null;
    if (caCount != null) {
      mergedProfile[RULE_CA_KEY] = caCount;
      mergedProfile[PRODUCER_CA_KEY] = caCount;
    }
  }

  // securityScore from Microsoft Secure Score (absent-only; ok row only).
  if (!("securityScore" in mergedProfile)) {
    const ssProps = okProps("security:secure-score");
    if (ssProps) {
      const current = firstNumericProp(ssProps, ["currentScore", "secureScore", "current"]);
      const max = firstNumericProp(ssProps, ["maxScore", "maxSecureScore", "max"]);
      if (current != null && max != null && max > 0) {
        mergedProfile["securityScore"] = Math.round((current / max) * 100);
      } else {
        const pct = firstNumericProp(ssProps, ["percentage", "scorePct"]);
        if (pct != null) mergedProfile["securityScore"] = Math.round(pct);
      }
    }
  }
}

// ─── Namespaced companion profile (Git #544) ─────────────────────────────────
//
// The flat `mergedProfile` above is ONE namespace shared by every check, so a
// property NAME used by two checks silently overwrites — and because
// `fetchLatestMonitorProfileRows` orders by checkKey ASC, the alphabetically
// LAST check deterministically wins, every build. Confirmed live scope
// (2026-08-07, full catalogue): 137 active checks emit 408 distinct property
// names, of which 89 (21.8%) collide — 87 of them from raw extraction
// (`monitor_checks.properties[]` emits `P_count`/`P_first`/`P_values`, names
// that carry no check identity at all), one `mapping[].targetField`
// (`teamCount`), and bare `_itemCount` colliding across all 137 by
// construction.
//
// `mergedProfileByCheck` is the additive fix (option B, signed off on the
// issue): the SAME merge pass also records every property under its producing
// check key, so nothing is lost. It is deliberately a COMPANION, not a
// replacement — the flat profile keeps its exact existing contents and
// precedence so `evaluateRule()` and all 214 `signal_derivation_rules` keep
// behaving byte-identically (the live audit confirmed zero exposed rules read
// any of the 89 colliding names, so there is nothing to migrate there).
//
// The established in-house precedent for this shape is the synthetic
// `<checkKey>__itemCount` key stamped below, which is exactly option B applied
// to one key and which 120 of 214 rules already consume happily.

/** `checkKey → { propertyName → value }`. See the block comment above. */
export type MergedProfileByCheck = Record<string, Record<string, unknown>>;

/**
 * Reserved bucket for the profile contributions that genuinely have no check
 * key to be namespaced by: `client_m365_profiles.profile`,
 * `script_run_results.profileUpdates`, and the keys `bridgeLegacyProfileKeys`
 * derives (`securityScore`, `conditionalAccessPolicy/PoliciesCount`).
 * `buildTenantProfile` unions three sources and only monitor rows carry a
 * check key — pretending otherwise is what made "namespace everything before
 * merging" unrealizable. Contains no ":", so it can never collide with a real
 * `monitor_checks.key` (all of which are `<domain>:<name>`).
 */
export const NON_CHECK_PROFILE_NAMESPACE = "_profile";

/**
 * The single flat, unambiguous key a document type's
 * `included_profile_key_patterns` is written against — `<checkKey>.<property>`,
 * e.g. `devices:autopilot-coverage.displayName_count`. Separator is "." because
 * check keys use ":" and property names use "_", so neither can be confused
 * with it.
 */
export function namespacedProfileKey(checkKey: string, propertyName: string): string {
  return `${checkKey}.${propertyName}`;
}

/** Value equality for collision reporting only — deep enough for the array/object
 *  payloads raw extraction produces (`id_values` et al) without pulling in a dep. */
function sameProfileValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Short, log-safe rendering of a discarded value — `id_values` can be thousands of ids. */
function profileValuePreview(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** How many individual collisions the warn below enumerates before summarising. */
const PROFILE_COLLISION_LOG_LIMIT = 25;

/**
 * Runtime property names that exist purely as PER-CHECK diagnostic markers —
 * `_itemCount` (every check) and the license-gap trio (Graph checks that hit
 * LicenseGapError; monitor-executor.ts). Git #545: confirmed by #544's live
 * audit that zero `signal_derivation_rules` rows and no code path reads any
 * of these off the bare flat `mergedProfile` (real consumers use the
 * namespaced `<checkKey>__itemCount` key or `LICENSE_GAP_PROFILE_FLAG_KEYS`
 * instead — see `buildProducibleProfileKeys` in pillar-coverage.ts, which
 * never enumerates these bare names as producible). By construction across
 * every check, these bare names also collide on every merge — the `_itemCount`
 * collision noise #544's block comment above already calls out. Excluded from
 * the flat merge here; still recorded verbatim, per check, in
 * `mergedProfileByCheck` for anything that genuinely wants them.
 */
const CHECK_DIAGNOSTIC_ONLY_KEYS = new Set([
  "_itemCount",
  "_licenseGap",
  "_licenseGapCode",
  "_licenseGapFeature",
]);

/**
 * Merges the latest monitor rows into a signal-evaluation profile: extracted
 * properties (so every DB-configured `monitor_checks.mapping` targetField —
 * e.g. mfaEnforced, globalAdminCount, dlpPoliciesCount — reaches
 * `evaluateRule()`), the synthetic `<checkKey>__itemCount` keys that
 * `threshold` rules read, and the legacy-vocabulary bridge above.
 *
 * `CHECK_DIAGNOSTIC_ONLY_KEYS` (Git #545) is excluded from the flat merge —
 * those bare names collide across every check by construction and have no
 * real reader on `mergedProfile` (`__itemCount` and the license-gap flags
 * each have their own namespaced/derived producible key instead).
 *
 * `mergedProfileByCheck` (optional, Git #544) is filled in the same pass with
 * the namespaced companion view — see the block comment above. Passing it
 * changes NOTHING about what lands in `mergedProfile`; call sites that don't
 * need it simply omit it.
 *
 * Deliberately, a check's bucket holds its extracted properties VERBATIM,
 * diagnostic keys included: the `?? 0` default the flat `<checkKey>__itemCount`
 * key applies is a threshold-rule contract, and mirroring it here would hand
 * a document prompt a fabricated "0 items" for a check that errored and
 * measured nothing.
 */
export function mergeMonitorProfileRows(
  mergedProfile: Record<string, unknown>,
  monitorRows: TenantMonitorProfileRow[],
  mergedProfileByCheck?: MergedProfileByCheck,
): void {
  // Loud-on-loss (Git #544): overwrites with an IDENTICAL value are skipped
  // (`CHECK_DIAGNOSTIC_ONLY_KEYS` are excluded from this loop entirely — see
  // above, Git #545). Collected and emitted as one warn per merge rather than
  // one per key, so a 62-collision tenant stays greppable.
  const collisions: Array<{ key: string; lostFrom: string | null; wonBy: string; lostValue: string; keptValue: string }> = [];
  const lastWriterByKey = new Map<string, string>();

  for (const row of monitorRows) {
    const props = row.extractedProperties ?? {};
    for (const [key, value] of Object.entries(props)) {
      if (CHECK_DIAGNOSTIC_ONLY_KEYS.has(key)) continue;
      if (key in mergedProfile && !sameProfileValue(mergedProfile[key], value)) {
        collisions.push({
          key,
          // Absent from the map = the previous value came from a non-monitor
          // source (client_m365_profiles / script_run_results), which is worth
          // distinguishing from a check-vs-check collision.
          lostFrom: lastWriterByKey.get(key) ?? null,
          wonBy: row.checkKey,
          lostValue: profileValuePreview(mergedProfile[key]),
          keptValue: profileValuePreview(value),
        });
      }
      lastWriterByKey.set(key, row.checkKey);
    }
    for (const [key, value] of Object.entries(props)) {
      if (CHECK_DIAGNOSTIC_ONLY_KEYS.has(key)) continue;
      mergedProfile[key] = value;
    }
    mergedProfile[`${row.checkKey}__itemCount`] = props["_itemCount"] ?? 0;
    if (mergedProfileByCheck) {
      const bucket = (mergedProfileByCheck[row.checkKey] ??= {});
      Object.assign(bucket, props);
    }
  }

  // The bridge derives keys from monitor rows but attributes them to no single
  // check, so its output belongs in the reserved namespace. Add-only by
  // construction (every branch is absent-guarded), so a key-set diff is exact.
  const beforeBridge = mergedProfileByCheck ? new Set(Object.keys(mergedProfile)) : null;
  bridgeLegacyProfileKeys(mergedProfile, monitorRows);
  if (mergedProfileByCheck && beforeBridge) {
    for (const key of Object.keys(mergedProfile)) {
      if (beforeBridge.has(key)) continue;
      (mergedProfileByCheck[NON_CHECK_PROFILE_NAMESPACE] ??= {})[key] = mergedProfile[key];
    }
  }

  if (collisions.length > 0) {
    log.warn(
      {
        collisionCount: collisions.length,
        collidingKeys: [...new Set(collisions.map(c => c.key))],
        collisions: collisions.slice(0, PROFILE_COLLISION_LOG_LIMIT),
        collisionsOmitted: Math.max(0, collisions.length - PROFILE_COLLISION_LOG_LIMIT),
      },
      "mergeMonitorProfileRows: flat mergedProfile key overwritten with a DIFFERENT value — the losing check's data is not in the flat profile (Git #544). Read mergedProfileByCheck for the per-check value.",
    );
  }
}

/**
 * Real, Graph-derived finding strings for `findings_keyword` rules — one per
 * check whose latest run genuinely evaluated (status "ok") AND matched a
 * severity condition. This gives keyword rules (e.g. "SharePoint") a real
 * path for Graph-only customers, whose script-run `parsedFindings` are empty.
 *
 * Only severity-matched ok rows qualify, deliberately: an errored or
 * license-gapped check is "state unknown", not a finding — bridging e.g.
 * "Check error: sharepoint:anonymous-links" would falsely fire
 * `hasSharePointIssues` off a transient Graph error. The checkKey is included
 * in the string because it carries the real keyword surface
 * ("sharepoint:anonymous-links" → keyword "SharePoint").
 *
 * These strings are ALSO what feeds `{{findings}}` in every generated document,
 * which is why Git #549 changed what leads them — see the wording contract on
 * `deriveMonitorFindingsWithKeys()` below.
 */
export function deriveMonitorFindings(monitorRows: TenantMonitorProfileRow[]): string[] {
  return deriveMonitorFindingsWithKeys(monitorRows).map(f => f.text);
}

/** A monitor-derived finding string plus the real per-check facts behind it. */
export interface MonitorDerivedFinding {
  text: string;
  checkKey: string;
  /**
   * The `severity_rules` severity that matched, verbatim (e.g. "critical",
   * "high", "warning") — NOT normalized here, because the vocabulary is
   * 100% DB-resident and this module is not its owner.
   */
  severity: string;
  /** `_itemCount` off the check's extracted properties, when it emitted one. */
  itemCount: number | null;
}

/**
 * The same findings `deriveMonitorFindings()` returns, each still carrying the
 * checkKey it came from. `deriveMonitorFindings()` is now a thin projection of
 * this function (`.map(f => f.text)`), so the two can never drift on wording or
 * on which rows qualify.
 *
 * The checkKey is what makes signal-category attribution possible: it is the
 * only durable link from a finding back to the `signal_derivation_rules` rows
 * (via `source_key`) that say which signal categories the check feeds.
 *
 * ── WORDING CONTRACT (Git #549) ──────────────────────────────────────────────
 *
 * A finding whose row carries a real `severityLabel` reads as
 *
 *     "<the rule author's own sentence> (<checkKey>)"
 *
 * e.g. "No SPF record found on the domain (exchange:dkim-spf-dmarc-status)".
 * Everything else keeps the pre-#549 generic sentence
 * "<checkKey>: <severity> severity condition matched on latest monitoring scan
 * (<n> items)". Two decisions worth stating, because both look arbitrary and
 * neither is:
 *
 *   • THE LABEL LEADS, THE CHECK KEY TRAILS. These strings are simultaneously
 *     the customer-facing `{{findings}}` list in every generated document AND
 *     the substring surface `findings_keyword` rules match on — `evaluateRule`
 *     does a case-insensitive `includes`, and `pillar-coverage.ts` reasons
 *     about package coverage on exactly that basis. Dropping the checkKey to
 *     get clean prose would silently stop those rules firing; keeping it in
 *     front leaves the raw internal key as the first thing a customer reads,
 *     which is the bug #549 was filed about. Putting the authored sentence
 *     first and the key in trailing parentheses satisfies both: the substring
 *     is still present, byte-identical, in every finding it was present in
 *     before.
 *
 *   • NO MACHINE-APPENDED "(n items)" ON THE LABELLED PATH. The generic
 *     sentence carries no facts, so the count was the only thing in it worth
 *     reading. An authored label already states its own facts, and #418 gives
 *     authors `{{token}}` interpolation to place counts exactly where the
 *     sentence needs them — bolting "(0 items)" onto the end of a finished
 *     sentence adds noise and, for the many checks whose `_itemCount` is 0 on
 *     the very run that fired their rule, actively misleads. The count is not
 *     lost: it stays on `MonitorDerivedFinding.itemCount` (and therefore on
 *     `CategorizedFinding.itemCount`) for any consumer that wants it.
 *
 * The fallback is NOT a temporary shim to delete later. A rule may genuinely
 * carry no label, and `interpolateLabel` deliberately discards a label whose
 * tokens didn't resolve rather than print `{{expiredKeyCredentialCount}}` at a
 * customer (#418). Both are real states with no better text available.
 */
export function deriveMonitorFindingsWithKeys(monitorRows: TenantMonitorProfileRow[]): MonitorDerivedFinding[] {
  const findings: MonitorDerivedFinding[] = [];
  for (const row of monitorRows) {
    if (row.status !== "ok") continue;
    const severity = row.severityMatched?.trim();
    if (!severity) continue;
    const props = row.extractedProperties ?? {};
    const itemCount = firstNumericProp(props, ["_itemCount"]);
    const label = row.severityLabel?.trim() || null;
    findings.push({
      checkKey: row.checkKey,
      severity,
      itemCount: itemCount ?? null,
      text: label
        ? `${label} (${row.checkKey})`
        : `${row.checkKey}: ${severity} severity condition matched on latest monitoring scan` +
          (itemCount != null ? ` (${itemCount} item${itemCount === 1 ? "" : "s"})` : ""),
    });
  }
  return findings;
}

/**
 * Batched checkKey → signal-pillar lookup (Git #481). ONE query for the whole
 * list, never one per check: every `signal_derivation_rules` row whose
 * `source_key` equals one of the given `monitor_checks.key`s, projected down to
 * that rule's `pillar` column and deduped per checkKey. A checkKey with no
 * matching rule, or whose matching rules all carry an empty `pillar` (the
 * column's `""` default — rows that predate pillar backfill), is simply absent
 * from the returned map.
 *
 * Replaces the #479 domain-segment parser (`extractSignalCategoryPrefix`, which
 * derived a category by splitting `signal_key` against the separate, narrower
 * `SIGNAL_CATEGORY_PREFIXES` list): `pillar` is Git #469's enforced single
 * source of truth for "what pillar does this signal belong to", so this reads
 * it directly instead of re-deriving a second vocabulary from the key string
 * that can drift out of sync with it — which is exactly what #481's live-corpus
 * audit found had happened (e.g. every `identity:*` finding carries
 * `pillar = 'security'` but never matched `SIGNAL_CATEGORY_PREFIXES`'s
 * "security" via key-parsing).
 *
 * The join is `signal_derivation_rules.source_key = monitor_checks.key` — the
 * exact join `getSignalStabilizationWindowHours` above already uses, so pillar
 * attribution and stabilization windows agree on what "this rule is fed by
 * this check" means.
 *
 * KNOWN RECALL LIMIT (deliberate, matches the existing join): a rule whose
 * `source_key` is a mapping targetField (e.g. `globalAdminCount`) or the
 * synthetic `<checkKey>__itemCount` rather than the bare check key will not
 * match, so its pillar is not attributed to that check. Widening the join to
 * mapping targetFields would be ambiguous — two checks can emit the same
 * targetField — so it is not done here. Under-attribution is the safe
 * direction: it can only make a pillar-scoped document narrower, never leak a
 * finding into a document type that didn't ask for its pillar.
 */
export async function fetchSignalCategoriesForCheckKeys(checkKeys: string[]): Promise<Map<string, string[]>> {
  const byCheckKey = new Map<string, string[]>();
  const uniqueKeys = [...new Set(checkKeys)];
  if (uniqueKeys.length === 0) return byCheckKey;

  const rows = await db
    .select({ checkKey: monitorChecksTable.key, pillar: signalDerivationRulesTable.pillar })
    .from(signalDerivationRulesTable)
    .innerJoin(monitorChecksTable, eq(signalDerivationRulesTable.sourceKey, monitorChecksTable.key))
    .where(inArray(monitorChecksTable.key, uniqueKeys));

  for (const row of rows) {
    const pillar = row.pillar?.trim();
    if (!pillar) continue;
    const existing = byCheckKey.get(row.checkKey);
    if (!existing) byCheckKey.set(row.checkKey, [pillar]);
    else if (!existing.includes(pillar)) existing.push(pillar);
  }
  return byCheckKey;
}

// ─── Tenant profile builder (single source of truth for signal evaluation) ────
//
// Builds the merged M365 profile + findings list a tenant's signals are
// evaluated against. Every engine (priority, pricing, drift, forecasting,
// security, sales_offer, health, crm) calls this directly. The consolidated
// SOW generator and the workflow executor's get_tenant_signals node operate in
// users.id space and assemble their own base profile, but route the monitor
// half through the SAME shared helpers above (fetchLatestMonitorProfileRows /
// mergeMonitorProfileRows / deriveMonitorFindings) so no site can drift on the
// Graph-data merge again.
//
// The input is a *customer id* (`tenantsTable.id`) — the id every real
// engine caller already carries (runForTenant / admin-engines testbed flow).
//
// Two independent id spaces are in play, and this function bridges them
// explicitly rather than assuming they coincide (the old per-engine copies
// assumed they did, which is what silently zeroed signals in production):
//
//   • tenantId / mspId live on `tenants`, keyed by the customer id
//     directly — resolved with one `WHERE id = customerId` lookup.
//   • `client_m365_profiles` and `script_run_results` are keyed by
//     `users.id` (a *portal user* id), NOT the customer id. So we first
//     resolve the customer's active portal user via `users.tenantId`
//     (`resolveCustomerPortalUserId`) and key those two tables by that id.
//
// A customer with no active portal user (unclaimed) is valid: the profile /
// script-run half simply contributes nothing, but tenant/msp resolution and
// the monitor merge still proceed off the customer id.
//
// ADDITIVE (2026-07-28): the return also carries `categorizedFindings` — the
// exact same strings as `findings`, in the same order, each annotated with the
// signal pillar(s) of the check that produced it (pillar-based since Git #481;
// previously a parsed `signal_key` domain-segment category). `findings` itself
// and every field's existing shape are untouched; consumers that don't want
// pillar scoping keep reading `findings` and see no change.
export interface CategorizedFinding {
  text: string;
  /**
   * `signal_derivation_rules.pillar` value(s) (governance, security,
   * compliance, adoption, copilot, architecture, licensing, cost) of the
   * check(s) that produced this finding. EMPTY means "not categorizable",
   * which is a real, distinguishable state — not "belongs to nothing". See the
   * permanent-limitation note on `categorizedFindings` below.
   */
  categories: string[];
  /**
   * The `monitor_checks.key` this finding came from, or NULL when there isn't
   * one — every script-run finding (see the limitation note below).
   *
   * ADDITIVE (Git #493). Exists because the Remediation Knowledge Base is keyed
   * on the check key, and the alternative — re-parsing it back out of the
   * `"<checkKey>: <severity> severity condition matched…"` prefix
   * `deriveMonitorFindingsWithKeys()` builds — would silently break the KB
   * lookup the day that wording changes. The producer already has the key; it
   * now says so instead of encoding it in prose.
   */
  checkKey: string | null;
  /** Verbatim matched severity (e.g. "critical", "warning"), NULL for findings with no check behind them. */
  severity: string | null;
  /** `_itemCount` for the matched check, when it emitted one. NULL otherwise. */
  itemCount: number | null;
  /**
   * True when `checkKey`'s LATEST `tenant_monitor_profiles` row carries
   * `status === 'license_gap'` (Git #484-#488/#495's established
   * classification) — i.e. the tenant lacks the M365 SKU/add-on the check
   * needs, a known limitation rather than a fault. Git #550.
   *
   * ALWAYS `false` today by construction, and that is a real, deliberate
   * invariant, not an oversight: `deriveMonitorFindingsWithKeys()` only ever
   * turns a `status === 'ok'` row into a finding in the first place (pinned by
   * "license_gap row is NOT a finding (status != ok)" in
   * `build-tenant-profile.test.ts`), so a finding's own checkKey can never
   * itself be license-gapped at the moment it becomes a finding. This field
   * exists so a genuine license_gap-classified finding — from whatever future
   * source eventually produces one — sorts correctly the moment it exists,
   * without every consumer needing to learn a new signal. Every script-run
   * finding (`checkKey: null`) is also `false`, for the same "nothing to
   * classify it by" reason `categories: []` already documents.
   */
  isLicenseGap: boolean;
}

export async function buildTenantProfile(customerId: number): Promise<{
  mergedProfile: Record<string, unknown>;
  /**
   * Namespaced companion to `mergedProfile` (Git #544) — `checkKey → props`,
   * plus the reserved `NON_CHECK_PROFILE_NAMESPACE` bucket for the two sources
   * that have no check key. ADDITIVE: `mergedProfile` above is unchanged, and
   * every existing consumer of it (all of `evaluateRule`, every engine) keeps
   * reading exactly what it read before. New consumers that need to know WHICH
   * check a value came from — document generation's `{{profileSample}}` is the
   * first — read this instead. See the block comment on
   * `mergeMonitorProfileRows`.
   */
  mergedProfileByCheck: MergedProfileByCheck;
  findings: string[];
  /**
   * 1:1 with `findings` (same strings, same order, same dedupe) — an additive
   * companion, not a replacement.
   *
   * PERMANENT LIMITATION, stated in the type rather than hidden: only
   * MONITOR-derived findings can carry categories. Script-run findings (from
   * `script_run_results.parsedFindings`) are free-text strings uploaded by the
   * legacy M365 script with no checkKey and no link to any
   * `signal_derivation_rules` row, so there is nothing to attribute them
   * through — they always get `categories: []`. This is not a bug to fix later:
   * the data to categorize them does not exist and cannot be derived without
   * fabricating it. They are deliberately kept in this array (rather than
   * dropped) so a caller can see them and decide, instead of silently losing
   * findings it never knew were there. A monitor finding whose check feeds no
   * category-prefixed rule also gets `[]` — same representation, same reason:
   * we genuinely don't know its category.
   */
  categorizedFindings: CategorizedFinding[];
  customerId: number;
  mspId: number | null;
  tenantId: string | null;
}> {
  // tenant/msp — keyed directly by the customer id (no user involved).
  const [customerRow] = await db
    .select({ tenantId: tenantsTable.tenantId, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  const tenantId = customerRow?.tenantId ?? null;
  const mspId = customerRow?.mspId ?? null;

  // profile + script-run findings — both those tables FK to users.id, but the
  // data they hold is a property of the customer/tenant, not of whichever
  // single login happened to upload it. So they are read CUSTOMER-scoped:
  // across ALL of the customer's linked portal users (active and inactive —
  // deactivating a login must not erase the tenant's telemetry), never a
  // single arbitrarily-picked user. Empty user set = unclaimed customer:
  // contribute an empty profile/findings rather than error.
  const customerUserIds = await resolveCustomerUserIds(customerId);

  let mergedProfile: Record<string, unknown> = {};
  const mergedProfileByCheck: MergedProfileByCheck = {};
  let findings: string[] = [];
  if (customerUserIds.length > 0) {
    const profileRows = await db
      .select({ profile: clientM365ProfilesTable.profile, updatedAt: clientM365ProfilesTable.updatedAt })
      .from(clientM365ProfilesTable)
      .where(inArray(clientM365ProfilesTable.clientId, customerUserIds))
      .orderBy(clientM365ProfilesTable.updatedAt);

    const scriptRuns = await db
      .select({
        parsedFindings: scriptRunResultsTable.parsedFindings,
        profileUpdates: scriptRunResultsTable.profileUpdates,
      })
      .from(scriptRunResultsTable)
      .where(and(inArray(scriptRunResultsTable.customerId, customerUserIds), eq(scriptRunResultsTable.status, "completed")))
      .orderBy(desc(scriptRunResultsTable.createdAt))
      .limit(50);

    // Oldest-updated profile row first so the freshest linked user's row wins
    // on key collision — same newest-wins convention as the script-run merge.
    for (const row of profileRows) Object.assign(mergedProfile, (row.profile as Record<string, unknown> | null) ?? {});
    for (const run of [...scriptRuns].reverse()) Object.assign(mergedProfile, run.profileUpdates ?? {});
    findings = [...new Set(scriptRuns.flatMap(r => r.parsedFindings ?? []))];

    // Snapshot the check-key-less contributions BEFORE the monitor merge, so a
    // monitor property that later overwrites one of them doesn't erase the
    // record of what the script-era source actually said (Git #544). This is
    // the only point at which the two are still distinguishable.
    if (Object.keys(mergedProfile).length > 0) {
      mergedProfileByCheck[NON_CHECK_PROFILE_NAMESPACE] = { ...mergedProfile };
    }
  } else {
    log.warn(
      { customerId },
      "buildTenantProfile: customer has no linked portal users — profile/script-run signals contribute nothing (unclaimed customer)",
    );
  }

  // monitor-derived inputs — keyed by tenantId off the customer row. Shared
  // helpers: full extracted-properties merge (monitor wins on collision — see
  // precedence contract above), legacy-vocabulary bridge, and real
  // severity-matched monitor findings so findings_keyword rules can fire for
  // Graph-only customers.
  //
  // Category attribution (additive) is keyed by the finding STRING so the
  // annotation survives the dedupe/reordering `findings` applies below. The
  // same map now also carries the checkKey/severity/itemCount the finding came
  // from (Git #493) — one map, so the annotation can never half-apply.
  const monitorMetaByFindingText = new Map<string, { categories: string[]; checkKey: string; severity: string; itemCount: number | null; isLicenseGap: boolean }>();
  if (tenantId) {
    const monitorRows = await fetchLatestMonitorProfileRows(tenantId);
    mergeMonitorProfileRows(mergedProfile, monitorRows, mergedProfileByCheck);
    const monitorFindings = deriveMonitorFindingsWithKeys(monitorRows);
    findings = [...new Set([...findings, ...monitorFindings.map(f => f.text)])];

    // Git #550 — the license_gap classification (#484-#488/#495) read straight
    // off the SAME `monitorRows` this generation already fetched, no extra
    // query. See `CategorizedFinding.isLicenseGap`'s doc comment for why this
    // always resolves `false` today: a finding's own checkKey's latest row is,
    // by the pinned "license_gap row is NOT a finding" contract, never itself
    // `license_gap` at the moment it becomes a finding.
    const statusByCheckKey = new Map(monitorRows.map((r) => [r.checkKey, r.status]));

    // One batched query for the whole finding set (skipped entirely when there
    // are no monitor findings — every engine calls buildTenantProfile, so this
    // must not add a query to the common no-findings path).
    if (monitorFindings.length > 0) {
      const categoriesByCheckKey = await fetchSignalCategoriesForCheckKeys(monitorFindings.map(f => f.checkKey));
      for (const finding of monitorFindings) {
        monitorMetaByFindingText.set(finding.text, {
          categories: categoriesByCheckKey.get(finding.checkKey) ?? [],
          checkKey: finding.checkKey,
          severity: finding.severity,
          itemCount: finding.itemCount,
          isLicenseGap: statusByCheckKey.get(finding.checkKey) === "license_gap",
        });
      }
    }
  } else {
    log.warn(
      { customerId },
      "buildTenantProfile: no tenantId on tenants row — monitor-derived threshold signals cannot fire for this customer",
    );
  }

  // Built from `findings` itself so the two arrays can never disagree on
  // content, order, or dedupe. Anything without a category entry — every
  // script-run finding, plus any monitor finding whose check feeds no
  // category-prefixed rule — gets `[]` (see the type's limitation note).
  const categorizedFindings: CategorizedFinding[] = findings.map(text => {
    const meta = monitorMetaByFindingText.get(text);
    return {
      text,
      categories: meta?.categories ?? [],
      checkKey: meta?.checkKey ?? null,
      severity: meta?.severity ?? null,
      itemCount: meta?.itemCount ?? null,
      isLicenseGap: meta?.isLicenseGap ?? false,
    };
  });

  return { mergedProfile, mergedProfileByCheck, findings, categorizedFindings, customerId, mspId, tenantId };
}

// ─── Tenant health block vars (used by email templates) ──────────────────────
//
// Single source of truth for turning a client's latest per-category health
// scores into the string vars consumed by the `tenant-health-block` email
// template. Category keys match `clientHealthHistoryTable.category` /
// `ALL_CATEGORY_LABELS` in admin-clients.ts: security, compliance, copilot,
// governance, productivity (used here as "adoption").
export interface TenantHealthVars {
  tenantScore: string;
  tenantScoreBand: string;
  complianceScore: string;
  securityScore: string;
  governanceScore: string;
  adoptionScore: string;
  copilotScore: string;
  tenantHealthIsZero: string;
  tenantHealthIsLow: string;
  tenantHealthIsHigh: string;
}

/**
 * Pure computation — takes the client's latest score per category (as
 * produced by a DB lookup) and returns the vars for the tenant-health-block
 * template. Returns `null` when there is no usable score data at all, so
 * callers can skip rendering the block entirely rather than showing zeros.
 */
export function computeTenantHealthVars(
  categoryScores: Partial<Record<"security" | "compliance" | "copilot" | "governance" | "productivity", number>> | null | undefined,
): TenantHealthVars | null {
  if (!categoryScores) return null;

  const entries = Object.entries(categoryScores).filter(
    (e): e is [string, number] => typeof e[1] === "number" && !isNaN(e[1]),
  );
  if (entries.length === 0) return null;

  const scoreOf = (key: string): number | null => {
    const val = categoryScores[key as keyof typeof categoryScores];
    return typeof val === "number" && !isNaN(val) ? val : null;
  };

  const overall = Math.round(entries.reduce((sum, [, v]) => sum + v, 0) / entries.length);
  const band = overall === 0 ? "zero" : overall < 60 ? "low" : overall >= 80 ? "high" : "medium";

  const fmt = (v: number | null): string => (v === null ? "" : String(v));

  return {
    tenantScore: String(overall),
    tenantScoreBand: band,
    complianceScore: fmt(scoreOf("compliance")),
    securityScore: fmt(scoreOf("security")),
    governanceScore: fmt(scoreOf("governance")),
    adoptionScore: fmt(scoreOf("productivity")),
    copilotScore: fmt(scoreOf("copilot")),
    tenantHealthIsZero: band === "zero" ? "true" : "",
    tenantHealthIsLow: band === "low" ? "true" : "",
    tenantHealthIsHigh: band === "high" ? "true" : "",
  };
}

export interface RecommendedRule {
  ruleType: string;
  sourceKey: string;
  compareValue?: string;
  rationale: string;
}

export interface TenantSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  recommendedRules: RecommendedRule[];
  isAdjustment: boolean;
  isBuiltin: boolean;
  sortOrder: number;
  enabled: boolean;
  exampleProfileKey?: string;
  exampleFindingKeyword?: string;
}

// ─── Unified signal catalog (custom_signals) ─────────────────────────────────
//
// The tenant signal catalog — the 13 "built-in" signals (9 project signals +
// 4 adjustment signals, is_builtin = true) AND any admin-created custom signals
// — lives ENTIRELY in the `custom_signals` table. There is no hardcoded array;
// adding, editing, or removing a signal is a data change, not a code deploy.
// The 13 built-ins were seeded by
// lib/db/migrations/manual/2026-07-21-unify-signal-catalog-custom-signals.sql.
//
// `is_builtin` (not membership in any code array) is what blocks deletion of a
// built-in signal — see the DELETE /admin/custom-signals/:key handler.

function parseRecommendedRules(value: unknown): RecommendedRule[] {
  if (Array.isArray(value)) return value as RecommendedRule[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as RecommendedRule[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface CustomSignalRow {
  key: string;
  label: string;
  description: string | null;
  expectedImpact: string | null;
  recommendedRules: unknown;
  isAdjustment: boolean;
  isBuiltin: boolean;
  sortOrder: number;
  enabled: boolean;
  exampleProfileKey: string | null;
  exampleFindingKeyword: string | null;
}

function mapCustomSignalRow(row: CustomSignalRow): TenantSignal {
  return {
    key: row.key,
    label: row.label,
    description: row.description ?? "",
    expectedImpact: row.expectedImpact ?? "",
    recommendedRules: parseRecommendedRules(row.recommendedRules),
    isAdjustment: Boolean(row.isAdjustment),
    isBuiltin: Boolean(row.isBuiltin),
    sortOrder: Number(row.sortOrder ?? 0),
    enabled: row.enabled !== false,
    exampleProfileKey: row.exampleProfileKey ?? undefined,
    exampleFindingKeyword: row.exampleFindingKeyword ?? undefined,
  };
}

/**
 * Canonical loader for the unified signal catalog. Returns EVERY signal —
 * built-in and custom, project and adjustment — ordered project-signals-first
 * then adjustment, each group by sort_order. This is the single source every
 * consumer reads instead of the old hardcoded TENANT_SIGNALS/ADJUSTMENT_SIGNALS
 * arrays.
 */
export async function getAllSignalDefinitions(): Promise<TenantSignal[]> {
  const rows = await db.execute(sql`
    SELECT key, label, description, expected_impact AS "expectedImpact",
           recommended_rules AS "recommendedRules", is_adjustment AS "isAdjustment",
           is_builtin AS "isBuiltin", sort_order AS "sortOrder", enabled,
           example_profile_key AS "exampleProfileKey",
           example_finding_keyword AS "exampleFindingKeyword"
    FROM custom_signals
    ORDER BY is_adjustment ASC, sort_order ASC, created_at ASC
  `);
  return (rows.rows as unknown as CustomSignalRow[]).map(mapCustomSignalRow);
}

/** Project (non-adjustment) signals only — replaces the old TENANT_SIGNALS array. */
export async function getProjectSignalDefinitions(): Promise<TenantSignal[]> {
  return (await getAllSignalDefinitions()).filter(s => !s.isAdjustment);
}

/** Adjustment (adj:*) signals only — replaces the old ADJUSTMENT_SIGNALS array. */
export async function getAdjustmentSignalDefinitions(): Promise<TenantSignal[]> {
  return (await getAllSignalDefinitions()).filter(s => s.isAdjustment);
}

/**
 * Keys of the built-in signals (is_builtin = true). Used by the custom-signal
 * create/delete routes to protect the built-ins from deletion and key collision
 * — replacing the old "is it in the hardcoded array?" membership check.
 */
export async function getBuiltinSignalKeys(): Promise<Set<string>> {
  const rows = await db.execute(sql`SELECT key FROM custom_signals WHERE is_builtin = true`);
  return new Set((rows.rows as Array<{ key: string }>).map(r => r.key));
}

// ─── Signal intelligence fields ────────────────────────────────────────────
//
// See the taxonomy comment near `signalRuleGroupsTable` in
// `lib/db/src/schema/index.ts` for the full `category` prefix list
// (pricing:*, priority:*, governance:*, security:*, compliance:*, adoption:*,
// copilot:*, architecture:*, drift:*, forecasting:*, crm:*, msp:*, workflow:*).
// These fields are pure data — no engine in this codebase reads them yet.
// computeTenantSignals() below does not consume them; they exist so future
// engine tasks (priority/pricing/health/drift/forecasting/CRM) can sum them
// off fired signals without ever hardcoding a formula.
export const SIGNAL_TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export type SignalTrendDirection = typeof SIGNAL_TREND_DIRECTIONS[number];

export const SIGNAL_SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export interface SignalIntelligenceFields {
  priority: number;
  weight: number;
  pricingImpact: number;
  priorityScoreContribution: number;
  pricingValueContribution: number;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
  licensingImpact: number;
  trendValue: number;
  trendDirection: SignalTrendDirection;
  decayRate: number;
  ttlDays: number;
  confidence: number;
  severity: SignalSeverity;
  category: string;
  pillar: string;
  crmFitContribution: number;
  crmPainContribution: number;
  crmMaturityContribution: number;
  crmIntentContribution: number;
  crmUrgencyContribution: number;
}

export interface SignalDerivationRule extends SignalIntelligenceFields {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  /** Denominator profile key for `ruleType: "profile_key_ratio"` only (#2514). Null otherwise. */
  denominatorKey: string | null;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignalRuleGroup extends SignalIntelligenceFields {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
  createdAt: Date;
}

/**
 * `decay_rate` is a `numeric(4,3)` column, which the `pg` driver returns as
 * a string. Every raw-SQL fetch site that casts DB rows to
 * `SignalDerivationRule[]`/`SignalRuleGroup[]` must run rows through this so
 * `decayRate` matches its `number` type contract (consumed as a fraction by
 * forecasting-engine.ts / drift-engine.ts's `1 - decayRate` formula).
 */
export function coerceDecayRate<T extends { decayRate?: unknown }>(rows: T[]): T[] {
  for (const row of rows) {
    if (row.decayRate !== undefined) (row as { decayRate: number }).decayRate = Number(row.decayRate);
  }
  return rows;
}

export interface RuleTraceEntry {
  signalKey: string;
  groupId: number | null;
  ruleId: number;
  result: boolean;
  reason: string;
}

export function evaluateRule(
  rule: SignalDerivationRule,
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
): { result: boolean; reason: string } {
  const { ruleType, sourceKey, compareValue } = rule;

  switch (ruleType) {
    case "profile_key_truthy": {
      const val = mergedProfile[sourceKey];
      const result = Boolean(val) && val !== 0 && val !== "" && val !== "false";
      return { result, reason: `requires profile[${sourceKey}] to be truthy to fire; actual value = ${JSON.stringify(val)}` };
    }
    case "profile_key_falsy": {
      // Only fire when the key is explicitly present in the profile.
      // An absent key means "the script that writes this field hasn't run yet" —
      // not that the feature is unconfigured.  This keeps profile_key_falsy
      // symmetric with profile_key_truthy (which correctly does not fire when
      // the key is missing).
      if (!(sourceKey in mergedProfile)) {
        return { result: false, reason: `requires profile[${sourceKey}] to be falsy to fire; key is absent — not yet written by any script, treated as unknown (not falsy)` };
      }
      const val = mergedProfile[sourceKey];
      const result = !val || val === 0 || val === "" || val === "false" || val === false;
      return { result, reason: `requires profile[${sourceKey}] to be falsy to fire; actual value = ${JSON.stringify(val)}` };
    }
    case "profile_key_eq": {
      const val = mergedProfile[sourceKey];
      const result = String(val) === String(compareValue ?? "");
      return { result, reason: `requires profile[${sourceKey}] == ${compareValue} to fire; actual value = ${JSON.stringify(val)}` };
    }
    case "profile_key_gt": {
      const val = Number(mergedProfile[sourceKey]);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val > threshold;
      return { result, reason: `requires profile[${sourceKey}] > ${threshold} to fire; actual value = ${val}` };
    }
    case "profile_key_lt": {
      const val = Number(mergedProfile[sourceKey]);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val < threshold;
      return { result, reason: `requires profile[${sourceKey}] < ${threshold} to fire; actual value = ${val}` };
    }
    case "threshold": {
      const val = Number(mergedProfile[`${sourceKey}__itemCount`] ?? 0);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val > threshold;
      return { result, reason: `requires monitor[${sourceKey}].itemCount > ${threshold} to fire; actual itemCount = ${val}` };
    }
    case "findings_keyword": {
      const keyword = (sourceKey ?? "").toLowerCase();
      const result = parsedFindings.some(f => f.toLowerCase().includes(keyword));
      return { result, reason: `requires findings to contain keyword "${sourceKey}" to fire; findings ${result ? "contain" : "do not contain"} it` };
    }
    case "profile_key_ratio": {
      // Cross-check ratio (#2514): sourceKey is the numerator profile key,
      // denominatorKey is the denominator — the two numbers can (and for the
      // real motivating case, `license-vs-total-users`, DO) come from two
      // DIFFERENT monitor checks that only ever meet here, on the merged
      // cross-check tenant profile.
      //
      // This is NOT the "derived check reading another check's stored output"
      // #553 rejected for staleness/ordering reasons. #553's objection was
      // about a check reading a SEPARATE, potentially-stale cached row
      // written by a different check's own run. mergedProfile here is built
      // fresh, once, for THIS evaluation call — every other single-key
      // ruleType above already reads its one value off this same live
      // snapshot; profile_key_ratio just reads two keys off it instead of
      // one, in the same call, against the same snapshot. No cache, no
      // ordering dependency, no new staleness risk.
      const denominatorKey = rule.denominatorKey ?? "";
      const numerator = Number(mergedProfile[sourceKey]);
      const denominator = Number(mergedProfile[denominatorKey]);
      if (!denominatorKey || isNaN(numerator) || isNaN(denominator) || denominator === 0) {
        return {
          result: false,
          reason: `requires (profile[${sourceKey}] / profile[${denominatorKey || "<no denominatorKey configured>"}]) to be computable to fire; numerator = ${JSON.stringify(mergedProfile[sourceKey])}, denominator = ${JSON.stringify(mergedProfile[denominatorKey])}`,
        };
      }
      const percent = (numerator / denominator) * 100;
      const threshold = Number(compareValue ?? 0);
      // Fixed "<" direction — mirrors the existing single-fixed-direction
      // "threshold" ruleType above (always ">"): this ruleType serves the
      // one real, live case that needs it (coverage below threshold = a
      // stalled/pilot rollout). A "_gt" sibling is a two-line addition if a
      // real ratio-fires-when-high case ever shows up; not added speculatively.
      const result = percent < threshold;
      return {
        result,
        reason: `requires (profile[${sourceKey}] / profile[${denominatorKey}]) * 100 < ${threshold} to fire; actual ratio = ${percent.toFixed(2)}% (${numerator} / ${denominator})`,
      };
    }
    default:
      return { result: false, reason: `unknown ruleType: ${ruleType}` };
  }
}

export function computeTenantSignals(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
  context?: { customerId: number; mspId: number },
): { firedSignals: Set<string>; trace: RuleTraceEntry[] } {
  const trace: RuleTraceEntry[] = [];
  const firedSignals = new Set<string>();
  if (disabledSignalKeys.has("alwaysInclude")) {
    trace.push({
      signalKey: "alwaysInclude",
      groupId: null,
      ruleId: -1,
      result: false,
      reason: "Signal is disabled by admin — skipped without evaluating rules, cannot fire",
    });
  } else {
    firedSignals.add("alwaysInclude");
  }

  const groupMap = new Map<number, SignalRuleGroup>();
  for (const g of groups) groupMap.set(g.id, g);

  const rulesByGroup = new Map<string, SignalDerivationRule[]>();
  const ungroupedRules: SignalDerivationRule[] = [];

  for (const rule of rules) {
    if (rule.groupId === null || rule.groupId === undefined) {
      ungroupedRules.push(rule);
    } else {
      const key = String(rule.groupId);
      if (!rulesByGroup.has(key)) rulesByGroup.set(key, []);
      rulesByGroup.get(key)!.push(rule);
    }
  }

  const signalKeys = [...new Set(rules.map(r => r.signalKey))];

  for (const signalKey of signalKeys) {
    if (disabledSignalKeys.has(signalKey)) {
      trace.push({
        signalKey,
        groupId: null,
        ruleId: -1,
        result: false,
        reason: "Signal is disabled by admin — skipped without evaluating rules, cannot fire",
      });
      continue;
    }

    let signalFired = false;

    const signalGroups = groups.filter(g => g.signalKey === signalKey);
    for (const group of signalGroups) {
      const groupRules = rulesByGroup.get(String(group.id)) ?? [];
      if (groupRules.length === 0) continue;

      let groupResult: boolean;
      if (group.logic === "AND") {
        groupResult = groupRules.every(rule => {
          const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
          trace.push({ signalKey, groupId: group.id, ruleId: rule.id, result, reason });
          return result;
        });
      } else {
        groupResult = groupRules.some(rule => {
          const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
          trace.push({ signalKey, groupId: group.id, ruleId: rule.id, result, reason });
          return result;
        });
      }

      if (groupResult) {
        signalFired = true;
        break;
      }
    }

    const signalUngrouped = ungroupedRules.filter(r => r.signalKey === signalKey);
    for (const rule of signalUngrouped) {
      const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
      trace.push({ signalKey, groupId: null, ruleId: rule.id, result, reason });
      if (result) {
        signalFired = true;
        break;
      }
    }

    if (signalFired) firedSignals.add(signalKey);
  }

  // ── Fire-and-forget: trigger SLA timers for any "sla:" signals ────────────
  if (context) {
    const slaSignalKeys = [...firedSignals].filter(k => k.startsWith("sla:"));
    if (slaSignalKeys.length > 0) {
      triggerSlaTimersForFiredSignals(context.customerId, context.mspId, slaSignalKeys)
        .catch(err => log.warn({ err, customerId: context.customerId, mspId: context.mspId }, "computeTenantSignals: fire-and-forget SLA timer trigger failed"));
    }
  }

  if (context) {
    recordSignalTransitions(context.customerId, context.mspId, firedSignals)
      .catch(err => log.warn({ err, customerId: context.customerId, mspId: context.mspId }, "computeTenantSignals: fire-and-forget signal transition recording failed"));
  }

  return { firedSignals, trace };
}

// ── SLA timer trigger helper (fire-and-forget, unexported) ──────────────────

async function triggerSlaTimersForFiredSignals(
  customerId: number,
  mspId: number,
  slaSignalKeys: string[],
): Promise<void> {
  for (const signalKey of slaSignalKeys) {
    try {
      const result = await db.execute(sql`
        SELECT policy_id AS "policyId" FROM sla_signal_policy_map
        WHERE signal_key = ${signalKey} AND is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)
        ORDER BY msp_id NULLS LAST LIMIT 1
      `);
      const row = result.rows[0] as { policyId: number } | undefined;
      if (!row) continue;

      const { timerId, alreadyExisted } = await startSlaTimer({
        mspId,
        customerId,
        policyId: row.policyId,
        phase: "resolution",
        ticketType: "signal_compliance",
        idempotencyKey: `sla-signal:${customerId}:${signalKey}`,
      });

      log.info(
        { signalKey, policyId: row.policyId, timerId, alreadyExisted },
        "computeTenantSignals: SLA timer triggered for fired signal",
      );
    } catch (err) {
      log.warn(
        { err, signalKey, customerId, mspId },
        "triggerSlaTimersForFiredSignals: failed to process signal key",
      );
    }
  }
}

async function recordSignalTransitions(
  customerId: number,
  mspId: number,
  firedSignals: Set<string>,
): Promise<void> {
  try {
    // tenant_signal_history.customer_id's live FK constraint actually targets
    // users.id (not mspCustomers.id, despite the column name) — see
    // resolveCustomerPortalUserId's doc comment for the same drift.
    //
    // READS span ALL of the customer's linked users (the old arbitrary limit-1
    // resolution could pick a different user per run, splitting one customer's
    // open-signal history across two users.id values — which breaks
    // stabilization windows and double-fires transitions). WRITES land on the
    // single deterministic canonical user so new history stays consolidated.
    const portalUserId = await resolveCustomerPortalUserId(customerId);
    if (portalUserId === null) {
      log.warn({ customerId, mspId }, "recordSignalTransitions: no active portal user for customer, skipping");
      return;
    }
    const allUserIds = await resolveCustomerUserIds(customerId);
    const historyUserIds = allUserIds.length > 0 ? allUserIds : [portalUserId];

    const openRows = await db.execute(sql`
      SELECT signal_key AS "signalKey" FROM tenant_signal_history
      WHERE customer_id IN ${sql.raw(`(${historyUserIds.map(Number).join(",")})`)} AND resolved_at IS NULL
    `);
    const openSignalKeys = new Set((openRows.rows as { signalKey: string }[]).map(r => r.signalKey));

    const newlyFired = [...firedSignals].filter(k => !openSignalKeys.has(k));
    const newlyResolved = [...openSignalKeys].filter(k => !firedSignals.has(k));

    for (const signalKey of newlyFired) {
      try {
        await db.execute(sql`
          INSERT INTO tenant_signal_history (customer_id, msp_id, signal_key, fired_at)
          VALUES (${portalUserId}, ${mspId}, ${signalKey}, NOW())
        `);
      } catch (err) {
        log.warn({ err, customerId, portalUserId, mspId, signalKey }, "recordSignalTransitions: failed to insert newly-fired row");
      }
    }

    for (const signalKey of newlyResolved) {
      try {
        await db.execute(sql`
          UPDATE tenant_signal_history
          SET resolved_at = NOW()
          WHERE customer_id IN ${sql.raw(`(${historyUserIds.map(Number).join(",")})`)} AND signal_key = ${signalKey} AND resolved_at IS NULL
        `);
      } catch (err) {
        log.warn({ err, customerId, portalUserId, mspId, signalKey }, "recordSignalTransitions: failed to resolve row");
      }
    }
  } catch (err) {
    log.warn({ err, customerId, mspId }, "recordSignalTransitions: failed to fetch open signal rows");
  }
}

/**
 * Returns the subset of a customer's currently-fired signals that have
 * been continuously fired for at least their per-signal stabilization
 * window (see getSignalStabilizationWindowHours) — i.e., excludes signals
 * that only just fired and could still be flapping/noise. A signal is
 * "currently fired" if it has an open row (resolved_at IS NULL) in
 * tenant_signal_history; it's "stabilized" if that row's fired_at is old
 * enough for its own window.
 *
 * Windows are resolved in one batched query keyed off the customer's open
 * signal keys (not one query per signal) — this runs per customer inside
 * the Signal Policy Engine's 15-minute sweep (policy-engine.ts), not a
 * per-request hot path, but there's no reason to pay N+1 for it anyway.
 */
export async function getStabilizedSignals(customerId: number): Promise<Set<string>> {
  try {
    // customerId here is a REAL tenants.id (the Signal Policy Engine's
    // enumeration space) — but tenant_signal_history.customer_id rows are
    // written in users.id space (see recordSignalTransitions). Bridge via
    // users.tenantId and read across ALL of the customer's linked users so history
    // written under any login (including the pre-determinism arbitrary picks)
    // still counts for the customer.
    const historyUserIds = await resolveCustomerUserIds(customerId);
    if (historyUserIds.length === 0) return new Set();
    const openRows = await db.execute(sql`
      SELECT signal_key AS "signalKey", fired_at AS "firedAt" FROM tenant_signal_history
      WHERE customer_id IN ${sql.raw(`(${historyUserIds.map(Number).join(",")})`)} AND resolved_at IS NULL
    `);
    const openSignals = openRows.rows as { signalKey: string; firedAt: string }[];
    if (openSignals.length === 0) return new Set();

    const signalKeys = [...new Set(openSignals.map(r => r.signalKey))];
    const ruleRows = await db
      .select({ signalKey: signalDerivationRulesTable.signalKey, frequency: monitorChecksTable.frequency })
      .from(signalDerivationRulesTable)
      .innerJoin(monitorChecksTable, eq(signalDerivationRulesTable.sourceKey, monitorChecksTable.key))
      .where(inArray(signalDerivationRulesTable.signalKey, signalKeys));

    const frequenciesBySignalKey = new Map<string, MonitorCheckFrequency[]>();
    for (const { signalKey, frequency } of ruleRows) {
      const frequencies = frequenciesBySignalKey.get(signalKey) ?? [];
      frequencies.push(frequency);
      frequenciesBySignalKey.set(signalKey, frequencies);
    }

    const now = Date.now();
    const stabilized = new Set<string>();
    for (const { signalKey, firedAt } of openSignals) {
      const windowHours = slowestStabilizationWindowHours(frequenciesBySignalKey.get(signalKey) ?? []);
      if (now - new Date(firedAt).getTime() >= windowHours * 60 * 60 * 1000) {
        stabilized.add(signalKey);
      }
    }
    return stabilized;
  } catch (err) {
    log.warn({ err, customerId }, "getStabilizedSignals: failed to query stabilized signals");
    return new Set();
  }
}

/**
 * Single source of truth for project inclusion logic — used by the SOW generator,
 * dry-run, and preview endpoints so they all agree on the same semantics.
 *
 * Rules (applied in order):
 * 1. No triggeredBy values → EXCLUDED. Every project must declare at least one
 *    canonical signal key. Use "alwaysInclude" for projects that should appear in
 *    every SOW regardless of signals.
 * 2. All triggeredBy values are unrecognized legacy strings (old plan names) →
 *    excluded; migrate to canonical signal keys to re-enable.
 * 3. At least one recognized signal key present → include only if ≥1 of those
 *    recognized keys appears in firedSignals
 */
export function projectMatchesSignals(
  project: { title: string; triggeredBy: string[] },
  knownSignalKeys: Set<string>,
  firedSignals: Set<string>,
): { included: boolean; legacyFallback: boolean; reason?: string } {
  const triggers = Array.isArray(project.triggeredBy) ? project.triggeredBy : [];

  if (triggers.length === 0) {
    return {
      included: false,
      legacyFallback: false,
      reason: "No triggeredBy signal keys — excluded until at least one canonical key is set (use 'alwaysInclude' to always include)",
    };
  }

  const recognizedTriggers = triggers.filter(t => knownSignalKeys.has(t));
  if (recognizedTriggers.length === 0) {
    // All triggeredBy strings are unrecognized (old plan-name style or typos).
    // EXCLUDE deterministically rather than silently including — the SOW
    // should only contain projects whose signal gate has been satisfied.
    // Migrate trigger strings to canonical signal keys to re-enable the project.
    return {
      included: false,
      legacyFallback: false,
      reason: `Unrecognized trigger(s): ${triggers.join(", ")} — excluded until migrated to canonical signal keys`,
    };
  }

  const matched = recognizedTriggers.find(t => firedSignals.has(t));
  if (matched) {
    return { included: true, legacyFallback: false };
  }
  return {
    included: false,
    legacyFallback: false,
    reason: `Requires signal(s): ${recognizedTriggers.join(", ")} — none fired for this tenant`,
  };
}

/**
 * resolveSignalsOverride
 *
 * Pure extraction of the signalsOverride resolution path used by the
 * `generate_document(consolidated_sow)` executor node.
 *
 * When a workflow chains `get_tenant_signals → generate_document`, the
 * generate_document node config carries `signalsOverride: "{{signals}}"`.
 * At runtime the executor interpolates that template against the current
 * payload, producing a JSON-serialised string such as
 * `'["alwaysInclude","hasGovernanceGaps"]'`.  This function handles the
 * parse + fallback steps so they can be tested independently of the DB
 * and Claude dependencies of the executor.
 *
 * Resolution order:
 *  1. Interpolate `field` via `interpFn` → parse as JSON array → return Set
 *  2. Fallback: use `payload.signals` directly when interp doesn't yield a JSON array
 *  3. Return `undefined` when field is empty/absent
 *
 * @param field      The raw template string from `node.data.signalsOverride`
 *                   (e.g. `"{{signals}}"` or a literal JSON array).
 * @param payload    The live workflow payload (contains `signals` from a
 *                   prior `get_tenant_signals` node output).
 * @param interpFn   Template interpolator — matches the executor's `interp`
 *                   signature; in tests pass a simple mock.
 */
export function resolveSignalsOverride(
  field: string | undefined,
  payload: Record<string, unknown>,
  interpFn: (template: string, payload: Record<string, unknown>) => string | undefined,
): Set<string> | undefined {
  const overrideField = field?.trim();
  if (!overrideField) return undefined;
  try {
    const resolved = interpFn(overrideField, payload);
    if (resolved) {
      const parsed = JSON.parse(resolved) as unknown;
      if (Array.isArray(parsed)) return new Set<string>(parsed as string[]);
    }
  } catch { /* not a valid JSON array — fall through to payload.signals */ }
  if (Array.isArray(payload.signals)) return new Set<string>(payload.signals as string[]);
  return undefined;
}

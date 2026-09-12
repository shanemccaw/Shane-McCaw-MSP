/**
 * weekly-rescan-populations.ts — Git #3609, collapsed to one row per tenant by #3642
 *
 * The two seeded weekly rescans used to split their audience by mspRole: Monday's
 * retargeting rescan took 'Free' + 'Assessment', Sunday's Copilot Assessment rescan
 * took 'Assessment' only. #3590 folded 'Assessment' into 'Free', so both queries
 * became `msp_role = 'Free'` and every pre-payment tenant was scanned twice a week.
 *
 * What the Sunday rescan was meant to single out — customers who bought an
 * assessment — is no longer expressible by role, so the split is now by purchase:
 *
 *   - Sunday (paid assessment): Free users holding an ACTIVE PAID assessment purchase
 *     (client_services -> services.service_type = 'assessment' AND NOT
 *     is_free_offering), rescanning the package they actually bought.
 *   - Monday (retargeting): every other Free user — the pre-purchase nurture audience.
 *
 * The two populations are disjoint, so each tenant is scanned once a week. The free
 * catalogue rows (Free 360° Tenant Scan, the Snapshots) are service_type 'assessment'
 * too, which is why the paid test is is_free_offering, not service_type alone.
 *
 * #3642: `fireWorkflowFanOut`'s per_record mode fires one FULL TENANT scan per
 * returned row, but each query below still joined per *user* — a tenant with N
 * eligible Free users (N paid-assessment holders on Sunday, or N pre-purchase users
 * on Monday) produced N identical scans of the same tenant on the same night. Both
 * queries are now `DISTINCT ON (tenant_id, packageKey)`, ordered so the lowest
 * `users.id` on that (tenant, packageKey) pair is the deterministic representative
 * clientId used for notification attribution — one row per tenant per package,
 * always.
 *
 * Shared by seed-system-workflows.ts (the trigger configs) and the portal's
 * rescoring-status route (which trigger's next_run_at a tenant sees), so the two can
 * never disagree about who belongs to which schedule.
 */

export const WEEKLY_RETARGETING_RESCAN_NAME = "__system__: Weekly Retargeting Rescan — Free/Assessment Tenants";
export const WEEKLY_ASSESSMENT_RESCAN_NAME = "__system__: Weekly Copilot Assessment Rescan";

const PACKAGE_KEY_EXPR = "COALESCE(s.type_attributes->>'packageKey', 'core:security-baseline')";

const SELECT_COLUMNS =
  `SELECT DISTINCT ON (t.tenant_id, ${PACKAGE_KEY_EXPR}) ` +
  `u.id AS "clientId", t.tenant_id AS "tenantId", ${PACKAGE_KEY_EXPR} AS "packageKey" `;

const ORDER_BY_TENANT_PACKAGE_THEN_USER = ` ORDER BY t.tenant_id, ${PACKAGE_KEY_EXPR}, u.id`;

const ELIGIBLE_FREE_USER =
  "u.msp_role = 'Free' AND u.is_active = true " +
  "AND t.consent->'graph'->>'status' = 'granted'";

/** Sunday: one row per (tenant, distinct purchased package) across active paid assessments. */
export const WEEKLY_ASSESSMENT_RESCAN_QUERY =
  SELECT_COLUMNS +
  "FROM users u " +
  "JOIN tenants t ON t.id = u.tenant_id " +
  "JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
  "JOIN services s ON s.id = cs.service_id AND s.service_type = 'assessment' AND s.is_free_offering = false " +
  "WHERE " + ELIGIBLE_FREE_USER +
  ORDER_BY_TENANT_PACKAGE_THEN_USER;

/**
 * Monday: eligible Free users on tenants the Sunday query does not cover. The scan
 * runs against the tenant, not the user, so the exclusion is tenant-wide — a second
 * Free user on a tenant whose colleague holds a paid assessment would otherwise
 * rescan that same tenant on Monday.
 */
export const WEEKLY_RETARGETING_RESCAN_QUERY =
  SELECT_COLUMNS +
  "FROM users u " +
  "JOIN tenants t ON t.id = u.tenant_id " +
  "LEFT JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
  "LEFT JOIN services s ON s.id = cs.service_id " +
  "WHERE " + ELIGIBLE_FREE_USER + " " +
  "AND NOT EXISTS (SELECT 1 FROM users pu " +
  "JOIN client_services pcs ON pcs.client_user_id = pu.id AND pcs.status = 'active' " +
  "JOIN services ps ON ps.id = pcs.service_id AND ps.service_type = 'assessment' AND ps.is_free_offering = false " +
  "WHERE pu.tenant_id = u.tenant_id AND pu.msp_role = 'Free' AND pu.is_active = true)" +
  ORDER_BY_TENANT_PACKAGE_THEN_USER;

/**
 * Every fan_out_query either trigger has ever been seeded with — the role-split
 * originals, #3590's rewrite of them, and #3609's per-user (pre-#3642) rewrite. The
 * seed rewrites an existing trigger's query only while it still equals one of these,
 * so a query an operator has hand-edited in the Workflow Engine is left alone.
 */
const legacyRoleSplitQuery = (roleClause: string) =>
  "SELECT u.id AS \"clientId\", t.tenant_id AS \"tenantId\", " +
  "COALESCE(s.type_attributes->>'packageKey', 'core:security-baseline') AS \"packageKey\" " +
  "FROM users u " +
  "JOIN tenants t ON t.id = u.tenant_id " +
  "LEFT JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
  "LEFT JOIN services s ON s.id = cs.service_id " +
  "WHERE " + roleClause + " AND u.is_active = true " +
  "AND t.consent->'graph'->>'status' = 'granted'";

/** #3609's per-user (pre-#3642) SELECT prefix — no DISTINCT ON, one row per user. */
const PER_USER_SELECT_COLUMNS =
  "SELECT DISTINCT u.id AS \"clientId\", t.tenant_id AS \"tenantId\", " +
  "COALESCE(s.type_attributes->>'packageKey', 'core:security-baseline') AS \"packageKey\" ";

const PER_USER_WEEKLY_ASSESSMENT_RESCAN_QUERY =
  PER_USER_SELECT_COLUMNS +
  "FROM users u " +
  "JOIN tenants t ON t.id = u.tenant_id " +
  "JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
  "JOIN services s ON s.id = cs.service_id AND s.service_type = 'assessment' AND s.is_free_offering = false " +
  "WHERE " + ELIGIBLE_FREE_USER;

const PER_USER_WEEKLY_RETARGETING_RESCAN_QUERY =
  PER_USER_SELECT_COLUMNS +
  "FROM users u " +
  "JOIN tenants t ON t.id = u.tenant_id " +
  "LEFT JOIN client_services cs ON cs.client_user_id = u.id AND cs.status = 'active' " +
  "LEFT JOIN services s ON s.id = cs.service_id " +
  "WHERE " + ELIGIBLE_FREE_USER + " " +
  "AND NOT EXISTS (SELECT 1 FROM users pu " +
  "JOIN client_services pcs ON pcs.client_user_id = pu.id AND pcs.status = 'active' " +
  "JOIN services ps ON ps.id = pcs.service_id AND ps.service_type = 'assessment' AND ps.is_free_offering = false " +
  "WHERE pu.tenant_id = u.tenant_id AND pu.msp_role = 'Free' AND pu.is_active = true)";

export const LEGACY_WEEKLY_RESCAN_QUERIES: readonly string[] = [
  legacyRoleSplitQuery("u.msp_role = 'Free'"),
  legacyRoleSplitQuery("u.msp_role IN ('Free', 'Assessment')"),
  legacyRoleSplitQuery("u.msp_role = 'Assessment'"),
  PER_USER_WEEKLY_ASSESSMENT_RESCAN_QUERY,
  PER_USER_WEEKLY_RETARGETING_RESCAN_QUERY,
];

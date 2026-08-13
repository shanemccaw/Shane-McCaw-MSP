/**
 * copilot-data-exposure-risk-553.test.ts
 *
 * #553 — `copilot:data-exposure-risk` was `count(id)` over `/sites`, so
 * `copilotExposedSiteCount` equalled the number of SharePoint sites in the
 * tenant. On the live test tenant that produced "All 99 of 99 scanned
 * SharePoint sites are flagged as Copilot-exposed", used as the primary reason
 * a copilot_readiness document said deployment must not proceed.
 *
 * This suite is built so it CANNOT pass against the defect (the lesson from
 * #413, whose harness could not detect the fix it guarded):
 *
 *   1. The DEFECT is driven first, through the real executor, and asserted to
 *      produce "every site" — so the assertions below are known to discriminate.
 *   2. The FIX is driven through the same executor with the same fixtures.
 *   3. Both configs are read OUT OF THE MIGRATION FILE this issue ships, not
 *      retyped here, so a test asserting a shape the migration does not
 *      actually apply is impossible.
 *
 * The Graph payload fixtures are the documented v1.0 shapes (`permission` with
 * `grantedToV2.siteUser.loginName` carrying the SharePoint claim, and the
 * `sharingLink.scope` values) — the same shapes #357's suite uses, because the
 * per-site derivation is literally the same code (`normalizeSiteSharing`).
 * There is no live tenant or DATABASE_URL in this environment.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ── Mock external dependencies (mirrors __tests__/sharepoint-sharing.test.ts) ──

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        orderBy: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
        }),
        returning: vi.fn().mockResolvedValue([{ profileId: "test-uuid" }]),
      }),
    }),
  },
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantsTable: {},
}));

vi.mock("./graph", () => ({
  graphFetchForTenant: vi.fn(),
  ConsentRevokedError: class ConsentRevokedError extends Error {
    tenantId: string;
    constructor(tenantId: string) {
      super(`Consent revoked for ${tenantId}`);
      this.name = "ConsentRevokedError";
      this.tenantId = tenantId;
    }
  },
  LicenseGapError: class LicenseGapError extends Error {
    tenantId: string;
    feature: string;
    graphErrorCode: string | null;
    rawBody: string;
    constructor(tenantId: string, feature: string, graphErrorCode: string | null, rawBody: string) {
      super(`License gap for ${tenantId}: ${feature}`);
      this.name = "LicenseGapError";
      this.tenantId = tenantId;
      this.feature = feature;
      this.graphErrorCode = graphErrorCode;
      this.rawBody = rawBody;
    }
  },
  markTenantConsentRevoked: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./ps-execution-client", () => ({
  callPsExecution: vi.fn(),
  PsExecutionError: class PsExecutionError extends Error {
    kind: "unreachable" | "auth_failed" | "script_error";
    cmdletKey: string;
    constructor(kind: "unreachable" | "auth_failed" | "script_error", cmdletKey: string, message: string) {
      super(message);
      this.name = "PsExecutionError";
      this.kind = kind;
      this.cmdletKey = cmdletKey;
    }
  },
}));

vi.mock("./logger", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

import { executeMonitorCheck, FAN_OUT_ITEM_NORMALIZERS } from "./monitor-executor";
import { EEEU_LOGIN_NAME_PREFIX, EVERYONE_LOGIN_NAME_PREFIX } from "./sharepoint-sharing";
import { graphFetchForTenant } from "./graph";

// ── The migration this issue ships, read rather than retyped ──────────────────

const MIGRATION_RELATIVE_PATH =
  "lib/db/migrations/manual/2026-08-08-copilot-data-exposure-risk-real-signal-553.sql";

/**
 * Walks up from the vitest cwd (the api-server package) to the repo root.
 * Resolved at runtime rather than from `__dirname`, which does not exist in
 * this package's ESM build.
 */
function findMigration(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, MIGRATION_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`#553 migration not found walking up from ${process.cwd()}`);
}

const MIGRATION_SQL = readFileSync(findMigration(), "utf8");

/**
 * Pulls one `column = '<json>'::jsonb` value out of the migration's UPDATE.
 *
 * The point is that the fixtures below are the REAL stored config. If the
 * migration's mapping and this suite's expectations ever diverge, the tests
 * stop describing anything that ships — which is the failure mode #553 is
 * fundamentally about.
 */
function jsonbFromMigration(column: string): unknown {
  const re = new RegExp(`${column}\\s*=\\s*'([\\s\\S]*?)'::jsonb`);
  const match = MIGRATION_SQL.match(re);
  if (!match) throw new Error(`#553 migration has no ${column} = '...'::jsonb assignment`);
  // Postgres escapes a literal single quote by doubling it.
  return JSON.parse(match[1].replace(/''/g, "'"));
}

type MappingRule = { sourceField: string; targetField: string; transform?: string };
type SeverityRule = { expression: string; severity: string; label?: string };

const FIXED_MAPPING = jsonbFromMigration("mapping") as MappingRule[];
const FIXED_SEVERITY_RULES = jsonbFromMigration("severity_rules") as SeverityRule[];

// ── Real Graph payload fixtures (documented v1.0 shapes) ──────────────────────

const TENANT_GUID = "3d2e5f60-1c0a-4a55-9c1e-2b8f7a6d4e11";

const eeeuPermission = {
  id: "eeeu-1",
  roles: ["read"],
  grantedToV2: {
    siteUser: {
      id: "11",
      displayName: "Everyone except external users",
      loginName: `${EEEU_LOGIN_NAME_PREFIX}/${TENANT_GUID}`,
    },
  },
};

const everyonePermission = {
  id: "everyone-1",
  roles: ["read"],
  grantedToV2: {
    siteUser: { id: "12", displayName: "Everyone", loginName: EVERYONE_LOGIN_NAME_PREFIX },
  },
};

const anonymousLinkPermission = {
  id: "anon-1",
  roles: ["write"],
  link: { scope: "anonymous", type: "edit", webUrl: "https://contoso.sharepoint.com/:f:/s/finance/EaBcD" },
};

const organizationLinkPermission = {
  id: "org-1",
  roles: ["read"],
  link: { scope: "organization", type: "view", webUrl: "https://contoso.sharepoint.com/:f:/s/marketing/EzYxW" },
};

/** A specific-people link and a named user: real, common, deliberately clean. */
const namedPeopleLinkPermission = {
  id: "users-1",
  roles: ["write"],
  link: { scope: "users", type: "edit", webUrl: "https://contoso.sharepoint.com/:f:/s/hr/EqQ" },
};

const namedUserPermission = {
  id: "user-1",
  roles: ["write"],
  grantedToV2: {
    user: { id: "5D33DD65C6932946", displayName: "Robin Danielsen" },
    siteUser: { id: "1", displayName: "Robin Danielsen", loginName: "Robin Danielsen" },
  },
};

const site = (short: string, guid: string, personal = false) => ({
  id: `contoso.sharepoint.com,${guid},${guid}`,
  name: short,
  displayName: short,
  webUrl: `https://contoso.sharepoint.com/sites/${short}`,
  isPersonalSite: personal,
});

/**
 * Five sites, of which exactly TWO carry real broad sharing. The shape of the
 * live defect in miniature: the fabricated answer is 5, the real answer is 2.
 */
const FINANCE = site("finance", "aaaaaaaa-0000-0000-0000-000000000001");   // EEEU
const MARKETING = site("marketing", "bbbbbbbb-0000-0000-0000-000000000002"); // anonymous + org link
const INTRANET = site("intranet", "cccccccc-0000-0000-0000-000000000003");  // clean
const HR = site("hr", "dddddddd-0000-0000-0000-000000000004");              // clean (users link)
const PROJECTS = site("projects", "eeeeeeee-0000-0000-0000-000000000005");  // clean (named user)
const ONEDRIVE = {
  id: "contoso-my.sharepoint.com,ffffffff-0000-0000-0000-000000000006,ffffffff-0000-0000-0000-000000000006",
  name: "OneDrive – Robin",
  webUrl: "https://contoso-my.sharepoint.com/personal/robin_contoso_com",
  isPersonalSite: true,
};

const ALL_SITES = [FINANCE, MARKETING, INTRANET, HR, PROJECTS, ONEDRIVE];
/** The real denominator: every site except the personal OneDrive. */
const NON_PERSONAL_SITE_COUNT = 5;
/** The real numerator: FINANCE (eeeu) and MARKETING (anonymous + organization). */
const REALLY_EXPOSED_SITE_COUNT = 2;

// ── Check rows ────────────────────────────────────────────────────────────────

const baseCheckRow = {
  id: 77,
  checkId: "uuid-copilot-data-exposure",
  key: "copilot:data-exposure-risk",
  label: "Copilot Data Exposure Risk",
  description: null,
  method: "GET",
  requestBody: null,
  selectParams: null,
  filterParams: null,
  properties: [] as string[],
  outputSchema: null,
  engines: ["copilot"] as string[],
  frequency: "daily" as const,
  requiresCustomerScript: false,
  scriptPackageId: null,
  executorType: "graph" as const,
  psCmdletKey: null,
  psParams: null,
  spOperation: null,
  status: "active" as const,
  createdByAdminId: null,
  updatedByAdminId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** The DEFECT, exactly as #553 confirmed it live. */
const defectiveCheck = {
  ...baseCheckRow,
  endpoint: "/sites",
  mapping: [{ sourceField: "id", targetField: "copilotExposedSiteCount", transform: "count" }] as MappingRule[],
  severityRules: [] as SeverityRule[],
  fanOutSource: null as string | null,
  fanOutItemIdField: null as string | null,
  fanOutMaxItems: null as number | null,
  fanOutItemFilter: null as string | null,
  fanOutItemNormalizer: null as string | null,
  schemaVersion: 1,
};

/** The FIX — mapping and severity rules read out of the shipped migration. */
const fixedCheck = {
  ...baseCheckRow,
  endpoint: "/sites/{itemId}/drive/root/permissions",
  mapping: FIXED_MAPPING,
  severityRules: FIXED_SEVERITY_RULES,
  fanOutSource: "/sites/getAllSites",
  fanOutItemIdField: "id",
  fanOutMaxItems: 400,
  fanOutItemFilter: "{{isPersonalSite}} != true",
  fanOutItemNormalizer: "sharepoint:site-sharing",
  schemaVersion: 2,
};

// ── Harness ───────────────────────────────────────────────────────────────────

const mockFetch = graphFetchForTenant as Mock;

const jsonRes = (value: unknown[], nextLink?: string) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(nextLink ? { value, "@odata.nextLink": nextLink } : { value }),
  headers: { get: (h: string) => (h === "content-type" ? "application/json" : null) },
});

const routeTo = (path: string, s: { id: string }) => path.includes(encodeURI(s.id)) || path.includes(s.id);

/** Permissions per site, as Graph would really return them. */
function permissionsFor(path: string): unknown[] {
  if (routeTo(path, FINANCE)) return [eeeuPermission, namedUserPermission];
  if (routeTo(path, MARKETING)) return [anonymousLinkPermission, organizationLinkPermission];
  if (routeTo(path, INTRANET)) return [];
  if (routeTo(path, HR)) return [namedPeopleLinkPermission];
  if (routeTo(path, PROJECTS)) return [namedUserPermission];
  throw new Error("unexpected per-item path " + path);
}

function wireGraph(onPath?: (path: string) => void) {
  mockFetch.mockImplementation(async (_tenantId: string, path: string) => {
    onPath?.(path);
    if (path.includes("getAllSites")) return jsonRes(ALL_SITES);
    // The defect's flat call: /sites, with no per-site hop at all.
    if (!path.includes("/permissions")) return jsonRes(ALL_SITES);
    return jsonRes(permissionsFor(path));
  });
}

const run = (check: typeof defectiveCheck | typeof fixedCheck, triggerId: string) =>
  executeMonitorCheck({
    check: check as never,
    tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3",
    triggerId,
    skipIdempotency: true,
    includeItems: true,
    persistProfile: false,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. The defect, reproduced ─────────────────────────────────────────────────

describe("#553 the defect — count(id) over /sites", () => {
  it("reports EVERY site as Copilot-exposed, which is what produced 99 of 99", async () => {
    wireGraph();
    const result = await run(defectiveCheck, "defect-run");

    // 6, not 5: the flat /sites call has no fan-out item filter, so the
    // personal OneDrive is counted too. Nothing about this number is a finding.
    expect(result.extractedProperties.copilotExposedSiteCount).toBe(ALL_SITES.length);
    expect(result.extractedProperties.copilotExposedSiteCount).not.toBe(REALLY_EXPOSED_SITE_COUNT);
  });

  it("carries no denominator at all, so a finding cannot say 'N of M' honestly", async () => {
    wireGraph();
    const result = await run(defectiveCheck, "defect-run-2");
    expect(result.extractedProperties.copilotSitesScanned).toBeUndefined();
    expect(result.extractedProperties._fanOut).toBeUndefined();
  });
});

// ── 2. The fix ────────────────────────────────────────────────────────────────

describe("#553 the fix — real broad sharing, per site", () => {
  it("counts only sites with REAL broad sharing, not every site", async () => {
    wireGraph();
    const result = await run(fixedCheck, "fix-run");
    const props = result.extractedProperties;

    expect(props.copilotExposedSiteCount).toBe(REALLY_EXPOSED_SITE_COUNT);
    // The whole issue in one assertion: numerator strictly below denominator.
    expect(props.copilotSitesScanned).toBe(NON_PERSONAL_SITE_COUNT);
    expect(props.copilotExposedSiteCount as number).toBeLessThan(props.copilotSitesScanned as number);
  });

  it("breaks the count down by the four kinds Microsoft names, from real fields", async () => {
    wireGraph();
    const props = (await run(fixedCheck, "fix-run-2")).extractedProperties;

    expect(props.copilotEeeuSiteCount).toBe(1);              // FINANCE
    expect(props.copilotAnonymousLinkSiteCount).toBe(1);     // MARKETING
    expect(props.copilotOrganizationLinkSiteCount).toBe(1);  // MARKETING
    expect(props.copilotEveryoneSiteCount).toBe(0);          // none in this tenant
    // MARKETING carries two kinds but is ONE exposed site — the counts are
    // per-site, not per-grant.
    expect(props.copilotExposedSiteCount).toBe(2);
    expect(props.copilotExposureByHighestSharingLevel).toEqual({ eeeu: 1, anonymous_link: 1 });
  });

  it("does not treat specific-people links, named users or empty ACLs as exposure", async () => {
    wireGraph();
    const rows = ((await run(fixedCheck, "fix-run-3")).items ?? []) as Array<Record<string, unknown>>;

    for (const shortName of ["intranet", "hr", "projects"]) {
      const row = rows.find((r) => String(r.siteUrl).endsWith(`/${shortName}`))!;
      expect(row, `${shortName} must still emit a row — a real denominator needs it`).toBeTruthy();
      expect(row.broadAccess).toBe(false);
      expect(row.highestSharingLevel).toBeNull();
    }
  });

  it("excludes personal OneDrive sites and never issues a request for them", async () => {
    const paths: string[] = [];
    wireGraph((p) => paths.push(p));
    const result = await run(fixedCheck, "fix-run-4");

    expect(paths.some((p) => routeTo(p, ONEDRIVE))).toBe(false);
    const fanOut = result.extractedProperties._fanOut as Record<string, unknown>;
    expect(fanOut.sourceItemsTotal).toBe(ALL_SITES.length);
    expect(fanOut.sourceItemsExcludedByFilter).toBe(1);
    expect(fanOut.sourceItemsScanned).toBe(NON_PERSONAL_SITE_COUNT);
    expect(fanOut.truncated).toBe(false);
  });

  it("reuses #357's code-owned normalizer rather than a second implementation", () => {
    expect(fixedCheck.fanOutItemNormalizer).toBe("sharepoint:site-sharing");
    expect(FAN_OUT_ITEM_NORMALIZERS[fixedCheck.fanOutItemNormalizer]).toBeTypeOf("function");
  });
});

// ── 3. Severity + the sentence a customer actually reads ──────────────────────

describe("#553 severity rules", () => {
  it("fires critical on an anonymous link and names the real numerator AND denominator", async () => {
    wireGraph();
    const result = await run(fixedCheck, "sev-run");

    expect(result.severityMatched).toBe("critical");
    expect(result.severityLabel).toContain("1 of 5");
    expect(result.severityLabel).toContain("Anyone with the link");
    // The defect's sentence shape must be impossible now.
    expect(result.severityLabel).not.toContain("5 of 5");
  });

  it("falls to the EEEU warning band when no link-based or Everyone grant exists", async () => {
    mockFetch.mockImplementation(async (_t: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([FINANCE, INTRANET, HR]);
      return jsonRes(permissionsFor(path));
    });
    const result = await run(fixedCheck, "sev-run-2");

    expect(result.extractedProperties.copilotExposedSiteCount).toBe(1);
    expect(result.severityMatched).toBe("warning");
    expect(result.severityLabel).toContain("1 of 3");
    expect(result.severityLabel).toContain("Everyone except external users");
  });

  it("ranks Everyone (includes external guests) above EEEU", async () => {
    mockFetch.mockImplementation(async (_t: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([FINANCE, INTRANET]);
      if (routeTo(path, FINANCE)) return jsonRes([eeeuPermission, everyonePermission]);
      return jsonRes([]);
    });
    const result = await run(fixedCheck, "sev-run-3");

    expect(result.extractedProperties.copilotEveryoneSiteCount).toBe(1);
    expect(result.severityMatched).toBe("critical");
    expect(result.severityLabel).toContain("includes external guests");
  });

  it("matches NOTHING on a genuinely clean tenant", async () => {
    mockFetch.mockImplementation(async (_t: string, path: string) => {
      if (path.includes("getAllSites")) return jsonRes([INTRANET, HR, PROJECTS]);
      return jsonRes(permissionsFor(path));
    });
    const result = await run(fixedCheck, "sev-run-4");

    expect(result.extractedProperties.copilotExposedSiteCount).toBe(0);
    expect(result.extractedProperties.copilotSitesScanned).toBe(3);
    expect(result.severityMatched).toBeNull();
    expect(result.severityLabel).toBeNull();
  });
});

// ── 4. The shipped migration is the thing under test ──────────────────────────

describe("#553 migration contract", () => {
  it("keeps copilotExposedSiteCount as the target field the signal is wired to", () => {
    // signal_derivation_rules.source_key for signal.copilot.data-exposure-risk
    // is the literal string "copilotExposedSiteCount", resolved as a mapping
    // targetField against the merged tenant profile. Renaming it would unwire
    // the copilot pillar's highest-weighted signal in silence.
    const headline = FIXED_MAPPING.find((r) => r.targetField === "copilotExposedSiteCount");
    expect(headline).toBeTruthy();
    // ...and it must no longer be the bare count of ids.
    expect(headline!.transform).toBe("countTruthy");
    expect(headline!.sourceField).toBe("broadAccess");
  });

  it("namespaces every other field so it cannot collide with #357 in the merged profile", () => {
    // compliance:eeeu-site-sharing already publishes these names.
    const eeeuFields = new Set([
      "oversharedSiteCount", "eeeuSiteCount", "everyoneSiteCount", "anonymousLinkSiteCount",
      "organizationLinkSiteCount", "sitesScanned", "sitesByHighestSharingLevel",
    ]);
    for (const rule of FIXED_MAPPING) {
      expect(eeeuFields.has(rule.targetField), `${rule.targetField} collides with #357`).toBe(false);
      if (rule.targetField !== "copilotExposedSiteCount") {
        expect(rule.targetField.startsWith("copilot")).toBe(true);
      }
    }
  });

  it("orders severity rules most-severe-first, since the first match wins", () => {
    expect(FIXED_SEVERITY_RULES.map((r) => r.severity)).toEqual([
      "critical", // anonymous link — no sign-in at all
      "critical", // Everyone — includes external guests
      "warning",  // EEEU — every internal user
      "info",     // organization-wide link — tenant-wide but link-gated
    ]);
  });

  it("gives every severity rule a label that interpolates the real denominator", () => {
    for (const rule of FIXED_SEVERITY_RULES) {
      expect(rule.label, `${rule.expression} has no label`).toBeTruthy();
      expect(rule.label).toContain("{{copilotSitesScanned}}");
    }
  });

  it("ends with the self-marking simulator_migration_runs INSERT naming itself", () => {
    expect(MIGRATION_SQL).toContain(
      "VALUES ('2026-08-08-copilot-data-exposure-risk-real-signal-553.sql', now())",
    );
  });
});

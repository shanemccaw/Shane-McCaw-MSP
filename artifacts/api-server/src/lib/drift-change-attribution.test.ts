/**
 * Tests for per-setting drift attribution (Git #2819).
 *
 * The regression under test is specific and security-relevant: before this,
 * `buildCaChangeRequestAttribution` returned a closure that IGNORED its `setting`
 * argument, so one completed Conditional Access change request marked every drifted
 * CA setting in the tenant `approved` for 30 days — and `approved` is exactly the
 * verdict `customer-tenant-alert-engine.ts` does NOT count toward `drift.unapproved`.
 * The live-Postgres block at the bottom is the one that actually proves the fix:
 * two policies drift, a change request touched only one of them, and the OTHER one
 * has to come out `unattributed`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run drift-change-attribution
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  pool,
  mspsTable,
  tenantsTable,
  mspChangeRequestsTable,
  configChangeScopesTable,
  driftEventsTable,
  driftBaselineSnapshotsTable,
  driftCollectionStatusTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  driftPropertyPath,
  resolveDriftSettingTarget,
  matchDriftScope,
  makeDriftAttributionResolver,
  buildDriftScopeAttribution,
  type EligibleDriftScope,
} from "./drift-change-attribution.ts";
import { clearResourceRegistryCache } from "./config-change-attribution.ts";
import { captureBaseline, collectDrift } from "./drift-collector.ts";
import { DRIFT_CHECK_SPECS } from "./drift-check-specs.ts";
import { formatChangeRequestCode } from "./portal-change-control.ts";

/** The real, registered Graph collection every fixture below targets. */
const RESOURCE = "graph:v1.0:/identity/conditionalAccess/policies";
const CA_ENDPOINT = "/identity/conditionalAccess/policies";
const POLICY_A = "aaaaaaaa-1111-2222-3333-444444444444";
const POLICY_B = "bbbbbbbb-5555-6666-7777-888888888888";

const CA_IDENTITY = { collection: "policies" };

// ── Pure: setting path → property path ───────────────────────────────────────

describe("drift-change-attribution — property path dialect (#2819)", () => {
  it("maps JSON-pointer segments onto the differ's dot/bracket form", () => {
    expect(driftPropertyPath(["state"])).toBe("state");
    expect(driftPropertyPath(["conditions", "users", "includeUsers"])).toBe("conditions.users.includeUsers");
  });

  it("collapses a numeric segment onto the property before it, never its own element", () => {
    // `config-snapshot-differ` writes `conditions.users.includeUsers[0]` and
    // `normalizePropertyPath` collapses the index — this has to land on the same string.
    expect(driftPropertyPath(["conditions", "users", "includeUsers", "1"])).toBe("conditions.users.includeUsers[]");
    expect(driftPropertyPath(["grantControls", "builtInControls", "0"])).toBe("grantControls.builtInControls[]");
  });

  it("is null when there is no property tail at all", () => {
    expect(driftPropertyPath([])).toBeNull();
  });

  it("is null when the tail starts with an index, which is not a property path", () => {
    expect(driftPropertyPath(["0"])).toBeNull();
  });
});

// ── Pure: setting path → object identity ─────────────────────────────────────

describe("drift-change-attribution — setting path → object identity (#2819, keyed by #3089)", () => {
  it("reads the object identity straight off the keyed path", () => {
    expect(resolveDriftSettingTarget(`/policies/${POLICY_A}/state`, CA_IDENTITY)).toEqual({
      objectIdentity: POLICY_A,
      propertyPathNormalized: "state",
    });
    expect(resolveDriftSettingTarget(`/policies/${POLICY_B}/conditions/users/includeUsers/2`, CA_IDENTITY)).toEqual({
      objectIdentity: POLICY_B,
      propertyPathNormalized: "conditions.users.includeUsers[]",
    });
  });

  it("a whole-object change — a policy created or deleted — has an identity and no property path", () => {
    // #3089: THE case this issue was about. Under the old positional array a
    // creation/deletion collapsed into one opaque `/policies` replace naming no
    // object; keyed, it is an add/remove at the policy's own id.
    expect(resolveDriftSettingTarget(`/policies/${POLICY_B}`, CA_IDENTITY)).toEqual({
      objectIdentity: POLICY_B,
      propertyPathNormalized: null,
    });
  });

  it("a whole-collection replace still names no object, rather than guessing one", () => {
    // Rare once keyed (a collection missing, or captured in another shape), but the
    // answer stays `null` — restricting the match to resource-level scopes.
    expect(resolveDriftSettingTarget("/policies", CA_IDENTITY)).toEqual({
      objectIdentity: null,
      propertyPathNormalized: null,
    });
  });

  it("does not depend on scan order — the same key resolves the same object either way", () => {
    // The positional guard #2819 needed existed only because `detectDrift` walks
    // arrays positionally and Graph promises no stable order. A key cannot drift
    // out from under its object, so there is nothing left to guard.
    expect(resolveDriftSettingTarget(`/policies/${POLICY_A}/state`, CA_IDENTITY)?.objectIdentity).toBe(POLICY_A);
    expect(resolveDriftSettingTarget(`/policies/${POLICY_B}/state`, CA_IDENTITY)?.objectIdentity).toBe(POLICY_B);
  });

  it("a path outside the declared collection resolves to nothing at all", () => {
    expect(resolveDriftSettingTarget("/", CA_IDENTITY)).toBeNull();
    expect(resolveDriftSettingTarget(`/somethingElse/${POLICY_A}`, CA_IDENTITY)).toBeNull();
  });
});

// ── Pure: scope matching ─────────────────────────────────────────────────────

describe("drift-change-attribution — scope matching (#2819)", () => {
  const objectScope = { resourceKey: RESOURCE, objectIdentity: POLICY_A, propertyPathNormalized: null };
  const resourceScope = { resourceKey: RESOURCE, objectIdentity: null, propertyPathNormalized: null };

  it("an object-scoped CR covers its own object and no other", () => {
    expect(matchDriftScope(objectScope, { resourceKey: RESOURCE, objectIdentity: POLICY_A, propertyPathNormalized: "state" }))
      .toBe("object");
    expect(matchDriftScope(objectScope, { resourceKey: RESOURCE, objectIdentity: POLICY_B, propertyPathNormalized: "state" }))
      .toBeNull();
  });

  it("an object-scoped CR cannot explain a change no object can be named for", () => {
    expect(matchDriftScope(objectScope, { resourceKey: RESOURCE, objectIdentity: null, propertyPathNormalized: null }))
      .toBeNull();
  });

  it("a resource-scoped CR covers the collection, including a create/delete", () => {
    expect(matchDriftScope(resourceScope, { resourceKey: RESOURCE, objectIdentity: null, propertyPathNormalized: null }))
      .toBe("resource");
    expect(matchDriftScope(resourceScope, { resourceKey: RESOURCE, objectIdentity: POLICY_B, propertyPathNormalized: "state" }))
      .toBe("resource");
  });

  it("a different resource never matches", () => {
    expect(matchDriftScope(
      { resourceKey: "graph:v1.0:/policies/authenticationMethodsPolicy", objectIdentity: null, propertyPathNormalized: null },
      { resourceKey: RESOURCE, objectIdentity: POLICY_A, propertyPathNormalized: "state" },
    )).toBeNull();
  });

  it("a property-scoped CR covers only that property", () => {
    const propScope = { resourceKey: RESOURCE, objectIdentity: POLICY_A, propertyPathNormalized: "state" };
    expect(matchDriftScope(propScope, { resourceKey: RESOURCE, objectIdentity: POLICY_A, propertyPathNormalized: "state" }))
      .toBe("property");
    expect(matchDriftScope(propScope, { resourceKey: RESOURCE, objectIdentity: POLICY_A, propertyPathNormalized: "conditions.users.includeUsers[]" }))
      .toBeNull();
  });
});

// ── Pure: the resolver is per setting, not per scan ──────────────────────────

function scope(over: Partial<EligibleDriftScope>): EligibleDriftScope {
  return {
    scopeId: 1,
    changeRequestId: 42,
    riskDecisionId: null,
    sourceKind: "change_request",
    crRef: formatChangeRequestCode(42),
    rbdRef: null,
    resourceKey: RESOURCE,
    objectIdentity: POLICY_A,
    propertyPathNormalized: null,
    basis: "execution_record",
    effectiveFrom: new Date("2026-07-01T06:00:00Z"),
    effectiveTo: new Date("2026-07-01T06:00:00Z"),
    sourceUpdatedAt: new Date("2026-07-01T06:00:00Z"),
    changedBy: "approver@example.com",
    ...over,
  };
}

describe("drift-change-attribution — the resolver answers per setting (#2819)", () => {
  it("attributes the policy the CR touched and NOTHING else — the whole point of #2819", () => {
    const resolve = makeDriftAttributionResolver({
      resourceKey: RESOURCE,
      identity: CA_IDENTITY,
      eligible: [scope({})],
    });

    expect(resolve(`/policies/${POLICY_A}/state`)).toEqual({
      changedBy: "approver@example.com",
      crRef: "CR-2026-142",
      changeRequestId: 42,
    });
    // Under the old category blanket this was the SAME attribution, which is how a
    // genuinely unapproved change hid behind an unrelated approved one.
    expect(resolve(`/policies/${POLICY_B}/state`)).toBeUndefined();
  });

  it("a policy DELETION is attributed per policy, not by resource (#3089)", () => {
    // The regression #3089 fixes: while the config was a positional array, deleting
    // a policy produced one `/policies` event naming no object, so ANY resource-level
    // scope explained it — an unapproved deletion absorbed by an unrelated approved
    // edit. Keyed, the remove names its own policy and an object-scoped CR for a
    // different policy cannot cover it.
    const resolve = makeDriftAttributionResolver({
      resourceKey: RESOURCE,
      identity: CA_IDENTITY,
      eligible: [scope({ objectIdentity: POLICY_A })],
    });
    expect(resolve(`/policies/${POLICY_A}`)?.changeRequestId).toBe(42);
    expect(resolve(`/policies/${POLICY_B}`)).toBeUndefined();
  });

  it("returns nothing when no scope covers the resource", () => {
    const resolve = makeDriftAttributionResolver({
      resourceKey: RESOURCE,
      identity: CA_IDENTITY,
      eligible: [],
    });
    expect(resolve(`/policies/${POLICY_A}/state`)).toBeUndefined();
  });

  it("prefers the more precise scope when two change requests both match", () => {
    const resolve = makeDriftAttributionResolver({
      resourceKey: RESOURCE,
      identity: CA_IDENTITY,
      eligible: [
        scope({ scopeId: 1, changeRequestId: 7, objectIdentity: null, basis: "template_endpoint" }),
        scope({ scopeId: 2, changeRequestId: 9, objectIdentity: POLICY_A, propertyPathNormalized: "state" }),
      ],
    });
    expect(resolve(`/policies/${POLICY_A}/state`)?.changeRequestId).toBe(9);
    // …and the resource-level one still covers the property it alone matches.
    expect(resolve(`/policies/${POLICY_A}/conditions/users/includeUsers/0`)?.changeRequestId).toBe(7);
  });
});

// ── The registry declares what per-setting attribution needs ─────────────────

describe("drift-check-specs — attribution requires an identity mapping (#2819)", () => {
  it("Conditional Access declares the scope strategy and where object identity lives", () => {
    const spec = DRIFT_CHECK_SPECS["identity:ca-policy-count"]!;
    expect(spec.attribution).toBe("change-request-scope");
    expect(spec.identity).toEqual({ collection: "policies" });
  });

  it("no spec declares attribution without the identity mapping it depends on", () => {
    for (const [key, spec] of Object.entries(DRIFT_CHECK_SPECS)) {
      if (spec.attribution) expect(spec.identity, `${key} declares attribution but no identity`).toBeTruthy();
    }
  });
});

// ── Live Postgres: the real end-to-end regression ────────────────────────────

const suffix = `vitest-2819-${Math.floor(Math.random() * 1e9)}`;

describe.skipIf(!process.env.DATABASE_URL)("drift attribution — live Postgres (#2819)", () => {
  let mspId: number;
  let tenantRowId: number;
  let crId: number;

  const executedAt = new Date();

  beforeAll(async () => {
    clearResourceRegistryCache();

    const [msp] = await db.insert(mspsTable)
      .values({ name: `Drift Attribution MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db.insert(tenantsTable)
      .values({ mspId, customerName: `Drift Attribution Customer ${suffix}`, tenantId: suffix })
      .returning({ id: tenantsTable.id });
    tenantRowId = tenant!.id;

    // A completed Conditional Access change request — exactly the row the OLD code
    // used to blanket-approve every CA drift in the tenant with.
    const [cr] = await db.insert(mspChangeRequestsTable).values({
      mspId,
      tenantId: suffix,
      tenantName: `Drift Attribution Customer ${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      title: "Enable the legacy-auth block policy",
      description: "Set state=enabled on policy A.",
      category: "ConditionalAccess",
      targetResource: "Conditional Access",
      psaTicketId: `${suffix}-1`,
      requestedBy: "operator@example.com",
      approvedBy: "approver@example.com",
      requestedAt: executedAt.toISOString(),
      scheduledFor: executedAt.toISOString(),
      backupHash: "n/a",
      rollbackScriptSnippet: "n/a",
      status: "completed",
    }).returning({ id: mspChangeRequestsTable.id });
    crId = cr!.id;

    // What it ACTUALLY wrote: policy A, and only policy A.
    await pool.query(
      `INSERT INTO cr_executions (change_request_id, msp_id, tenant_id, executor_kind, outcome, executed_at, actual_outcome)
       VALUES ($1, $2, $3, 'config_pack', 'succeeded', $4, $5::jsonb)`,
      [crId, mspId, suffix, executedAt,
        JSON.stringify({ steps: [{ endpoint: `/identity/conditionalAccess/policies/${POLICY_A}`, method: "PATCH" }] })],
    );
  });

  afterAll(async () => {
    await db.delete(driftEventsTable).where(eq(driftEventsTable.tenantId, suffix));
    await db.delete(driftCollectionStatusTable).where(eq(driftCollectionStatusTable.tenantId, suffix));
    await db.delete(driftBaselineSnapshotsTable).where(eq(driftBaselineSnapshotsTable.tenantId, suffix));
    await db.delete(configChangeScopesTable).where(eq(configChangeScopesTable.tenantId, tenantRowId));
    await pool.query("DELETE FROM cr_executions WHERE tenant_id = $1", [suffix]);
    await db.delete(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.tenantId, suffix));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("the CR's execution record resolves to a scope over policy A only", async () => {
    const attribute = await buildDriftScopeAttribution({
      tenantId: suffix,
      endpoint: CA_ENDPOINT,
      identity: CA_IDENTITY,
      baselineCapturedAt: new Date(executedAt.getTime() - 60 * 60 * 1000),
      observedAt: new Date(executedAt.getTime() + 60 * 60 * 1000),
    });
    expect(attribute).toBeTypeOf("function");
    expect(attribute!(`/policies/${POLICY_A}/state`)).toMatchObject({
      crRef: formatChangeRequestCode(crId),
      changeRequestId: crId,
      changedBy: "approver@example.com",
    });
    expect(attribute!(`/policies/${POLICY_B}/state`)).toBeUndefined();

    const scopes = await db.select().from(configChangeScopesTable)
      .where(and(
        eq(configChangeScopesTable.tenantId, tenantRowId),
        eq(configChangeScopesTable.changeRequestId, crId),
      ));
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((s) => s.resourceKey === RESOURCE)).toBe(true);
    expect(scopes.some((s) => s.objectIdentity === POLICY_A)).toBe(true);
    expect(scopes.some((s) => s.objectIdentity === POLICY_B)).toBe(false);
  });

  it("drift on the untouched policy stays unattributed while the CR's own policy is approved", async () => {
    // #3089 — both sides are the id-keyed shape the builder emits today.
    const baseline = {
      policies: {
        [POLICY_A]: { id: POLICY_A, displayName: "Block legacy auth", state: "disabled" },
        [POLICY_B]: { id: POLICY_B, displayName: "Require MFA for admins", state: "enabled" },
      },
    };
    const current = {
      policies: {
        [POLICY_A]: { id: POLICY_A, displayName: "Block legacy auth", state: "enabled" },
        // The unapproved one: nobody raised a change request against policy B.
        [POLICY_B]: { id: POLICY_B, displayName: "Require MFA for admins", state: "disabled" },
      },
    };

    await captureBaseline(suffix, "ca-policy", baseline, { capturedBy: "vitest", configVersion: 2 });

    const result = await collectDrift(suffix, "ca-policy", current, {
      configVersion: 2,
      attributionFactory: (ctx) => buildDriftScopeAttribution({
        tenantId: suffix,
        endpoint: CA_ENDPOINT,
        identity: CA_IDENTITY,
        baselineCapturedAt: ctx.baselineCapturedAt,
      }),
    });
    expect(result.firstRun).toBe(false);
    expect(result.inserted.length).toBe(2);

    const rows = await db.select().from(driftEventsTable)
      .where(eq(driftEventsTable.tenantId, suffix));
    const bySetting = new Map(rows.map((r) => [r.setting, r]));

    const a = bySetting.get(`/policies/${POLICY_A}/state`);
    expect(a, "policy A's state change should have produced an event").toBeTruthy();
    expect(a!.verdict).toBe("approved");
    expect(a!.crRef).toBe(formatChangeRequestCode(crId));
    expect(a!.changeRequestId).toBe(crId);

    const b = bySetting.get(`/policies/${POLICY_B}/state`);
    expect(b, "policy B's state change should have produced an event").toBeTruthy();
    // THE REGRESSION. Before #2819 this read `approved` with policy A's CR on it,
    // and `drift.unapproved` never fired for it.
    expect(b!.verdict).toBe("unattributed");
    expect(b!.crRef).toBeNull();
    expect(b!.changeRequestId).toBeNull();
  });

  it("a policy DELETION is a per-policy remove that an unrelated CR cannot absorb (#3089)", async () => {
    // Live end-to-end of the issue: policy B is deleted between scans, with the only
    // change request in the window being the one that touched policy A. Under the old
    // positional array this was ONE `/policies` replace naming no object, which the
    // CR's resource-level scope matched — a deletion nobody approved reading as
    // `approved`, and therefore never reaching the `drift.unapproved` alert.
    await db.delete(driftEventsTable).where(eq(driftEventsTable.tenantId, suffix));
    await db.delete(driftBaselineSnapshotsTable).where(eq(driftBaselineSnapshotsTable.tenantId, suffix));

    const baseline = {
      policies: {
        [POLICY_A]: { id: POLICY_A, displayName: "Block legacy auth", state: "enabled" },
        [POLICY_B]: { id: POLICY_B, displayName: "Require MFA for admins", state: "enabled" },
      },
    };
    const current = {
      policies: {
        [POLICY_A]: { id: POLICY_A, displayName: "Block legacy auth", state: "enabled" },
      },
    };

    await captureBaseline(suffix, "ca-policy", baseline, { capturedBy: "vitest", configVersion: 2 });
    const result = await collectDrift(suffix, "ca-policy", current, {
      configVersion: 2,
      attributionFactory: (ctx) => buildDriftScopeAttribution({
        tenantId: suffix,
        endpoint: CA_ENDPOINT,
        identity: CA_IDENTITY,
        baselineCapturedAt: ctx.baselineCapturedAt,
      }),
    });

    expect(result.inserted.length).toBe(1);
    const [event] = result.inserted;
    expect(event.op).toBe("remove");
    expect(event.setting).toBe(`/policies/${POLICY_B}`);
    expect(event.verdict).toBe("unattributed");
    expect(event.crRef).toBeNull();
  });
});

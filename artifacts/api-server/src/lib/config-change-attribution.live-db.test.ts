/**
 * Live-Postgres test for the configuration-change attribution layer (Git #2759).
 *
 * Live rather than mocked, deliberately. Everything this layer does is a join across
 * five real tables — `config_diff_changes`, `msp_change_requests`, `cr_executions`,
 * `msp_risk_decisions` and the resource registry — plus a set of CHECK constraints that
 * are the whole point of the design (a verdict that names no edge cannot be written).
 * A mocked `db` would assert that the code calls the functions it calls, and would have
 * caught none of the four real defects the first live runs exposed: an inverted snapshot
 * window on `baseline_assessment` diffs, a lifecycle keyed on the NORMALISED property
 * path collapsing 126 array members onto one row, `baseline_assessment` diffs feeding a
 * lifecycle that only means anything over time, and an `ON DELETE SET NULL` edge that
 * the verdict CHECK turned into an un-deletable change request.
 *
 * Skips cleanly with no `DATABASE_URL`, matching `drift-collector.test.ts` and
 * `msp-sla-operator-tasks.live-db.test.ts`. Every row it writes is synthetic, suffixed,
 * and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run config-change-attribution.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  pool,
  mspsTable,
  tenantsTable,
  configDiffsTable,
  configDiffChangesTable,
  configChangeScopesTable,
  configChangeAttributionsTable,
  configChangeLifecycleTable,
  tenantConfigSnapshotsTable,
  mspChangeRequestsTable,
  mspRiskDecisionsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  attributeDiff,
  resolveEndpointToResource,
  readDiffVerdictRollup,
  matchScopeFor,
  stableEqual,
  clearResourceRegistryCache,
} from "./config-change-attribution.ts";

/** The resource every fixture below targets — a real, registered Graph collection. */
const RESOURCE = "graph:v1.0:/identity/conditionalAccess/policies";
const OBJECT = "00000000-1111-2222-3333-444444444444";
const OTHER_OBJECT = "99999999-8888-7777-6666-555555555555";

const suffix = `vitest-2759-${Math.floor(Math.random() * 1e9)}`;

describe.skipIf(!process.env.DATABASE_URL)("config change attribution — live Postgres (#2759)", () => {
  let mspId: number;
  let tenantRowId: number;
  let baseSnapId: number;
  let headSnapId: number;
  let laterSnapId: number;
  let crId: number;
  let rdId: number;

  const t0 = new Date("2026-07-01T00:00:00Z");    // base snapshot
  const tExec = new Date("2026-07-01T06:00:00Z"); // the CR executes, inside the window
  const t1 = new Date("2026-07-01T12:00:00Z");    // head snapshot
  const t2 = new Date("2026-07-02T12:00:00Z");    // a later snapshot, for the lifecycle

  beforeAll(async () => {
    clearResourceRegistryCache();

    const [msp] = await db.insert(mspsTable)
      .values({ name: `Attribution Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db.insert(tenantsTable)
      .values({ mspId, customerName: `Attribution Test Customer ${suffix}`, tenantId: suffix })
      .returning({ id: tenantsTable.id });
    tenantRowId = tenant!.id;

    const snap = async (capturedAt: Date): Promise<number> => {
      const [s] = await db.insert(tenantConfigSnapshotsTable).values({
        tenantId: tenantRowId,
        entraTenantId: suffix,
        capturedAt,
        trigger: "manual",
        status: "sealed",
        sealedAt: capturedAt,
      }).returning({ id: tenantConfigSnapshotsTable.id });
      return s!.id;
    };
    baseSnapId = await snap(t0);
    headSnapId = await snap(t1);
    laterSnapId = await snap(t2);

    // ── A real change request that ACTUALLY executed inside the window ─────────
    const [cr] = await db.insert(mspChangeRequestsTable).values({
      mspId,
      tenantId: suffix,
      tenantName: `Attribution Test Customer ${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      title: "Tighten the legacy-auth Conditional Access policy",
      description: "Set state=enabled on the legacy authentication block policy.",
      category: "ConditionalAccess",
      targetResource: "Conditional Access",
      psaTicketId: `${suffix}-1`,
      requestedBy: "operator@example.com",
      requestedAt: t0.toISOString(),
      scheduledFor: t1.toISOString(),
      backupHash: "n/a",
      rollbackScriptSnippet: "n/a",
      status: "completed",
    }).returning({ id: mspChangeRequestsTable.id });
    crId = cr!.id;

    // Its real execution record — the strongest attribution basis there is.
    await pool.query(
      `INSERT INTO cr_executions (change_request_id, msp_id, tenant_id, executor_kind, outcome, executed_at, actual_outcome)
       VALUES ($1, $2, $3, 'config_pack', 'succeeded', $4, $5::jsonb)`,
      [crId, mspId, suffix, tExec,
        JSON.stringify({ steps: [{ endpoint: `/identity/conditionalAccess/policies/${OBJECT}`, method: "PATCH" }] })],
    );

    // ── A real, ACTIVE accepted risk over a DIFFERENT object of the same resource ──
    const [rd] = await db.insert(mspRiskDecisionsTable).values({
      mspId,
      rbdId: `RBD-${suffix}`,
      tenantId: suffix,
      tenantName: `Attribution Test Customer ${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      title: "Break-glass account exempt from Conditional Access",
      controlViolated: "CA coverage",
      framework: "CIS",
      rawRiskLevel: "high",
      residualRiskLevel: "medium",
      rawRiskScore: 16,
      residualRiskScore: 8,
      liabilityValueUsd: 1000,
      hazardDescription: "One emergency-access account is excluded from all CA policies.",
      graphEndpoint: `GET /v1.0/identity/conditionalAccess/policies/${OTHER_OBJECT}`,
      mspAssessor: { name: "Assessor" },
      clientApprover: { name: "Approver" },
      expirationDate: "2027-01-01",
      status: "active",
      acceptedAt: t0,
    }).returning({ id: mspRiskDecisionsTable.id });
    rdId = rd!.id;
  });

  afterAll(async () => {
    // Children first; the diff cascade takes its change/attribution rows with it.
    await db.delete(configChangeLifecycleTable).where(eq(configChangeLifecycleTable.tenantId, tenantRowId));
    await db.delete(configChangeScopesTable).where(eq(configChangeScopesTable.tenantId, tenantRowId));
    await pool.query("DELETE FROM cr_executions WHERE tenant_id = $1", [suffix]);
    await db.delete(mspRiskDecisionsTable).where(eq(mspRiskDecisionsTable.tenantId, suffix));
    await db.delete(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.tenantId, suffix));
    await db.delete(configDiffsTable).where(eq(configDiffsTable.headTenantId, tenantRowId));
    await db.delete(tenantConfigSnapshotsTable).where(eq(tenantConfigSnapshotsTable.tenantId, tenantRowId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  /**
   * A sealed diff with the given change rows, written directly (no differ run needed).
   *
   * `ruleset_fingerprint` is part of `config_diffs_pair_uidx`, so it carries a per-call
   * counter — several tests here legitimately build more than one diff over the SAME
   * snapshot pair and mode, which is exactly what that unique key forbids when the
   * fingerprint repeats.
   */
  let diffSeq = 0;
  async function makeDiff(opts: {
    baseId: number; headId: number; mode: "drift" | "baseline_assessment";
    changes: { object: string; path: string; oldValue: unknown; newValue: unknown }[];
  }): Promise<number> {
    const [d] = await db.insert(configDiffsTable).values({
      mode: opts.mode,
      baseSnapshotRowId: opts.baseId,
      headSnapshotRowId: opts.headId,
      baseTenantId: tenantRowId,
      headTenantId: tenantRowId,
      rulesetFingerprint: `${suffix}-${opts.mode}-${opts.baseId}-${opts.headId}-${++diffSeq}`,
      differVersion: "test",
      status: "sealed",
      sealedAt: new Date(),
      changesTotal: opts.changes.length,
      changesSignificant: opts.changes.length,
      changesIgnored: 0,
    }).returning({ id: configDiffsTable.id });

    let seq = 0;
    for (const c of opts.changes) {
      await db.insert(configDiffChangesTable).values({
        diffRowId: d!.id,
        sequence: seq++,
        resourceKey: RESOURCE,
        objectIdentity: c.object,
        changeKind: "property_changed",
        propertyPath: c.path,
        propertyPathNormalized: c.path.replace(/\[[^\]]*\]/g, "[]"),
        oldValue: c.oldValue,
        newValue: c.newValue,
        oldValuePresent: true,
        newValuePresent: true,
        isIgnored: false,
      });
    }
    return d!.id;
  }

  it("resolves a real Graph endpoint to a registered resource key, and refuses to guess", async () => {
    const hit = await resolveEndpointToResource(`GET /v1.0/identity/conditionalAccess/policies/${OBJECT}`);
    expect(hit).not.toBeNull();
    expect(hit!.resourceKey).toBe(RESOURCE);
    expect(hit!.objectIdentity).toBe(OBJECT);

    // A template variable is not an object identity — the scope widens to the resource.
    const tmpl = await resolveEndpointToResource("/identity/conditionalAccess/policies/{{policyId}}");
    expect(tmpl!.objectIdentity).toBeNull();

    // Nothing registered → nothing resolved → no scope → the change stays unattributed.
    expect(await resolveEndpointToResource("/nonsense/not-a-registered-resource")).toBeNull();

    // AMBIGUOUS also resolves to nothing: `Get-Mailbox` is a read cmdlet for a long list
    // of `m365dsc:EXO*` types, and picking the first would attribute drift to a resource
    // the change request never touched.
    expect(await resolveEndpointToResource("exchange-online://Set-Mailbox")).toBeNull();
  });

  it("attributes a change to the change request that really executed inside the window", async () => {
    const diffId = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [{ object: OBJECT, path: "state", oldValue: "disabled", newValue: "enabled" }],
    });

    const res = await attributeDiff(diffId);
    expect(res.verdicts.attributed_change).toBe(1);
    expect(res.verdicts.unattributed).toBe(0);

    const [row] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(row!.verdict).toBe("attributed_change");
    expect(row!.changeRequestId).toBe(crId);
    expect(row!.riskDecisionId).toBeNull();
    // The execution record named the object, so the match is object-precise, not a
    // category-wide blanket like the path this replaces.
    expect(row!.matchScope).toBe("object");

    const rollup = await readDiffVerdictRollup(diffId);
    expect(rollup.attributed).toBe(true);
    expect(rollup.changeRequests.map((c) => c.id)).toEqual([crId]);
  });

  it("marks a change over a different object of the same resource as accepted risk", async () => {
    const diffId = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [{ object: OTHER_OBJECT, path: "state", oldValue: "enabled", newValue: "disabled" }],
    });

    await attributeDiff(diffId);
    const [row] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(row!.verdict).toBe("accepted_risk");
    expect(row!.riskDecisionId).toBe(rdId);
    expect(row!.rbdRef).toBe(`RBD-${suffix}`);
  });

  it("leaves a change nothing covers honestly unattributed", async () => {
    const diffId = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [{ object: "an-object-nobody-claimed", path: "state", oldValue: "a", newValue: "b" }],
    });

    await attributeDiff(diffId);
    const [row] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(row!.verdict).toBe("unattributed");
    expect(row!.changeRequestId).toBeNull();
    expect(row!.riskDecisionId).toBeNull();
    expect(row!.matchScope).toBeNull();
    expect(row!.matchCount).toBe(0);
  });

  it("reports `contested` — with BOTH edges kept — when a CR and an active accepted risk cover the same row", async () => {
    // Widen the risk decision to the whole resource so it overlaps the CR's object.
    await db.update(mspRiskDecisionsTable)
      .set({ graphEndpoint: "GET /v1.0/identity/conditionalAccess/policies" })
      .where(eq(mspRiskDecisionsTable.id, rdId));
    await db.delete(configChangeScopesTable).where(eq(configChangeScopesTable.riskDecisionId, rdId));

    const diffId = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [{ object: OBJECT, path: "displayName", oldValue: "old", newValue: "new" }],
    });

    const res = await attributeDiff(diffId);
    expect(res.verdicts.contested).toBe(1);

    const [row] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(row!.verdict).toBe("contested");
    // Neither edge is dropped. The resolution is a human call, not a tie-break.
    expect(row!.changeRequestId).toBe(crId);
    expect(row!.riskDecisionId).toBe(rdId);
    expect(row!.matchCount).toBeGreaterThanOrEqual(2);

    // Restore the narrower endpoint for any later assertion.
    await db.update(mspRiskDecisionsTable)
      .set({ graphEndpoint: `GET /v1.0/identity/conditionalAccess/policies/${OTHER_OBJECT}` })
      .where(eq(mspRiskDecisionsTable.id, rdId));
    await db.delete(configChangeScopesTable).where(eq(configChangeScopesTable.riskDecisionId, rdId));
  });

  it("does not attribute a change request whose execution falls outside the snapshot window", async () => {
    // A second CR that executed a week after the head snapshot: same tenant, same
    // resource, same object — and it still explains nothing, because it could not have.
    const [late] = await db.insert(mspChangeRequestsTable).values({
      mspId, tenantId: suffix,
      tenantName: `Attribution Test Customer ${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      title: "A later, unrelated change",
      description: "Executed well after the head snapshot was captured.",
      category: "ConditionalAccess",
      targetResource: "Conditional Access",
      psaTicketId: `${suffix}-2`,
      requestedBy: "operator@example.com",
      requestedAt: t2.toISOString(),
      scheduledFor: t2.toISOString(),
      backupHash: "n/a",
      rollbackScriptSnippet: "n/a",
      status: "completed",
    }).returning({ id: mspChangeRequestsTable.id });

    await pool.query(
      `INSERT INTO cr_executions (change_request_id, msp_id, tenant_id, executor_kind, outcome, executed_at, actual_outcome)
       VALUES ($1, $2, $3, 'config_pack', 'succeeded', $4, $5::jsonb)`,
      [late!.id, mspId, suffix, new Date("2026-07-09T00:00:00Z"),
        JSON.stringify({ steps: [{ endpoint: "/identity/conditionalAccess/policies/late-object" }] })],
    );

    const diffId = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [{ object: "late-object", path: "state", oldValue: "x", newValue: "y" }],
    });

    await attributeDiff(diffId);
    const [row] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(row!.verdict).toBe("unattributed");
  });

  it("opens a lifecycle row per RAW property path, resolves it only on an observed return to baseline, and reopens", async () => {
    const obj = "lifecycle-object";
    const lifecycleRow = async () => {
      const [r] = await db.select().from(configChangeLifecycleTable).where(and(
        eq(configChangeLifecycleTable.tenantId, tenantRowId),
        eq(configChangeLifecycleTable.objectIdentity, obj),
        eq(configChangeLifecycleTable.propertyPath, "controlScores[0].status"),
      ));
      return r;
    };

    // Two array members share ONE normalised path and must NOT share a lifecycle row.
    const d1 = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [
        { object: obj, path: "controlScores[0].status", oldValue: "on", newValue: "off" },
        { object: obj, path: "controlScores[1].status", oldValue: "on", newValue: "off" },
      ],
    });
    const r1 = await attributeDiff(d1);
    expect(r1.lifecycleOpened).toBe(2);
    expect(r1.lifecycleResolved).toBe(0);
    expect((await lifecycleRow())!.status).toBe("open");

    // Observed back at the value it started from → resolved.
    const d2 = await makeDiff({
      baseId: headSnapId, headId: laterSnapId, mode: "drift",
      changes: [{ object: obj, path: "controlScores[0].status", oldValue: "off", newValue: "on" }],
    });
    const r2 = await attributeDiff(d2);
    expect(r2.lifecycleResolved).toBe(1);
    const resolved = await lifecycleRow();
    expect(resolved!.status).toBe("resolved");
    expect(resolved!.resolvedAt).not.toBeNull();

    // Re-running the SAME diff must not manufacture a second transition.
    const r2again = await attributeDiff(d2);
    expect(r2again.lifecycleResolved).toBe(0);
    expect(r2again.lifecycleReopened).toBe(0);
    expect((await lifecycleRow())!.reopenCount).toBe(0);

    // Off baseline again after a resolution → reopened, with the count advanced.
    const [extraSnap] = await db.insert(tenantConfigSnapshotsTable).values({
      tenantId: tenantRowId, entraTenantId: suffix,
      capturedAt: new Date("2026-07-03T12:00:00Z"), trigger: "manual",
      status: "sealed", sealedAt: new Date("2026-07-03T12:00:00Z"),
    }).returning({ id: tenantConfigSnapshotsTable.id });

    const d3 = await makeDiff({
      baseId: laterSnapId, headId: extraSnap!.id, mode: "drift",
      changes: [{ object: obj, path: "controlScores[0].status", oldValue: "on", newValue: "off" }],
    });
    const r3 = await attributeDiff(d3);
    expect(r3.lifecycleReopened).toBe(1);
    const reopened = await lifecycleRow();
    expect(reopened!.status).toBe("reopened");
    expect(reopened!.reopenCount).toBe(1);
    expect(reopened!.resolvedAt).toBeNull();
  });

  it("does not advance the lifecycle for a non-`drift` comparison, and survives an inverted window", async () => {
    // A baseline assessment whose reference snapshot is NEWER than the subject — the
    // real shape that produced an inverted window on the testbed (diff row 11).
    const diffId = await makeDiff({
      baseId: laterSnapId, headId: baseSnapId, mode: "baseline_assessment",
      changes: [{ object: "assessment-only-object", path: "state", oldValue: "a", newValue: "b" }],
    });

    const res = await attributeDiff(diffId);
    // The window is stated earliest-first regardless of which side is `base`.
    expect(new Date(res.window.from!).getTime()).toBeLessThan(new Date(res.window.to!).getTime());
    expect(res.lifecycleOpened).toBe(0);
    expect(res.changesAttributed).toBe(1);

    const [none] = await db.select().from(configChangeLifecycleTable).where(and(
      eq(configChangeLifecycleTable.tenantId, tenantRowId),
      eq(configChangeLifecycleTable.objectIdentity, "assessment-only-object"),
    ));
    expect(none).toBeUndefined();
  });

  it("survives its source being pruned — the row keeps the ref and the DELETE succeeds", async () => {
    // The `ON DELETE SET NULL` edge and the verdict CHECK have to agree, and the first
    // version of them did not: Postgres runs the cascade as an UPDATE that nulls
    // `change_request_id`, the CHECK rejected it, and the whole DELETE aborted — so a
    // change request that had ever attributed a diff row could never be deleted again.
    const [doomed] = await db.insert(mspChangeRequestsTable).values({
      mspId, tenantId: suffix,
      tenantName: `Attribution Test Customer ${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      title: "A change request that will later be pruned",
      description: "Exists to prove an attribution outlives its source.",
      category: "ConditionalAccess",
      targetResource: "Conditional Access",
      psaTicketId: `${suffix}-3`,
      requestedBy: "operator@example.com",
      requestedAt: t0.toISOString(),
      scheduledFor: t1.toISOString(),
      backupHash: "n/a",
      rollbackScriptSnippet: "n/a",
      status: "completed",
    }).returning({ id: mspChangeRequestsTable.id });

    await pool.query(
      `INSERT INTO cr_executions (change_request_id, msp_id, tenant_id, executor_kind, outcome, executed_at, actual_outcome)
       VALUES ($1, $2, $3, 'config_pack', 'succeeded', $4, $5::jsonb)`,
      [doomed!.id, mspId, suffix, tExec,
        JSON.stringify({ steps: [{ endpoint: "/identity/conditionalAccess/policies/doomed-object" }] })],
    );

    const diffId = await makeDiff({
      baseId: baseSnapId, headId: headSnapId, mode: "drift",
      changes: [{ object: "doomed-object", path: "state", oldValue: "a", newValue: "b" }],
    });
    await attributeDiff(diffId);

    const [before] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(before!.verdict).toBe("attributed_change");
    expect(before!.changeRequestId).toBe(doomed!.id);
    const keptRef = before!.crRef;
    expect(keptRef).not.toBeNull();

    await pool.query("DELETE FROM cr_executions WHERE change_request_id = $1", [doomed!.id]);
    await db.delete(configChangeScopesTable).where(eq(configChangeScopesTable.changeRequestId, doomed!.id));
    // This is the assertion: the prune must not be blocked by the attribution history.
    await db.delete(mspChangeRequestsTable).where(eq(mspChangeRequestsTable.id, doomed!.id));

    const [after] = await db.select().from(configChangeAttributionsTable)
      .where(eq(configChangeAttributionsTable.diffRowId, diffId));
    expect(after).toBeDefined();
    expect(after!.verdict).toBe("attributed_change");
    expect(after!.changeRequestId).toBeNull();
    // The durable display ref is what keeps the surviving row falsifiable.
    expect(after!.crRef).toBe(keptRef);
  });

  it("refuses to attribute a comparison that is not sealed", async () => {
    const [d] = await db.insert(configDiffsTable).values({
      mode: "drift",
      baseSnapshotRowId: baseSnapId, headSnapshotRowId: headSnapId,
      baseTenantId: tenantRowId, headTenantId: tenantRowId,
      rulesetFingerprint: `${suffix}-computing`,
      differVersion: "test",
      status: "computing",
    }).returning({ id: configDiffsTable.id });

    await expect(attributeDiff(d!.id)).rejects.toThrow(/not 'sealed'/);
  });
});

describe("pure matching rules (#2759)", () => {
  const change = { resourceKey: RESOURCE, objectIdentity: OBJECT, propertyPathNormalized: "state" };

  it("widens on a NULL, and never matches across a stated value", () => {
    expect(matchScopeFor({ resourceKey: RESOURCE, objectIdentity: null, propertyPathNormalized: null }, change))
      .toBe("resource");
    expect(matchScopeFor({ resourceKey: RESOURCE, objectIdentity: OBJECT, propertyPathNormalized: null }, change))
      .toBe("object");
    expect(matchScopeFor({ resourceKey: RESOURCE, objectIdentity: OBJECT, propertyPathNormalized: "state" }, change))
      .toBe("property");
    expect(matchScopeFor({ resourceKey: RESOURCE, objectIdentity: OTHER_OBJECT, propertyPathNormalized: null }, change))
      .toBeNull();
    expect(matchScopeFor({ resourceKey: "graph:v1.0:/users", objectIdentity: null, propertyPathNormalized: null }, change))
      .toBeNull();
  });

  it("compares values order-insensitively, so a re-serialised object is not a change", () => {
    expect(stableEqual({ a: 1, b: [1, { x: 1, y: 2 }] }, { b: [1, { y: 2, x: 1 }], a: 1 })).toBe(true);
    expect(stableEqual({ a: 1 }, { a: 2 })).toBe(false);
    // Arrays are ORDERED — a reordered list is a real difference, not a re-serialisation.
    expect(stableEqual([1, 2], [2, 1])).toBe(false);
    expect(stableEqual(null, undefined)).toBe(false);
  });
});

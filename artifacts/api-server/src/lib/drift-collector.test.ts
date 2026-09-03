import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  deriveVerdict,
  planDriftEvents,
  planDriftLifecycle,
  buildDriftIdempotencyKey,
  driftDomainKeyFromSourceKey,
  collectDrift,
  getCurrentBaseline,
  maybeCollectDriftForCheck,
  recordDriftCollectionStatus,
  type PlannedDriftEvent,
} from "./drift-collector.ts";
import { detectDrift } from "./pcc/drift-detector.ts";
import { db } from "@workspace/db";
import { driftEventsTable, driftBaselineSnapshotsTable, driftCollectionStatusTable } from "@workspace/db";
import { and, eq, gte, desc, sql } from "drizzle-orm";

describe("drift-collector — verdict derivation (#1270)", () => {
  it("a linked CR makes the change approved", () => {
    expect(deriveVerdict({ crRef: "CR-1042" })).toBe("approved");
    // CR wins even when an actor is also known.
    expect(deriveVerdict({ crRef: "CR-1042", changedBy: "admin@contoso" })).toBe("approved");
  });

  it("a known actor with no CR is attributed_unapproved", () => {
    expect(deriveVerdict({ changedBy: "admin@contoso" })).toBe("attributed_unapproved");
  });

  it("nothing known is unattributed (never an invented actor)", () => {
    expect(deriveVerdict(undefined)).toBe("unattributed");
    expect(deriveVerdict({})).toBe("unattributed");
    expect(deriveVerdict({ changedBy: null, crRef: null })).toBe("unattributed");
  });
});

describe("drift-collector — domain key mapping", () => {
  it("strips the drift: prefix to the bare slug", () => {
    expect(driftDomainKeyFromSourceKey("drift:ca-policy")).toBe("ca-policy");
    expect(driftDomainKeyFromSourceKey("drift:security-defaults")).toBe("security-defaults");
  });
  it("passes through a slug that is already bare", () => {
    expect(driftDomainKeyFromSourceKey("ca-policy")).toBe("ca-policy");
  });
});

describe("drift-collector — idempotency key", () => {
  it("is deterministic over (tenant, domain, baseline, op, setting)", () => {
    const a = buildDriftIdempotencyKey("t1", "ca-policy", 7, "replace", "/policies/0/state");
    const b = buildDriftIdempotencyKey("t1", "ca-policy", 7, "replace", "/policies/0/state");
    expect(a).toBe(b);
    expect(a).toBe("t1|ca-policy|7|replace|/policies/0/state");
  });
  it("differs when the baseline differs (a re-baseline produces a fresh key)", () => {
    const a = buildDriftIdempotencyKey("t1", "ca-policy", 7, "replace", "/policies/0/state");
    const b = buildDriftIdempotencyKey("t1", "ca-policy", 8, "replace", "/policies/0/state");
    expect(a).not.toBe(b);
  });
});

describe("drift-collector — planDriftEvents over real detectDrift output", () => {
  const baseline = {
    policies: [{ id: "p1", state: "enabled", grantControls: ["mfa"] }],
    securityDefaults: true,
  };

  it("a changed setting becomes a replace event with old→new values", () => {
    const current = {
      policies: [{ id: "p1", state: "disabled", grantControls: ["mfa"] }],
      securityDefaults: true,
    };
    const diffs = detectDrift(baseline, current);
    const events = planDriftEvents(diffs);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      setting: "/policies/0/state",
      op: "replace",
      oldValue: "enabled",
      newValue: "disabled",
      verdict: "unattributed",
      changedBy: null,
      crRef: null,
    });
  });

  it("a removed key normalizes newValue to null; an added key normalizes oldValue to null", () => {
    const current = {
      policies: [{ id: "p1", state: "enabled" /* grantControls removed */ }],
      securityDefaults: true,
      newTenantFlag: "x", // added
    };
    const diffs = detectDrift(baseline, current);
    const events = planDriftEvents(diffs);
    const removed = events.find((e) => e.op === "remove");
    const added = events.find((e) => e.op === "add");
    expect(removed).toBeTruthy();
    expect(removed!.newValue).toBeNull();
    expect(removed!.oldValue).toEqual(["mfa"]);
    expect(added).toBeTruthy();
    expect(added!.oldValue).toBeNull();
    expect(added!.newValue).toBe("x");
  });

  it("applies caller attribution by setting path (CR → approved, actor → attributed_unapproved)", () => {
    const current = {
      policies: [{ id: "p1", state: "disabled", grantControls: ["mfa", "compliantDevice"] }],
      securityDefaults: false,
    };
    const diffs = detectDrift(baseline, current);
    const attribution: Record<string, { changedBy?: string; crRef?: string }> = {
      "/policies/0/state": { changedBy: "admin@contoso", crRef: "CR-9" },
      "/securityDefaults": { changedBy: "admin@contoso" },
    };
    const events = planDriftEvents(diffs, (s) => attribution[s]);
    const stateEv = events.find((e) => e.setting === "/policies/0/state")!;
    const sdEv = events.find((e) => e.setting === "/securityDefaults")!;
    expect(stateEv.verdict).toBe("approved");
    expect(stateEv.crRef).toBe("CR-9");
    expect(sdEv.verdict).toBe("attributed_unapproved");
    expect(sdEv.changedBy).toBe("admin@contoso");
  });

  it("no drift → no events (identical config)", () => {
    const diffs = detectDrift(baseline, structuredClone(baseline));
    expect(planDriftEvents(diffs)).toHaveLength(0);
  });
});

describe("drift-collector — planDriftLifecycle (resolve/reopen, #1290)", () => {
  const mkEvent = (setting: string, op: PlannedDriftEvent["op"] = "replace"): PlannedDriftEvent => ({
    setting,
    op,
    oldValue: "enabled",
    newValue: "disabled",
    changedBy: null,
    verdict: "unattributed",
    crRef: null,
    changeRequestId: null,
  });
  const keyFor = (p: PlannedDriftEvent) => `${p.op}|${p.setting}`;

  it("a setting drifting for the first time is an insert (no existing row)", () => {
    const plan = planDriftLifecycle([mkEvent("/a")], keyFor, []);
    expect(plan.toInsert.map((p) => p.setting)).toEqual(["/a"]);
    expect(plan.toReopen).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);
    expect(plan.toResolveKeys).toHaveLength(0);
  });

  it("a still-drifting setting whose event is already open is unchanged (idempotent)", () => {
    const plan = planDriftLifecycle(
      [mkEvent("/a")],
      keyFor,
      [{ idempotencyKey: "replace|/a", status: "open" }],
    );
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.unchanged.map((p) => p.setting)).toEqual(["/a"]);
    expect(plan.toReopen).toHaveLength(0);
    expect(plan.toResolveKeys).toHaveLength(0);
  });

  it("an open event whose setting is no longer drifting is resolved", () => {
    // Nothing currently drifting, but an open event exists → it returned to baseline.
    const plan = planDriftLifecycle([], keyFor, [{ idempotencyKey: "replace|/a", status: "open" }]);
    expect(plan.toResolveKeys).toEqual(["replace|/a"]);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toReopen).toHaveLength(0);
  });

  it("a previously-resolved setting that drifts again is reopened, not re-inserted", () => {
    const plan = planDriftLifecycle(
      [mkEvent("/a")],
      keyFor,
      [{ idempotencyKey: "replace|/a", status: "resolved" }],
    );
    expect(plan.toReopen.map((p) => p.setting)).toEqual(["/a"]);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(0);
    expect(plan.toResolveKeys).toHaveLength(0);
  });

  it("a reopened event no longer drifting resolves again", () => {
    const plan = planDriftLifecycle([], keyFor, [{ idempotencyKey: "replace|/a", status: "reopened" }]);
    expect(plan.toResolveKeys).toEqual(["replace|/a"]);
  });

  it("a resolved event that stays at baseline is left alone (not resolved twice, not reopened)", () => {
    const plan = planDriftLifecycle([], keyFor, [{ idempotencyKey: "replace|/a", status: "resolved" }]);
    expect(plan.toResolveKeys).toHaveLength(0);
    expect(plan.toReopen).toHaveLength(0);
    expect(plan.toInsert).toHaveLength(0);
  });

  it("mixed set: insert + reopen + unchanged + resolve in one pass", () => {
    const plan = planDriftLifecycle(
      [mkEvent("/new"), mkEvent("/reappeared"), mkEvent("/stillOpen")],
      keyFor,
      [
        { idempotencyKey: "replace|/reappeared", status: "resolved" },
        { idempotencyKey: "replace|/stillOpen", status: "open" },
        { idempotencyKey: "replace|/reverted", status: "open" }, // no longer drifting
      ],
    );
    expect(plan.toInsert.map((p) => p.setting)).toEqual(["/new"]);
    expect(plan.toReopen.map((p) => p.setting)).toEqual(["/reappeared"]);
    expect(plan.unchanged.map((p) => p.setting)).toEqual(["/stillOpen"]);
    expect(plan.toResolveKeys).toEqual(["replace|/reverted"]);
  });
});

// ── DB integration (#1270) — store + collector end-to-end against real Postgres.
// Skips cleanly when no DATABASE_URL (the module already requires @workspace/db,
// so this whole file only imports under a DB-provisioned run). Uses a synthetic
// tenant id and cleans itself up, so it pollutes no real tenant's drift metric.
const TENANT = `vitest-1270-${Math.floor(Math.random() * 1e9)}`;
const DOMAIN = "ca-policy";

describe.skipIf(!process.env.DATABASE_URL)("drift-collector — store + collector (live Postgres)", () => {
  beforeAll(async () => {
    // Apply the migration DDL (idempotent) so the run works on a fresh DB too.
    const ddl = readFileSync(
      new URL("../../../../lib/db/migrations/manual/2026-08-25-configuration-drift-engine-1270.sql", import.meta.url),
      "utf8",
    );
    await db.execute(sql.raw(ddl));
    // #1290 lifecycle columns (applied inline, not via the whole migration file,
    // to avoid its customer_tenant_alert_rules catalog UPDATE dependency here).
    await db.execute(
      sql.raw(`
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
      `),
    );
  });

  afterAll(async () => {
    await db.delete(driftEventsTable).where(eq(driftEventsTable.tenantId, TENANT));
    await db.delete(driftBaselineSnapshotsTable).where(eq(driftBaselineSnapshotsTable.tenantId, TENANT));
  });

  const baselineConfig = {
    policies: [{ id: "p1", displayName: "Require MFA", state: "enabled", grantControls: ["mfa"] }],
    securityDefaults: true,
  };
  const changedConfig = {
    policies: [{ id: "p1", displayName: "Require MFA", state: "disabled", grantControls: ["mfa"] }],
    securityDefaults: true,
  };

  it("first scan captures a baseline and emits zero events", async () => {
    const r = await collectDrift(TENANT, DOMAIN, baselineConfig, { capturedBy: "vitest" });
    expect(r.firstRun).toBe(true);
    expect(r.inserted).toHaveLength(0);
    expect(await getCurrentBaseline(TENANT, DOMAIN)).toBeTruthy();
  });

  it("a changed scan persists one itemized, attributed drift event", async () => {
    const r = await collectDrift(TENANT, DOMAIN, changedConfig, {
      capturedBy: "vitest",
      attributionFor: (s) => (s === "/policies/0/state" ? { changedBy: "admin@contoso.com" } : undefined),
    });
    expect(r.firstRun).toBe(false);
    expect(r.inserted).toHaveLength(1);
    expect(r.inserted[0]).toMatchObject({
      setting: "/policies/0/state",
      op: "replace",
      oldValue: "enabled",
      newValue: "disabled",
      changedBy: "admin@contoso.com",
      verdict: "attributed_unapproved",
    });
  });

  it("re-running the identical scan is idempotent (no duplicate rows)", async () => {
    const r = await collectDrift(TENANT, DOMAIN, changedConfig, { capturedBy: "vitest" });
    expect(r.inserted).toHaveLength(0);
  });

  it("the resolver read path sees the baseline + the event in-window", async () => {
    const [bl] = await db
      .select({ id: driftBaselineSnapshotsTable.id })
      .from(driftBaselineSnapshotsTable)
      .where(and(eq(driftBaselineSnapshotsTable.tenantId, TENANT), eq(driftBaselineSnapshotsTable.domainKey, DOMAIN)))
      .limit(1);
    expect(bl).toBeTruthy();
    const since = new Date(Date.now() - 30 * 864e5);
    const rows = await db
      .select()
      .from(driftEventsTable)
      .where(
        and(
          eq(driftEventsTable.tenantId, TENANT),
          eq(driftEventsTable.domainKey, DOMAIN),
          gte(driftEventsTable.detectedAt, since),
        ),
      )
      .orderBy(desc(driftEventsTable.detectedAt));
    expect(rows).toHaveLength(1);
    expect(rows[0].setting).toBe("/policies/0/state");
    expect(rows[0].verdict).toBe("attributed_unapproved");
  });
});

// ── DB integration (#1290) — full resolve→reopen lifecycle against real Postgres.
const LC_TENANT = `vitest-1290-${Math.floor(Math.random() * 1e9)}`;

describe.skipIf(!process.env.DATABASE_URL)("drift-collector — resolve→reopen lifecycle (live Postgres)", () => {
  beforeAll(async () => {
    const ddl = readFileSync(
      new URL("../../../../lib/db/migrations/manual/2026-08-25-configuration-drift-engine-1270.sql", import.meta.url),
      "utf8",
    );
    await db.execute(sql.raw(ddl));
    await db.execute(
      sql.raw(`
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
        ALTER TABLE drift_events ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
      `),
    );
  });

  afterAll(async () => {
    await db.delete(driftEventsTable).where(eq(driftEventsTable.tenantId, LC_TENANT));
    await db.delete(driftBaselineSnapshotsTable).where(eq(driftBaselineSnapshotsTable.tenantId, LC_TENANT));
  });

  const baselineConfig = {
    policies: [{ id: "p1", displayName: "Require MFA", state: "enabled", grantControls: ["mfa"] }],
  };
  const driftedConfig = {
    policies: [{ id: "p1", displayName: "Require MFA", state: "disabled", grantControls: ["mfa"] }],
  };

  const oneEvent = async () => {
    const [row] = await db
      .select()
      .from(driftEventsTable)
      .where(and(eq(driftEventsTable.tenantId, LC_TENANT), eq(driftEventsTable.domainKey, DOMAIN)));
    return row;
  };

  it("baseline → drift → revert → re-drift walks open → resolved → reopened", async () => {
    // 1. First scan captures baseline, no events.
    const first = await collectDrift(LC_TENANT, DOMAIN, baselineConfig, { capturedBy: "vitest" });
    expect(first.firstRun).toBe(true);

    // 2. Drift: the CA policy is disabled → one open event.
    const drift = await collectDrift(LC_TENANT, DOMAIN, driftedConfig, { capturedBy: "vitest" });
    expect(drift.inserted).toHaveLength(1);
    expect(drift.reopened).toHaveLength(0);
    expect(drift.resolved).toBe(0);
    let row = await oneEvent();
    expect(row.status).toBe("open");
    expect(row.resolvedAt).toBeNull();
    expect(row.reopenCount).toBe(0);

    // 3. Revert: config returns to baseline → the event resolves (no new row).
    const revert = await collectDrift(LC_TENANT, DOMAIN, baselineConfig, { capturedBy: "vitest" });
    expect(revert.inserted).toHaveLength(0);
    expect(revert.resolved).toBe(1);
    row = await oneEvent();
    expect(row.status).toBe("resolved");
    expect(row.resolvedAt).not.toBeNull();

    // 4. Re-drift the SAME setting against the SAME baseline → REOPEN, not insert.
    const redrift = await collectDrift(LC_TENANT, DOMAIN, driftedConfig, { capturedBy: "vitest" });
    expect(redrift.inserted).toHaveLength(0);
    expect(redrift.reopened).toHaveLength(1);
    expect(redrift.resolved).toBe(0);
    row = await oneEvent();
    expect(row.status).toBe("reopened");
    expect(row.reopenedAt).not.toBeNull();
    expect(row.resolvedAt).toBeNull();
    expect(row.reopenCount).toBe(1);

    // Still exactly ONE row for this setting — the reopen reused it, no duplicate.
    const all = await db
      .select()
      .from(driftEventsTable)
      .where(and(eq(driftEventsTable.tenantId, LC_TENANT), eq(driftEventsTable.domainKey, DOMAIN)));
    expect(all).toHaveLength(1);

    // 5. Revert then re-drift once more → reopen_count increments to 2.
    await collectDrift(LC_TENANT, DOMAIN, baselineConfig, { capturedBy: "vitest" });
    const redrift2 = await collectDrift(LC_TENANT, DOMAIN, driftedConfig, { capturedBy: "vitest" });
    expect(redrift2.reopened).toHaveLength(1);
    row = await oneEvent();
    expect(row.status).toBe("reopened");
    expect(row.reopenCount).toBe(2);
  });
});

// ── DB integration (#1287) — the universal per-check hook + honest status.
const MC_TENANT = `vitest-1287-${Math.floor(Math.random() * 1e9)}`;
const EEEU_DOMAIN = "eeeu-site-sharing";

describe.skipIf(!process.env.DATABASE_URL)("drift-collector — maybeCollectDriftForCheck + honest status (#1287)", () => {
  beforeAll(async () => {
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS drift_collection_status (
          id serial PRIMARY KEY,
          tenant_id text NOT NULL,
          domain_key text NOT NULL,
          check_key text,
          status text NOT NULL,
          reason text,
          coverage jsonb,
          events_inserted integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS drift_collection_status_tenant_domain_uniq
          ON drift_collection_status (tenant_id, domain_key);
      `),
    );
  });

  afterAll(async () => {
    await db.delete(driftEventsTable).where(eq(driftEventsTable.tenantId, MC_TENANT));
    await db.delete(driftBaselineSnapshotsTable).where(eq(driftBaselineSnapshotsTable.tenantId, MC_TENANT));
    await db.delete(driftCollectionStatusTable).where(eq(driftCollectionStatusTable.tenantId, MC_TENANT));
  });

  const site = (id: string, level: string | null) => ({
    siteId: id,
    siteUrl: `https://contoso.sharepoint.com/sites/${id}`,
    broadAccess: level !== null,
    highestSharingLevel: level,
    hasEeeu: level === "eeeu",
    hasEveryone: false,
    hasAnonymousLink: false,
    hasOrganizationLink: false,
  });

  const statusRow = async (domain: string) => {
    const [row] = await db
      .select()
      .from(driftCollectionStatusTable)
      .where(and(eq(driftCollectionStatusTable.tenantId, MC_TENANT), eq(driftCollectionStatusTable.domainKey, domain)));
    return row;
  };

  it("a check with no drift spec is a clean no-op (not drift-tracked, no status row)", async () => {
    const r = await maybeCollectDriftForCheck({
      checkKey: "compliance:dlp-incidents",
      tenantId: MC_TENANT,
      scan: { items: [{ count: 3 }], extracted: {}, status: "ok" },
    });
    expect(r.driftTracked).toBe(false);
    expect(await statusRow("dlp-incidents")).toBeUndefined();
  });

  it("first eeeu-site-sharing run captures a baseline and records baseline_captured", async () => {
    const r = await maybeCollectDriftForCheck({
      checkKey: "compliance:eeeu-site-sharing",
      tenantId: MC_TENANT,
      scan: { items: [site("s1", null)], extracted: { _fanOut: { truncated: false } }, status: "ok" },
    });
    expect(r).toMatchObject({ driftTracked: true, domainKey: EEEU_DOMAIN, status: "baseline_captured" });
    const st = await statusRow(EEEU_DOMAIN);
    expect(st.status).toBe("baseline_captured");
    expect(st.reason).toBeNull();
    expect(st.checkKey).toBe("compliance:eeeu-site-sharing");
  });

  it("a newly overshared site is tracked as one real drift event", async () => {
    const r = await maybeCollectDriftForCheck({
      checkKey: "compliance:eeeu-site-sharing",
      tenantId: MC_TENANT,
      scan: { items: [site("s1", null), site("s2", "eeeu")], extracted: { _fanOut: { truncated: false } }, status: "ok" },
    });
    expect(r.status).toBe("tracked");
    const events = await db
      .select()
      .from(driftEventsTable)
      .where(and(eq(driftEventsTable.tenantId, MC_TENANT), eq(driftEventsTable.domainKey, EEEU_DOMAIN)));
    expect(events).toHaveLength(1);
    expect(events[0].setting).toBe("/sites/s2");
    expect(events[0].op).toBe("add");
    const st = await statusRow(EEEU_DOMAIN);
    expect(st.status).toBe("tracked");
    expect(st.eventsInserted).toBe(1);
  });

  it("a TRUNCATED fan-out is recorded not_comparable with a specific reason — no false drift", async () => {
    const before = await db
      .select()
      .from(driftEventsTable)
      .where(and(eq(driftEventsTable.tenantId, MC_TENANT), eq(driftEventsTable.domainKey, EEEU_DOMAIN)));

    const r = await maybeCollectDriftForCheck({
      checkKey: "compliance:eeeu-site-sharing",
      tenantId: MC_TENANT,
      // Only s1 came back (s2 lost to the cap) — diffing this would falsely
      // "remove" s2. The spec must refuse and the status must say why.
      scan: {
        items: [site("s1", null)],
        extracted: { _fanOut: { truncated: true, sourceItemsScanned: 1, sourceItemsEligible: 2 } },
        status: "partial",
      },
    });
    expect(r.status).toBe("not_comparable");
    expect(r.reason).toContain("truncated");

    const st = await statusRow(EEEU_DOMAIN);
    expect(st.status).toBe("not_comparable");
    expect(st.reason).toContain("truncated");
    expect(st.eventsInserted).toBe(0);

    // Crucially: NO new drift events were written (s2 was NOT falsely removed).
    const after = await db
      .select()
      .from(driftEventsTable)
      .where(and(eq(driftEventsTable.tenantId, MC_TENANT), eq(driftEventsTable.domainKey, EEEU_DOMAIN)));
    expect(after.length).toBe(before.length);
  });

  it("recordDriftCollectionStatus upserts (one current row per tenant+domain)", async () => {
    await recordDriftCollectionStatus(MC_TENANT, "some-domain", { status: "error", reason: "boom" });
    await recordDriftCollectionStatus(MC_TENANT, "some-domain", { status: "tracked", eventsInserted: 4 });
    const rows = await db
      .select()
      .from(driftCollectionStatusTable)
      .where(and(eq(driftCollectionStatusTable.tenantId, MC_TENANT), eq(driftCollectionStatusTable.domainKey, "some-domain")));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("tracked");
    expect(rows[0].reason).toBeNull();
    expect(rows[0].eventsInserted).toBe(4);
  });
});

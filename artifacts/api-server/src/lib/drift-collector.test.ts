import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  deriveVerdict,
  planDriftEvents,
  buildDriftIdempotencyKey,
  driftDomainKeyFromSourceKey,
  collectDrift,
  getCurrentBaseline,
} from "./drift-collector.ts";
import { detectDrift } from "./pcc/drift-detector.ts";
import { db } from "@workspace/db";
import { driftEventsTable, driftBaselineSnapshotsTable } from "@workspace/db";
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

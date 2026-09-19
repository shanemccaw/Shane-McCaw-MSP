/**
 * break-glass-existing-account-decision-4532.live-verify.ts — Git #4532
 *
 * LIVE round trip for the operator decision a quickstart-v1 re-run waits on when its
 * create step found an existing break-glass account. Real workflow executor, real
 * Postgres, real Express routers on an ephemeral port, real Graph against the
 * testbed tenant. Both paths, each from a real `fireWorkflowForDefinition` run whose
 * payload carries the step output #4514 produces (`skippedExisting` +
 * `unappliedVariables`):
 *
 *   npx vitest run --config vitest.live-verify.config.ts src/routes/break-glass-existing-account-decision-4532.live-verify.ts
 *
 * Load .env.local WITHOUT sourcing it (it holds a PEM key):
 *   node --env-file=<repo>/.env.local node_modules/vitest/vitest.mjs run \
 *     --config vitest.live-verify.config.ts src/routes/break-glass-existing-account-decision-4532.live-verify.ts
 *
 * Requires the generated-secret store UNCONFIGURED (GENERATED_SECRET_VAULT_URL unset
 * or empty): the only vault reachable locally is production Key Vault, outside agent
 * reach (Git #1913). This harness refuses to run if a store is configured, and
 * replaces the store with an in-process one for the whole file — Graph and Postgres
 * stay real. Nothing here can reach a real vault.
 *
 * The ONLY tenant write is ONE password reset on the sanctioned synthetic identity
 * `zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com` (Git #2840) — no roles, no
 * groups, no licences, its password held nowhere. It stands in for "the existing
 * break-glass account": pointing this at a real `breakglass-admin` would destroy a
 * real emergency credential. The "resume without delivering" path asserts ZERO
 * tenant writes. The outgoing invite email and the notification-center's e-mail are
 * recorded, never sent. Every row created here is removed.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
  db,
  breakGlassPendingSecretsTable,
  breakGlassVerificationAttemptsTable,
  breakGlassOverrideAuditTable,
  breakGlassExistingAccountDecisionsTable,
  tenantsTable,
  usersTable,
  wfDefinitionsTable,
  wfNodeOutputSamplesTable,
  wfRunNodeOutputsTable,
  wfRunsTable,
  wfVersionsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const liveMode = vi.hoisted(() => ({
  held: new Map<string, string>(),
  purged: [] as string[],
  graphWrites: 0,
  invitesSent: [] as string[],
  emailsSent: 0,
}));

// The vault is stubbed for the WHOLE file — see the header. Every function the run and
// the decide paths call is covered, so none of them can fall through to a real store.
vi.mock("../lib/generated-secret-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/generated-secret-store.ts")>();
  return {
    ...actual,
    generatedSecretStoreConfigured: () => true,
    storeGeneratedSecret: async (o: { value: string; purpose: string; customerId: number }) => {
      const secretName = `zz-test-4532-${randomUUID()}`;
      liveMode.held.set(secretName, o.value);
      return {
        kind: "azure-key-vault" as const, vaultUrl: "stub://zz-test-4532", secretName, version: null,
        expiresOn: new Date(Date.now() + 3_600_000).toISOString(), purpose: o.purpose, customerId: o.customerId,
      };
    },
    bindGeneratedSecretToRun: async () => {},
    readGeneratedSecret: async (ref: { secretName: string }) => liveMode.held.get(ref.secretName) ?? null,
    purgeGeneratedSecret: async (ref: { secretName: string }) => {
      liveMode.purged.push(ref.secretName);
      liveMode.held.delete(ref.secretName);
      return true;
    },
  };
});

// No real mail: the invite email a reset sends, and any preference e-mail the
// notification center could fire for the MSP's staff.
vi.mock("../lib/mailer.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mailer.ts")>();
  return { ...actual, sendEmailForMspOrThrow: async (_mspId: number, to: string) => { liveMode.invitesSent.push(to); } };
});
vi.mock("../lib/graphEmail.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/graphEmail.ts")>();
  return { ...actual, sendMessage: async () => { liveMode.emailsSent += 1; } };
});

// The operator session is not what is under test; the routes, their validation, the
// audit writes and everything below them stay real. The stub user is the real
// PlatformAdmin row (so audit rows carry a real actor).
const stub = vi.hoisted(() => ({ user: { id: 1, role: "admin", mspRole: null, name: "Shane McCaw", email: "" } as Record<string, unknown> }));
vi.mock("../middlewares/requireAuth.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/requireAuth.ts")>();
  const asOperator = (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = stub.user; next(); };
  return {
    ...actual,
    requireAuth: asOperator,
    requireCapability: () => asOperator,
    assertCustomerAccess: async () => true,
  };
});
vi.mock("../lib/graph.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/graph.ts")>();
  return {
    ...actual,
    graphWriteForTenant: async (...args: Parameters<typeof actual.graphWriteForTenant>) => {
      liveMode.graphWrites += 1;
      return actual.graphWriteForTenant(...args);
    },
  };
});

import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fireWorkflowForDefinition } from "../lib/workflow-executor.ts";
import { graphFetchForTenant } from "../lib/graph.ts";
import breakGlassRouter, { generateStrongPassword, EXISTING_ACCOUNT_DECISION_PENDING_ERROR } from "./break-glass-verification.ts";
import mspBreakGlassRouter from "./msp-break-glass.ts";
// @ts-expect-error — plain .mjs script with no declarations; its CLI only runs when invoked directly.
import { TEST_USER_PREFIX, TEST_USER_UPN, TESTBED_INITIAL_DOMAIN, TESTBED_TENANT_ID } from "../../../../scripts/azure/testbed-test-user-2840.mjs";

const TESTBED_CUSTOMER_ID = 2080; // tenants.id of the testbed tenant (mccawsoft2)
const STEP_NODE = "tpl-quickstart-v1-create-break-glass-account";

const startedAt = new Date();
let definitionId = 0;
let versionId = 0;
let accountObjectId = "";
let passwordChangedBefore: string | null = null;
const runIds: number[] = [];

/** Console AND, when LIVE_VERIFY_EVIDENCE is set, an append-only file (vitest swallows console output for passing tests). */
const evidence = (label: string, value: unknown) => {
  const line = `${label} ${JSON.stringify(value)}`;
  console.log(line);
  if (process.env.LIVE_VERIFY_EVIDENCE) appendFileSync(process.env.LIVE_VERIFY_EVIDENCE, `${line}\n`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readTestUser(): Promise<{ id: string; userPrincipalName: string; lastPasswordChangeDateTime: string | null }> {
  const res = await graphFetchForTenant(
    TESTBED_TENANT_ID,
    `/users/${encodeURIComponent(TEST_USER_UPN)}?$select=id,userPrincipalName,lastPasswordChangeDateTime`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; userPrincipalName: string; lastPasswordChangeDateTime: string | null };
}

/** Entra replication can lag — poll until the timestamp differs from `from`, or give up. */
async function waitForPasswordChange(from: string | null, attempts = 12): Promise<string | null> {
  let current = from;
  for (let i = 0; i < attempts && current === from; i += 1) {
    await sleep(5000);
    current = (await readTestUser()).lastPasswordChangeDateTime;
  }
  return current;
}

async function waitForStatus(runId: number, wanted: string, tries = 80): Promise<string> {
  let status = "";
  for (let i = 0; i < tries && status !== wanted; i += 1) {
    await sleep(250);
    const [row] = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
    status = row?.status ?? "";
    if (status !== wanted && (status === "failed" || status === "cancelled")) break;
  }
  return status;
}

let server: Server | null = null;
let baseUrl = "";
async function api(): Promise<string> {
  if (server) return baseUrl;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { log: unknown }).log = console; next(); });
  app.use("/api", mspBreakGlassRouter);
  app.use("/api", breakGlassRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return baseUrl;
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${await api()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${await api()}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const secretsOf = (runId: number) =>
  db.select().from(breakGlassPendingSecretsTable).where(eq(breakGlassPendingSecretsTable.runId, runId)).orderBy(breakGlassPendingSecretsTable.id);
const decisionOf = async (runId: number) =>
  (await db.select().from(breakGlassExistingAccountDecisionsTable).where(eq(breakGlassExistingAccountDecisionsTable.runId, runId)))[0];
const runOf = async (runId: number) =>
  (await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1))[0];

/** Where the credential must never be: every table a run writes to. */
async function leaksOf(runId: number, plaintext: string): Promise<string[]> {
  const like = "%" + plaintext + "%";
  const res = await db.execute(sql`
    SELECT 'wf_runs.payload' AS col, count(*) AS n FROM wf_runs WHERE id = ${runId} AND payload::text LIKE ${like}
    UNION ALL SELECT 'wf_run_node_outputs', count(*) FROM wf_run_node_outputs
      WHERE run_id = ${runId} AND (output::text LIKE ${like} OR input::text LIKE ${like})
    UNION ALL SELECT 'wf_run_node_logs', count(*) FROM wf_run_node_logs
      WHERE run_id = ${runId} AND (message LIKE ${like} OR metadata::text LIKE ${like})
    UNION ALL SELECT 'wf_node_output_samples', count(*) FROM wf_node_output_samples
      WHERE definition_id = ${definitionId} AND sample::text LIKE ${like}
    UNION ALL SELECT 'break_glass_existing_account_decisions.context', count(*) FROM break_glass_existing_account_decisions
      WHERE run_id = ${runId} AND context::text LIKE ${like}
    UNION ALL SELECT 'notifications', count(*) FROM notifications WHERE body LIKE ${like} OR title LIKE ${like}
  `);
  const rows = (res as unknown as { rows: Array<{ col: string; n: string }> }).rows ?? (res as unknown as Array<{ col: string; n: string }>);
  return rows.filter((r) => Number(r.n) > 0).map((r) => `${r.col}=${r.n}`);
}

/** Fire one real run that reaches the gate exactly as a re-run of quickstart-v1 does. */
async function fireGatedRun(label: string): Promise<{ runId: number; plaintext: string; ref: { secretName: string } }> {
  const plaintext = generateStrongPassword();
  const secretName = `zz-test-4532-run-${randomUUID()}`;
  liveMode.held.set(secretName, plaintext);
  const ref = {
    kind: "azure-key-vault" as const, vaultUrl: "stub://zz-test-4532", secretName, version: null,
    expiresOn: new Date(Date.now() + 3_600_000).toISOString(), purpose: "break-glass", customerId: TESTBED_CUSTOMER_ID,
  };
  const fired = await fireWorkflowForDefinition(definitionId, "manual", `zz-test-4532-${label}`, {
    customerId: TESTBED_CUSTOMER_ID,
    generatedPassword: plaintext,
    generatedSecretRefs: { generatedPassword: ref },
    breakglassUserId: accountObjectId,
    breakGlassUserId: accountObjectId,
    principalId: accountObjectId,
    breakGlassAccountId: accountObjectId,
    // The create step's output as #4514 leaves it when the account already existed:
    // the write was skipped, so the generated password was never applied.
    nodes: {
      [STEP_NODE]: {
        success: true, status: 200, skippedExisting: true, unappliedVariables: ["generatedPassword"],
        data: { id: accountObjectId, userPrincipalName: TEST_USER_UPN },
      },
    },
  }, { versionId });
  expect(fired).not.toBeNull();
  runIds.push(fired!);
  return { runId: fired!, plaintext, ref };
}

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  for (const runId of runIds) {
    const secretIds = (await db.select({ id: breakGlassPendingSecretsTable.id })
      .from(breakGlassPendingSecretsTable).where(eq(breakGlassPendingSecretsTable.runId, runId))).map((r) => r.id);
    await db.delete(breakGlassExistingAccountDecisionsTable).where(eq(breakGlassExistingAccountDecisionsTable.runId, runId)).catch(() => {});
    if (secretIds.length > 0) {
      await db.delete(breakGlassOverrideAuditTable).where(inArray(breakGlassOverrideAuditTable.newPendingSecretId, secretIds)).catch(() => {});
      await db.delete(breakGlassVerificationAttemptsTable).where(inArray(breakGlassVerificationAttemptsTable.pendingSecretId, secretIds)).catch(() => {});
      await db.delete(breakGlassPendingSecretsTable).where(inArray(breakGlassPendingSecretsTable.id, secretIds)).catch(() => {});
    }
    await db.delete(wfRunNodeOutputsTable).where(eq(wfRunNodeOutputsTable.runId, runId)).catch(() => {});
    await db.execute(sql`DELETE FROM wf_run_node_logs WHERE run_id = ${runId}`).catch(() => {});
    await db.execute(sql`DELETE FROM notifications WHERE title = 'Break-glass decision needed' AND body LIKE ${"Run #" + runId + " paused:%"}`).catch(() => {});
    await db.delete(wfRunsTable).where(eq(wfRunsTable.id, runId)).catch(() => {});
  }
  // The audit rows the routes wrote in this window, by the stub actor and these action types only.
  await db.execute(sql`
    DELETE FROM audit_logs
    WHERE created_at >= ${startedAt} AND actor_user_id = ${stub.user.id as number} AND tenant_id = ${TESTBED_CUSTOMER_ID}
      AND action_type IN ('break_glass.existing_account_decision', 'break_glass.existing_account_decisions_viewed', 'break_glass.invite_sent')
  `).catch(() => {});
  if (definitionId) {
    await db.delete(wfNodeOutputSamplesTable).where(eq(wfNodeOutputSamplesTable.definitionId, definitionId)).catch(() => {});
    await db.delete(wfVersionsTable).where(eq(wfVersionsTable.definitionId, definitionId)).catch(() => {});
    await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId)).catch(() => {});
  }
});

describe("#4532 — existing break-glass account: operator decision, live", () => {
  it("refuses to run anywhere it could reach a real vault or a non-synthetic identity", async () => {
    // The REAL store predicate (the mock above overrides the module export the code under
    // test sees, so ask the actual implementation): a configured store means production.
    const actual = await vi.importActual<typeof import("../lib/generated-secret-store.ts")>("../lib/generated-secret-store.ts");
    expect(actual.generatedSecretStoreConfigured()).toBe(false);

    const [tenant] = await db.select({ tenantId: tenantsTable.tenantId, isTestbed: tenantsTable.isTestbed })
      .from(tenantsTable).where(eq(tenantsTable.id, TESTBED_CUSTOMER_ID)).limit(1);
    expect(tenant?.tenantId).toBe(TESTBED_TENANT_ID);
    expect(tenant?.isTestbed).toBe(true);

    const user = await readTestUser();
    expect(user.userPrincipalName.startsWith(TEST_USER_PREFIX)).toBe(true);
    expect(user.userPrincipalName.endsWith(`@${TESTBED_INITIAL_DOMAIN}`)).toBe(true);
    accountObjectId = user.id;
    passwordChangedBefore = user.lastPasswordChangeDateTime;

    const [admin] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, 1)).limit(1);
    expect(admin).toBeDefined();
    stub.user = { ...stub.user, id: admin!.id, name: admin!.name, email: admin!.email };

    // start -> gate -> end: the shape config-pack-graph.ts builds around a gated step.
    const graph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } },
        {
          id: "gate", type: "break_glass_verification_gate", position: { x: 200, y: 0 },
          data: { label: "Break-glass gate", secretField: "generatedPassword", customerIdField: "customerId", accountIdField: "breakGlassAccountId" },
        },
        { id: "end", type: "end", position: { x: 400, y: 0 }, data: { label: "Pack Complete" } },
      ],
      edges: [{ id: "e1", source: "start", target: "gate" }, { id: "e2", source: "gate", target: "end" }],
    };
    const [def] = await db.insert(wfDefinitionsTable).values({ name: "zz-test #4532 live verify", description: "temporary — removed by the test" }).returning({ id: wfDefinitionsTable.id });
    definitionId = def.id;
    const [ver] = await db.insert(wfVersionsTable).values({ definitionId, versionNumber: 1, status: "published", graph: graph as never }).returning({ id: wfVersionsTable.id });
    versionId = ver.id;
  });

  // ── Path (b): resume without delivering ──────────────────────────────────
  let b = { runId: 0, plaintext: "", secretName: "" };

  it("the gate PAUSES on the existing account instead of failing the run, and parks the unapplied secret", async () => {
    const fired = await fireGatedRun("resume");
    b = { runId: fired.runId, plaintext: fired.plaintext, secretName: fired.ref.secretName };

    expect(await waitForStatus(b.runId, "awaiting_approval")).toBe("awaiting_approval");

    const decision = await decisionOf(b.runId);
    expect(decision).toMatchObject({ status: "pending", gateNodeId: "gate", customerId: TESTBED_CUSTOMER_ID, existingAccountId: accountObjectId, existingAccountUpn: TEST_USER_UPN, skippedNodeId: STEP_NODE });

    const secrets = await secretsOf(b.runId);
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatchObject({ status: "pending_delivery", breakGlassAccountId: accountObjectId, gateNodeId: "gate" });
    expect(secrets[0]!.credentialUncertainAt).not.toBeNull();
    expect(decision!.pendingSecretId).toBe(secrets[0]!.id);

    // #1911's guarantee is untouched: the credential is in none of the run's tables.
    expect(await leaksOf(b.runId, b.plaintext)).toEqual([]);
    // The decision row carries the redacted snapshot the chosen path resumes with.
    expect((decision!.context as Record<string, unknown>).breakGlassAccountId).toBe(accountObjectId);

    // Operators and platform admins were told (real notification-center rows), not e-mailed.
    const notified = await db.execute(sql`SELECT count(*) AS n FROM notifications WHERE title = 'Break-glass decision needed' AND body LIKE ${"Run #" + b.runId + " paused:%"}`);
    const n = Number(((notified as unknown as { rows: Array<{ n: string }> }).rows ?? (notified as unknown as Array<{ n: string }>))[0]!.n);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(liveMode.emailsSent).toBe(0);
  });

  it("the never-applied secret can be neither invited nor revealed while the decision is pending", async () => {
    const [secret] = await secretsOf(b.runId);
    const r = await post(`/portal/break-glass/${secret!.id}/invite`, { emails: [TEST_USER_UPN] });
    evidence("[#4532] invite on the parked secret:", r);
    expect(r.status).toBe(409);
    expect(r.body.detail).toBe("existing_account_decision_pending");
    expect(r.body.error).toBe(EXISTING_ACCOUNT_DECISION_PENDING_ERROR);
    expect(liveMode.invitesSent).toEqual([]);
  });

  it("the decide route refuses an answer without the customer's answer, a reason, or with stray emails — and nothing changes", async () => {
    const d = await decisionOf(b.runId);
    const base = `/msp/customers/${TESTBED_CUSTOMER_ID}/break-glass-decisions/${d!.id}/decide`;
    const writesBefore = liveMode.graphWrites;

    expect((await post(base, { decision: "resume_without_delivery", reason: "r" })).status).toBe(400);
    expect((await post(base, { decision: "resume_without_delivery", customerAnswer: "a" })).status).toBe(400);
    expect((await post(base, { decision: "resume_without_delivery", customerAnswer: "  ", reason: "r" })).status).toBe(400);
    expect((await post(base, { decision: "guess", customerAnswer: "a", reason: "r" })).status).toBe(400);
    expect((await post(base, { decision: "resume_without_delivery", customerAnswer: "a", reason: "r", emails: [TEST_USER_UPN] })).status).toBe(400);
    // Another customer's id must not find it.
    expect((await post(`/msp/customers/${TESTBED_CUSTOMER_ID + 1}/break-glass-decisions/${d!.id}/decide`, { decision: "resume_without_delivery", customerAnswer: "a", reason: "r" })).status).toBe(404);

    expect(liveMode.graphWrites).toBe(writesBefore);
    expect((await decisionOf(b.runId))!.status).toBe("pending");
    expect((await runOf(b.runId))!.status).toBe("awaiting_approval");
  });

  it("the list route returns the real pending decision", async () => {
    const r = await get(`/msp/customers/${TESTBED_CUSTOMER_ID}/break-glass-decisions`);
    expect(r.status).toBe(200);
    const rows = r.body.decisions as Array<{ runId: number; status: string; existingAccountUpn: string | null }>;
    const mine = rows.find((x) => x.runId === b.runId);
    expect(mine).toMatchObject({ status: "pending", existingAccountUpn: TEST_USER_UPN });
  });

  it("resume without delivering: ZERO tenant writes, the secret is discarded and purged, the run completes", async () => {
    const d = await decisionOf(b.runId);
    const writesBefore = liveMode.graphWrites;
    const answer = "zz-test #4532: customer confirmed by email they already hold the credential";
    expect(liveMode.held.has(b.secretName)).toBe(true);

    const r = await post(`/msp/customers/${TESTBED_CUSTOMER_ID}/break-glass-decisions/${d!.id}/decide`, {
      decision: "resume_without_delivery", customerAnswer: answer, reason: "zz-test #4532 live verify, resume path",
    });
    evidence("[#4532] resume_without_delivery:", r);
    expect(r).toMatchObject({ status: 200, body: { ok: true, decision: "resume_without_delivery", runId: b.runId } });

    // Exactly the chosen path: the run resumed past the gate and finished — and delivered nothing.
    expect(await waitForStatus(b.runId, "completed")).toBe("completed");
    expect(liveMode.graphWrites).toBe(writesBefore);
    expect(liveMode.invitesSent).toEqual([]);

    const [secret] = await secretsOf(b.runId);
    expect(secret).toMatchObject({ status: "discarded_unapplied", encryptedValue: "", deliveredAt: null, deliveredToEmail: null });
    expect(liveMode.purged).toContain(b.secretName);
    expect(liveMode.held.has(b.secretName)).toBe(false);

    const decided = await decisionOf(b.runId);
    expect(decided).toMatchObject({ status: "resume_without_delivery", customerAnswer: answer, decidedByUserId: stub.user.id, resultPendingSecretId: null });
    expect(decided!.decidedAt).not.toBeNull();

    expect(await leaksOf(b.runId, b.plaintext)).toEqual([]);

    // Answering twice is refused, and the run is not resumed again.
    const again = await post(`/msp/customers/${TESTBED_CUSTOMER_ID}/break-glass-decisions/${d!.id}/decide`, {
      decision: "reset_and_redeliver", customerAnswer: "changed my mind", reason: "r",
    });
    expect(again.status).toBe(409);
    expect(liveMode.graphWrites).toBe(writesBefore);

    // The tenant account is untouched: no write was sent, so the timestamp cannot have moved.
    expect((await readTestUser()).lastPasswordChangeDateTime).toBe(passwordChangedBefore);
  }, 120_000);

  // ── Path (a): reset and redeliver ────────────────────────────────────────
  let a = { runId: 0, plaintext: "", secretName: "" };

  it("(a) a second run pauses the same way", async () => {
    const fired = await fireGatedRun("reset");
    a = { runId: fired.runId, plaintext: fired.plaintext, secretName: fired.ref.secretName };
    expect(await waitForStatus(a.runId, "awaiting_approval")).toBe("awaiting_approval");
    expect((await decisionOf(a.runId))!.status).toBe("pending");
    expect(await leaksOf(a.runId, a.plaintext)).toEqual([]);
  });

  it("reset and redeliver: ONE real tenant reset, a new deliverable credential on the same gate, the run stays paused", async () => {
    const d = await decisionOf(a.runId);
    const writesBefore = liveMode.graphWrites;
    const answer = "zz-test #4532: customer asked us to issue a new password";

    const r = await post(`/msp/customers/${TESTBED_CUSTOMER_ID}/break-glass-decisions/${d!.id}/decide`, {
      decision: "reset_and_redeliver", customerAnswer: answer, reason: "zz-test #4532 live verify, reset path", emails: [TEST_USER_UPN],
    });
    evidence("[#4532] reset_and_redeliver:", r);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, decision: "reset_and_redeliver", reissued: 1, sent: 1 });
    const newId = r.body.newPendingSecretId as number;

    // Exactly one write against the tenant, on the account the create step found.
    expect(liveMode.graphWrites).toBe(writesBefore + 1);

    const secrets = await secretsOf(a.runId);
    const oldRow = secrets.find((s) => s.id === d!.pendingSecretId)!;
    const newRow = secrets.find((s) => s.id === newId)!;
    expect(oldRow.status).toBe("superseded_by_reset");
    expect(newRow).toMatchObject({ status: "pending_delivery", gateNodeId: "gate", breakGlassAccountId: accountObjectId, deliveredAt: null });
    // The replacement is deliverable: the uncertainty marker the parked row carried is cleared.
    expect(newRow.credentialUncertainAt).toBeNull();

    // The replacement is a NEW password, held by the store; the run's original is gone from it.
    const newRef = newRow.secretRef as { secretName: string } | null;
    expect(newRef).not.toBeNull();
    const heldNew = liveMode.held.get(newRef!.secretName);
    expect(heldNew).toBeTypeOf("string");
    expect(heldNew).not.toBe(a.plaintext);
    expect(liveMode.purged).toContain(a.secretName);

    // Recorded against the decision, with who answered and what the customer said.
    const decided = await decisionOf(a.runId);
    expect(decided).toMatchObject({ status: "reset_and_redeliver", customerAnswer: answer, decidedByUserId: stub.user.id, resultPendingSecretId: newId });

    // The override's own audit row, and the invite it issued (recorded, not sent).
    const audit = await db.select().from(breakGlassOverrideAuditTable).where(eq(breakGlassOverrideAuditTable.newPendingSecretId, newId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ oldPendingSecretId: oldRow.id, customerId: TESTBED_CUSTOMER_ID });
    expect(liveMode.invitesSent).toEqual([TEST_USER_UPN]);

    // Delivery happens through the normal verify-and-acknowledge flow: the run is still paused.
    expect((await runOf(a.runId))!.status).toBe("awaiting_approval");
    expect(await leaksOf(a.runId, a.plaintext)).toEqual([]);
    expect(await leaksOf(a.runId, heldNew!)).toEqual([]);

    // Answering twice is refused, and no second reset is sent.
    const again = await post(`/msp/customers/${TESTBED_CUSTOMER_ID}/break-glass-decisions/${d!.id}/decide`, {
      decision: "reset_and_redeliver", customerAnswer: "again", reason: "r",
    });
    expect(again.status).toBe(409);
    expect(liveMode.graphWrites).toBe(writesBefore + 1);
  }, 120_000);

  it("the tenant really changed: the account's lastPasswordChangeDateTime moved forward", async () => {
    const after = await waitForPasswordChange(passwordChangedBefore);
    evidence("[#4532] lastPasswordChangeDateTime:", { before: passwordChangedBefore, after });
    expect(after).not.toBe(passwordChangedBefore);
    expect(new Date(after!).getTime()).toBeGreaterThan(new Date(passwordChangedBefore ?? 0).getTime());
  }, 120_000);

  it("the replacement can now be invited: the parked-secret refusal no longer applies to it", async () => {
    const d = await decisionOf(a.runId);
    const r = await post(`/portal/break-glass/${d!.resultPendingSecretId}/invite`, { emails: [TEST_USER_UPN] });
    evidence("[#4532] invite on the replacement:", r);
    expect(r.status).toBe(200);
  });
});

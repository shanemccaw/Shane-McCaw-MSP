/**
 * break-glass-admin-override.live-verify.ts — Git #4015, #4029
 *
 * LIVE round trip from the break_glass_verification_gate's account-identity stamp
 * to performBreakGlassAdminOverride()'s real tenant reset. Nothing tested that
 * round trip before #4015, which is how the override came to PATCH
 * `/users/%5Bredacted%5D` on every gated run. Opt-in, like the #1911 harness:
 *
 *   npx vitest run --config vitest.live-verify.config.ts src/routes/break-glass-admin-override.live-verify.ts
 *
 * Requires .env.local loaded, WITH the generated-secret store unconfigured
 * (GENERATED_SECRET_VAULT_URL="" — empty, not unset, so it does not fall back to
 * AZURE_KEY_VAULT_URL). Locally that fallback is the production Key Vault, which
 * is outside agent reach (Git #1913), so this harness refuses to run otherwise.
 *
 * #4029 — the override used to reset first and store second, so an unconfigured
 * store answered 503 AFTER the password had already changed. It now refuses before
 * any tenant write when the replacement cannot be held. What is exercised here:
 *
 *   - store unconfigured          → 503, zero tenant writes, password unchanged
 *   - store configured, vault unreachable (a real SDK call to a `.invalid` host)
 *                                 → 503, zero tenant writes, password unchanged
 *   - Graph definitely refuses    → 502, the provisional copy is purged
 *   - reset lands, recording fails twice
 *                                 → 500, the replacement's copy is kept, the old
 *                                   row stays overridable
 *   - the override run again      → a recorded, deliverable replacement
 *
 * The last three need a store that SUCCEEDS, and the only reachable vault locally
 * is production. They swap the store for an in-process one (`liveMode.store =
 * "stub"`): Graph and Postgres stay real. RBAC refusal and throttling from a real
 * vault are not reachable without a non-production vault and are not exercised.
 *
 * The ONLY tenant writes are password resets on the sanctioned synthetic identity
 * `zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com` (Git #2840) — no roles, no
 * groups, no licences — plus one PATCH to a random, nonexistent object id. Its
 * password is not held anywhere, so replacing it breaks nothing. Every row created
 * here is removed.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  db,
  breakGlassPendingSecretsTable,
  breakGlassVerificationAttemptsTable,
  breakGlassOverrideAuditTable,
  tenantsTable,
  wfDefinitionsTable,
  wfNodeOutputSamplesTable,
  wfRunNodeOutputsTable,
  wfRunsTable,
  wfVersionsTable,
} from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";

const liveMode = vi.hoisted(() => ({
  store: "real" as "real" | "stub",
  held: new Map<string, string>(),
  purged: [] as string[],
  graphWrites: 0,
  stores: 0,
}));

vi.mock("../lib/generated-secret-store.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/generated-secret-store.ts")>();
  return {
    ...actual,
    generatedSecretStoreConfigured: () => liveMode.store === "stub" || actual.generatedSecretStoreConfigured(),
    storeGeneratedSecret: async (o: Parameters<typeof actual.storeGeneratedSecret>[0]) => {
      liveMode.stores += 1;
      if (liveMode.store !== "stub") return actual.storeGeneratedSecret(o);
      const secretName = `zz-test-4029-${randomUUID()}`;
      liveMode.held.set(secretName, o.value);
      return {
        kind: "azure-key-vault" as const, vaultUrl: "stub://zz-test-4029", secretName, version: null,
        expiresOn: new Date(Date.now() + 3_600_000).toISOString(), purpose: o.purpose, customerId: o.customerId,
      };
    },
    purgeGeneratedSecret: async (ref: Parameters<typeof actual.purgeGeneratedSecret>[0], reason: string) => {
      if (liveMode.store !== "stub") return actual.purgeGeneratedSecret(ref, reason);
      liveMode.purged.push(ref.secretName);
      liveMode.held.delete(ref.secretName);
      return true;
    },
  };
});

// #4041 — invite and reveal are exercised through the real routes. Two things are
// stubbed at the edges: the portal session (requireAuth / assertCustomerAccess —
// not what is under test) and the outgoing invite email, which would otherwise
// send real mail to the synthetic identity. The rows, the routes and the
// Microsoft token endpoint stay real.
const liveInvites = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("../lib/mailer.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mailer.ts")>();
  return { ...actual, sendEmailForMspOrThrow: async (_mspId: number, to: string) => { liveInvites.sent.push(to); } };
});
vi.mock("../middlewares/requireAuth.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/requireAuth.ts")>();
  return {
    ...actual,
    requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 0, role: "admin", mspRole: null }; next(); },
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
import { createHmac, randomBytes } from "node:crypto";
import { fireWorkflowForDefinition } from "../lib/workflow-executor.ts";
import { generatedSecretStoreConfigured } from "../lib/generated-secret-store.ts";
import { graphFetchForTenant } from "../lib/graph.ts";
import breakGlassRouter, {
  CREDENTIAL_UNCERTAIN_ERROR,
  generateStrongPassword,
  performBreakGlassAdminOverride,
  resolvePendingContext,
} from "./break-glass-verification.ts";
// @ts-expect-error — plain .mjs script with no declarations; its CLI only runs when invoked directly.
import { TEST_USER_PREFIX, TEST_USER_UPN, TESTBED_INITIAL_DOMAIN, TESTBED_TENANT_ID } from "../../../../scripts/azure/testbed-test-user-2840.mjs";

const CUSTOMER_ID = 1; // the testbed tenant row

let definitionId = 0;
let runId = 0;
let pendingId = 0;
/** #4040 — the deliverable replacement the recovery override issues; the concurrent pair targets it. */
let replacementId = 0;
let accountObjectId = "";
let passwordChangedBefore: string | null = null;

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

async function runSecrets() {
  return db.select().from(breakGlassPendingSecretsTable).where(eq(breakGlassPendingSecretsTable.runId, runId));
}

async function overrideOnce(mutate?: (ctx: NonNullable<Awaited<ReturnType<typeof resolvePendingContext>>>) => void) {
  const ctx = await resolvePendingContext(pendingId);
  expect(ctx).not.toBeNull();
  mutate?.(ctx!);
  return performBreakGlassAdminOverride(ctx!, pendingId, 0, "zz-test #4029 live verify", undefined);
}

// ── #4041 — the real router on an ephemeral port ─────────────────────────────
let server: Server | null = null;
let baseUrl = "";
async function api(): Promise<string> {
  if (server) return baseUrl;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { (req as unknown as { log: unknown }).log = console; next(); });
  app.use("/api", breakGlassRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return baseUrl;
}

/** The route's own state format: `${token}.${hmac-sha256(JWT_SECRET, token)}`. */
const signedState = (token: string) =>
  `${token}.${createHmac("sha256", process.env.JWT_SECRET!).update(token).digest("hex")}`;

/** A link as it exists when the row is marked — issued before, or racing, the override. */
async function insertLink(secretId: number): Promise<{ id: number; linkToken: string }> {
  const linkToken = `zz-test-4041-${randomBytes(24).toString("hex")}`;
  const [row] = await db.insert(breakGlassVerificationAttemptsTable).values({
    pendingSecretId: secretId, initiatedByPortalUserId: 0, invitedEmail: TEST_USER_UPN,
    linkToken, linkStatus: "pending", failedAttemptCount: 0,
  }).returning({ id: breakGlassVerificationAttemptsTable.id });
  return { id: row.id, linkToken };
}

async function linkStatusOf(attemptId: number): Promise<string | undefined> {
  const [row] = await db.select({ linkStatus: breakGlassVerificationAttemptsTable.linkStatus })
    .from(breakGlassVerificationAttemptsTable).where(eq(breakGlassVerificationAttemptsTable.id, attemptId)).limit(1);
  return row?.linkStatus;
}

async function uncertainAtOf(secretId: number): Promise<Date | null | undefined> {
  const [row] = await db.select({ at: breakGlassPendingSecretsTable.credentialUncertainAt })
    .from(breakGlassPendingSecretsTable).where(eq(breakGlassPendingSecretsTable.id, secretId)).limit(1);
  return row?.at;
}

/** Counts calls the callback makes to Microsoft's token endpoint, without altering them. */
function watchTokenExchanges(): { count: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let n = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://login.microsoftonline.com/") && url.includes("/oauth2/v2.0/token")) n += 1;
    return real(input, init);
  });
  return { count: () => n, restore: () => spy.mockRestore() };
}

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (runId) {
    const secretIds = (await db.select({ id: breakGlassPendingSecretsTable.id })
      .from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.runId, runId))).map((r) => r.id);
    if (secretIds.length > 0) {
      await db.delete(breakGlassOverrideAuditTable).where(inArray(breakGlassOverrideAuditTable.newPendingSecretId, secretIds)).catch(() => {});
      await db.delete(breakGlassVerificationAttemptsTable).where(inArray(breakGlassVerificationAttemptsTable.pendingSecretId, secretIds)).catch(() => {});
      await db.delete(breakGlassPendingSecretsTable).where(inArray(breakGlassPendingSecretsTable.id, secretIds)).catch(() => {});
    }
    await db.delete(wfRunNodeOutputsTable).where(eq(wfRunNodeOutputsTable.runId, runId)).catch(() => {});
    await db.execute(sql`DELETE FROM wf_run_node_logs WHERE run_id = ${runId}`).catch(() => {});
    await db.delete(wfRunsTable).where(eq(wfRunsTable.id, runId)).catch(() => {});
  }
  if (definitionId) {
    await db.delete(wfNodeOutputSamplesTable).where(eq(wfNodeOutputSamplesTable.definitionId, definitionId)).catch(() => {});
    await db.delete(wfVersionsTable).where(eq(wfVersionsTable.definitionId, definitionId)).catch(() => {});
    await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId)).catch(() => {});
  }
});

describe("#4015 / #4029 — break-glass admin-override against the gated account, live", () => {
  it("refuses to run anywhere it could reach the vault or a non-synthetic identity", async () => {
    expect(generatedSecretStoreConfigured()).toBe(false);

    const [tenant] = await db.select({ tenantId: tenantsTable.tenantId, isTestbed: tenantsTable.isTestbed })
      .from(tenantsTable).where(eq(tenantsTable.id, CUSTOMER_ID)).limit(1);
    expect(tenant?.tenantId).toBe(TESTBED_TENANT_ID);
    expect(tenant?.isTestbed).toBe(true);

    const user = await readTestUser();
    expect(user.userPrincipalName.startsWith(TEST_USER_PREFIX)).toBe(true);
    expect(user.userPrincipalName.endsWith(`@${TESTBED_INITIAL_DOMAIN}`)).toBe(true);
    accountObjectId = user.id;
    passwordChangedBefore = user.lastPasswordChangeDateTime;
  });

  it("the gate keeps the account identity usable in the paused run and on its pending secret", async () => {
    expect(accountObjectId).not.toBe("");
    const plaintext = generateStrongPassword();

    // The shape config-pack-graph.ts builds for a gated create step: the map node
    // emits all four casings of the created user's id, then the gate pauses.
    const graph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } },
        {
          id: "gate",
          type: "break_glass_verification_gate",
          position: { x: 200, y: 0 },
          data: { label: "Break-glass gate", secretField: "generatedPassword", customerIdField: "customerId", accountIdField: "breakGlassAccountId" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "gate" }],
    };

    const [def] = await db.insert(wfDefinitionsTable).values({
      name: "zz-test #4029 live verify", description: "temporary — removed by the test",
    }).returning({ id: wfDefinitionsTable.id });
    definitionId = def.id;
    const [ver] = await db.insert(wfVersionsTable).values({
      definitionId, versionNumber: 1, status: "published", graph: graph as never,
    }).returning({ id: wfVersionsTable.id });

    const fired = await fireWorkflowForDefinition(definitionId, "manual", "zz-test-4029-live-verify", {
      customerId: CUSTOMER_ID,
      generatedPassword: plaintext,
      breakglassUserId: accountObjectId,
      breakGlassUserId: accountObjectId,
      principalId: accountObjectId,
      breakGlassAccountId: accountObjectId,
    }, { versionId: ver.id });
    expect(fired).not.toBeNull();
    runId = fired!;

    let status = "";
    for (let i = 0; i < 60 && status !== "awaiting_approval"; i += 1) {
      await sleep(250);
      const [row] = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      status = row?.status ?? "";
      if (status === "failed" || status === "completed" || status === "cancelled") break;
    }
    expect(status).toBe("awaiting_approval");

    // Soft, so a regression still reaches the override below and shows its real answer.
    const [run] = await db.select({ payload: wfRunsTable.payload }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
    const persisted = run.payload as Record<string, unknown>;
    expect.soft(persisted.breakGlassUserId).toBe(accountObjectId);
    expect.soft(persisted.principalId).toBe(accountObjectId);
    expect.soft(persisted.breakGlassAccountId).toBe(accountObjectId);

    const [pending] = await runSecrets();
    expect(pending?.status).toBe("pending_delivery");
    expect.soft(pending.breakGlassAccountId).toBe(accountObjectId);
    pendingId = pending.id;

    // #1911's guarantee is untouched: the credential itself is nowhere in the database.
    const leaks = await db.execute(sql`
      SELECT 'wf_runs.payload' AS col, count(*) AS n FROM wf_runs
        WHERE id = ${runId} AND payload::text LIKE ${"%" + plaintext + "%"}
      UNION ALL SELECT 'wf_run_node_outputs', count(*) FROM wf_run_node_outputs
        WHERE run_id = ${runId} AND (output::text LIKE ${"%" + plaintext + "%"} OR input::text LIKE ${"%" + plaintext + "%"})
      UNION ALL SELECT 'wf_run_node_logs', count(*) FROM wf_run_node_logs
        WHERE run_id = ${runId} AND (message LIKE ${"%" + plaintext + "%"} OR metadata::text LIKE ${"%" + plaintext + "%"})
      UNION ALL SELECT 'wf_node_output_samples', count(*) FROM wf_node_output_samples
        WHERE definition_id = ${definitionId} AND sample::text LIKE ${"%" + plaintext + "%"}
    `);
    const rows = (leaks as unknown as { rows: Array<{ col: string; n: string }> }).rows
      ?? (leaks as unknown as Array<{ col: string; n: string }>);
    for (const row of rows) expect(`${row.col}=${row.n}`).toBe(`${row.col}=0`);
  });

  it("#4029 — an unconfigured store refuses before any tenant write", async () => {
    expect(pendingId).not.toBe(0);
    liveMode.store = "real";
    const writesBefore = liveMode.graphWrites;

    const result = await overrideOnce();
    console.log("[#4029] unconfigured store:", result);
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(liveMode.graphWrites).toBe(writesBefore);

    const [after] = await runSecrets();
    expect(after.status).toBe("pending_delivery");
  });

  it("#4029 — a store that fails for real refuses before any tenant write", async () => {
    liveMode.store = "real";
    const saved = process.env.GENERATED_SECRET_VAULT_URL;
    // RFC 2606 `.invalid` never resolves: a genuine SDK setSecret against an
    // unreachable vault, and nothing that could be anyone's real vault.
    process.env.GENERATED_SECRET_VAULT_URL = "https://zz-test-4029.vault.invalid";
    const writesBefore = liveMode.graphWrites;
    try {
      expect(generatedSecretStoreConfigured()).toBe(true);
      const result = await overrideOnce();
      console.log("[#4029] unreachable vault:", result);
      expect(result).toMatchObject({ ok: false, status: 503 });
    } finally {
      process.env.GENERATED_SECRET_VAULT_URL = saved;
    }
    expect(liveMode.graphWrites).toBe(writesBefore);

    const rows = await runSecrets();
    expect(rows.map((r) => r.status)).toEqual(["pending_delivery"]);

    // Neither refusal touched the tenant: the directory object agrees.
    await sleep(15_000);
    const now = (await readTestUser()).lastPasswordChangeDateTime;
    console.log("[#4029] lastPasswordChangeDateTime after both refusals:", { before: passwordChangedBefore, now });
    expect(now).toBe(passwordChangedBefore);
  }, 120_000);

  it("#4029 — a definite Graph refusal purges the provisional replacement", async () => {
    liveMode.store = "stub";
    const writesBefore = liveMode.graphWrites;

    // A random object id that exists nowhere: Graph answers 404 and changes nothing.
    const result = await overrideOnce((ctx) => { ctx.secret.breakGlassAccountId = randomUUID(); });
    console.log("[#4029] refused reset:", result);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(liveMode.graphWrites).toBe(writesBefore + 1);
    expect(liveMode.held.size).toBe(0);
    expect(liveMode.purged.length).toBe(1);

    const rows = await runSecrets();
    expect(rows.map((r) => r.status)).toEqual(["pending_delivery"]);
    // #4041 — nothing changed on the tenant, so the marker written before the reset was put back.
    expect(rows[0].credentialUncertainAt).toBeNull();
  }, 60_000);

  it("#4029 — reset lands but recording fails: the replacement is kept and the row stays overridable", async () => {
    liveMode.store = "stub";
    const writesBefore = liveMode.graphWrites;
    const tx = vi.spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("zz-test #4029 forced: connection terminated"))
      .mockRejectedValueOnce(new Error("zz-test #4029 forced: connection terminated"));
    let result: Awaited<ReturnType<typeof overrideOnce>>;
    try {
      result = await overrideOnce();
    } finally {
      tx.mockRestore();
    }
    console.log("[#4029] unrecorded replacement:", result);
    expect(result).toMatchObject({ ok: false, status: 500, detail: "replacement_unrecorded" });
    expect(liveMode.graphWrites).toBe(writesBefore + 1);
    // The live password's only copy was not purged.
    expect(liveMode.held.size).toBe(1);
    expect(liveMode.purged.length).toBe(1);

    const rows = await runSecrets();
    expect(rows.map((r) => r.status)).toEqual(["pending_delivery"]);

    const changed = await waitForPasswordChange(passwordChangedBefore);
    console.log("[#4029] lastPasswordChangeDateTime after the landed reset:", { before: passwordChangedBefore, after: changed });
    expect(changed).not.toBe(passwordChangedBefore);
    passwordChangedBefore = changed;
  }, 120_000);

  it("#4041 — the unrecorded reset is persisted on the row", async () => {
    const at = await uncertainAtOf(pendingId);
    console.log("[#4041] credential_uncertain_at after replacement_unrecorded:", at);
    expect(at).toBeInstanceOf(Date);
  });

  it("#4041 — invite is refused while the row is marked", async () => {
    const base = await api();
    const sentBefore = liveInvites.sent.length;
    const res = await fetch(`${base}/portal/break-glass/${pendingId}/invite`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: [TEST_USER_UPN] }),
    });
    const body = await res.json();
    console.log("[#4041] invite while marked:", res.status, body);
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: CREDENTIAL_UNCERTAIN_ERROR, detail: "credential_uncertain" });
    expect(liveInvites.sent.length).toBe(sentBefore);
    const links = await db.select().from(breakGlassVerificationAttemptsTable)
      .where(eq(breakGlassVerificationAttemptsTable.pendingSecretId, pendingId));
    expect(links).toEqual([]);
  });

  it("#4041 — reveal is refused while the row is marked, and the link is retired rather than left live", async () => {
    const base = await api();
    const exchanges = watchTokenExchanges();
    try {
      // The landing redirect refuses before sending anyone to Microsoft.
      const first = await insertLink(pendingId);
      const landing = await fetch(`${base}/public/break-glass/verify/${first.linkToken}`, { redirect: "manual" });
      const landingHtml = await landing.text();
      console.log("[#4041] verify link while marked:", landing.status, landing.headers.get("location"));
      expect(landing.status).toBe(409);
      expect(landingHtml).toContain("This credential cannot be delivered right now");
      expect(await linkStatusOf(first.id)).toBe("superseded");

      // The callback — where the credential is shown — refuses before exchanging the code.
      const second = await insertLink(pendingId);
      const callback = await fetch(
        `${base}/public/break-glass/verify/callback?state=${encodeURIComponent(signedState(second.linkToken))}&code=zz-test-4041`,
        { redirect: "manual" },
      );
      const callbackHtml = await callback.text();
      console.log("[#4041] callback while marked:", callback.status);
      expect(callback.status).toBe(409);
      expect(callbackHtml).toContain("This credential cannot be delivered right now");
      expect(callbackHtml).not.toContain('class="secret"');
      expect(await linkStatusOf(second.id)).toBe("superseded");
      expect(exchanges.count()).toBe(0);
    } finally {
      exchanges.restore();
    }
  });

  it("#4029 — running the override again issues a recorded, deliverable replacement", async () => {
    liveMode.store = "stub";
    const writesBefore = liveMode.graphWrites;

    const result = await overrideOnce();
    console.log("[#4029] recovery override:", result);
    // #4041 — the two retired links are what makes the override allowed, and their
    // recipient is re-invited (one address, deduplicated) on the replacement.
    expect(result).toMatchObject({ ok: true, reissued: 1, sent: 1 });
    expect(liveMode.graphWrites).toBe(writesBefore + 1);
    const newId = (result as { newPendingSecretId: number }).newPendingSecretId;
    replacementId = newId;

    const rows = await runSecrets();
    const old = rows.find((r) => r.id === pendingId);
    const replacement = rows.find((r) => r.id === newId);
    expect(old?.status).toBe("superseded_by_reset");
    expect(replacement?.status).toBe("pending_delivery");
    expect(replacement?.breakGlassAccountId).toBe(accountObjectId);
    const ref = replacement?.secretRef as { secretName: string } | null;
    expect(ref && liveMode.held.has(ref.secretName)).toBe(true);

    const audit = await db.select().from(breakGlassOverrideAuditTable)
      .where(eq(breakGlassOverrideAuditTable.newPendingSecretId, newId));
    expect(audit.map((a) => a.oldPendingSecretId)).toEqual([pendingId]);

    const changed = await waitForPasswordChange(passwordChangedBefore);
    console.log("[#4029] lastPasswordChangeDateTime after the recovery reset:", { before: passwordChangedBefore, after: changed });
    expect(changed).not.toBe(passwordChangedBefore);

    // #4041 — the successful override clears the marker; the replacement starts clean.
    expect(old?.credentialUncertainAt).toBeNull();
    expect(replacement?.credentialUncertainAt).toBeNull();
    passwordChangedBefore = changed;
  }, 120_000);

  it("#4041 — after the successful override, invite and reveal are allowed again", async () => {
    expect(replacementId).not.toBe(0);
    const base = await api();

    const res = await fetch(`${base}/portal/break-glass/${replacementId}/invite`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails: [TEST_USER_UPN] }),
    });
    const body = await res.json();
    console.log("[#4041] invite on the replacement:", res.status, body);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, invited: 1, sent: 1 });

    const [link] = await db.select().from(breakGlassVerificationAttemptsTable)
      .where(eq(breakGlassVerificationAttemptsTable.pendingSecretId, replacementId))
      .orderBy(desc(breakGlassVerificationAttemptsTable.id)).limit(1);
    expect(link.linkStatus).toBe("pending");

    // The landing link now sends the recipient to their tenant's Microsoft sign-in.
    const landing = await fetch(`${base}/public/break-glass/verify/${link.linkToken}`, { redirect: "manual" });
    const location = landing.headers.get("location") ?? "";
    console.log("[#4041] verify link on the replacement:", landing.status, location.split("?")[0]);
    expect(landing.status).toBe(302);
    expect(location.startsWith(`https://login.microsoftonline.com/${TESTBED_TENANT_ID}/oauth2/v2.0/authorize`)).toBe(true);

    // The callback now gets as far as exchanging the code with Microsoft. A real
    // Global Administrator sign-in is the one step no harness can perform, so the
    // placeholder code is rejected there — past the #4041 check, not at it.
    const exchanges = watchTokenExchanges();
    try {
      const callback = await fetch(
        `${base}/public/break-glass/verify/callback?state=${encodeURIComponent(signedState(link.linkToken))}&code=zz-test-4041`,
        { redirect: "manual" },
      );
      const html = await callback.text();
      console.log("[#4041] callback on the replacement:", callback.status, "token exchanges:", exchanges.count());
      expect(html).not.toContain("This credential cannot be delivered right now");
      expect(exchanges.count()).toBe(1);
      expect(callback.status).toBe(400);
    } finally {
      exchanges.restore();
    }
    expect(await linkStatusOf(link.id)).toBe("pending");

    // Hand the next test a dead-ended handoff, as the 24h link expiry would: the
    // #4040 pair below needs every link on the replacement terminal before either
    // override may claim it.
    await db.update(breakGlassVerificationAttemptsTable)
      .set({ linkStatus: "expired", verificationOutcome: "expired" })
      .where(eq(breakGlassVerificationAttemptsTable.pendingSecretId, replacementId));
  }, 60_000);

  // #4040 — two overrides on the same pending secret, fired together. Both contexts
  // are read first, so both callers hold a row that says pending_delivery — the
  // exact shape of an operator double-click or the portal and MSP console racing.
  // Before the claim, both passed that in-memory check, both reset the tenant and
  // both inserted a deliverable replacement; only one of those is the live password.
  it("#4040 — two concurrent overrides: one resets, the other is refused before any tenant write", async () => {
    expect(replacementId).not.toBe(0);
    liveMode.store = "stub";
    const writesBefore = liveMode.graphWrites;
    const storesBefore = liveMode.stores;

    const [ctxA, ctxB] = await Promise.all([resolvePendingContext(replacementId), resolvePendingContext(replacementId)]);
    expect(ctxA?.secret.status).toBe("pending_delivery");
    expect(ctxB?.secret.status).toBe("pending_delivery");

    const results = await Promise.all([
      performBreakGlassAdminOverride(ctxA!, replacementId, 0, "zz-test #4040 concurrent A", undefined),
      performBreakGlassAdminOverride(ctxB!, replacementId, 0, "zz-test #4040 concurrent B", undefined),
    ]);
    console.log("[#4040] concurrent overrides:", results);

    const won = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    expect(won.length).toBe(1);
    expect(refused).toEqual([expect.objectContaining({ ok: false, status: 409 })]);
    // The refused call never reached the store or the tenant.
    expect(liveMode.graphWrites).toBe(writesBefore + 1);
    expect(liveMode.stores).toBe(storesBefore + 1);

    // Exactly one deliverable row for the run, and it is the winner's.
    const winnerId = (won[0] as { newPendingSecretId: number }).newPendingSecretId;
    const rows = await runSecrets();
    expect(rows.filter((r) => r.status === "pending_delivery").map((r) => r.id)).toEqual([winnerId]);
    expect(rows.find((r) => r.id === replacementId)?.status).toBe("superseded_by_reset");
    expect(rows.some((r) => r.status === "reset_in_progress")).toBe(false);

    const audit = await db.select().from(breakGlassOverrideAuditTable)
      .where(eq(breakGlassOverrideAuditTable.oldPendingSecretId, replacementId));
    expect(audit.map((a) => a.newPendingSecretId)).toEqual([winnerId]);

    const changed = await waitForPasswordChange(passwordChangedBefore);
    console.log("[#4040] lastPasswordChangeDateTime after the concurrent pair:", { before: passwordChangedBefore, after: changed });
    expect(changed).not.toBe(passwordChangedBefore);
  }, 120_000);
});

/**
 * generated-secret-store.live-verify.ts — Git #1911
 *
 * LIVE end-to-end verification of the generated-credential lifecycle. Deliberately
 * NOT in `vitest.config.ts`'s include list: it talks to the real local Postgres
 * and the real Key Vault, so it is opt-in and never part of a regression sweep.
 *
 *   npx vitest run --config vitest.live-verify.config.ts
 *
 * It drives the real production code paths — the real orchestrator helper, the
 * real engine, the real gate node, the real reveal resolver — and asserts the two
 * things #1911 is actually about:
 *
 *   1. the plaintext is NOWHERE in the database, at any point, in any column;
 *   2. the reveal path can still hand the credential to the person who needs it.
 *
 * It fires NO tenant write. The graph is `start → break_glass_verification_gate`,
 * and the gate performs no Graph call — it encrypts, records the pending secret
 * and pauses. That is exactly the shape of the three runs #1900 found, which all
 * died before ever reaching a write.
 *
 * Everything it creates (workflow definition, version, run, pending secret, vault
 * secret) is removed at the end.
 */

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@workspace/db";
import {
  breakGlassPendingSecretsTable,
  wfDefinitionsTable,
  wfRunNodeOutputsTable,
  wfRunsTable,
  wfNodeOutputSamplesTable,
  wfVersionsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

import { persistGeneratedSecretsForRun } from "./config-pack-orchestrator";
import { fireWorkflowForDefinition } from "./workflow-executor";
import { generateStrongPassword, resolvePendingSecretPlaintext } from "../routes/break-glass-verification";
import { purgeGeneratedSecret, readGeneratedSecret, type GeneratedSecretRef } from "./generated-secret-store";

const CUSTOMER_ID = 1; // the testbed tenant — read-only here, nothing is written to it

let definitionId = 0;
let versionId = 0;
let runId = 0;
let plaintext = "";
let ref: GeneratedSecretRef | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  // Best-effort teardown, in FK order. A failed assertion must not leave a vault
  // secret or a run row behind.
  if (ref) await purgeGeneratedSecret(ref, "live-verify teardown").catch(() => {});
  if (runId) {
    await db.delete(breakGlassPendingSecretsTable).where(eq(breakGlassPendingSecretsTable.runId, runId)).catch(() => {});
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

describe("#1911 — generated credential lifecycle, live", () => {
  it("stores the generated credential in Key Vault and returns a reference, not the value", async () => {
    plaintext = generateStrongPassword();
    const stored: Array<[string, GeneratedSecretRef]> = [];

    const persisted = await persistGeneratedSecretsForRun(
      { packKey: "live-verify", customerId: CUSTOMER_ID, generatedPassword: plaintext },
      CUSTOMER_ID,
      stored,
    );

    expect(stored).toHaveLength(1);
    ref = stored[0][1];

    // The payload that will reach the database carries no plaintext at all.
    expect(persisted.generatedPassword).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain(plaintext);
    expect((persisted.generatedSecretRefs as Record<string, GeneratedSecretRef>).generatedPassword.secretName)
      .toBe(ref.secretName);

    // The vault really holds it.
    await expect(readGeneratedSecret(ref)).resolves.toBe(plaintext);
  });

  it("runs the engine through the gate without the plaintext ever touching the database", async () => {
    const graph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } },
        {
          id: "gate",
          type: "break_glass_verification_gate",
          position: { x: 200, y: 0 },
          data: { label: "Break-glass gate", secretField: "generatedPassword" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "gate" }],
    };

    const [def] = await db.insert(wfDefinitionsTable).values({
      name: "#1911 live verify", description: "temporary — removed by the test",
    }).returning({ id: wfDefinitionsTable.id });
    definitionId = def.id;

    const [ver] = await db.insert(wfVersionsTable).values({
      definitionId, versionNumber: 1, status: "published", graph: graph as never,
    }).returning({ id: wfVersionsTable.id });
    versionId = ver.id;

    // The SAME two-step the orchestrator performs: mint in memory, store in the
    // vault, fire with the reference-only payload.
    const stored: Array<[string, GeneratedSecretRef]> = [];
    const persisted = await persistGeneratedSecretsForRun(
      { customerId: CUSTOMER_ID, generatedPassword: plaintext },
      CUSTOMER_ID,
      stored,
    );
    // Reuse the first test's vault secret so teardown has one thing to purge.
    await purgeGeneratedSecret(stored[0][1], "live-verify: superseded by the run's own copy");
    (persisted.generatedSecretRefs as Record<string, GeneratedSecretRef>).generatedPassword = ref!;

    const fired = await fireWorkflowForDefinition(definitionId, "manual", "#1911-live-verify", persisted, { versionId });
    expect(fired).not.toBeNull();
    runId = fired!;

    // Wait for the gate to pause the run.
    let status = "";
    for (let i = 0; i < 60 && status !== "awaiting_approval"; i += 1) {
      await sleep(250);
      const [row] = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      status = row?.status ?? "";
      if (status === "failed" || status === "completed" || status === "cancelled") break;
    }
    expect(status).toBe("awaiting_approval");

    // ── The assertion #1900 exists for ────────────────────────────────────────
    // Every column that held the plaintext before this fix, checked for the real
    // value rather than for the key name.
    const leaks = await db.execute(sql`
      SELECT 'wf_runs.payload' AS col, count(*) AS n FROM wf_runs
        WHERE id = ${runId} AND payload::text LIKE ${"%" + plaintext + "%"}
      UNION ALL SELECT 'wf_run_node_outputs.output', count(*) FROM wf_run_node_outputs
        WHERE run_id = ${runId} AND output::text LIKE ${"%" + plaintext + "%"}
      UNION ALL SELECT 'wf_run_node_outputs.input', count(*) FROM wf_run_node_outputs
        WHERE run_id = ${runId} AND input::text LIKE ${"%" + plaintext + "%"}
      UNION ALL SELECT 'wf_run_node_outputs.error_message', count(*) FROM wf_run_node_outputs
        WHERE run_id = ${runId} AND error_message LIKE ${"%" + plaintext + "%"}
      UNION ALL SELECT 'wf_run_node_logs', count(*) FROM wf_run_node_logs
        WHERE run_id = ${runId} AND (message LIKE ${"%" + plaintext + "%"} OR metadata::text LIKE ${"%" + plaintext + "%"})
      UNION ALL SELECT 'wf_node_output_samples', count(*) FROM wf_node_output_samples
        WHERE definition_id = ${definitionId} AND sample::text LIKE ${"%" + plaintext + "%"}
    `);
    const rows = (leaks as unknown as { rows: Array<{ col: string; n: string }> }).rows
      ?? (leaks as unknown as Array<{ col: string; n: string }>);
    for (const row of rows) {
      expect(`${row.col}=${row.n}`).toBe(`${row.col}=0`);
    }

    // The start node DID run and DID record its output — this is not passing
    // because nothing was written.
    const [startRow] = await db.select({ output: wfRunNodeOutputsTable.output })
      .from(wfRunNodeOutputsTable)
      .where(eq(wfRunNodeOutputsTable.runId, runId));
    expect(startRow).toBeDefined();
    expect(JSON.stringify(startRow.output)).toContain("started");
  });

  it("reveals the credential to the tenant admin, then purges it on acknowledgement", async () => {
    const [pending] = await db.select().from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.runId, runId)).limit(1);
    expect(pending).toBeDefined();
    expect(pending.status).toBe("pending_delivery");

    // The gate recorded the vault reference alongside its own encrypted copy.
    expect((pending.secretRef as GeneratedSecretRef | null)?.secretName).toBe(ref!.secretName);

    // THE REVEAL. This is the real resolver the reveal page calls, and it must
    // return the real password — a secret safely stored and unreachable by the
    // admin who needs it is a broken product, not a secure one.
    await expect(resolvePendingSecretPlaintext(pending)).resolves.toBe(plaintext);

    // Acknowledgement purges the vault copy permanently (delete AND purge, so it
    // is not merely recoverable-for-90-days soft-deleted).
    await expect(purgeGeneratedSecret(ref!, "live-verify: acknowledged")).resolves.toBe(true);
    await expect(readGeneratedSecret(ref!)).resolves.toBeNull();

    // With the vault copy gone and the ciphertext cleared, the reveal correctly
    // reports "no longer available" instead of showing an empty box.
    await expect(resolvePendingSecretPlaintext({ ...pending, encryptedValue: "" })).resolves.toBeNull();

    // The gate's own encrypted copy is untouched by #1911 and still decrypts —
    // this change moved where the plaintext lives, it did not weaken the gate.
    await expect(resolvePendingSecretPlaintext({ ...pending, secretRef: null })).resolves.toBe(plaintext);

    ref = null; // already purged — nothing for teardown to do
  });
});

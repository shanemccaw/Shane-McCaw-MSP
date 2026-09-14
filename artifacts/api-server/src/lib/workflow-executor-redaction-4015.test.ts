/**
 * workflow-executor-redaction-4015.test.ts — Git #4015
 *
 * Persistence redaction must strip the break-glass CREDENTIAL and keep the
 * break-glass ACCOUNT IDENTITY. With `breakGlassAccountId` listed as sensitive,
 * the value pass collected the account's object id as a "secret" and scrubbed
 * every copy of it out of `wf_runs.payload`. A paused run then resumed with
 * `breakGlassUserId: "[redacted]"` (quickstart-v1.assign-global-admin-role posts
 * that as principalId), and admin-override reset `/users/[redacted]`.
 *
 * The live round trip (gate → override → real tenant reset) is
 * src/routes/break-glass-admin-override.live-verify.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
vi.mock("./logger.ts", () => {
  const n = () => {};
  const log = { info: n, warn: n, error: n, debug: n, fatal: n, trace: n, child: () => log };
  return { logger: log };
});

const { redactForPersistence } = await import("./workflow-executor.ts");

const OBJECT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PASSWORD = "Xq7!pLm2#rT9vW4z";

function gatedPayload(): Record<string, unknown> {
  // The shape wf_runs.payload has when the gate persists it: the map node's four
  // id casings, the create step's own echo under steps.*, and the credential.
  return {
    customerId: 1,
    generatedPassword: PASSWORD,
    breakglassUserId: OBJECT_ID,
    breakGlassUserId: OBJECT_ID,
    principalId: OBJECT_ID,
    breakGlassAccountId: OBJECT_ID,
    steps: {
      "tpl-create": { data: { id: OBJECT_ID, passwordProfile: { password: PASSWORD } } },
    },
  };
}

describe("#4015 — persistence redaction keeps the break-glass account identity", () => {
  it("keeps every copy of the account id that resume and admin-override read", () => {
    const out = redactForPersistence(gatedPayload(), gatedPayload());

    expect(out.breakGlassAccountId).toBe(OBJECT_ID);
    expect(out.breakGlassUserId).toBe(OBJECT_ID);
    expect(out.breakglassUserId).toBe(OBJECT_ID);
    expect(out.principalId).toBe(OBJECT_ID);
    expect((out.steps as Record<string, { data: { id: string } }>)["tpl-create"].data.id).toBe(OBJECT_ID);
  });

  it("still removes the credential everywhere, including echoes of its value", () => {
    const payload: Record<string, unknown> = { ...gatedPayload(), error: `Graph 400: body {"password":"${PASSWORD}"}` };
    const out = redactForPersistence(payload, payload);

    expect(out.generatedPassword).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toContain(PASSWORD);
    expect(out.error).toContain("[redacted]");
  });
});

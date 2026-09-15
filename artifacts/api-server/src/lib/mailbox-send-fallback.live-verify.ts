/**
 * mailbox-send-fallback.live-verify.ts — Git #4309
 *
 * LIVE round trip proving that `sendEmailForMspOrThrow` (artifacts/api-server/src/lib/mailer.ts)
 * actually delivers mail through the platform's existing single-tenant mechanism
 * (`GRAPH_CLIENT_ID`/`GRAPH_TENANT_ID`/`GRAPH_CLIENT_SECRET` + `getAccessToken()`/
 * `sendMailViaGraph()`) in today's real state — `MAILBOX_SEND_APP_CLIENT_ID` unset,
 * no dedicated mailbox-send app registration. Unit tests (msp-mailer.test.ts) mock
 * Graph entirely; this hits the real Microsoft Graph endpoint with real credentials
 * read directly out of `.env.local` (same safe per-line-regex read as
 * `scripts/config-state/db.mjs` — never a shell `source`), the same app that
 * already sends Shane's real daily platform mail.
 *
 *   npx vitest run --config vitest.live-verify.config.ts src/lib/mailbox-send-fallback.live-verify.ts
 *
 * Refuses to run if MAILBOX_SEND_APP_CLIENT_ID is actually set in `.env.local` —
 * that would validate a different (Path 1) mechanism, not this one.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function loadEnvVar(name: string): Promise<string | undefined> {
  if (process.env[name]) return process.env[name];
  const line = new RegExp(`^${name}\\s*=\\s*(.+)$`, "m");
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = await readFile(path.join(repoRoot, file), "utf8");
      const m = line.exec(txt);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* try the next candidate */ }
  }
  return undefined;
}

const LIVE_TEST_RECIPIENT = "shanemccaw.inbox2@gmail.com";

beforeAll(async () => {
  for (const name of ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_MAIL_USER_ID", "DATABASE_URL"]) {
    const value = await loadEnvVar(name);
    if (value) process.env[name] = value;
  }
});

describe("sendEmailForMspOrThrow — live platform-mailbox fallback (Git #4309)", () => {
  it("sends a real email through the platform's single-tenant Graph app when the dedicated mailbox-send app is not configured", async () => {
    const { mailboxSendAppCredentialsPresent } = await import("./mailbox-send-app.ts");
    const { graphCredentialsPresent } = await import("./graph.ts");
    const { sendEmailForMspOrThrow } = await import("./mailer.ts");

    expect(mailboxSendAppCredentialsPresent()).toBe(false);
    expect(graphCredentialsPresent()).toBe(true);
    expect(process.env.GRAPH_MAIL_USER_ID).toBeTruthy();

    await sendEmailForMspOrThrow(
      1,
      LIVE_TEST_RECIPIENT,
      "Git #4309 live-verify — platform mailbox fallback",
      "<p>Live-verify for Git #4309: this email was sent via the platform's single-tenant " +
        "Graph mailbox fallback (Path 2 of sendEmailForMspOrThrow) because " +
        "MAILBOX_SEND_APP_CLIENT_ID is unset.</p>",
      { skipWrapper: true },
    );
  });
});

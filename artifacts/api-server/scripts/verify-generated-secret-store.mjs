/**
 * verify-generated-secret-store.mjs — Git #1911
 *
 * Proves, live, that this environment's service principal can actually run the
 * full generated-credential lifecycle against Key Vault: set → read → update
 * tags → delete → PURGE. Without the purge step the "purge on acknowledgement"
 * promise is not real (soft-delete keeps the value recoverable for the vault's
 * retention window), so the purge is asserted, not assumed.
 *
 * It writes and then removes ONE throwaway secret under a dev-scoped name
 * prefix. It never touches a secret it did not create, and it never prints a
 * secret value.
 *
 *   node artifacts/api-server/scripts/verify-generated-secret-store.mjs
 *
 * Reads AZURE_* and GENERATED_SECRET_* from .env.local at the repo root.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../../.env.local");

/**
 * A build worktree's `node_modules` is junctioned from another checkout, and
 * those junctions can outlive the worktree they point at — leaving @azure/*
 * unresolvable here even though it is installed. Fall back to resolving from the
 * main checkout (the git common dir's parent) rather than failing on plumbing.
 */
async function loadAzure(specifier) {
  try {
    return await import(specifier);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    const gitCommonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: here, encoding: "utf8",
    }).trim();
    const mainCheckout = dirname(resolve(here, gitCommonDir));
    try {
      const req = createRequire(resolve(mainCheckout, "artifacts/api-server/package.json"));
      return await import(pathToFileURL(req.resolve(specifier)).href);
    } catch {
      // Last resort: the per-package symlinks are dangling too (they point into a
      // worktree that has since been swept). The pnpm content store itself is
      // intact, so resolve straight out of it.
      const store = resolve(mainCheckout, "node_modules/.pnpm");
      const mangled = `${specifier.replace("/", "+")}@`;
      const hit = readdirSync(store).find((e) => e.startsWith(mangled));
      if (!hit) throw err;
      const req = createRequire(resolve(store, hit, "node_modules", specifier, "package.json"));
      return import(pathToFileURL(req.resolve(specifier)).href);
    }
  }
}

const { SecretClient } = await loadAzure("@azure/keyvault-secrets");
const { ClientSecretCredential } = await loadAzure("@azure/identity");

for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const vaultUrl = process.env.GENERATED_SECRET_VAULT_URL ?? process.env.AZURE_KEY_VAULT_URL;
const prefix = (process.env.GENERATED_SECRET_NAME_PREFIX ?? "genc-dev").replace(/[^0-9a-zA-Z-]/g, "");

if (!vaultUrl) {
  console.error("FAIL: no GENERATED_SECRET_VAULT_URL / AZURE_KEY_VAULT_URL configured");
  process.exit(1);
}

const client = new SecretClient(
  vaultUrl,
  new ClientSecretCredential(process.env.AZURE_TENANT_ID, process.env.AZURE_CLIENT_ID, process.env.AZURE_CLIENT_SECRET),
);

const name = `${prefix}-selftest-c0-${randomBytes(16).toString("hex")}`;
const value = randomBytes(24).toString("base64");
const expiresOn = new Date(Date.now() + 3_600_000);

console.log(`vault:  ${vaultUrl}`);
console.log(`secret: ${name}`);

let failed = false;
const step = (label, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

try {
  const stored = await client.setSecret(name, value, {
    contentType: "text/plain",
    expiresOn,
    tags: { managedBy: "generated-secret-store", purpose: "selftest", customerId: "0", runId: "pending", issue: "1911" },
  });
  step("set     (write a generated credential)", Boolean(stored.properties.version), `version=${stored.properties.version}`);

  const read = await client.getSecret(name, { version: stored.properties.version });
  step("read    (reveal path resolves the reference)", read.value === value, "value matched, not printed");
  step("expiry  (secret has a hard end date)", read.properties.expiresOn instanceof Date, read.properties.expiresOn?.toISOString() ?? "none");

  await client.updateSecretProperties(name, stored.properties.version, {
    tags: { ...(read.properties.tags ?? {}), runId: "999999" },
  });
  const rebound = await client.getSecret(name);
  step("bind    (stamp the run id for the orphan sweep)", rebound.properties.tags?.runId === "999999");

  let listed = false;
  for await (const p of client.listPropertiesOfSecrets()) {
    if (p.name === name && p.tags?.managedBy === "generated-secret-store") { listed = true; break; }
  }
  step("list    (orphan sweep can enumerate by tag)", listed);

  const poller = await client.beginDeleteSecret(name);
  await poller.pollUntilDone();
  step("delete  (soft-delete)", true);

  await client.purgeDeletedSecret(name);
  step("purge   (permanent — NOT recoverable)", true);

  let stillThere = false;
  try {
    await client.getSecret(name);
    stillThere = true;
  } catch (err) {
    stillThere = err?.statusCode !== 404;
  }
  step("gone    (read after purge is 404)", !stillThere);
} catch (err) {
  step("lifecycle", false, `${err?.statusCode ?? ""} ${err?.name ?? ""}: ${err?.message ?? err}`);
  console.error("\nIf this is a 403 the service principal lacks the Key Vault data-plane role.");
  console.error("Do NOT work around it — report the missing permission (see #1911, #1875).");
}

process.exit(failed ? 1 : 0);

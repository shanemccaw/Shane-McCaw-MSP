/**
 * generated-secret-store.ts
 *
 * Git #1911 (implements #1900). The store for credentials the platform GENERATES
 * on the write path — today the break-glass Global Administrator password the
 * Config Pack orchestrator stamps onto a run, tomorrow anything else that mints a
 * credential a customer will later be handed.
 *
 * Shane's decision: **generated credentials go to Key Vault. The database holds a
 * reference, never the secret.**
 *
 * Why this module exists rather than reusing `azure-keyvault.ts` directly:
 *
 *  1. `azure-keyvault.ts` is the *integration credential* reader — long-lived
 *     secrets an operator provisioned by hand, read by name. These are the
 *     opposite: short-lived, machine-minted, one per run, and they must be
 *     purged the moment they are delivered. Mixing the two namespaces would make
 *     an orphan sweep unable to tell "safe to purge" from "the platform stops
 *     working if you delete this".
 *  2. The vault this writes to is deliberately a SEPARATE env var
 *     (`GENERATED_SECRET_VAULT_URL`) from `AZURE_KEY_VAULT_URL`. `ShaneMcCawConsulting`
 *     is the PRODUCTION vault; pointing the generated-credential store at it has
 *     to be an explicit act, never an accident of sharing one variable.
 *  3. Names are dev-scoped by default (`GENERATED_SECRET_NAME_PREFIX`, default
 *     `genc-dev`). An environment that forgets to configure the prefix writes
 *     dev-scoped names, not production ones — it fails safe.
 *
 * ## Lifecycle (the design in `docs/writepackmapping.md` finding 6)
 *
 *   store  → run payload + every persisted node output carry only the REFERENCE
 *   read   → the reveal path resolves the reference exactly once, server-side
 *   purge  → on acknowledgement, permanently (not soft-delete: `purgeDeletedSecret`)
 *
 * A secret that is never acknowledged still has an end: every secret is written
 * with an `expiresOn` (`GENERATED_SECRET_TTL_HOURS`, default 72h) and carries
 * tags the orphan sweep matches on. Runs 30166, 30171 and 30301 all died BEFORE
 * the gate — a run failing before delivery is the normal case, not the exception,
 * so `purgeGeneratedSecret` is called on the terminal path too.
 *
 * ## Never log the value
 *
 * Nothing in this module logs a secret value, at any level, on any path —
 * including error paths, which is the gap that produced #1900 in the first place.
 * Errors are logged with the secret NAME only.
 */

import { SecretClient } from "@azure/keyvault-secrets";
import { ClientSecretCredential } from "@azure/identity";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";

const log = logger.child({ channel: "audit" });

/** Key Vault secret names accept `[0-9a-zA-Z-]` only, 1–127 chars. */
const VAULT_NAME_RE = /^[0-9a-zA-Z-]{1,127}$/;

const DEFAULT_TTL_HOURS = 72;

/**
 * The reference that travels on the run payload and lands in the database in
 * place of the plaintext. Everything here is safe to persist and safe to show in
 * an admin run-history surface: it locates the secret, it is not the secret.
 */
export interface GeneratedSecretRef {
  kind: "azure-key-vault";
  vaultUrl: string;
  secretName: string;
  /** Immutable version identifier, so a later overwrite cannot silently change
   *  what a reveal resolves to. */
  version: string | null;
  /** ISO-8601. Informational on the reference; the vault holds the real expiry. */
  expiresOn: string;
  /** What minted it — `break-glass` today. */
  purpose: string;
  customerId: number;
}

export function isGeneratedSecretRef(value: unknown): value is GeneratedSecretRef {
  if (value == null || typeof value !== "object") return false;
  const r = value as Partial<GeneratedSecretRef>;
  return r.kind === "azure-key-vault"
    && typeof r.vaultUrl === "string"
    && typeof r.secretName === "string";
}

/** The vault the generated-credential store uses. Falls back to the platform
 *  vault only when explicitly unset, so a single-vault deployment still works. */
function vaultUrl(): string | null {
  return process.env.GENERATED_SECRET_VAULT_URL ?? process.env.AZURE_KEY_VAULT_URL ?? null;
}

/** Dev-scoped by default — see the header. Production must set this explicitly. */
function namePrefix(): string {
  const raw = process.env.GENERATED_SECRET_NAME_PREFIX ?? "genc-dev";
  return raw.replace(/[^0-9a-zA-Z-]/g, "");
}

function ttlHours(): number {
  const raw = Number(process.env.GENERATED_SECRET_TTL_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
}

/** True when this environment can actually store a generated credential. The
 *  callers treat `false` as fail-CLOSED — a credential is never written to the
 *  database as a fallback. */
export function generatedSecretStoreConfigured(): boolean {
  return Boolean(
    vaultUrl()
    && process.env.AZURE_TENANT_ID
    && process.env.AZURE_CLIENT_ID
    && process.env.AZURE_CLIENT_SECRET,
  );
}

function client(): SecretClient {
  const url = vaultUrl();
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!url || !tenantId || !clientId || !clientSecret) {
    throw new Error(
      "generated-secret-store: GENERATED_SECRET_VAULT_URL (or AZURE_KEY_VAULT_URL) plus AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET must be set",
    );
  }
  return new SecretClient(url, new ClientSecretCredential(tenantId, clientId, clientSecret));
}

/**
 * Build the secret's name. It has to be BOTH unambiguous (traceable back to the
 * tenant and, once known, the run) and non-guessable (an attacker who knows a
 * customer id must not be able to derive the name of their break-glass secret),
 * and it must never be reused across runs — hence 128 bits of randomness on the
 * end and no deterministic component that repeats.
 *
 * The run id is NOT in the name because the password is minted before the run row
 * exists; it is stamped on as a tag by `bindGeneratedSecretToRun` the moment the
 * run id is known, which is what the orphan sweep reads.
 */
function buildSecretName(purpose: string, customerId: number): string {
  const safePurpose = purpose.replace(/[^0-9a-zA-Z]/g, "").slice(0, 24) || "generated";
  const name = `${namePrefix()}-${safePurpose}-c${customerId}-${randomBytes(16).toString("hex")}`;
  if (!VAULT_NAME_RE.test(name)) {
    throw new Error(`generated-secret-store: computed an invalid Key Vault secret name for purpose '${purpose}'`);
  }
  return name;
}

/**
 * Write a freshly generated credential to Key Vault and return the reference to
 * persist in its place. The value is never returned, never logged, and never
 * written to the database by this module.
 */
export async function storeGeneratedSecret(opts: {
  value: string;
  purpose: string;
  customerId: number;
  /** Optional at mint time — stamped as a tag later via `bindGeneratedSecretToRun`. */
  runId?: number;
}): Promise<GeneratedSecretRef> {
  const secretName = buildSecretName(opts.purpose, opts.customerId);
  const expiresOn = new Date(Date.now() + ttlHours() * 3_600_000);

  try {
    const stored = await client().setSecret(secretName, opts.value, {
      contentType: "text/plain",
      expiresOn,
      tags: {
        managedBy: "generated-secret-store",
        purpose: opts.purpose,
        customerId: String(opts.customerId),
        runId: opts.runId != null ? String(opts.runId) : "pending",
        issue: "1911",
      },
    });

    log.info(
      { secretName, purpose: opts.purpose, customerId: opts.customerId, runId: opts.runId ?? null, expiresOn: expiresOn.toISOString() },
      "generated-secret-store: credential stored in Key Vault (value never persisted to the database)",
    );

    return {
      kind: "azure-key-vault",
      vaultUrl: vaultUrl()!,
      secretName,
      version: stored.properties.version ?? null,
      expiresOn: expiresOn.toISOString(),
      purpose: opts.purpose,
      customerId: opts.customerId,
    };
  } catch (err) {
    // Name only — an error from the vault SDK can echo request context, so the
    // value is never in scope here and never interpolated into the message.
    log.error(
      { err, secretName, purpose: opts.purpose, customerId: opts.customerId },
      "generated-secret-store: failed to store credential in Key Vault",
    );
    throw err;
  }
}

/**
 * Stamp the run id onto an already-stored secret's tags. Called as soon as the
 * run row exists so the orphan sweep can correlate a vault secret with the run
 * that owns it. Non-fatal: a missing tag degrades the sweep to the age/expiry
 * rule, it does not break delivery.
 */
export async function bindGeneratedSecretToRun(ref: GeneratedSecretRef, runId: number): Promise<void> {
  try {
    const c = client();
    const current = await c.getSecret(ref.secretName);
    const version = current.properties.version ?? ref.version;
    if (!version) {
      log.warn({ secretName: ref.secretName, runId }, "generated-secret-store: no secret version to bind the run id to (non-fatal)");
      return;
    }
    await c.updateSecretProperties(ref.secretName, version, {
      tags: { ...(current.properties.tags ?? {}), runId: String(runId) },
    });
  } catch (err) {
    log.warn({ err, secretName: ref.secretName, runId }, "generated-secret-store: failed to bind secret to run (non-fatal)");
  }
}

/**
 * Resolve a reference back to its plaintext. The ONLY read path — used by the
 * executor to rehydrate the in-memory run payload and by the reveal page. Returns
 * null when the secret is gone (already purged, or expired), which callers treat
 * as "no longer deliverable" rather than as an error.
 */
export async function readGeneratedSecret(ref: GeneratedSecretRef): Promise<string | null> {
  try {
    const secret = ref.version
      ? await client().getSecret(ref.secretName, { version: ref.version })
      : await client().getSecret(ref.secretName);
    return secret.value ?? null;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) {
      log.info({ secretName: ref.secretName }, "generated-secret-store: secret not present (purged or expired)");
      return null;
    }
    log.error({ err, secretName: ref.secretName }, "generated-secret-store: failed to read credential");
    return null;
  }
}

/**
 * Permanently remove a generated credential. Delete alone is not enough: the
 * vault has soft-delete on with a 90-day retention, so a "purge on
 * acknowledgement" secret that was only deleted would stay recoverable for three
 * months — which is the exact opposite of what the design promises the customer.
 * This deletes then PURGES.
 *
 * Idempotent, and never throws: it is called from terminal/cleanup paths where
 * failing loudly would be worse than the log line.
 */
export async function purgeGeneratedSecret(ref: GeneratedSecretRef, reason: string): Promise<boolean> {
  try {
    const c = client();
    const poller = await c.beginDeleteSecret(ref.secretName);
    await poller.pollUntilDone();
    try {
      await c.purgeDeletedSecret(ref.secretName);
    } catch (purgeErr) {
      // Purge protection, if it is ever turned on for this vault, makes the
      // permanent purge impossible. Say so plainly rather than reporting success.
      log.warn(
        { err: purgeErr, secretName: ref.secretName, reason },
        "generated-secret-store: secret deleted but could NOT be purged — it stays recoverable until the soft-delete retention expires",
      );
      return false;
    }
    log.info({ secretName: ref.secretName, reason }, "generated-secret-store: credential purged from Key Vault");
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) return true; // already gone — the desired end state
    log.error({ err, secretName: ref.secretName, reason }, "generated-secret-store: failed to purge credential");
    return false;
  }
}

/** One orphan the sweep found, with the reason it is considered abandoned. */
export interface OrphanedGeneratedSecret {
  secretName: string;
  runId: number | null;
  customerId: number | null;
  purpose: string | null;
  reason: "run_terminal" | "expired" | "unbound_and_stale";
  createdOn: string | null;
}

/**
 * List every generated credential this store owns that no longer has a live run
 * behind it. Pure read — `purgeOrphanedGeneratedSecrets` (the workflow node) is
 * what acts on the result.
 *
 * `isRunLive` is injected rather than queried here so this module never imports
 * the workflow tables, which would make it a cycle.
 */
export async function findOrphanedGeneratedSecrets(opts: {
  isRunLive: (runId: number) => Promise<boolean>;
  /** A secret whose run id was never stamped is only an orphan once it is older
   *  than this — otherwise the sweep would race a run that is still being fired. */
  unboundGraceMs?: number;
}): Promise<OrphanedGeneratedSecret[]> {
  const graceMs = opts.unboundGraceMs ?? 60 * 60 * 1000;
  const now = Date.now();
  const orphans: OrphanedGeneratedSecret[] = [];

  for await (const props of client().listPropertiesOfSecrets()) {
    if (props.tags?.managedBy !== "generated-secret-store") continue;

    const secretName = props.name;
    const rawRunId = props.tags?.runId;
    const runId = rawRunId && rawRunId !== "pending" ? Number(rawRunId) : null;
    const customerId = props.tags?.customerId ? Number(props.tags.customerId) : null;
    const purpose = props.tags?.purpose ?? null;
    const createdOn = props.createdOn ? props.createdOn.toISOString() : null;

    if (props.expiresOn && props.expiresOn.getTime() <= now) {
      orphans.push({ secretName, runId, customerId, purpose, reason: "expired", createdOn });
      continue;
    }

    if (runId == null) {
      const age = props.createdOn ? now - props.createdOn.getTime() : Number.POSITIVE_INFINITY;
      if (age > graceMs) {
        orphans.push({ secretName, runId: null, customerId, purpose, reason: "unbound_and_stale", createdOn });
      }
      continue;
    }

    if (!(await opts.isRunLive(runId))) {
      orphans.push({ secretName, runId, customerId, purpose, reason: "run_terminal", createdOn });
    }
  }

  return orphans;
}

/** Purge by name — used by the sweep, which works from vault listings rather
 *  than from a reference that travelled on a payload. */
export async function purgeGeneratedSecretByName(secretName: string, reason: string): Promise<boolean> {
  return purgeGeneratedSecret(
    { kind: "azure-key-vault", vaultUrl: vaultUrl() ?? "", secretName, version: null, expiresOn: "", purpose: "", customerId: 0 },
    reason,
  );
}

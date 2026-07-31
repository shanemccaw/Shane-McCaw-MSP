/**
 * ps-execution-client.ts
 *
 * HTTP client for the `ps-execution` container (services/ps-execution) — the
 * platform's only unattended PowerShell execution surface, used for
 * Connect-IPPSSession-backed checks (DLP/Label policies, #208) that have no
 * Graph REST equivalent.
 *
 * Kept separate from graph.ts per #209's approved design: the auth/error
 * semantics genuinely don't overlap. This is not a Graph token — it's a
 * shared bearer secret gating the container (#198) — and PsExecutionError is
 * not ConsentRevokedError/LicenseGapError. A PS execution failure (bad cert,
 * unreachable container, cmdlet error) has nothing to do with a customer's
 * Graph admin-consent state and must never be conflated with one.
 *
 * Contract, locked by #209/#210's real (verified) implementation:
 *   POST { cmdletKey, params } -> one synchronous JSON body.
 *   - cmdletKey resolves server-side (container-side) to an entry in a fixed,
 *     code-owned allowlist ($script:CmdletCatalog in entrypoint.ps1) — never
 *     an arbitrary script string. An unrecognized key is the container's own
 *     400 "unknown_cmdlet" response, not something validated client-side.
 *   - params fill that cmdlet's allowed parameter values only, never control
 *     flow. `Organization` is the reserved tenant-identity field
 *     Connect-IPPSSession needs — always required.
 *   - Response body: a JSON array (cmdlet returned multiple items) or a bare
 *     JSON object (single item) — no pagination/nextLink concept. Normalized
 *     here to always return an `items` array, mirroring the same
 *     "non-collection response = one item" rule graphFetchPaginated uses.
 */

import { getSecretValue } from "./azure-keyvault";
import { logger } from "./logger";
const log = logger.child({ channel: "integration.ps-execution" });

const BEARER_TOKEN_SECRET_NAME = process.env.PS_EXECUTION_BEARER_TOKEN_SECRET_NAME ?? "ps-execution-bearer-token";

function getContainerUrl(): string {
  const url = process.env.PS_EXECUTION_CONTAINER_URL;
  if (!url) throw new Error("PS_EXECUTION_CONTAINER_URL must be set");
  return url.replace(/\/+$/, "");
}

// The bearer token is a static Key Vault secret (#198) — cached in-process
// rather than re-fetched on every check, and refreshed once on a 401 in case
// it was rotated, mirroring the container's own "read once, hold in memory"
// treatment of its own secrets.
let cachedBearerToken: string | null = null;

async function getBearerToken(forceRefresh = false): Promise<string> {
  if (cachedBearerToken && !forceRefresh) return cachedBearerToken;
  cachedBearerToken = await getSecretValue(BEARER_TOKEN_SECRET_NAME);
  return cachedBearerToken;
}

/**
 * Error thrown by ps-execution container calls. Distinct from graph.ts's
 * ConsentRevokedError/LicenseGapError by construction — this function never
 * touches Graph, so neither of those classes can originate here.
 *
 * `kind` is the narrower 3-value discriminator #209's design settled on:
 *   - "unreachable": network failure, or a 5xx that isn't the container's own
 *     Connect-IPPSSession auth_failed case.
 *   - "auth_failed": the container's Connect-IPPSSession/cert failure (502),
 *     or our own bearer token being rejected (401). NEVER calls
 *     markTenantConsentRevoked() — a cert/permission problem on our side is a
 *     completely different failure domain from a customer revoking Graph
 *     OAuth consent.
 *   - "script_error": the resolved cmdlet itself threw (500), or the request
 *     was malformed/misconfigured (400 bad_request/unknown_cmdlet, 405) —
 *     grouped here because both are defects in the check definition itself,
 *     not a tenant-auth or network condition.
 */
export class PsExecutionError extends Error {
  readonly kind: "unreachable" | "auth_failed" | "script_error";
  readonly cmdletKey: string;
  /** The container's own `error` field (e.g. "unknown_cmdlet", "script_error"), when present. */
  readonly containerErrorKind?: string;
  readonly rawBody?: string;

  constructor(
    kind: PsExecutionError["kind"],
    cmdletKey: string,
    message: string,
    opts?: { containerErrorKind?: string; rawBody?: string },
  ) {
    super(message);
    this.name = "PsExecutionError";
    this.kind = kind;
    this.cmdletKey = cmdletKey;
    this.containerErrorKind = opts?.containerErrorKind;
    this.rawBody = opts?.rawBody;
  }
}

export interface PsExecutionResult {
  items: unknown[];
  rawResponse: unknown;
}

/**
 * Calls the ps-execution container once with the resolved cmdletKey/params.
 * Callers (monitor-executor.ts's runPowerShellCheck) are responsible for
 * resolving tenant-identity placeholders into `params` before calling this —
 * this function is a thin, tenant-agnostic HTTP client.
 */
export async function callPsExecution(
  cmdletKey: string,
  params: Record<string, unknown>,
): Promise<PsExecutionResult> {
  const containerUrl = getContainerUrl();
  let bearerToken = await getBearerToken();

  const doRequest = (token: string) =>
    fetch(containerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cmdletKey, params }),
    });

  let res: Response;
  try {
    res = await doRequest(bearerToken);
  } catch (err) {
    throw new PsExecutionError(
      "unreachable",
      cmdletKey,
      `Could not reach the ps-execution container: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 401) {
    bearerToken = await getBearerToken(true);
    try {
      res = await doRequest(bearerToken);
    } catch (err) {
      throw new PsExecutionError(
        "unreachable",
        cmdletKey,
        `Could not reach the ps-execution container on bearer-token retry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    let containerErrorKind: string | undefined;
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
      containerErrorKind = parsed.error;
      message = parsed.message ?? bodyText;
    } catch {
      // Non-JSON error body — keep the raw text as the message.
    }

    const kind: PsExecutionError["kind"] =
      containerErrorKind === "auth_failed" || res.status === 401
        ? "auth_failed"
        : res.status >= 500 && containerErrorKind !== "script_error"
          ? "unreachable"
          : "script_error";

    log.error({ cmdletKey, status: res.status, containerErrorKind }, "ps-execution: request failed");
    throw new PsExecutionError(kind, cmdletKey, message || `ps-execution container returned ${res.status}`, {
      containerErrorKind,
      rawBody: bodyText,
    });
  }

  const bodyText = await res.text();
  let parsed: unknown;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : [];
  } catch {
    throw new PsExecutionError(
      "unreachable",
      cmdletKey,
      `ps-execution container returned a non-JSON 200 body: ${bodyText.slice(0, 500)}`,
    );
  }

  // Same "non-collection response = one item" rule graphFetchPaginated already
  // uses for symmetry — the container's contract (#210) mirrors it exactly.
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return { items, rawResponse: parsed };
}

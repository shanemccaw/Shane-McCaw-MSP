/**
 * ps-execution-revision.ts
 *
 * "Which ps-execution revision is actually serving right now?" — the api-side
 * counterpart to the BuildConsole `deployPsExecution` tooling (#1277).
 *
 * WHY THIS EXISTS (#1482 / the #1434 failure mode):
 *   #1482 iterates on a bug in the ps-execution container: build a candidate
 *   image, deploy it to `ca-ps-execution-dev`, then verify the fix. That loop is
 *   only sound if the verifier can prove it is testing the revision it just
 *   deployed and not a stale one still serving traffic. Asserting a fix against a
 *   stale revision is exactly the #1434 "looked done but wasn't" failure. This
 *   module gives product code (and a #1482 verifier running inside the api-server)
 *   an authoritative read of the live revision straight from the running
 *   container's own `/healthz` self-report — the code that is genuinely executing,
 *   not the Azure control plane's separate notion of the active revision.
 *
 * The container's `/healthz` route (services/ps-execution/entrypoint.ps1, #1277)
 * is deliberately UNAUTHENTICATED and returns only deployment metadata (revision
 * name, image tag, start time) — never tenant data — so this read needs no bearer
 * token. Dev/prod endpoint selection reuses the SAME #1385 guard the real cmdlet
 * client uses (getPsExecutionContainerUrl): a dev context can never cross over to
 * the production container, and an unset dev URL throws rather than falling back.
 */

import { getPsExecutionContainerUrl } from "./ps-execution-client";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

export interface PsExecutionServingRevision {
  /** The exact Azure Container Apps revision name serving the request (e.g. `ca-ps-execution-dev--dev1277a`). */
  revision: string;
  /** The Container App name the running container belongs to. */
  containerApp: string;
  /** The image ref the deploy tool stamped into the container, or "unknown" if not set. */
  image: string;
  /** ISO-8601 UTC time the serving container process started. */
  startedAtUtc: string;
  /** The container URL that was queried (dev or prod, chosen by #1385 tiering). */
  url: string;
}

/**
 * Reads the live ps-execution revision from the container's `/healthz` route.
 *
 * Throws on an unreachable container or a non-200/non-JSON response — a caller
 * verifying a just-deployed fix MUST NOT silently treat "couldn't read the
 * revision" as "the right revision is serving" (that would reintroduce the exact
 * stale-verify gap this exists to close).
 */
export async function getServingPsExecutionRevision(): Promise<PsExecutionServingRevision> {
  const containerUrl = getPsExecutionContainerUrl();
  const healthUrl = `${containerUrl}/healthz`;

  let res: Response;
  try {
    res = await fetch(healthUrl, { method: "GET" });
  } catch (err) {
    log.error({ healthUrl, err: err instanceof Error ? err.message : String(err) }, "ps-execution /healthz unreachable");
    throw new Error(
      `Could not reach the ps-execution container /healthz at ${healthUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    log.error({ healthUrl, status: res.status }, "ps-execution /healthz returned non-200");
    throw new Error(`ps-execution /healthz at ${healthUrl} returned ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  let parsed: Partial<PsExecutionServingRevision>;
  try {
    parsed = JSON.parse(bodyText) as Partial<PsExecutionServingRevision>;
  } catch {
    log.error({ healthUrl, bodyPreview: bodyText.slice(0, 200) }, "ps-execution /healthz returned non-JSON body");
    throw new Error(`ps-execution /healthz at ${healthUrl} returned a non-JSON body: ${bodyText.slice(0, 300)}`);
  }

  const result: PsExecutionServingRevision = {
    revision: parsed.revision ?? "unknown",
    containerApp: parsed.containerApp ?? "unknown",
    image: parsed.image ?? "unknown",
    startedAtUtc: parsed.startedAtUtc ?? "unknown",
    url: containerUrl,
  };

  log.info(
    { revision: result.revision, containerApp: result.containerApp, image: result.image, url: result.url },
    "ps-execution serving revision read",
  );
  return result;
}

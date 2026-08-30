/**
 * ps-capability-survey.ts — driver for Git #1793's app-only PowerShell
 * capability survey.
 *
 * WHAT IT DOES
 * ------------
 * Walks the REAL exported cmdlet surface of each ps-execution session type
 * (`exchange`, `compliance`, `teams`) against a testbed tenant, executing the
 * read-safe subset live and recording, per cmdlet, the literal outcome and —
 * for successes — the real output property names. Results land in
 * `ps_capability_survey_runs` / `ps_capability_survey_results` so the survey is
 * queryable and re-runnable, not just a markdown file that goes stale.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not decide anything. #1793's explicit non-goal: no `monitor_checks`
 * row is derived from a survey. This writes measurements only.
 *
 * WHERE THE DANGEROUS PART LIVES — NOT HERE
 * -----------------------------------------
 * This script never names a cmdlet to run. It POSTs a `cmdletKey` of
 * `survey-probe-<session>` plus three integers (Skip / Take / BudgetSeconds).
 * Which commands are enumerated, which are read-safe enough to execute, and
 * how they are invoked is decided entirely inside the container by
 * `services/ps-execution/survey.ps1` — see that file's header for the four
 * read-safety gates. That is what keeps #209's what-code-runs-stays-code-owned
 * boundary intact while still answering a question that needs live execution.
 *
 * It also never holds the ps-execution bearer secret: every call goes through
 * `POST /api/simulator/ps-execution/cmdlet` (#1404), which fetches that secret
 * server-side and re-applies the #965 testbed gate, exactly as a real scan does.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run ps-capability-survey
 *   pnpm --filter @workspace/scripts run ps-capability-survey -- --session teams
 *   pnpm --filter @workspace/scripts run ps-capability-survey -- --run 3 --session exchange
 *
 * Env (read from the process, or from .env.local at the repo root):
 *   DATABASE_URL               — the local Postgres the results are written to.
 *   BUILD_TRACKER_INGEST_TOKEN — auth for the api-server simulator route.
 *   API_BASE_URL               — default http://localhost:8080
 *   SURVEY_TENANT_ID           — default 1 (the testbed customer).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Minimal .env.local reader — this script is run by hand, not by the server. */
function loadEnvLocal(): void {
  const file = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvLocal();

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const INGEST_TOKEN = process.env.BUILD_TRACKER_INGEST_TOKEN ?? "";
const TENANT_ID = process.env.SURVEY_TENANT_ID ?? "1";
const HEALTHZ_URL =
  process.env.PS_EXECUTION_HEALTHZ_URL ??
  "https://ca-ps-execution-dev.proudstone-22013f89.eastus2.azurecontainerapps.io/healthz";

const SESSION_TYPES = ["compliance", "exchange", "teams"] as const;
type SessionType = (typeof SESSION_TYPES)[number];

/**
 * Batch sizing. The container clamps BudgetSeconds itself; these are the
 * client-side asks. TAKE starts high because most of an inventory is
 * `not_attempted` (rejected by a read-safety gate at ~0ms) and only the
 * eligible minority actually costs time.
 */
const INITIAL_TAKE = Number(process.env.SURVEY_TAKE ?? 60);
/**
 * The ask, not the ceiling — the container clamps this against its OWN child
 * timeout (`PS_EXECUTION_CHILD_TIMEOUT_SECONDS`), which is the only place that
 * knows the real limit. Overridable so a session can trade batch size against
 * how much a killed batch costs, without a redeploy.
 */
const BUDGET_SECONDS = Number(process.env.SURVEY_BUDGET_SECONDS ?? 150);

/**
 * The local api-server is restarted out from under this script routinely — the
 * dev-server coordinator restarts it whenever ANY concurrent build completes,
 * and a full survey runs for far longer than the gap between those. That is
 * not a survey result about a cmdlet, and the first version of this script
 * wrongly recorded it as one: 36 cmdlets landed as `error` whose real cause was
 * "the api-server was down", which is precisely the false-negative table #1793
 * warns is worse than no table.
 *
 * So a transport failure is now NEVER written as a row. It is retried, and if
 * it never clears the run is failed honestly instead of completed with fiction.
 */
const UNREACHABLE_RETRY_ATTEMPTS = 60;
const UNREACHABLE_RETRY_DELAY_MS = 15_000;

/** Hard per-request deadline — see the `signal:` comment in callCmdlet. */
const REQUEST_TIMEOUT_MS = Number(process.env.SURVEY_REQUEST_TIMEOUT_MS ?? 300_000);

class ApiServerUnreachableError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface InventoryRow {
  Name: string;
  Verb: string | null;
  Noun: string | null;
  CommandType: string | null;
  ModuleName: string | null;
  SupportsShouldProcess: boolean;
  MinMandatoryParamCount: number;
  MandatoryParamNames: string[] | null;
  ParameterCount: number;
  Eligible: boolean;
  IneligibleReason: string | null;
}

interface ProbeRow {
  Name: string;
  Verb: string | null;
  Noun: string | null;
  ModuleName: string | null;
  Status: string;
  ErrorMessage: string | null;
  ItemCount: number | null;
  PropertyNames: string[] | null;
  TypeName: string | null;
  ElapsedMs: number;
  InvokedWith: string | null;
  Attempted: boolean;
  Reason: string | null;
}

interface CmdletCallOk<T> {
  ok: true;
  payload: T;
  /** The org the SERVER connected with — the gated testbed tenant's own domain. */
  organization: string | null;
  elapsedMs: number;
}
interface CmdletCallFail {
  ok: false;
  /** The route's own discriminator when it has one (auth_failed / script_error / …). */
  kind: string | null;
  error: string;
  elapsedMs: number;
}
type CmdletCall<T> = CmdletCallOk<T> | CmdletCallFail;

/**
 * One call to the ps-execution cmdlet route. Returns a settled result rather
 * than throwing, because a failed batch is DATA here — "this session type
 * could not be surveyed, and here is the verbatim reason" is exactly the kind
 * of row #1793 wants recorded, not an exception that aborts the run.
 */
async function callCmdlet<T>(cmdletKey: string, params: Record<string, unknown>): Promise<CmdletCall<T>> {
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/simulator/ps-execution/cmdlet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${INGEST_TOKEN}` },
      body: JSON.stringify({ cmdletKey, tenantId: TENANT_ID, params }),
      // A hard client-side deadline. Observed live: the container's parent
      // process stopped answering after killing a hung child, the api-server's
      // own fetch to it never returned, and this driver sat on a single request
      // for over half an hour with no output — indistinguishable from slow work.
      // Neither the container's child timeout nor undici's defaults bounded it,
      // so the bound has to be here. Comfortably above the container's own
      // child timeout (200s) plus a Connect-* handshake, so a legitimately slow
      // batch is never cut off by this.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // A blown REQUEST_TIMEOUT_MS deadline is NOT the same condition as a
    // restarting api-server, and must not be retried as one: the server
    // answered the connection and then went quiet, which is a real failure of
    // that batch. Returning a non-"unreachable" kind sends it down the
    // isolation-walk path so the responsible cmdlet gets named, instead of the
    // driver waiting out a restart that is not happening.
    const isDeadline = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (isDeadline) {
      return {
        ok: false,
        kind: "request_timeout",
        error: `no response within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s (client-side deadline; the container never answered)`,
        elapsedMs: Date.now() - startedAt,
      };
    }
    return { ok: false, kind: "unreachable", error: `api-server unreachable: ${String(err)}`, elapsedMs: Date.now() - startedAt };
  }

  const bodyText = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return { ok: false, kind: null, error: `non-JSON response (HTTP ${res.status}): ${bodyText.slice(0, 500)}`, elapsedMs: Date.now() - startedAt };
  }

  if (!res.ok || body.ok !== true) {
    return {
      ok: false,
      kind: (body.kind as string | undefined) ?? (body.containerErrorKind as string | undefined) ?? null,
      error: (body.error as string | undefined) ?? `HTTP ${res.status}`,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // A Script catalog entry returns ONE object; the route normalizes a
  // non-collection response to a single-item `items` array (its documented
  // contract), so the survey envelope is items[0].
  const items = (body.items as unknown[] | undefined) ?? [];
  if (items.length !== 1) {
    return { ok: false, kind: null, error: `expected exactly one survey envelope, got ${items.length}`, elapsedMs: Date.now() - startedAt };
  }
  return {
    ok: true,
    payload: items[0] as T,
    organization: (body.organization as string | undefined) ?? null,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * The organization the server actually connected with, captured off the first
 * successful call and written back to the run row. Never assumed: the #965
 * gate derives it from the gated tenant's own domain, and recording anything
 * this script guessed would be fabricating the run's own provenance.
 */
let observedOrganization: string | null = null;

/**
 * Wraps `callCmdlet` so a DOWN api-server is waited out rather than recorded.
 * Only `unreachable` is retried — a real container failure (auth_failed,
 * script_error, a killed child) is a genuine observation and is returned to the
 * caller to be written as a row.
 */
async function callCmdletWaitingOutRestarts<T>(
  cmdletKey: string,
  params: Record<string, unknown>,
): Promise<CmdletCall<T>> {
  for (let attempt = 1; attempt <= UNREACHABLE_RETRY_ATTEMPTS; attempt++) {
    const result = await callCmdlet<T>(cmdletKey, params);
    if (result.ok || result.kind !== "unreachable") return result;
    if (attempt === 1) {
      console.warn(`  api-server unreachable — waiting for it to come back (this is a restart, not a cmdlet result)`);
    }
    await sleep(UNREACHABLE_RETRY_DELAY_MS);
  }
  throw new ApiServerUnreachableError(
    `api-server at ${API_BASE_URL} stayed unreachable across ${UNREACHABLE_RETRY_ATTEMPTS} attempts ` +
      `(~${Math.round((UNREACHABLE_RETRY_ATTEMPTS * UNREACHABLE_RETRY_DELAY_MS) / 60000)} minutes). ` +
      `Refusing to record transport failures as per-cmdlet survey results.`,
  );
}

/**
 * Maps a whole-batch failure onto the per-cmdlet outcome vocabulary. Used when
 * a batch dies as a unit (the container could not connect, or the child was
 * killed by its own timeout) — every cmdlet in that window inherits the
 * batch's real reason rather than silently disappearing from the survey.
 */
function batchFailureStatus(kind: string | null, error: string): string {
  if (kind === "auth_failed") return "auth_failed";
  if (kind === "cmdlet_unavailable") return "cmdlet_unavailable";
  // Everything else — the container's own child timeout, a client-side
  // deadline, a script_error — is an `error` against the cmdlet, always carrying
  // the verbatim reason so a reader can tell WHICH kind of failure it was.
  return "error";
}

interface ResultRow {
  sessionType: SessionType;
  moduleName: string | null;
  cmdletName: string;
  verb: string | null;
  noun: string | null;
  commandType: string | null;
  status: string;
  reason: string | null;
  errorMessage: string | null;
  itemCount: number | null;
  elapsedMs: number | null;
  invokedWith: string | null;
  outputTypeName: string | null;
  propertyNames: string[] | null;
  supportsShouldProcess: boolean | null;
  minMandatoryParamCount: number | null;
  mandatoryParamNames: string[] | null;
  parameterCount: number | null;
}

async function upsertResults(pool: pg.Pool, runId: number, rows: ResultRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(
        `INSERT INTO ps_capability_survey_results
           (run_id, session_type, module_name, cmdlet_name, verb, noun, command_type, status, reason,
            error_message, item_count, elapsed_ms, invoked_with, output_type_name, property_names,
            supports_should_process, min_mandatory_param_count, mandatory_param_names, parameter_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (run_id, session_type, cmdlet_name) DO UPDATE SET
           module_name = EXCLUDED.module_name,
           verb = EXCLUDED.verb,
           noun = EXCLUDED.noun,
           command_type = EXCLUDED.command_type,
           status = EXCLUDED.status,
           reason = EXCLUDED.reason,
           error_message = EXCLUDED.error_message,
           item_count = EXCLUDED.item_count,
           elapsed_ms = EXCLUDED.elapsed_ms,
           invoked_with = EXCLUDED.invoked_with,
           output_type_name = EXCLUDED.output_type_name,
           property_names = EXCLUDED.property_names,
           supports_should_process = EXCLUDED.supports_should_process,
           min_mandatory_param_count = EXCLUDED.min_mandatory_param_count,
           mandatory_param_names = EXCLUDED.mandatory_param_names,
           parameter_count = EXCLUDED.parameter_count,
           observed_at = now()`,
        [
          runId, r.sessionType, r.moduleName, r.cmdletName, r.verb, r.noun, r.commandType, r.status, r.reason,
          r.errorMessage, r.itemCount, r.elapsedMs, r.invokedWith, r.outputTypeName,
          r.propertyNames ? JSON.stringify(r.propertyNames) : null,
          r.supportsShouldProcess, r.minMandatoryParamCount,
          r.mandatoryParamNames ? JSON.stringify(r.mandatoryParamNames) : null,
          r.parameterCount,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Surveys one session type end to end, writing results as each batch settles. */
async function surveySession(pool: pg.Pool, runId: number, sessionType: SessionType): Promise<void> {
  console.log(`\n=== ${sessionType} ===`);

  const inventoryCall = await callCmdletWaitingOutRestarts<{ TotalCommands: number; EligibleCount: number; Modules: { Name: string }[]; Rows: InventoryRow[] }>(
    `survey-list-commands-${sessionType}`,
    {},
  );

  if (!inventoryCall.ok) {
    // A session type whose surface cannot even be ENUMERATED is the single
    // most important thing this survey can report, so it is recorded as a real
    // row rather than a console warning that evaporates.
    console.error(`  inventory FAILED (${inventoryCall.kind}): ${inventoryCall.error}`);
    await upsertResults(pool, runId, [
      {
        sessionType, moduleName: null, cmdletName: `(session unavailable: ${sessionType})`,
        verb: null, noun: null, commandType: null,
        status: batchFailureStatus(inventoryCall.kind, inventoryCall.error),
        reason: "the session's own command surface could not be enumerated, so no cmdlet in it was surveyed",
        errorMessage: inventoryCall.error, itemCount: null, elapsedMs: inventoryCall.elapsedMs,
        invokedWith: `survey-list-commands-${sessionType}`, outputTypeName: null, propertyNames: null,
        supportsShouldProcess: null, minMandatoryParamCount: null, mandatoryParamNames: null, parameterCount: null,
      },
    ]);
    return;
  }

  if (!observedOrganization) observedOrganization = inventoryCall.organization;

  const inventory = inventoryCall.payload;
  const byName = new Map<string, InventoryRow>();
  for (const row of inventory.Rows) byName.set(row.Name, row);
  console.log(
    `  modules: ${inventory.Modules.map((m) => m.Name).join(", ")} | commands: ${inventory.TotalCommands} | eligible: ${inventory.EligibleCount} (${inventoryCall.elapsedMs}ms)`,
  );

  const total = inventory.TotalCommands;
  let skip = 0;
  let take = INITIAL_TAKE;

  while (skip < total) {
    const batch = await callCmdletWaitingOutRestarts<{ Processed: number; StoppedEarly: boolean; TotalCommands: number; Rows: ProbeRow[] }>(
      `survey-probe-${sessionType}`,
      { Skip: skip, Take: take, BudgetSeconds: BUDGET_SECONDS },
    );

    if (!batch.ok) {
      // A batch dies as a unit when ONE cmdlet in it hangs past the container's
      // child timeout — the child is killed, so every result in that window is
      // lost, including the ones that had already succeeded.
      //
      // Drop straight to take=1 rather than halving. Halving costs one FULL
      // child timeout (200s) per step and needs ~log2(take) of them before the
      // window is narrow enough to exclude the offender; walking forward at
      // take=1 and ramping back up on each success costs one cheap round trip
      // per command instead, and names the offender exactly when the
      // batch-of-one is the one that dies.
      if (take > 1) {
        console.warn(`  batch ${skip}..${skip + take - 1} failed (${batch.kind}); dropping to take=1 to isolate`);
        take = 1;
        continue;
      }
      // The container's window is the SAME deterministically sorted inventory
      // this list came from, so index `skip` names the exact cmdlet that died.
      const name = inventory.Rows[skip]?.Name ?? `(index ${skip})`;
      console.warn(`  ${name}: batch-of-one failed — ${batch.error}`);
      await upsertResults(pool, runId, [
        {
          sessionType, moduleName: inventory.Rows[skip]?.ModuleName ?? null, cmdletName: name,
          verb: inventory.Rows[skip]?.Verb ?? null, noun: inventory.Rows[skip]?.Noun ?? null,
          commandType: inventory.Rows[skip]?.CommandType ?? null,
          status: batchFailureStatus(batch.kind, batch.error),
          reason: "the container request carrying only this cmdlet failed as a unit (child timeout or transport failure), so no per-cmdlet outcome was observed",
          errorMessage: batch.error, itemCount: null, elapsedMs: batch.elapsedMs,
          invokedWith: null, outputTypeName: null, propertyNames: null,
          supportsShouldProcess: inventory.Rows[skip]?.SupportsShouldProcess ?? null,
          minMandatoryParamCount: inventory.Rows[skip]?.MinMandatoryParamCount ?? null,
          mandatoryParamNames: inventory.Rows[skip]?.MandatoryParamNames ?? null,
          parameterCount: inventory.Rows[skip]?.ParameterCount ?? null,
        },
      ]);
      skip += 1;
      // Stay at 1 and ramp back up on success (below) — the next command could
      // hang too, and jumping straight back to 60 would re-pay a full timeout.
      continue;
    }

    const payload = batch.payload;
    const rows: ResultRow[] = payload.Rows.map((p) => {
      const meta = byName.get(p.Name);
      return {
        sessionType,
        moduleName: p.ModuleName ?? meta?.ModuleName ?? null,
        cmdletName: p.Name,
        verb: p.Verb ?? meta?.Verb ?? null,
        noun: p.Noun ?? meta?.Noun ?? null,
        commandType: meta?.CommandType ?? null,
        status: p.Status,
        reason: p.Reason,
        errorMessage: p.ErrorMessage,
        itemCount: p.ItemCount,
        elapsedMs: p.ElapsedMs,
        invokedWith: p.InvokedWith,
        outputTypeName: p.TypeName,
        propertyNames: p.PropertyNames && p.PropertyNames.length > 0 ? p.PropertyNames : null,
        supportsShouldProcess: meta?.SupportsShouldProcess ?? null,
        minMandatoryParamCount: meta?.MinMandatoryParamCount ?? null,
        mandatoryParamNames: meta?.MandatoryParamNames ?? null,
        parameterCount: meta?.ParameterCount ?? null,
      };
    });
    await upsertResults(pool, runId, rows);

    const attempted = rows.filter((r) => r.status !== "not_attempted");
    const okCount = rows.filter((r) => r.status === "ok").length;
    console.log(
      `  ${skip}..${skip + payload.Processed - 1} of ${total}: ${payload.Processed} rows (${attempted.length} executed, ${okCount} ok) in ${batch.elapsedMs}ms${payload.StoppedEarly ? " [budget stop]" : ""}`,
    );

    if (payload.Processed === 0) {
      console.warn(`  batch at skip=${skip} processed nothing; advancing by 1 to avoid a stall`);
      skip += 1;
      continue;
    }
    skip += payload.Processed;
    // Geometric ramp back to the full batch size after an isolation walk.
    take = Math.min(INITIAL_TAKE, Math.max(1, take) * 2);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sessionArg = args.includes("--session") ? args[args.indexOf("--session") + 1] : null;
  const runArg = args.includes("--run") ? Number(args[args.indexOf("--run") + 1]) : null;

  const sessions: SessionType[] = sessionArg
    ? [sessionArg as SessionType]
    : [...SESSION_TYPES];
  for (const s of sessions) {
    if (!SESSION_TYPES.includes(s)) throw new Error(`unknown session type '${s}' (expected: ${SESSION_TYPES.join(", ")})`);
  }

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!INGEST_TOKEN) throw new Error("BUILD_TRACKER_INGEST_TOKEN is required (the api-server simulator route's auth)");

  // The revision that actually served the run. Recorded on the run row because
  // a survey result is only meaningful against the code that produced it.
  let revision: string | null = null;
  let image: string | null = null;
  try {
    const health = (await (await fetch(HEALTHZ_URL)).json()) as { revision?: string; image?: string };
    revision = health.revision ?? null;
    image = health.image ?? null;
  } catch (err) {
    console.warn(`could not read container /healthz: ${String(err)}`);
  }
  console.log(`ps-execution revision: ${revision ?? "(unknown)"} | image: ${image ?? "(unknown)"}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let runId: number;
    if (runArg) {
      runId = runArg;
      console.log(`resuming survey run #${runId}`);
    } else {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO ps_capability_survey_runs (customer_id, organization, container_revision, container_image, status)
         VALUES ($1, $2, $3, $4, 'running') RETURNING id`,
        // organization is filled in at completion from what the SERVER actually
        // connected with (the #965 gate derives it from the gated tenant's own
        // domain); this placeholder is never presented as an observation.
        [Number(TENANT_ID), "(pending — filled from the first live call)", revision, image],
      );
      runId = rows[0].id;
      console.log(`survey run #${runId}`);
    }

    try {
      for (const sessionType of sessions) {
        await surveySession(pool, runId, sessionType);
      }
    } catch (err) {
      // A run that could not finish is marked `failed`, never left looking
      // complete. A partially-populated run silently read as the full picture
      // is the exact way a capability table starts asserting false negatives.
      const note = err instanceof ApiServerUnreachableError ? err.message : `run aborted: ${String(err)}`;
      await pool.query(
        `UPDATE ps_capability_survey_runs SET status = 'failed', completed_at = now(), notes = $2 WHERE id = $1`,
        [runId, note],
      );
      console.error(`\nrun #${runId} marked FAILED: ${note}`);
      throw err;
    }

    await pool.query(
      `UPDATE ps_capability_survey_runs
          SET status = 'completed',
              completed_at = now(),
              organization = COALESCE($2, organization)
        WHERE id = $1`,
      [runId, observedOrganization],
    );

    const { rows: summary } = await pool.query<{ session_type: string; status: string; n: string }>(
      `SELECT session_type, status, COUNT(*)::text AS n
         FROM ps_capability_survey_results WHERE run_id = $1
        GROUP BY session_type, status ORDER BY session_type, status`,
      [runId],
    );
    console.log(`\n--- run #${runId} summary ---`);
    for (const r of summary) console.log(`  ${r.session_type.padEnd(11)} ${r.status.padEnd(24)} ${r.n}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

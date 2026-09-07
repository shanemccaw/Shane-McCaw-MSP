/**
 * mfa-reregistration.ts — the real convergence core behind
 * `action.require-security-info-reregistration` (`mfa-enforcement-v1` step 1).
 *
 * #1899 established the real Graph mechanism: there is no single v1.0 endpoint that
 * "forces re-registration", so the action enumerates a user's authentication methods
 * and DELETEs each individually-typed method they could otherwise sign in with. That
 * shipped as a SINGLE pass — one `GET /users/{id}/authentication/methods`, then one
 * DELETE per method that read happened to return, then unconditional success.
 *
 * #2981 proved that single pass reports success after deleting nothing. Microsoft Entra
 * is eventually consistent: a read can land on a replica that has not converged and come
 * back SHORT. Observed live on 2026-09-06 against the sanctioned test user
 * `zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com` (#2840): a phone method registered
 * seconds earlier (`POST phoneMethods` -> 201) was invisible to the very next enumeration
 * ("enumerated 1 method(s); 0 deletable"), and two consecutive GETs of the same endpoint
 * inside ONE process disagreed with each other — one listing `phoneAuthenticationMethod`,
 * the next not. From the executor's point of view a stale short read is indistinguishable
 * from "this user has no MFA methods registered", so the step passed while the user kept a
 * registered factor. For a remediation whose entire purpose is "this account's factors are
 * no longer trusted, wipe them" — run precisely when an attacker's freshly-enrolled method
 * is minutes old — that is a materially wrong outcome, not a cosmetic one.
 *
 * Microsoft's own guidance for this class of failure (Designing for Eventual Consistency
 * for Microsoft Entra, devblogs.microsoft.com/identity) is twofold, and this module
 * follows both halves literally:
 *
 *   1. "Poll with exponential backoff when a read is required." Hence the bounded
 *      re-enumeration loop below: a single read is never allowed to be the last word, and
 *      the success signal reflects a corroborated end state instead of one sample.
 *   2. "If a write operation returns a success status, treat the operation as complete" —
 *      do not re-read merely to confirm it. Hence a DELETE that returned 2xx is
 *      authoritative: a later read that STILL lists that method id is stale in the other
 *      direction and is not treated as a failure, and a 404 on DELETE means the method is
 *      already gone rather than that the step failed.
 *
 * Microsoft deliberately publishes no replication-time SLA, so the loop is bounded by a
 * real wall-clock budget and a real read cap (see DEFAULT_MFA_REREGISTRATION_VERIFICATION)
 * rather than spinning: it either verifies, or it reports honestly that it could not.
 *
 * There is no strongly-consistent read available for authentication methods —
 * `ConsistencyLevel: eventual` is the opposite knob, and
 * `/reports/authenticationMethods/userRegistrationDetails` lags further still. Repeated,
 * delayed samples are the only real mechanism, which is exactly why an unconverged end
 * state is reported as a failed step rather than papered over.
 *
 * Real residual limitation, stated rather than hidden (and pinned by a test): because no
 * strongly-consistent read exists, "verified" means N delayed samples agreed — it is not a
 * proof. A replica lagging longer than the whole corroboration window would still read as
 * empty. What this closes is #2981's actual failure: a SINGLE sample, taken with no delay,
 * being the entire success signal.
 *
 * Kept deliberately free of `@workspace/db` and Graph-transport imports so the convergence
 * logic is unit-testable against real fakes with no network, no database and no real
 * sleeping — the caller (`runForceMfaReregistrationAgainstTenant` in workflow-executor.ts)
 * injects the real Graph calls.
 */
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.run" });

/**
 * `@odata.type` -> the real typed collection segment Graph deletes that method type
 * through. Phone, Microsoft Authenticator and software OATH only: FIDO2, Windows Hello for
 * Business, certificate-based auth and the password method are deliberately left alone,
 * because the Entra admin center's own "Require re-register MFA" action does not delete
 * those either (#1899).
 */
export const DELETABLE_AUTH_METHOD_COLLECTIONS: Record<string, string> = {
  "#microsoft.graph.phoneAuthenticationMethod": "phoneMethods",
  "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod": "microsoftAuthenticatorMethods",
  "#microsoft.graph.softwareOathAuthenticationMethod": "softwareOathMethods",
};

/** One entry of `GET /users/{id}/authentication/methods` -> `value`. */
export interface AuthenticationMethodRef {
  id: string;
  "@odata.type"?: string;
}

/** The subset of GraphWriteResult this module needs back from a per-method DELETE. */
export interface AuthMethodDeleteResult {
  success: boolean;
  status: number;
  data?: unknown;
  errorType?: "insufficient_privilege" | "conflict" | "bad_request" | "unexpected";
}

export interface MfaReregistrationDeps {
  /** `GET /users/{id}/authentication/methods` -> its `value` array. Throws if the read fails. */
  listMethods: () => Promise<AuthenticationMethodRef[]>;
  /** `DELETE /users/{id}/authentication/{collection}/{methodId}`. */
  deleteMethod: (collection: string, methodId: string) => Promise<AuthMethodDeleteResult>;
  /** Injected so tests converge instantly instead of really waiting. */
  sleep: (ms: number) => Promise<void>;
  /** Identifiers carried into log lines only (tenantId / userId). */
  context?: Record<string, unknown>;
}

export interface MfaReregistrationVerificationPolicy {
  /**
   * Consecutive enumeration reads that must show NOTHING left to delete before the end
   * state is called verified. Must be >= 2 to be meaningful: at 1 this degrades back to
   * #2981's single-pass bug, where one stale short read is the whole success signal. Every
   * read after the first is preceded by a real delay, so two clean reads are two samples
   * separated in time (and, behind Graph's load-balanced front end, potentially of
   * different replicas).
   */
  requiredCleanReads: number;
  /** Hard cap on enumeration reads (the initial one plus every re-read). */
  maxReads: number;
  /** Delay before read 2; doubles for each subsequent read, capped at maxDelayMs. */
  initialDelayMs: number;
  maxDelayMs: number;
  /** Wall-clock cap on total time spent waiting for convergence. */
  totalBudgetMs: number;
  /** Consecutive throwing reads after which the loop stops rather than burning the budget. */
  maxConsecutiveReadFailures: number;
}

/**
 * Real defaults. Microsoft publishes no replication-time SLA for Entra, so these come from
 * the #2981 evidence (a freshly-written method stayed invisible to a read taken right after
 * its own 201, and was visible on a later run seconds afterwards) plus Microsoft's
 * "exponential backoff" guidance — not from a documented convergence figure.
 *
 * Real cost of the happy paths: a user with no removable methods verifies after 2 reads and
 * one 5s wait; a user with methods to delete verifies after 3 reads and 15s of waiting.
 * Worst case is bounded at 6 reads / 45s.
 */
export const DEFAULT_MFA_REREGISTRATION_VERIFICATION: MfaReregistrationVerificationPolicy = {
  requiredCleanReads: 2,
  maxReads: 6,
  initialDelayMs: 5_000,
  maxDelayMs: 15_000,
  totalBudgetMs: 45_000,
  maxConsecutiveReadFailures: 2,
};

/** Everything the caller needs in order to report honestly, whatever the outcome. */
export interface MfaReregistrationTrail {
  /** Distinct method ids observed across every read — all types, not just deletable ones. */
  methodsFound: number;
  /** Method ids this run DELETEd with a confirmed 2xx. */
  deletedIds: string[];
  /** Their `@odata.type`s, positionally aligned with deletedIds. */
  deletedTypes: string[];
  /**
   * Ids whose DELETE came back 404 — already absent (a stale read listed a method that no
   * longer exists). Counted as resolved rather than failed, and reported separately from
   * real deletes so the audit trail never overstates what this run actually did.
   */
  alreadyAbsentIds: string[];
  /** Enumeration reads actually performed. */
  reads: number;
  /** Consecutive clean reads standing at exit. */
  cleanReads: number;
  /** Real wall-clock time spent waiting for replica convergence. */
  waitedMs: number;
  /** Cumulative reads that threw. */
  readFailures: number;
}

export type MfaReregistrationOutcome = MfaReregistrationTrail &
  (
    | { verified: true }
    /** The enumeration read itself never succeeded — nothing was attempted. */
    | { verified: false; failure: "read_failed"; readError: string }
    /**
     * A per-method DELETE genuinely failed — 403, or one of Graph's real refusals such as
     * a phone method that is the user's default MFA method (documented as non-deletable
     * until they change their default).
     */
    | {
        verified: false;
        failure: "delete_failed";
        collection: string;
        methodId: string;
        deleteResult: AuthMethodDeleteResult;
      }
    /**
     * Deletes did not fail, but the end state could not be corroborated inside the budget.
     * NOT reported as success: #2981 exists precisely because an uncorroborated read was
     * allowed to mean "done".
     */
    | {
        verified: false;
        failure: "unverified";
        unverifiedReason: "budget_exhausted" | "read_cap_reached" | "read_unavailable";
        /** Deletable method ids still outstanding at the last successful read. */
        outstanding: string[];
        readError?: string;
      }
  );

function delayBeforeRead(readNumber: number, policy: MfaReregistrationVerificationPolicy): number {
  // readNumber is 1-based and always >= 2 here (read 1 is never delayed).
  const exponent = Math.max(0, readNumber - 2);
  return Math.min(policy.initialDelayMs * 2 ** exponent, policy.maxDelayMs);
}

/**
 * Enumerate -> delete -> RE-enumerate until the removable-method list is corroborated
 * empty, or the bounded budget runs out. See this module's header for why a single pass is
 * not sufficient, and why a confirmed DELETE outranks a later contradicting read.
 */
export async function runMfaReregistrationConvergence(
  deps: MfaReregistrationDeps,
  policy: MfaReregistrationVerificationPolicy = DEFAULT_MFA_REREGISTRATION_VERIFICATION,
): Promise<MfaReregistrationOutcome> {
  const startedAt = Date.now();
  const ctx = deps.context ?? {};

  /** id -> @odata.type for every method that no longer needs deleting (deleted, or already absent). */
  const resolved = new Map<string, string>();
  const deletedIds: string[] = [];
  const deletedTypes: string[] = [];
  const alreadyAbsentIds: string[] = [];
  const seenIds = new Set<string>();

  let reads = 0;
  let cleanReads = 0;
  let waitedMs = 0;
  let readFailures = 0;
  let consecutiveReadFailures = 0;
  let lastReadError: string | undefined;
  let outstandingAtLastRead: string[] = [];

  const trail = (): MfaReregistrationTrail => ({
    methodsFound: seenIds.size,
    deletedIds: [...deletedIds],
    deletedTypes: [...deletedTypes],
    alreadyAbsentIds: [...alreadyAbsentIds],
    reads,
    cleanReads,
    waitedMs,
    readFailures,
  });

  while (reads < policy.maxReads) {
    if (reads > 0) {
      const remainingBudget = policy.totalBudgetMs - (Date.now() - startedAt);
      if (remainingBudget <= 0) break;
      const delayMs = Math.min(delayBeforeRead(reads + 1, policy), remainingBudget);
      await deps.sleep(delayMs);
      waitedMs += delayMs;
    }

    reads++;
    let methods: AuthenticationMethodRef[];
    try {
      methods = await deps.listMethods();
      consecutiveReadFailures = 0;
    } catch (err) {
      readFailures++;
      consecutiveReadFailures++;
      cleanReads = 0;
      lastReadError = err instanceof Error ? err.message : String(err);
      log.warn({ ...ctx, read: reads, err }, "mfa-reregistration: authentication-methods enumeration failed");
      if (consecutiveReadFailures >= policy.maxConsecutiveReadFailures) {
        if (deletedIds.length === 0 && alreadyAbsentIds.length === 0) {
          return { ...trail(), verified: false, failure: "read_failed", readError: lastReadError };
        }
        return {
          ...trail(),
          verified: false,
          failure: "unverified",
          unverifiedReason: "read_unavailable",
          outstanding: outstandingAtLastRead,
          readError: lastReadError,
        };
      }
      continue;
    }

    for (const m of methods) {
      if (m?.id) seenIds.add(m.id);
    }

    const outstanding = methods.filter(
      (m) => m?.id && !resolved.has(m.id) && DELETABLE_AUTH_METHOD_COLLECTIONS[m["@odata.type"] ?? ""],
    );
    outstandingAtLastRead = outstanding.map((m) => m.id);

    if (outstanding.length === 0) {
      // Clean read. A read that still lists a method already DELETEd with a 2xx counts as
      // clean on purpose — the confirmed write is authoritative, the lagging read is not.
      cleanReads++;
      if (cleanReads >= policy.requiredCleanReads) {
        log.info(
          { ...ctx, reads, cleanReads, waitedMs, deleted: deletedIds.length, methodsFound: seenIds.size },
          "mfa-reregistration: removable-method list verified empty",
        );
        return { ...trail(), verified: true };
      }
      continue;
    }

    // A read after the first that reveals a method no earlier read showed is the exact
    // #2981 signature — the earlier read was stale, and single-pass would have stopped.
    if (reads > 1) {
      log.warn(
        { ...ctx, read: reads, revealed: outstandingAtLastRead },
        "mfa-reregistration: re-enumeration revealed removable method(s) an earlier read did not — stale replica read caught (#2981)",
      );
    }

    cleanReads = 0;
    for (const m of outstanding) {
      const type = m["@odata.type"] ?? "";
      const collection = DELETABLE_AUTH_METHOD_COLLECTIONS[type]!;
      const result = await deps.deleteMethod(collection, m.id);

      if (!result.success && result.status === 404) {
        // Already gone: a stale read listed a method that no longer exists. Resolved, not
        // failed — and deliberately not counted as one of this run's own deletes.
        resolved.set(m.id, type);
        alreadyAbsentIds.push(m.id);
        log.info(
          { ...ctx, methodId: m.id, collection },
          "mfa-reregistration: method already absent (404 on DELETE) — treating as resolved",
        );
        continue;
      }
      if (!result.success) {
        log.warn(
          { ...ctx, methodId: m.id, collection, status: result.status, errorType: result.errorType },
          "mfa-reregistration: per-method DELETE failed — reporting failure without claiming a wipe",
        );
        return {
          ...trail(),
          verified: false,
          failure: "delete_failed",
          collection,
          methodId: m.id,
          deleteResult: result,
        };
      }

      resolved.set(m.id, type);
      deletedIds.push(m.id);
      deletedTypes.push(type);
    }
    outstandingAtLastRead = [];
  }

  const unverifiedReason = reads >= policy.maxReads ? "read_cap_reached" : "budget_exhausted";
  log.warn(
    {
      ...ctx,
      reads,
      cleanReads,
      waitedMs,
      unverifiedReason,
      deleted: deletedIds.length,
      outstanding: outstandingAtLastRead,
    },
    "mfa-reregistration: could not corroborate an empty removable-method list inside the budget — reporting FAILURE, not success",
  );
  return {
    ...trail(),
    verified: false,
    failure: "unverified",
    unverifiedReason,
    outstanding: outstandingAtLastRead,
    ...(lastReadError !== undefined ? { readError: lastReadError } : {}),
  };
}

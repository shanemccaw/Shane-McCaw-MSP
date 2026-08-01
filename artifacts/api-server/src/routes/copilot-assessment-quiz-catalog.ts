/**
 * copilot-assessment-quiz-catalog.ts
 *
 * GET /api/portal/copilot-assessment/quiz-catalog?industry=space[&personaKey=…]
 *
 * Copilot Assessment epic (#183), #271. Serves the four adaptive quiz catalogs —
 * persona clusters, personas, use cases and outcomes — which used to be
 * hardcoded objects in msp-portal's quizCatalog.ts. Shane populates the real
 * content by direct SQL; there is deliberately no admin CRUD or JSON-import
 * surface here, and this route is READ-ONLY for that reason.
 *
 * ── Why one route and not four ───────────────────────────────────────────────
 * The wizard filters as you answer: choosing clusters narrows the persona list,
 * choosing personas narrows use cases AND (new in #271) outcomes. That filtering
 * was in-memory over static objects, and it stays in-memory here — the client
 * fetches an industry's whole catalog once and filters locally, so a persona
 * toggle still costs zero round trips. Returning the linkage keys on each item
 * (clusterId on a persona, personaId on a use case / outcome) is what makes that
 * possible, and it preserves the exact filtering behaviour rather than
 * re-implementing it server-side with different edge cases.
 *
 * The optional personaKey parameter exists for callers that DO want the narrow
 * slice server-side; the wizard does not use it.
 *
 * ── Two behaviours carried over from the static catalogs, on purpose ─────────
 * 1. PER-LEVEL fallback to industry='default'. The wizard did
 *    `ADAPTIVE_X[industry] || ADAPTIVE_X['default']` independently per catalog,
 *    and that mattered: healthcare had its own clusters/personas/use cases but
 *    no outcomes of its own, so its outcomes fell through to default. Falling
 *    back per level (not per catalog-as-a-whole) is what keeps that identical.
 * 2. persona_key = '*' means "every persona in this industry". Mapped back to
 *    `personaId: undefined` on the way out, which is precisely how the wizard's
 *    own predicate (`!item.personaId || selected.includes(item.personaId)`)
 *    already treats an unlinked tile. The migrated outcomes all carry '*',
 *    because industry-scoped-only is what that content genuinely is.
 *
 * Response items are shaped as the wizard's own QuizOptionTile ({ id, title,
 * description, iconName, … }) with the row's *_key as `id`, so nothing about
 * rendering or answer storage had to change: an answer value is still the key.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { asc, inArray, sql } from "drizzle-orm";
import {
  db,
  quizPersonaClustersTable,
  quizPersonasTable,
  quizUseCasesTable,
  quizOutcomesTable,
  QUIZ_CATALOG_ALL_PERSONAS,
} from "@workspace/db";
import { requireRole } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

/** The literal industry key every level falls back to — a real row set, not a placeholder. */
const DEFAULT_INDUSTRY = "default";

/** Which row set a level actually answered from, so a caller can tell real content from fallback. */
export type QuizCatalogLevelSource = "industry" | "default" | "empty";

export interface QuizCatalogTile {
  id: string;
  title: string;
  description: string;
  iconName: string;
  clusterId?: string;
  personaId?: string;
}

export interface QuizCatalogResponse {
  industry: string;
  clusters: QuizCatalogTile[];
  personas: QuizCatalogTile[];
  useCases: QuizCatalogTile[];
  outcomes: QuizCatalogTile[];
  /** Per level, because the fallback is per level — see the header note. */
  sources: {
    clusters: QuizCatalogLevelSource;
    personas: QuizCatalogLevelSource;
    useCases: QuizCatalogLevelSource;
    outcomes: QuizCatalogLevelSource;
  };
}

/**
 * Split one industry-or-default result set into the level's real answer.
 *
 * Rows for the requested industry win outright; the default set is used only
 * when the industry has none of its own. "Some of each" is never merged — the
 * static catalogs were whole-array-or-fallback and merging would invent a
 * blended list no industry was ever configured with.
 */
function pickLevel<T extends { industry: string }>(
  rows: T[],
  industry: string,
): { rows: T[]; source: QuizCatalogLevelSource } {
  const own = rows.filter((r) => r.industry === industry);
  if (own.length > 0) return { rows: own, source: "industry" };
  const fallback = rows.filter((r) => r.industry === DEFAULT_INDUSTRY);
  if (fallback.length > 0) return { rows: fallback, source: "default" };
  return { rows: [], source: "empty" };
}

/** '*' is storage's way of saying "no persona linkage"; the wire format says it with an absent field. */
function toPersonaId(personaKey: string): string | undefined {
  return personaKey === QUIZ_CATALOG_ALL_PERSONAS ? undefined : personaKey;
}

// ── Failure diagnostics (#286) ───────────────────────────────────────────────
//
// This route 500'd persistently and the ONE time the server-side error was
// captured it logged as an empty `{}`, which left the cause unknown across
// several sessions. That emptiness is not pino mangling the error — it is
// structural, and would happen to any `logger.error({ err }, …)` call site in
// this codebase:
//
//   logger.ts's `logMethod` hook mirrors every log call into
//   `platform_log_stream.meta` (a jsonb column) and out over the SSE log hub
//   that Simulator Studio's console reads. Both paths JSON-serialize the
//   merging object, and `JSON.stringify(new Error("boom"))` is exactly `"{}"` —
//   an Error's message/stack are non-enumerable, so they never survive. pino's
//   own stdout copy is fine; the console Shane was reading is not.
//
// So the fix is not a better serializer — it is to hand the logger a plain,
// already-JSON-safe object. `errorDetail` below is that object. The raw `err`
// is still passed alongside it, deliberately: pino-pretty's stdout output wants
// it, and logger.ts only feeds `captureException` when `mergingObject.err` is a
// real Error instance.
//
// Second reason the cause was invisible: drizzle 0.45.x wraps EVERY driver
// error in a `DrizzleQueryError` whose message is just "Failed query: …". The
// real node-postgres error — with the SQLSTATE `code`, `detail`, `hint`,
// `schema`, `table` and `routine` that name the actual problem — is on `.cause`.
// Nothing here unwrapped it, so even a healthy log line would have said nothing
// more useful than "Failed query". `describeThrown` walks the cause chain.

/** node-postgres error fields, plus the two DrizzleQueryError adds. Named explicitly so a non-enumerable one is still captured. */
const ERROR_FIELDS_OF_INTEREST = [
  "code", "severity", "detail", "hint", "position", "internalPosition",
  "internalQuery", "where", "schema", "table", "column", "dataType",
  "constraint", "file", "line", "routine", "errno", "syscall", "address",
  "port", "query", "params",
] as const;

/** Anything at all can be thrown; render it as something jsonb can hold without losing it. */
function jsonSafe(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "undefined":
      return undefined;
    case "bigint":
      return value.toString();
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
    case "symbol":
      return value.toString();
    default:
      try {
        // Round-trips through JSON so a nested Error/circular ref can't take
        // the whole log line down. Length-capped: a DrizzleQueryError carries
        // the full query text and params.
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : json.slice(0, 2000);
      } catch {
        return "[unserializable]";
      }
  }
}

/**
 * Everything knowable about a thrown value, as plain JSON.
 *
 * Deliberately does not assume an Error: the whole point of #286 is that we did
 * not know what was being thrown. `getOwnPropertyNames` (not `Object.keys`)
 * because pg sets several of its fields non-enumerable, and message/stack always
 * are.
 */
function describeThrown(value: unknown, depth = 0): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return { thrownType: typeof value, value: jsonSafe(value) };
  }

  const err = value as Record<string, unknown>;
  const detail: Record<string, unknown> = {
    thrownType: typeof value,
    constructorName: value.constructor?.name ?? "(no constructor)",
    isErrorInstance: value instanceof Error,
    name: typeof err.name === "string" ? err.name : undefined,
    message: typeof err.message === "string" ? err.message.slice(0, 2000) : undefined,
    stack: typeof err.stack === "string" ? err.stack.slice(0, 4000) : undefined,
  };

  for (const field of ERROR_FIELDS_OF_INTEREST) {
    if (err[field] !== undefined) detail[field] = jsonSafe(err[field]);
  }

  // Own properties beyond the known set — the catch-all for a thrown shape we
  // have not seen before, which is precisely the case this exists for.
  const known = new Set<string>([...ERROR_FIELDS_OF_INTEREST, "name", "message", "stack", "cause"]);
  const extras: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(err)) {
    if (known.has(key)) continue;
    extras[key] = jsonSafe(err[key]);
  }
  if (Object.keys(extras).length > 0) detail.ownProperties = extras;

  // drizzle wraps pg; pg can wrap a socket error. Bounded so a self-referencing
  // cause cannot loop.
  if (err.cause !== undefined && err.cause !== null && depth < 4) {
    detail.cause = describeThrown(err.cause, depth + 1);
  }

  return detail;
}

/**
 * Ask the SAME connection the failed query used what it can actually see.
 *
 * This is here because of how #286 stayed unsolved: the query was verified by
 * hand in a SQL console and came back clean, which proves nothing about the
 * pool the API server holds — a different database, a different role, or a
 * search_path that doesn't include the schema the tables were created in all
 * look exactly like this. `to_regclass` returns NULL instead of raising when a
 * table isn't visible, and `has_table_privilege` is strict, so this probe is
 * safe to run even when all four tables are missing or unreadable.
 *
 * Runs on the failure path only, and never throws — a diagnostic that can break
 * the response it is diagnosing is worse than no diagnostic.
 */
async function probeCatalogVisibility(): Promise<Record<string, unknown>> {
  try {
    if (typeof (db as { execute?: unknown }).execute !== "function") {
      return { probe: "skipped — db.execute unavailable" };
    }
    const result = await db.execute(sql`
      select current_database()                                            as database,
             current_user                                                  as db_user,
             current_schema()                                              as current_schema,
             current_setting('search_path')                                as search_path,
             to_regclass('quiz_persona_clusters')::text                    as clusters_regclass,
             to_regclass('quiz_personas')::text                            as personas_regclass,
             to_regclass('quiz_use_cases')::text                           as use_cases_regclass,
             to_regclass('quiz_outcomes')::text                            as outcomes_regclass,
             has_table_privilege(to_regclass('quiz_persona_clusters'), 'SELECT') as clusters_selectable,
             has_table_privilege(to_regclass('quiz_personas'), 'SELECT')         as personas_selectable,
             has_table_privilege(to_regclass('quiz_use_cases'), 'SELECT')        as use_cases_selectable,
             has_table_privilege(to_regclass('quiz_outcomes'), 'SELECT')         as outcomes_selectable
    `);
    const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows;
    return (Array.isArray(rows) ? rows[0] : undefined) ?? { probe: "returned no rows" };
  } catch (probeErr) {
    // The probe failing is itself a finding — it means the connection, not the
    // four tables, is what is broken.
    return { probeFailed: describeThrown(probeErr) };
  }
}

router.get(
  "/portal/copilot-assessment/quiz-catalog",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const industry = typeof req.query.industry === "string" ? req.query.industry.trim() : "";
    if (!industry) {
      res.status(400).json({ error: "industry query parameter is required" });
      return;
    }

    const personaKey = typeof req.query.personaKey === "string" ? req.query.personaKey.trim() : "";

    // One query per level, each covering the industry and the default fallback
    // in a single round trip, then resolved in memory by pickLevel above.
    const industries = industry === DEFAULT_INDUSTRY ? [DEFAULT_INDUSTRY] : [industry, DEFAULT_INDUSTRY];

    try {
      const [clusterRows, personaRows, useCaseRows, outcomeRows] = await Promise.all([
        db
          .select()
          .from(quizPersonaClustersTable)
          .where(inArray(quizPersonaClustersTable.industry, industries))
          .orderBy(asc(quizPersonaClustersTable.sortOrder), asc(quizPersonaClustersTable.id)),
        db
          .select()
          .from(quizPersonasTable)
          .where(inArray(quizPersonasTable.industry, industries))
          .orderBy(asc(quizPersonasTable.sortOrder), asc(quizPersonasTable.id)),
        db
          .select()
          .from(quizUseCasesTable)
          .where(inArray(quizUseCasesTable.industry, industries))
          .orderBy(asc(quizUseCasesTable.sortOrder), asc(quizUseCasesTable.id)),
        db
          .select()
          .from(quizOutcomesTable)
          .where(inArray(quizOutcomesTable.industry, industries))
          .orderBy(asc(quizOutcomesTable.sortOrder), asc(quizOutcomesTable.id)),
      ]);

      const clusters = pickLevel(clusterRows, industry);
      const personas = pickLevel(personaRows, industry);
      const useCases = pickLevel(useCaseRows, industry);
      const outcomes = pickLevel(outcomeRows, industry);

      // Optional server-side narrowing. A '*' row always survives it — it applies
      // to every persona by definition, so filtering it out would drop content
      // that genuinely belongs to the requested persona.
      const matchesPersona = (rowPersonaKey: string): boolean =>
        !personaKey || rowPersonaKey === personaKey || rowPersonaKey === QUIZ_CATALOG_ALL_PERSONAS;

      const payload: QuizCatalogResponse = {
        industry,
        clusters: clusters.rows.map((r) => ({
          id: r.clusterKey,
          title: r.title,
          description: r.description,
          iconName: r.iconName,
        })),
        personas: personas.rows.map((r) => ({
          id: r.personaKey,
          title: r.title,
          description: r.description,
          iconName: r.iconName,
          clusterId: r.clusterKey,
        })),
        useCases: useCases.rows.filter((r) => matchesPersona(r.personaKey)).map((r) => ({
          id: r.useCaseKey,
          title: r.title,
          description: r.description,
          iconName: r.iconName,
          personaId: toPersonaId(r.personaKey),
        })),
        outcomes: outcomes.rows.filter((r) => matchesPersona(r.personaKey)).map((r) => ({
          id: r.outcomeKey,
          title: r.title,
          description: r.description,
          iconName: r.iconName,
          personaId: toPersonaId(r.personaKey),
        })),
        sources: {
          clusters: clusters.source,
          personas: personas.source,
          useCases: useCases.source,
          outcomes: outcomes.source,
        },
      };

      // An entirely empty catalog means the content migration has not been run —
      // worth a real warning, because the client's own fallback would otherwise
      // make it invisible.
      if (payload.clusters.length === 0 && payload.personas.length === 0) {
        log.warn({ industry }, "quiz catalog returned no rows for industry or default — has the #271 content migration been run?");
      }

      res.json(payload);
    } catch (err) {
      // See the "Failure diagnostics (#286)" block above for why this is not
      // just `log.error({ err }, …)`: that form reaches the DB-backed log stream
      // and Simulator Studio's console as an empty `{}`, which is how this
      // route's real cause stayed unknown across several sessions.
      const errorDetail = describeThrown(err);
      const connection = await probeCatalogVisibility();
      log.error(
        { err, errorDetail, connection, industry, personaKey: personaKey || null, industries },
        "GET /portal/copilot-assessment/quiz-catalog failed",
      );
      res.status(500).json({ error: "Failed to load quiz catalog" });
    }
  },
);

export default router;

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
import { asc, inArray } from "drizzle-orm";
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
      log.error({ err, industry }, "GET /portal/copilot-assessment/quiz-catalog failed");
      res.status(500).json({ error: "Failed to load quiz catalog" });
    }
  },
);

export default router;

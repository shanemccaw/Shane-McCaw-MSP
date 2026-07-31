/**
 * copilot-assessment-quiz-catalog.test.ts — #271 (Copilot Assessment epic #183).
 *
 * What matters here is not "the route returns rows" but that it returns them
 * with the SAME semantics the hardcoded catalogs had, because the wizard's
 * filtering was built against those semantics and #271 must not move them:
 *
 *   - fallback to industry='default' happens PER LEVEL, not per catalog. The
 *     real shape of the old data was asymmetric — healthcare had its own
 *     clusters/personas/use cases but no outcomes of its own — and a
 *     whole-catalog fallback would silently replace three good levels with
 *     default content the moment one level was missing.
 *   - persona_key '*' is "applies to every persona", and must come back as an
 *     ABSENT personaId, because that is the value the wizard's own predicate
 *     already treats as "no linkage". Every migrated outcome carries it.
 *
 * The @workspace/db mock is a real in-memory row store, not a canned response:
 * the fallback assertions are only meaningful if the route genuinely queries and
 * sorts through the same path a live request would.
 *
 * Run: pnpm --filter @workspace/api-server vitest run copilot-assessment-quiz-catalog
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

interface CatalogRow {
  id: number;
  industry: string;
  clusterKey?: string;
  personaKey?: string;
  useCaseKey?: string;
  outcomeKey?: string;
  title: string;
  description: string;
  iconName: string;
  sortOrder: number;
}

// Prefixed `mock` so vi.mock's hoisting check allows the factory to close over them.
const mockRows: Record<string, CatalogRow[]> = {
  quiz_persona_clusters: [],
  quiz_personas: [],
  quiz_use_cases: [],
  quiz_outcomes: [],
};

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, value: unknown) => ({ __op: "eq", col, value }),
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
  ne: (col: unknown, value: unknown) => ({ __op: "ne", col, value }),
  desc: (col: unknown) => ({ __op: "desc", col }),
  asc: (col: unknown) => ({ __op: "asc", col }),
  inArray: (col: unknown, values: unknown[]) => ({ __op: "inArray", col, values }),
  sql: (strings: TemplateStringsArray) => ({ __op: "sql", strings }),
}));

vi.mock("@workspace/db", () => {
  // Each table descriptor carries its own name so the fake select chain knows
  // which row set from() was pointed at.
  const table = (name: string) => ({ __table: name, industry: "industry", sortOrder: "sort_order", id: "id" });

  const makeSelectChain = () => {
    let tableName = "";
    let industries: string[] = [];
    const chain: Record<string, unknown> = {
      from: (t: { __table: string }) => {
        tableName = t.__table;
        return chain;
      },
      where: (cond: { values?: unknown[] }) => {
        industries = (cond?.values ?? []) as string[];
        return chain;
      },
      // The route awaits at orderBy, so this is where the rows are produced.
      // Sorted the same way the real query is, since the route relies on order.
      orderBy: () =>
        Promise.resolve(
          (mockRows[tableName] ?? [])
            .filter((r) => industries.includes(r.industry))
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
        ),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve({}) }) })),
      insert: vi.fn(() => ({ values: () => Promise.resolve({}) })),
      delete: vi.fn(() => ({ where: () => Promise.resolve({}) })),
    },
    quizPersonaClustersTable: table("quiz_persona_clusters"),
    quizPersonasTable: table("quiz_personas"),
    quizUseCasesTable: table("quiz_use_cases"),
    quizOutcomesTable: table("quiz_outcomes"),
    QUIZ_CATALOG_ALL_PERSONAS: "*",
    tenantsTable: { id: "id", mspId: "msp_id" },
    mspStaffCustomerScopesTable: { id: "id" },
  };
});

vi.mock("../lib/logger.ts", () => {
  const child: () => Record<string, unknown> = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import router from "./copilot-assessment-quiz-catalog.ts";

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
app.use(express.json());
app.use("/api", router);

function token(): string {
  return jwt.sign(
    {
      id: 501,
      email: "buyer@contoso.com",
      role: "client",
      mspRole: "Assessment",
      mspId: 42,
      customerId: 77,
      sid: "session-1",
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

let nextId = 1;
function row(partial: Partial<CatalogRow> & { industry: string; title: string }): CatalogRow {
  return {
    id: nextId++,
    description: `${partial.title} description`,
    iconName: "Sparkles",
    sortOrder: 0,
    ...partial,
  } as CatalogRow;
}

/**
 * A fixture shaped like the REAL migrated data, including its asymmetry:
 * space and healthcare both have their own clusters/personas/use cases, only
 * space has its own outcomes, and healthcare therefore has to fall through to
 * the 'default' outcome rows — exactly the case that made per-level fallback
 * necessary rather than a nicety.
 */
beforeEach(() => {
  nextId = 1;
  mockRows.quiz_persona_clusters = [
    row({ industry: "space", clusterKey: "mission_ops", title: "Mission Operations", sortOrder: 10 }),
    row({ industry: "space", clusterKey: "science_research", title: "Science & Research", sortOrder: 0 }),
    row({ industry: "healthcare", clusterKey: "clinical_care", title: "Clinical Care", sortOrder: 0 }),
    row({ industry: "default", clusterKey: "gen_knowledge", title: "General Knowledge", sortOrder: 0 }),
  ];
  mockRows.quiz_personas = [
    row({ industry: "space", clusterKey: "mission_ops", personaKey: "flight_dir", title: "Flight Director", sortOrder: 10 }),
    row({ industry: "space", clusterKey: "science_research", personaKey: "scientist", title: "Scientist", sortOrder: 0 }),
    row({ industry: "healthcare", clusterKey: "clinical_care", personaKey: "clinician", title: "Clinician", sortOrder: 0 }),
    row({ industry: "default", clusterKey: "gen_knowledge", personaKey: "generalist", title: "Generalist", sortOrder: 0 }),
  ];
  mockRows.quiz_use_cases = [
    row({ industry: "space", personaKey: "flight_dir", useCaseKey: "contingency_drafting", title: "Contingency Protocol Drafting", sortOrder: 10 }),
    row({ industry: "space", personaKey: "scientist", useCaseKey: "lit_synthesis_space", title: "Literature Synthesis", sortOrder: 0 }),
    // Industry-wide: belongs to every persona in space.
    row({ industry: "space", personaKey: "*", useCaseKey: "status_reporting", title: "Status Reporting", sortOrder: 20 }),
    row({ industry: "healthcare", personaKey: "clinician", useCaseKey: "chart_summarization", title: "Chart Summarization", sortOrder: 0 }),
    row({ industry: "default", personaKey: "generalist", useCaseKey: "doc_drafting", title: "Document Drafting", sortOrder: 0 }),
  ];
  mockRows.quiz_outcomes = [
    // Space has REAL persona-scoped outcomes — the thing #271 exists to enable.
    row({ industry: "space", personaKey: "flight_dir", outcomeKey: "mission_safety", title: "Mission Safety", sortOrder: 0 }),
    row({ industry: "space", personaKey: "scientist", outcomeKey: "res_accel", title: "Research Acceleration", sortOrder: 10 }),
    // Healthcare has NONE of its own -> must fall through to default.
    row({ industry: "default", personaKey: "*", outcomeKey: "dev_velocity", title: "Productivity & Time Saved", sortOrder: 0 }),
  ];
});

describe("GET /portal/copilot-assessment/quiz-catalog (#271)", () => {
  it("serves an industry's own four levels, keyed the way the wizard expects", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=space")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.industry).toBe("space");

    // Row *_key becomes the tile id — an answer value is still the key, which is
    // what lets stored answers from before #271 keep resolving.
    expect(res.body.clusters.map((c: { id: string }) => c.id)).toEqual(["science_research", "mission_ops"]);
    expect(res.body.sources.clusters).toBe("industry");

    // Linkage keys survive, so the client can filter in memory with no round trip.
    const flightDir = res.body.personas.find((p: { id: string }) => p.id === "flight_dir");
    expect(flightDir.clusterId).toBe("mission_ops");
    expect(flightDir.title).toBe("Flight Director");
  });

  it("orders by sort_order, not by insertion or id", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=space")
      .set("Authorization", `Bearer ${token()}`);

    // science_research was inserted second but sorts first.
    expect(res.body.clusters[0].id).toBe("science_research");
    expect(res.body.personas[0].id).toBe("scientist");
  });

  it("maps the '*' persona sentinel to an ABSENT personaId, not the literal '*'", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=space")
      .set("Authorization", `Bearer ${token()}`);

    const shared = res.body.useCases.find((u: { id: string }) => u.id === "status_reporting");
    expect(shared).toBeDefined();
    // The wizard's predicate is `!u.personaId || selected.includes(u.personaId)`.
    // A literal '*' here would make this tile match NO persona instead of all.
    expect(shared.personaId).toBeUndefined();

    const scoped = res.body.useCases.find((u: { id: string }) => u.id === "contingency_drafting");
    expect(scoped.personaId).toBe("flight_dir");
  });

  it("carries real persona-scoped outcomes — the linkage that did not exist before #271", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=space")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.body.outcomes).toHaveLength(2);
    expect(res.body.outcomes.find((o: { id: string }) => o.id === "mission_safety").personaId).toBe("flight_dir");
    expect(res.body.outcomes.find((o: { id: string }) => o.id === "res_accel").personaId).toBe("scientist");
    expect(res.body.sources.outcomes).toBe("industry");
  });

  it("falls back to 'default' PER LEVEL — healthcare keeps its own clusters but borrows outcomes", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=healthcare")
      .set("Authorization", `Bearer ${token()}`);

    // Its own three levels are untouched...
    expect(res.body.clusters.map((c: { id: string }) => c.id)).toEqual(["clinical_care"]);
    expect(res.body.personas.map((p: { id: string }) => p.id)).toEqual(["clinician"]);
    expect(res.body.useCases.map((u: { id: string }) => u.id)).toEqual(["chart_summarization"]);
    expect(res.body.sources.clusters).toBe("industry");
    expect(res.body.sources.useCases).toBe("industry");

    // ...and ONLY outcomes fall through, which is the real pre-#271 behaviour.
    expect(res.body.outcomes.map((o: { id: string }) => o.id)).toEqual(["dev_velocity"]);
    expect(res.body.sources.outcomes).toBe("default");

    // The regression this guards: a whole-catalog fallback would have replaced
    // healthcare's own clinician/chart_summarization with the default content.
    expect(res.body.personas.map((p: { id: string }) => p.id)).not.toContain("generalist");
  });

  it("falls back for an industry with no rows at all", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=agriculture")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.body.clusters.map((c: { id: string }) => c.id)).toEqual(["gen_knowledge"]);
    expect(res.body.sources.clusters).toBe("default");
    expect(res.body.sources.personas).toBe("default");
  });

  it("reports 'empty' rather than inventing content when a level exists nowhere", async () => {
    mockRows.quiz_outcomes = [];

    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=healthcare")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.outcomes).toEqual([]);
    expect(res.body.sources.outcomes).toBe("empty");
    // The other levels are unaffected — an empty level is not a failed request.
    expect(res.body.clusters).toHaveLength(1);
  });

  it("narrows use cases and outcomes to personaKey when asked, keeping '*' rows", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=space&personaKey=flight_dir")
      .set("Authorization", `Bearer ${token()}`);

    const ids = res.body.useCases.map((u: { id: string }) => u.id).sort();
    // flight_dir's own use case AND the industry-wide one; NOT the scientist's.
    expect(ids).toEqual(["contingency_drafting", "status_reporting"]);
    expect(res.body.outcomes.map((o: { id: string }) => o.id)).toEqual(["mission_safety"]);

    // Clusters and personas are never persona-narrowed — they are what the
    // customer picks a persona FROM.
    expect(res.body.clusters).toHaveLength(2);
    expect(res.body.personas).toHaveLength(2);
  });

  it("does not treat 'default' as an industry that falls back to itself", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog?industry=default")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.body.clusters.map((c: { id: string }) => c.id)).toEqual(["gen_knowledge"]);
    expect(res.body.sources.clusters).toBe("industry");
  });

  it("rejects a request with no industry", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-catalog")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/portal/copilot-assessment/quiz-catalog?industry=space");
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(404);
  });
});

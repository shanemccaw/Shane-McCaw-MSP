/**
 * admin-document-generator.test.ts
 *
 * Regression tests for GET /admin/document-generator/missing-types
 * (Document Generator IDE Phase 4) — services flagged for
 * delivery_type = 'document_generation' with no matching document_types row —
 * and for GET /admin/document-generator/history's cost column (#53, parent
 * #48): the route joins ai_usage_events via generatedArtifactId/Type and must
 * pass a null costCents (no matching usage event) through as null, never a
 * fabricated 0.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

let selectResult: unknown[] = [];

// Chain depth varies by route (missing-types: 1 leftJoin + where + orderBy;
// history: 4 leftJoins + where + orderBy + limit) — a single self-returning,
// thenable chain object supports every route's query shape without a mock
// change per route.
function makeQueryChain(): unknown {
  const chain: Record<string, unknown> = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(selectResult).then(resolve, reject),
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeQueryChain()),
  },
  documentTypesTable: { id: "id", serviceId: "service_id", key: "key", label: "label" },
  insightsGeneratedDocumentsTable: { id: "id", docType: "doc_type" },
  projectsTable: {},
  servicesTable: { id: "id", name: "name", description: "description", slug: "slug", deliveryType: "delivery_type" },
  usersTable: {},
  aiUsageEventsTable: { generatedArtifactId: "generated_artifact_id", generatedArtifactType: "generated_artifact_type", costCents: "cost_cents" },
  // Profile-key registry (#544) — opaque column markers; the query chain above
  // only needs to be handed something, it never inspects them.
  monitorChecksTable: { key: "key", mapping: "mapping", properties: "properties", status: "status" },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/document-engine.ts", () => ({ generateDocument: vi.fn() }));
vi.mock("../lib/document-engine-sow.ts", () => ({ generateSowDocument: vi.fn() }));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {},
  withAiAttribution: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  selectResult = [];

  app = express();
  app.use(express.json());
  const { default: router } = await import("./admin-document-generator");
  app.use("/api", router);
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

describe("GET /admin/document-generator/missing-types", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/document-generator/missing-types");
    expect(res.status).toBe(401);
  });

  it("returns services with no matching document_types row", async () => {
    selectResult = [
      { id: 12, name: "Email Security Audit", description: "Automated email security report", slug: "email-security-audit" },
      { id: 19, name: "License Waste Report", description: null, slug: null },
    ];

    const res = await auth(request(app).get("/api/admin/document-generator/missing-types"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(selectResult);
  });

  it("returns an empty list when every document-generation service is covered", async () => {
    selectResult = [];
    const res = await auth(request(app).get("/api/admin/document-generator/missing-types"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 on a query failure", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await auth(request(app).get("/api/admin/document-generator/missing-types"));
    expect(res.status).toBe(500);
  });
});

describe("GET /admin/document-generator/history", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/document-generator/history");
    expect(res.status).toBe(401);
  });

  it("passes through a recorded cost from the ai_usage_events join", async () => {
    selectResult = [
      { id: 1, docType: "sow", category: "consulting", title: "Acme SOW", status: "approved", errorMessage: null, createdAt: "2026-07-29T00:00:00Z", customerId: 5, customerName: "Jane", customerCompany: "Acme", projectId: 1, projectTitle: "Acme Project", docTypeLabel: "SOW", costCents: 350 },
    ];

    const res = await auth(request(app).get("/api/admin/document-generator/history"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(selectResult);
    expect(res.body[0].costCents).toBe(350);
  });

  it("passes through a null cost for a document with no matching usage event, not a fabricated 0", async () => {
    selectResult = [
      { id: 2, docType: "assessment_report", category: "report", title: "Old Report", status: "approved", errorMessage: null, createdAt: "2026-01-01T00:00:00Z", customerId: 5, customerName: "Jane", customerCompany: "Acme", projectId: null, projectTitle: null, docTypeLabel: "Assessment Report", costCents: null },
    ];

    const res = await auth(request(app).get("/api/admin/document-generator/history"));
    expect(res.status).toBe(200);
    expect(res.body[0].costCents).toBeNull();
  });

  it("returns 500 on a query failure", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await auth(request(app).get("/api/admin/document-generator/history"));
    expect(res.status).toBe(500);
  });
});

// ── Profile key registry (Git #544 companion 2) ──────────────────────────────
//
// Before #544 this endpoint offered `mapping[].targetField` plus the flat
// `<key>__itemCount`, and nothing else. That made the entire raw-extraction
// class — `monitor_checks.properties[]` → `P_count`/`P_first`/`P_values`, where
// 87 of the catalogue's 89 colliding names live — invisible to BOTH the admin
// picker and the AI suggest-scoping endpoint (whose allowlist filters against
// this same list). The one surface the scoping work most needed to name was the
// one it could not see.
//
// It also grouped by `row.key.split("://")[0]`. Real check keys use ":" and
// never "://", so that split never fired: `domain` came back as the whole check
// key and the picker rendered one group per CHECK instead of one per domain.

describe("fetchProfileKeyGroups (Git #544)", () => {
  const CHECKS = [
    {
      key: "teams:team-count",
      mapping: [{ sourceField: "value", targetField: "teamCount" }],
      properties: ["displayName", "id"],
    },
    {
      key: "teams:channel-sprawl",
      mapping: [],
      properties: ["displayName"],
    },
    {
      key: "identity:ca-policy-count",
      mapping: [{ sourceField: "value", targetField: "conditionalAccessPoliciesCount" }],
      properties: [],
    },
  ];

  const groups = async () => {
    selectResult = CHECKS;
    const { fetchProfileKeyGroups } = await import("./admin-document-generator");
    return fetchProfileKeyGroups();
  };

  it("emits every raw-extraction key, namespaced by the check that produces it", async () => {
    const teams = (await groups()).find((g) => g.domain === "teams");
    // All THREE suffixes per properties[] entry — applyMapping emits count,
    // first AND values, so a picker offering only one of them is still blind.
    expect(teams?.keys).toEqual(expect.arrayContaining([
      "teams:team-count.displayName_count",
      "teams:team-count.displayName_first",
      "teams:team-count.displayName_values",
      "teams:team-count.id_count",
      "teams:channel-sprawl.displayName_count",
    ]));
  });

  it("namespaces the two colliding checks separately, so a pattern can name one", async () => {
    const teams = (await groups()).find((g) => g.domain === "teams");
    // The live collision: both checks emit displayName_count with different real
    // values (18 vs 27). The bare, unattributable name is offered to nobody.
    expect(teams?.keys).not.toContain("displayName_count");
    expect(teams?.keys.filter((k) => k.endsWith(".displayName_count"))).toHaveLength(2);
  });

  it("namespaces mapping targetFields and the per-check item count", async () => {
    const all = (await groups()).flatMap((g) => g.keys);
    expect(all).toContain("teams:team-count.teamCount");
    expect(all).toContain("teams:team-count._itemCount");
    // The flat threshold-rule key is not a document-scoping key.
    expect(all).not.toContain("teams:team-count__itemCount");
  });

  it("groups by real domain — the old \"://\" split gave one group per check", async () => {
    const result = await groups();
    expect(new Set(result.map((g) => g.domain))).toEqual(new Set(["_profile", "identity", "teams"]));
    const teams = result.find((g) => g.domain === "teams");
    expect(teams?.keys.some((k) => k.startsWith("teams:channel-sprawl."))).toBe(true);
    expect(teams?.keys.some((k) => k.startsWith("teams:team-count."))).toBe(true);
  });

  it("offers a bridged key only while its single real producer check is active", async () => {
    const withProducer = (await groups()).find((g) => g.domain === "_profile");
    expect(withProducer?.keys).toContain("_profile.conditionalAccessPolicyCount");
    // security:secure-score is absent from this catalogue, so securityScore is
    // not producible for it and must not be offered.
    expect(withProducer?.keys).not.toContain("_profile.securityScore");

    selectResult = CHECKS.filter((c) => c.key !== "identity:ca-policy-count");
    const { fetchProfileKeyGroups } = await import("./admin-document-generator");
    expect((await fetchProfileKeyGroups()).some((g) => g.domain === "_profile")).toBe(false);
  });
});

// ── POST .../:key/generate — SSE streaming mode ───────────────────────────────
// The engine streams its narrative call so an operator watches the document
// being written; this route relays that. Two things here are load-bearing and
// easy to break: the frames actually reaching the wire, and the plain-JSON
// shape staying intact for SimulatorDocumentCanvas.tsx, which calls the SAME
// route and reads `res.json()` — which is why streaming is opt-in.

describe("POST /admin/document-generator/document-types/:key/generate — streaming", () => {
  /** Parses an SSE body into its `data:` frames, in arrival order. */
  function frames(body: string): Array<Record<string, unknown>> {
    return body
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  }

  const GENERATED = {
    documentId: 4242,
    htmlContent: "<html><body>Hi</body></html>",
    docTypeKey: "governance_snapshot",
    costCents: 1337,
    costStatus: "recorded",
  };

  beforeEach(() => {
    selectResult = [{ pipelineCategory: "standalone", isActive: true, label: "Governance Snapshot" }];
  });

  it("relays the model's text as delta frames and finishes with the real result", async () => {
    const { generateDocument } = await import("../lib/document-engine.ts");
    vi.mocked(generateDocument).mockImplementation((async (params: { onTextDelta?: (t: string) => void }) => {
      params.onTextDelta?.("<html><bo");
      params.onTextDelta?.("dy>Hi</body></html>");
      return GENERATED;
    }) as never);

    const res = await auth(
      request(app)
        .post("/api/admin/document-generator/document-types/governance_snapshot/generate")
        .send({ mspCustomerId: 42, projectId: 0, stream: true }),
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const evts = frames(res.text);
    expect(evts.filter((e) => e["type"] === "delta").map((e) => e["text"]))
      .toEqual(["<html><bo", "dy>Hi</body></html>"]);
    // A phase frame precedes the first delta, so the pane is never blank.
    expect(evts[0]!["type"]).toBe("phase");

    const done = evts.find((e) => e["type"] === "done");
    // The terminal payload carries the SAME fields the JSON shape does, and
    // carries the STORED document rather than the concatenated deltas — those
    // omit the #493 remediation appendix, which is appended after generation.
    expect(done?.["payload"]).toEqual(GENERATED);
  });

  it("still answers plain JSON without stream:true — SimulatorDocumentCanvas depends on it", async () => {
    const { generateDocument } = await import("../lib/document-engine.ts");
    let sawRelay: unknown = "unset";
    vi.mocked(generateDocument).mockImplementation((async (params: { onTextDelta?: (t: string) => void }) => {
      sawRelay = params.onTextDelta;
      return { ...GENERATED, documentId: 7 };
    }) as never);

    const res = await auth(
      request(app)
        .post("/api/admin/document-generator/document-types/governance_snapshot/generate")
        .send({ mspCustomerId: 42, projectId: 0 }),
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ ...GENERATED, documentId: 7 });
    // A non-streaming caller is not handed a relay tap at all.
    expect(sawRelay).toBeUndefined();
  });

  it("a truthy-but-not-true stream flag does not switch transports", async () => {
    const { generateDocument } = await import("../lib/document-engine.ts");
    vi.mocked(generateDocument).mockResolvedValue(GENERATED as never);

    const res = await auth(
      request(app)
        .post("/api/admin/document-generator/document-types/governance_snapshot/generate")
        .send({ mspCustomerId: 42, projectId: 0, stream: "false" }),
    );

    // Same strict `=== true` discipline `forceRegenerate` uses — a body
    // carrying the string "false" must not buy a different response shape.
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("reports a generation failure as an error frame, not a silently dropped stream", async () => {
    const { generateDocument } = await import("../lib/document-engine.ts");
    vi.mocked(generateDocument).mockRejectedValue(new Error("overloaded_error"));

    const res = await auth(
      request(app)
        .post("/api/admin/document-generator/document-types/governance_snapshot/generate")
        .send({ mspCustomerId: 42, projectId: 0, stream: true }),
    );

    // Already 200 by the time generation failed — the status code is spent, so
    // the failure has to travel in-band.
    expect(res.status).toBe(200);
    expect(frames(res.text).find((e) => e["type"] === "error")?.["message"]).toBe("overloaded_error");
    // And no `done` frame, so a client cannot read the failure as a success.
    expect(frames(res.text).some((e) => e["type"] === "done")).toBe(false);
  });

  it("rejects a bad request with a real status code even in streaming mode", async () => {
    const res = await auth(
      request(app)
        .post("/api/admin/document-generator/document-types/governance_snapshot/generate")
        .send({ stream: true }),
    );

    // Validation runs before the headers are flushed, so this is still a 400
    // with a JSON body — not a 200 stream whose first frame is an error.
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("mspCustomerId");
  });

  it("an unknown document type is a 404, not a stream", async () => {
    selectResult = [];

    const res = await auth(
      request(app)
        .post("/api/admin/document-generator/document-types/nope/generate")
        .send({ mspCustomerId: 42, stream: true }),
    );

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
  });
});

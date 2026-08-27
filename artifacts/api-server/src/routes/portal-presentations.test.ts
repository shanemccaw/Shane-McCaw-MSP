/**
 * Tests that the sowVersion fingerprint returned by GET /portal/presentations/:id
 * actually changes when the consolidated_sow document's pricing lines change.
 *
 * The sowVersion is the mechanism that tells an open client tab that Shane has
 * regenerated the SOW — if the fingerprint cannot change, the stale-scope banner
 * can never appear and clients may sign/pay stale prices.
 *
 * Scenarios covered:
 *   (A) sowVersion is stable across two identical fetches with identical pricing.
 *   (B) sowVersion changes when the SOW is "regenerated" with an updated price.
 *   (C) sowVersion changes when a new phase is added to the SOW.
 *   (D) Fallback (no SOW doc): sowVersion is derived from the snapshot phases.
 *
 * DB queue layout — the GET handler fires these selects in order per request
 * (clientUserId is non-null in every fixture below, so the clientUserId-gated
 * steps always fire):
 *   [0] quickWinPresentationsTable          (presRow)
 *   [1] insightsGeneratedDocumentsTable      (liveDocs — by clientUserId, since projectId is null)
 *   [2] insightsGeneratedDocumentsTable      (docsRaw: full HTML for display — only when mergedDocIds is non-empty)
 *   [3] insightsGeneratedDocumentsTable      (docsWithPricing inside deriveEffectiveSowData — only when documentsIncluded is non-empty)
 *   [4] clientM365ProfilesTable              (inside computeSignalDrivenAdjustments — fires whenever clientUserId is non-null)
 *   [5] scriptRunResultsTable                (inside computeSignalDrivenAdjustments — fires whenever clientUserId is non-null)
 *   [6] usersTable                           (clientUser — clientUserId is non-null)
 *
 * projectId is null → no projectsTable select.
 * stripeSessionId is null → no Stripe sync.
 * For the fallback test (documentsIncluded=[]) entries [2] and [3] are skipped
 * since mergedDocIds/documentsIncluded are both empty.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.JWT_SECRET = "sow-version-test-secret-xyz";

// ── Queue-based mock DB ───────────────────────────────────────────────────────
let dbQueue: unknown[][] = [];

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject),
  };
  return chain;
}

function makeMockDb() {
  return {
    select: (_cols?: unknown) => makeChain(dbQueue.shift() ?? []),
    insert: () => ({
      values: () => ({
        returning: async () => [],
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
      onConflictDoNothing: () => ({ returning: async () => [] }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
    execute: async () => ({ rows: [] }),
  };
}

// Trimmed to exactly what portal-presentations.ts (and the tenant-signals.ts /
// sow-pricing.ts helpers it calls) actually import from @workspace/db. The old
// portal.ts pulled in ~50 tables for its whole 16k-line surface; this route
// only ever touches these.
mock.module("@workspace/db", {
  namedExports: {
    db: makeMockDb(),
    quickWinPresentationsTable: {},
    insightsGeneratedDocumentsTable: {},
    projectsTable: {},
    clientServicesTable: {},
    servicesTable: {},
    workflowTemplatesTable: {},
    usersTable: {},
    contractTemplatesTable: {},
    clientM365ProfilesTable: {},
    scriptRunResultsTable: {},
  },
});

// Only requireAuth is imported by portal-presentations.ts (requireAdmin is not).
mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop,
  child: () => noopLogger,
};
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

// Only getStripeKey is imported by portal-presentations.ts; made to throw so
// the route's try/catch treats Stripe as "not configured" and never reaches
// the dynamic `import("stripe")` in the GET handler's auto-sync block.
mock.module("../lib/stripe.ts", {
  namedExports: {
    getStripeKey: () => { throw new Error("Stripe not configured in tests"); },
  },
});

// tenant-signals.ts is mocked (rather than left real) for two reasons: (1) its
// real implementation imports `./logger` without a `.ts` extension, which
// fails ESM resolution under `node --experimental-strip-types`; (2) even if it
// resolved, computeSignalDrivenAdjustments' signal evaluation is irrelevant to
// what these sowVersion tests assert — they only care about workstream phase
// pricing, never about which adj:* signals fired. Trimmed to the three named
// exports portal-presentations.ts actually imports; no signals ever fire, so
// computeSignalDrivenAdjustments resolves to success:true with 0 adjustments,
// matching this file's existing dbQueue expectations.
mock.module("../lib/tenant-signals.ts", {
  namedExports: {
    computeTenantSignals: () => ({ firedSignals: new Set<string>(), trace: [] }),
    getAdjustmentSignalDefinitions: async () => [],
    getDisabledSignalKeys: async () => new Set<string>(),
    // #1397: portal-presentations.ts now customer-scopes /latest and /sign via
    // this bridge; stub to the single-login set so no real DB query is made.
    resolveSiblingUserIds: async (id: number) => [id],
  },
});

const { default: portalPresentationsRouter } = await import("./portal-presentations.ts");
const { default: express } = await import("express");

const app = express();
app.use(express.json());
app.use((_req: unknown, _res: unknown, next: () => void) => {
  (_req as Record<string, unknown>).log = noopLogger;
  next();
});
app.use("/api", portalPresentationsRouter);

let server: http.Server;
let baseUrl: string;

before(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

after(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

// ── Helpers ────────────────────────────────────────────────────────────────────

const PRES_ID = 301;
const SHARE_TOKEN = "sow-version-test-token";

function makePresRow(docIds: number[] = []): Record<string, unknown> {
  return {
    id: PRES_ID,
    shareToken: SHARE_TOKEN,
    clientUserId: 42,
    projectId: null,
    status: "pending",
    stripeSessionId: null,
    signatureData: null,
    signedAt: null,
    signerName: null,
    paymentPlan: null,
    documentsIncluded: docIds,
    sowPhases: [],
    selectedPhaseIds: [],
    totalPrice: "0",
  };
}

function makeSowDoc(pricingLines: Array<{ title: string; scope: string; priceUsd: number; notes: string }>): Record<string, unknown> {
  return {
    id: 10,
    title: "Statement of Work",
    category: "consulting",
    docType: "consolidated_sow",
    htmlContent: "<p>SOW</p>",
    sowPricingLines: pricingLines,
    sowTotalPrice: String(pricingLines.reduce((s, l) => s + l.priceUsd, 0)),
    createdAt: new Date(),
  };
}

/**
 * Build the DB queue for one GET /portal/presentations/:id request with a SOW doc.
 *
 * The handler executes these selects in order:
 *   [0] quickWinPresentationsTable          (presRow)
 *   [1] insightsGeneratedDocumentsTable      (liveDocs — by clientUserId, fires when clientUserId non-null)
 *   [2] insightsGeneratedDocumentsTable      (docsRaw — HTML for display, by mergedDocIds)
 *   [3] insightsGeneratedDocumentsTable      (docsWithPricing inside deriveEffectiveSowData)
 *   [4] clientM365ProfilesTable              (inside computeSignalDrivenAdjustments — fires when clientUserId non-null)
 *   [5] scriptRunResultsTable                (inside computeSignalDrivenAdjustments — fires when clientUserId non-null)
 *   [6] usersTable                           (clientUser — fires when clientUserId is non-null)
 *
 * projectId=null → no projectsTable select.
 * stripeSessionId=null → no Stripe sync select.
 */
function queueForOneGet(pricingLines: Array<{ title: string; scope: string; priceUsd: number; notes: string }>): unknown[][] {
  return [
    [makePresRow([10])],        // [0] presRow
    [makeSowDoc(pricingLines)], // [1] liveDocs (returns doc id 10 — mock db ignores column selection)
    [makeSowDoc(pricingLines)], // [2] docsRaw (HTML display)
    [makeSowDoc(pricingLines)], // [3] docsWithPricing (deriveEffectiveSowData)
    [],                         // [4] clientM365Profile (computeSignalDrivenAdjustments — no profile, no signals fire)
    [],                         // [5] scriptRunResults (computeSignalDrivenAdjustments — no script runs, no signals fire)
    [],                         // [6] clientUser (empty — name is irrelevant for these tests)
  ];
}

async function getPresentation(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/portal/presentations/${PRES_ID}?token=${SHARE_TOKEN}`);
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

// =============================================================================
// (A) sowVersion is stable across two identical fetches with identical pricing
// =============================================================================

describe("GET presentation sowVersion — stable when pricing unchanged", () => {
  const pricingLines = [
    { title: "Phase 1 — Foundation", scope: "Identity setup", priceUsd: 12_000, notes: "" },
    { title: "Phase 2 — Governance", scope: "Policy", priceUsd: 8_000, notes: "" },
  ];

  let first: { status: number; body: Record<string, unknown> };
  let second: { status: number; body: Record<string, unknown> };

  before(async () => {
    dbQueue = [
      ...queueForOneGet(pricingLines),
      ...queueForOneGet(pricingLines),
    ];
    first = await getPresentation();
    second = await getPresentation();
  });

  it("first request returns HTTP 200", () => {
    assert.equal(first.status, 200, `expected 200, got ${first.status}; body: ${JSON.stringify(first.body)}`);
  });

  it("second request returns HTTP 200", () => {
    assert.equal(second.status, 200, `expected 200, got ${second.status}; body: ${JSON.stringify(second.body)}`);
  });

  it("sowVersion is present in both responses", () => {
    assert.ok(first.body.sowVersion, "first response should include sowVersion");
    assert.ok(second.body.sowVersion, "second response should include sowVersion");
  });

  it("sowVersion is identical when pricing is unchanged", () => {
    assert.equal(
      first.body.sowVersion,
      second.body.sowVersion,
      `sowVersion should be stable; got "${String(first.body.sowVersion)}" vs "${String(second.body.sowVersion)}"`,
    );
  });
});

// =============================================================================
// (B) sowVersion changes when the consolidated_sow is regenerated with new prices
// =============================================================================

describe("GET presentation sowVersion — changes after SOW regeneration with new prices", () => {
  const originalPricingLines = [
    { title: "Phase 1 — Foundation", scope: "Identity setup", priceUsd: 12_000, notes: "" },
    { title: "Phase 2 — Governance", scope: "Policy", priceUsd: 8_000, notes: "" },
  ];
  const regeneratedPricingLines = [
    { title: "Phase 1 — Foundation", scope: "Identity setup", priceUsd: 15_000, notes: "" }, // price increased
    { title: "Phase 2 — Governance", scope: "Policy", priceUsd: 8_000, notes: "" },
  ];

  let beforeRegen: { status: number; body: Record<string, unknown> };
  let afterRegen: { status: number; body: Record<string, unknown> };

  before(async () => {
    // First fetch uses original pricing; second fetch uses regenerated pricing.
    // Simulates Shane regenerating the SOW between two client fetches.
    dbQueue = [
      ...queueForOneGet(originalPricingLines),
      ...queueForOneGet(regeneratedPricingLines),
    ];
    beforeRegen = await getPresentation();
    afterRegen = await getPresentation();
  });

  it("pre-regeneration request returns HTTP 200", () => {
    assert.equal(beforeRegen.status, 200, `expected 200, got ${beforeRegen.status}; body: ${JSON.stringify(beforeRegen.body)}`);
  });

  it("post-regeneration request returns HTTP 200", () => {
    assert.equal(afterRegen.status, 200, `expected 200, got ${afterRegen.status}; body: ${JSON.stringify(afterRegen.body)}`);
  });

  it("sowVersion is present in both responses", () => {
    assert.ok(beforeRegen.body.sowVersion, "pre-regeneration response should include sowVersion");
    assert.ok(afterRegen.body.sowVersion, "post-regeneration response should include sowVersion");
  });

  it("sowVersion is DIFFERENT after the SOW is regenerated with new prices", () => {
    assert.notEqual(
      beforeRegen.body.sowVersion,
      afterRegen.body.sowVersion,
      `sowVersion must change when prices change so clients can detect stale scope; ` +
      `pre: "${String(beforeRegen.body.sowVersion)}", post: "${String(afterRegen.body.sowVersion)}"`,
    );
  });

  it("pre-regeneration sowVersion encodes the original Phase 1 price ($12k)", () => {
    const version = String(beforeRegen.body.sowVersion);
    assert.ok(
      version.includes("12000"),
      `pre-regeneration sowVersion should encode 12000; got "${version}"`,
    );
  });

  it("post-regeneration sowVersion encodes the updated Phase 1 price ($15k)", () => {
    const version = String(afterRegen.body.sowVersion);
    assert.ok(
      version.includes("15000"),
      `post-regeneration sowVersion should encode 15000; got "${version}"`,
    );
  });
});

// =============================================================================
// (C) sowVersion changes when a new phase is added to the SOW document
// =============================================================================

describe("GET presentation sowVersion — changes when a new phase is added", () => {
  const twoPhaseLines = [
    { title: "Phase 1", scope: "Discovery", priceUsd: 5_000, notes: "" },
    { title: "Phase 2", scope: "Build", priceUsd: 20_000, notes: "" },
  ];
  const threePhaseLines = [
    { title: "Phase 1", scope: "Discovery", priceUsd: 5_000, notes: "" },
    { title: "Phase 2", scope: "Build", priceUsd: 20_000, notes: "" },
    { title: "Phase 3", scope: "Rollout", priceUsd: 7_500, notes: "" },
  ];

  let beforeAdd: Record<string, unknown>;
  let afterAdd: Record<string, unknown>;

  before(async () => {
    dbQueue = [
      ...queueForOneGet(twoPhaseLines),
      ...queueForOneGet(threePhaseLines),
    ];
    beforeAdd = (await getPresentation()).body;
    afterAdd = (await getPresentation()).body;
  });

  it("sowVersion changes when a new phase is added to the SOW", () => {
    assert.notEqual(
      beforeAdd.sowVersion,
      afterAdd.sowVersion,
      `sowVersion must change when a new SOW phase is added; ` +
      `2-phase: "${String(beforeAdd.sowVersion)}", 3-phase: "${String(afterAdd.sowVersion)}"`,
    );
  });

  it("post-add sowVersion includes the new phase identifier (sow-2)", () => {
    const version = String(afterAdd.sowVersion);
    assert.ok(
      version.includes("sow-2"),
      `sowVersion after adding Phase 3 should include sow-2; got "${version}"`,
    );
  });
});

// =============================================================================
// (D) Fallback (no SOW doc): sowVersion is derived from snapshot phases
// =============================================================================

describe("GET presentation sowVersion — fallback snapshot phases produce a version", () => {
  const snapshotPhases = [
    { id: "snap-A", title: "Phase A", description: "Design", price: 9_000, selected: true },
    { id: "snap-B", title: "Phase B", description: "Deploy", price: 6_000, selected: true },
  ];

  let body: Record<string, unknown>;

  before(async () => {
    // documentsIncluded=[] → no docsRaw or deriveEffectiveSowData docsWithPricing
    // DB calls, but clientUserId is still non-null so liveDocs,
    // computeSignalDrivenAdjustments' two selects, and clientUser all still fire.
    // Queue: [presRow, liveDocs, clientM365Profile, scriptRunResults, clientUser]
    const presRow = {
      id: PRES_ID,
      shareToken: SHARE_TOKEN,
      clientUserId: 42,
      projectId: null,
      status: "pending",
      stripeSessionId: null,
      signatureData: null,
      signedAt: null,
      signerName: null,
      paymentPlan: null,
      documentsIncluded: [],
      sowPhases: snapshotPhases,
      selectedPhaseIds: ["snap-A", "snap-B"],
      totalPrice: "15000",
    };
    dbQueue = [[presRow], [], [], [], []]; // presRow, empty liveDocs, empty clientM365Profile, empty scriptRunResults, empty clientUser
    const { body: b } = await getPresentation();
    body = b;
  });

  it("sowVersion is present even with fallback snapshot phases", () => {
    assert.ok(body.sowVersion, `sowVersion should be present; got ${JSON.stringify(body.sowVersion)}`);
  });

  it("sowVersion encodes both snapshot phase IDs and prices", () => {
    const version = String(body.sowVersion);
    assert.ok(version.includes("snap-A"), `sowVersion should include snap-A; got "${version}"`);
    assert.ok(version.includes("snap-B"), `sowVersion should include snap-B; got "${version}"`);
  });
});

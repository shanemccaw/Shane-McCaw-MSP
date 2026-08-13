/**
 * Integration test for the real persona-generation route's SSE conversion
 * (#283 — root cause of a real 502 Shane hit in production).
 *
 * Root cause established by code inspection (no live Anthropic/DB creds
 * available in this session — see the #283 bookend for the full writeup):
 * the route used to be a single blocking anthropic.messages.create() call, so
 * ZERO response bytes reached the client for the entire generation. A reverse
 * proxy's idle-connection timeout (distinct from, and typically much shorter
 * than, any max-duration timeout) reads that silence as a dead upstream and
 * kills the connection — the browser sees that as a 502.
 *
 * This test proves the fix's actual mechanism, not just that the final JSON
 * shape is still correct: it drives a FAKE Anthropic stream that emits text
 * chunks with real (small) async delays between them, then asserts the route
 * writes multiple distinct SSE chunks to the HTTP response BEFORE the
 * generation finishes — i.e. the connection genuinely stays busy throughout,
 * which is the property that prevents an idle-timeout kill. A regression back
 * to a single blocking write (even one that still returns the right personas)
 * would fail the "multiple chunks arrive before completion" assertion here.
 *
 * Run: pnpm --filter @workspace/api-server run test
 * (uses --experimental-test-module-mocks, same convention as
 * admin-ps-scripts.test.ts)
 */
import { describe, it, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const VALID_QUIZ_PROFILE = {
  role: "Operations Director",
  department: "Operations",
  industry: "Healthcare",
  collaboration: ["internal", "external"],
  sensitivity: ["PHI", "PII"],
  workflowStyle: "structured",
  outcomePriorities: ["reduce-admin-time"],
  draftingLoad: 0.8,
  researchLoad: 0.4,
  communicationLoad: 0.6,
  repetitiveLoad: 0.9,
  toolUsage: ["Teams", "SharePoint / OneDrive"],
  aiComfort: "medium",
};

function personaObject(id: string, name: string) {
  return {
    id,
    name,
    role: `${name} Role`,
    department: "Operations",
    avatar: "💼",
    bgAnimationType: "engineer",
    collaborationPattern: ["Teams", "SharePoint"],
    sensitivitySet: ["PHI"],
    useCaseCluster: "Reporting",
    outcomePriorities: ["Reduce admin time"],
    riskScore: 40,
    feasibilityScore: 70,
    adoptionFriction: 20,
    sensitivityExposure: [{ label: "PHI in email", severity: "Medium" }],
    collaborationFriction: [{ label: "Manual handoffs", severity: "Low" }],
    valuePotential: {
      hoursSavedPerWeek: 5,
      annualValuePerSeat: "$2,000 / seat",
      roiMultiplier: "3.0x ROI",
      primaryBenefit: "Faster reporting",
    },
    shortStory: {
      summary: "A short story summary.",
      telemetryCheck: "Organizations like this commonly see manual handoffs.",
      copilotUnlock: "Copilot drafts the report automatically.",
    },
    expandedNarrative: {
      identityContext: "Context.",
      collaborationSensitivity: "Sensitivity context.",
      telemetryRealityCheck: "Common pattern framing.",
      workflowFriction: "Friction point.",
      feasibilityReadiness: "Readiness note.",
      copilotValueStory: "Value story.",
      roiBreakdown: "ROI breakdown.",
    },
    insightRibbonText: "✨ Headline pattern.",
  };
}

const FIVE_PERSONAS = [
  personaObject("engineering-lead", "Engineering Lead"),
  personaObject("security-lead", "Security Lead"),
  personaObject("pm-lead", "PM Lead"),
  personaObject("writer-lead", "Writer Lead"),
  personaObject("researcher-lead", "Researcher Lead"),
];
const FULL_RESPONSE_TEXT = JSON.stringify(FIVE_PERSONAS);

// ── Fake streaming Anthropic client ───────────────────────────────────────────
// Splits the response into several chunks and emits them with a real (small)
// delay between each — this is what makes the "bytes flow before completion"
// assertion below meaningful rather than trivially true.
function makeChunkedStream(fullText: string, chunkCount: number, delayMs: number) {
  const chunkSize = Math.ceil(fullText.length / chunkCount);
  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += chunkSize) chunks.push(fullText.slice(i, i + chunkSize));

  const textHandlers: ((text: string) => void)[] = [];
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "text") textHandlers.push(cb as (text: string) => void);
      return this;
    },
    async finalMessage() {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        for (const cb of textHandlers) cb(chunk);
      }
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: fullText }],
      };
    },
  };
}

let streamFactory = () => makeChunkedStream(FULL_RESPONSE_TEXT, 6, 15);

mock.module("@workspace/integrations-anthropic-ai", {
  namedExports: {
    anthropic: {
      messages: {
        stream: () => streamFactory(),
      },
    },
  },
});

// Bypass the dev-response-cache's DB dependency entirely — this test is
// about the SSE/streaming mechanism, not the cache. A real cache hit/miss
// would skip streaming altogether, which is exactly the behaviour under test.
mock.module("../lib/ai-dev-response-cache.ts", {
  namedExports: {
    withAiDevResponseCache: async (
      _req: unknown,
      _attribution: unknown,
      fn: () => Promise<unknown>,
    ) => fn(),
  },
});

mock.module("../lib/prompt-loader.ts", {
  namedExports: {
    getPrompt: async (_key: string, fallback: string) => fallback,
  },
});

mock.module("../lib/resolve-msp-id.ts", {
  namedExports: {
    resolveMspId: async () => 1,
  },
});

mock.module("../lib/ai-billing.ts", {
  namedExports: {
    resolveBillingMspId: () => 1,
  },
});

mock.module("../middlewares/requireAuth.ts", {
  namedExports: {
    requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { id: 501, customerId: 77, mspId: 1 };
      next();
    },
  },
});

const noop = () => {};
const noopLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  fatal: noop, trace: noop, child: () => noopLogger,
};
mock.module("../lib/logger.ts", { namedExports: { logger: noopLogger } });

// ── Dynamically import the REAL route module AFTER mocks are registered ───────
const { default: personasRouter } = await import("./copilot-assessment-personas.ts");

const { default: express } = await import("express");
const app = express();
app.use(express.json());
app.use("/api", personasRouter);

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

// Reads the SSE response incrementally, recording a timestamp for each raw
// chunk the OS delivers to us — this is what lets the test distinguish
// "bytes trickled in over time" from "everything arrived in one write at the
// very end", which res.text() alone cannot do.
async function readSseIncrementally(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get("content-type") ?? "";
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunkArrivals: number[] = [];
  let buf = "";
  const events: Record<string, unknown>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkArrivals.push(Date.now());
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        events.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* ignore partial */
      }
    }
  }

  return { status: res.status, contentType, chunkArrivals, events };
}

describe("POST /api/portal/copilot-assessment/personas — SSE conversion (#283)", () => {
  it("streams as text/event-stream, not a single buffered JSON response", async () => {
    const { contentType } = await readSseIncrementally("/api/portal/copilot-assessment/personas", {
      quizProfile: VALID_QUIZ_PROFILE,
    });
    assert.ok(contentType.includes("text/event-stream"), `expected SSE content-type, got: ${contentType}`);
  });

  it("delivers multiple distinct response chunks spaced over real time — the connection stays busy across the whole generation, not idle until the end", async () => {
    const { chunkArrivals } = await readSseIncrementally("/api/portal/copilot-assessment/personas", {
      quizProfile: VALID_QUIZ_PROFILE,
    });

    // A regression back to one blocking write would deliver everything as
    // (at most) one or two chunks with no meaningful time gap between them.
    assert.ok(
      chunkArrivals.length >= 3,
      `expected several distinct chunk arrivals proving incremental delivery, got ${chunkArrivals.length}`,
    );
    const firstToLastSpanMs = chunkArrivals[chunkArrivals.length - 1] - chunkArrivals[0];
    assert.ok(
      firstToLastSpanMs >= 30,
      `expected chunks to arrive spread over real time (>=30ms), got a ${firstToLastSpanMs}ms span — looks like one buffered write`,
    );
  });

  it("emits at least one real progress event before the done event, and pct strictly increases", async () => {
    const { events } = await readSseIncrementally("/api/portal/copilot-assessment/personas", {
      quizProfile: VALID_QUIZ_PROFILE,
    });
    const doneIdx = events.findIndex((e) => e.type === "done");
    assert.ok(doneIdx > 0, `expected a "done" event after at least one progress/phase event, got: ${JSON.stringify(events)}`);

    const pctSeries = events
      .slice(0, doneIdx)
      .filter((e) => typeof e.pct === "number")
      .map((e) => e.pct as number);
    assert.ok(pctSeries.length >= 2, `expected multiple real pct updates before done, got: ${JSON.stringify(pctSeries)}`);
    for (let i = 1; i < pctSeries.length; i++) {
      assert.ok(pctSeries[i] >= pctSeries[i - 1], `pct must never go backwards: ${JSON.stringify(pctSeries)}`);
    }
  });

  it("the done event's payload contains the real generated personas", async () => {
    const { events } = await readSseIncrementally("/api/portal/copilot-assessment/personas", {
      quizProfile: VALID_QUIZ_PROFILE,
    });
    const doneEvent = events.find((e) => e.type === "done");
    const payload = doneEvent?.payload as { personas?: unknown[] } | undefined;
    assert.ok(Array.isArray(payload?.personas), `expected done.payload.personas to be an array, got: ${JSON.stringify(doneEvent)}`);
    assert.equal(payload!.personas!.length, 5);
  });

  it("rejects a request with no quizProfile before opening any stream", async () => {
    const res = await fetch(`${baseUrl}/api/portal/copilot-assessment/personas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.ok(body.error);
  });

  it("sends an SSE error event (not a raw 500) when generation fails after the stream has already started", async () => {
    const priorFactory = streamFactory;
    streamFactory = () => ({
      on() { return this; },
      async finalMessage() {
        throw new Error("simulated upstream failure mid-stream");
      },
    });
    try {
      const { status, events } = await readSseIncrementally("/api/portal/copilot-assessment/personas", {
        quizProfile: VALID_QUIZ_PROFILE,
      });
      assert.equal(status, 200, "SSE headers are already committed once streaming starts, so a mid-stream failure cannot become a fresh HTTP error status");
      const errorEvent = events.find((e) => e.type === "error");
      assert.ok(errorEvent, `expected an SSE error event, got: ${JSON.stringify(events)}`);
    } finally {
      streamFactory = priorFactory;
    }
  });
});

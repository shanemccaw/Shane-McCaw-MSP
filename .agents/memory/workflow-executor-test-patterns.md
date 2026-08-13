---
name: workflow-executor Vitest mock patterns
description: Gotchas when unit-testing workflow-executor.ts with Vitest — fs mock shape, node data field names, and DB queue patterns.
---

# workflow-executor Vitest test patterns

## Rule
When writing Vitest tests for `artifacts/api-server/src/lib/workflow-executor.ts`, the mock shapes and node data field names must exactly match what the executor reads at runtime.

**Why:** The executor is 6400 lines with many subtle field-name conventions. Mismatches silently produce error status instead of an assertion failure on the value you intended to test.

## How to apply

### fs/promises mock — always include default export
The executor uses `import fs from "fs/promises"` (default import). A named-only mock leaves `fs.writeFile` and `fs.mkdir` as `undefined` at runtime, causing all article-write and image-write nodes to throw.

```ts
vi.mock("fs/promises", () => {
  const fsMock = {
    writeFile: async () => {},
    mkdir:     async () => {},
    readFile:  async () => Buffer.from(""),
  };
  return { default: fsMock, ...fsMock };  // BOTH default and named
});
```

### condition node — use a full JS-style expression string
`case "condition"` reads `node.data.expression` as a single complete comparison
string parsed by `evalCondition()`. Separate `conditionOp` / `conditionValue`
fields are ignored.

```ts
// CORRECT
singleNodeGraph("condition", { expression: "{{score}} > 50" })
// WRONG (fields silently ignored)
singleNodeGraph("condition", { conditionExpr: "{{score}}", conditionOp: "gt", conditionValue: "50" })
```

The output key is `result` (boolean), not `conditionResult`.

### find_object node — uses fieldName / fieldValueExpr
```ts
singleNodeGraph("find_object", {
  objectType:     "lead",
  fieldName:      "email",      // NOT lookupField
  fieldValueExpr: "foo@bar.com", // NOT lookupValue — interpolated against payload
})
```

### publish_article — reads from payload, not DB
The node requires `articleTitle` and `articleContent` in the **payload** (set by a preceding generate_article node). It does NOT look up an existing article by slug. It only does one DB SELECT (slug conflict check) before inserting.

```ts
seedDb(
  singleNodeGraph("publish_article", {}),
  { articleTitle: "My Article", articleContent: "# Body\n\nContent." },
  [[]], // empty result for slug conflict check
);
```

The DB mock's `returning()` for the article INSERT must include `summary` (with a string value) because the node calls `newArticle.summary.replace(...)`.

### generate_article / generate_landing_page — anthropic mock JSON must satisfy all parsers
Both nodes call `anthropic.messages.create` and parse the JSON response. Use a
single mock response that includes ALL expected keys so every node gets what
it needs:

```ts
JSON.stringify({
  // generate_article keys
  title: "Microsoft 365 Best Practices", slug: "m365-best-practices",
  summary: "A guide.", date: "January 1, 2025", content: "# Heading\n\nBody.",
  // generate_landing_page keys
  headline: "Your M365 Tenant Is a Risk", subheadline: "Framing sentence.",
  valuePropBlocks: [{ icon: "🔍", heading: "Security", body: "Fix gaps." }],
  socialProof: [], cta: { buttonText: "Book Now", href: "/contact" },
  // topic_picker / fetch_news_headlines keys
  topic: "M365 Tips", rationale: "High intent", context: "Ctx",
  hotScore: 70, targetSector: "Enterprise", articleSuggestion: "Write guide",
})
```

### generate_image — mock openai.images.generate, not generateImage helper
The executor imports `import { openai } from "@workspace/integrations-openai-ai-server/image"` and calls `openai.images.generate(...)` which returns `{ data: [{ b64_json }] }`.

```ts
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  openai: {
    images: {
      generate: async () => ({ data: [{ b64_json: "aGVsbG8=" }] }),
    },
  },
  generateImage: async () => ({ imageUrl: "http://x.com/img.png", revisedPrompt: "test" }),
}));
```

### Constructor mocks (used with `new`) — must use regular function, not arrow

When mocking a class instantiated via `new` (e.g. `new Stripe(...)`), the
`mockImplementation` factory must be a regular `function`, not an arrow function.
Arrow functions cannot be constructors; vitest warns and the mock silently returns
`undefined`, causing the route to throw.

```ts
// CORRECT
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { checkout: { sessions: { create: mockCreate } }, webhooks: { ... } };
  }),
}));

// WRONG — arrow functions cannot be constructors
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({ ... })),  // vitest warning + crash
}));
```

### vi.hoisted() for mocks shared across vi.mock() factories

`vi.mock()` factories are hoisted before module-level `const` declarations. Any
`vi.fn()` variable referenced inside a factory must be declared via `vi.hoisted()`,
which runs before factories. Without it the variable is in TDZ (temporal dead zone)
when the factory evaluates and the mock function is `undefined`.

```ts
const { mockCreate, mockDbSelect } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function () {
    return { checkout: { sessions: { create: mockCreate } } };
  }),
}));
```

### DB queue pattern
Every `executeWorkflowRun(runId)` call consumes a queue in order:
1. `[runRow]` — wfRunsTable SELECT
2. `[versionRow]` — wfVersionsTable SELECT
3. `[{ status: "running" }]` — wfRunsTable SELECT (cancellation check)
4. Any additional SELECTs the node itself makes (via extraRows)

Pass extraRows as the third argument to `seedDb()`.

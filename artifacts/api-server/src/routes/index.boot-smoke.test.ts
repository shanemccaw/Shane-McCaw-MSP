import { describe, expect, it, vi } from "vitest";

// #2881 — process guard against the entire "a route file's module-scope
// evaluation error reaches main undetected" failure class. The actual bug
// this issue was filed against (a missing `requireRole` import, duplicate of
// #2874) never failed at *type-check* time in a way anyone ran, and the
// server only found out at process boot, in production, when Express threw
// evaluating `./routes/index`. This test imports that same aggregator module
// directly and asserts it evaluates (and every one of the ~150 route modules
// it re-exports transitively evaluates) without throwing — any file in that
// import graph with a broken import, a throw at module scope, or a missing
// export used at module scope fails this test the same way it would have
// failed real boot, but in CI/dev instead of production.
//
// #2876 — this aggregator's import graph is large (~150 route modules, each
// pulling in @workspace/db, @workspace/api-zod, etc.), so a cold import here
// is genuinely slower than a typical unit test; the raised timeout below is
// sized for that, not masking a hang.
describe("routes/index boot smoke", () => {
  it("imports without throwing and exports a usable Express router", async () => {
    // #3029 — stub the env vars module-scope code in the import graph reads
    // at eval time, so this test is genuinely self-contained rather than
    // depending on ambient environment state (a real DATABASE_URL, real AI
    // integration creds, etc. happening to already be present in the shell
    // that runs it). Values are fake/unreachable — nothing here needs a live
    // connection, only presence.
    // Port 1 has nothing listening, so any accidental module-scope query
    // against this fails instantly with ECONNREFUSED instead of doing a
    // real (if failing) auth round trip against whatever Postgres happens
    // to be listening on the real default port in this environment.
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/db");
    vi.stubEnv(
      "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
      "https://example.invalid/anthropic",
    );
    vi.stubEnv("AI_INTEGRATIONS_ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv(
      "AI_INTEGRATIONS_OPENAI_BASE_URL",
      "https://example.invalid/openai",
    );
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "test-openai-key");

    const mod = await import("./index");
    const router = mod.default;

    expect(router).toBeTruthy();
    // A real Express Router exposes `.use`/`.handle` — assert shape, not just
    // truthiness, so a module that imports fine but exports the wrong thing
    // (e.g. an empty object) still fails this test.
    expect(typeof (router as unknown as { use?: unknown }).use).toBe(
      "function",
    );
    expect(typeof (router as unknown as { handle?: unknown }).handle).toBe(
      "function",
    );
    // #3066 — the previous 60s ceiling was still hit once under a real
    // full-suite run even after vitest.config.ts capped the thread pool
    // (cpus/2) to relieve contention: this file's ~150-module import graph
    // is the single most import-heavy file in the suite, so it's the one
    // most exposed to whatever CPU/transform contention remains under full
    // parallelism. 90s gives real margin without masking a genuine hang —
    // it passes in ~1-2s in isolation (see the test run in build-journal/
    // 3066.md), so anything actually reaching this ceiling is still a real
    // failure, not a timeout tuned to hide one.
  }, 90_000);
});

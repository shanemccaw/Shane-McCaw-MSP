import { describe, expect, it } from "vitest";

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
  }, 60_000);
});

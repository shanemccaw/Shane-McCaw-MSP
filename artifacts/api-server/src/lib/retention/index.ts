/**
 * Platform retention & soft delete (Git #1947, EPIC #1944).
 *
 * The foundation only — schema, the freeze-safe clock, the referential delete guard,
 * and the provenance gate. No UI, no routes, no per-module wiring: every registry here
 * ships empty and each consuming module registers itself in its own issue.
 *
 * Start at `lifecycle.ts` — `softDelete()` is the one write path that replaces
 * `DELETE FROM` across the platform.
 */

export * from "./clock";
export * from "./policy";
export * from "./origin-registry";
export * from "./reference-guard";
export * from "./registry";
export * from "./lifecycle";
// #2765 — the subscription gate, the freeze/resume trigger, and the 7-year
// post-termination purge scheduler. The foundation above built the clock; these three
// are what start, stop and finally run it.
export * from "./subscription-state";
export * from "./subscription-gate";
export * from "./post-termination";

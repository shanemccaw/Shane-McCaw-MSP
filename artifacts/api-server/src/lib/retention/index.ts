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
// #2859 — the real per-module tenant-data purgers the post-termination purge drives, and
// `registerAllTenantDataPurgers()`, the single point that arms them. Exporting the
// declarations does NOT register them: arming is an explicit call, made once at startup,
// so importing this barrel anywhere cannot arm an irreversible destructive path as a side
// effect. Until that call the registry is empty and `purgeTerminatedTenant()` refuses.
export * from "./purgers";
// #2936 — Shane's decision that an MSP's own lapse cascades to its customers, and the
// limited-access half of that decision: a gated customer can still request reinstatement.
export * from "./msp-cascade";
export * from "./reinstatement";

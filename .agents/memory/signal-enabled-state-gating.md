---
name: Tenant signal enable/disable gating
description: How disabled tenant/adjustment signals are kept from firing across every computeTenantSignals call site
---

Disabling a signal must skip rule evaluation entirely (not just filter the result afterward), because both project-inclusion and adjustment-signal-driven pricing authorization key off the fired-signal set produced by `computeTenantSignals`.

**Why:** there is no single choke point — `computeTenantSignals` is called from multiple admin routes (evaluate, preview-projects, health, dry-run-sow, simulation-profile run) and from two separate code paths in the SOW generator (DB-eval path, and the `signalsOverride` fast path used by the workflow executor). Missing any one call site would let a "disabled" signal still fire silently in that flow.

**How to apply:** a shared `getDisabledSignalKeys()` helper (in the same module as `computeTenantSignals`) fetches the disabled-key set — use it and pass the result as the 5th arg to every call site. When a caller receives a pre-computed `Set<string>` of fired signals from elsewhere (an override/cache), also filter that set against disabled keys before using it — don't assume it was already filtered upstream. Grep for `computeTenantSignals(` across the whole api-server (routes AND lib) whenever adding a new one, since call sites are spread across route files, the SOW generator, the workflow executor, and portal pricing — it's easy to miss one.

/**
 * REGISTERING THE PER-MODULE TENANT-DATA PURGERS (Git #2859, EPIC #1944 part 7).
 *
 * `registerAllTenantDataPurgers()` is the single arming point. Until it is called the
 * registry is empty and `purgeTerminatedTenant()` refuses — which is exactly the state
 * #2765 shipped and #2859 closes, and it is worth keeping reachable rather than replacing
 * with import-time side effects:
 *
 *   - a module that registers itself on import arms an irreversible destructive path as a
 *     side effect of any file that happens to pull it in transitively;
 *   - the refusal path is a real safety behaviour with its own tests, and it has to stay
 *     testable without unloading modules.
 *
 * The api-server calls this once at startup, in the same block that schedules the sweep,
 * so the two can never be wired apart — see `src/index.ts`.
 *
 * IDEMPOTENT ON PURPOSE. `registerTenantDataPurger()` throws on a duplicate key, and that
 * throw is a real guard worth keeping (two registrations for one key would decide by
 * import order which one actually runs). But "called twice" is not that failure: a second
 * call with the same declarations is the same registry. So already-registered keys are
 * skipped, and only a genuinely conflicting key still throws.
 */

import { declareTenantDataPurger } from "./declare";
import { ALL_TENANT_DATA_PURGER_DECLARATIONS } from "./modules";
import { listTenantDataPurgers, registerTenantDataPurger } from "../registry";

export * from "./declare";
export * from "./modules";

/**
 * Register every module's declared whole-tenant purge.
 *
 * @returns the keys registered by THIS call — empty on a second call, which is how a
 *          caller can tell "already armed" from "just armed" without inspecting the
 *          registry itself.
 */
export function registerAllTenantDataPurgers(): string[] {
  const already = new Set(listTenantDataPurgers().map((p) => p.key));
  const registered: string[] = [];

  for (const declaration of ALL_TENANT_DATA_PURGER_DECLARATIONS) {
    if (already.has(declaration.key)) continue;
    registerTenantDataPurger(declareTenantDataPurger(declaration));
    registered.push(declaration.key);
  }
  return registered;
}

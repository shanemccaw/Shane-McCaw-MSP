/**
 * security-plan-drift.ts — the live-vs-last-signed comparison #1562 settles (part of
 * #1495/#1485).
 *
 * #1562's own tension: "cumulative" (a signed version, frozen at a point in time) and
 * "live" (true today) pull in opposite directions. The resolution is not to pick one —
 * it's that the live view carries its drift from the last signed version alongside it,
 * so a reader can see both "what was signed" and "what has moved since" without the
 * document silently re-rendering out from under a prior signature.
 *
 * PURE — takes two already-assembled `SecurityPlanContent` snapshots (the live one and
 * the last signed one) and diffs them by item id, per module. No DB access here, so the
 * comparison itself is unit-testable without seeding — `computeSecurityPlanDrift` is the
 * whole guarantee; `getSecurityPlanDrift` just wires it to the real reads.
 */
import type { SecurityPlanAssembledItem, SecurityPlanContent, SecurityPlanDrift, SecurityPlanModuleDrift } from "@workspace/db";
import { getLastSignedSecurityPlanVersion } from "./security-plan-versioning.ts";
import { assembleSecurityPlan, HONEST_SCOPE } from "./security-plan-assembly.ts";
import type { TenantScope } from "./portal-customer-scope.ts";

/** True when two items carry the same displayed state — the only fields a reader can
 * actually see change; `pillar`/`framework` are classification, not content. */
function sameContent(a: SecurityPlanAssembledItem, b: SecurityPlanAssembledItem): boolean {
  return a.state === b.state && a.detail === b.detail;
}

/**
 * Diffs the live (honest, unscoped) assembled document against the last SIGNED
 * snapshot, module by module. Modules are matched by `key`; a module present in one
 * side only contributes its whole item set as added/removed. `hasLastSignedVersion`
 * false means nothing has ever been signed — there is no "the same" or "different" yet,
 * just no baseline.
 */
export function computeSecurityPlanDrift(
  live: SecurityPlanContent,
  lastSigned: SecurityPlanContent | null,
  lastSignedMeta: { versionUid: string; versionNumber: number; signedAt: string | null } | null,
): SecurityPlanDrift {
  if (!lastSigned || !lastSignedMeta) {
    return {
      hasLastSignedVersion: false,
      lastSignedVersionUid: null,
      lastSignedVersionNumber: null,
      lastSignedAt: null,
      modules: [],
      totalAdded: 0,
      totalRemoved: 0,
      totalChanged: 0,
    };
  }

  const signedModulesByKey = new Map(lastSigned.modules.map((m) => [m.key, m]));
  const seenKeys = new Set<string>();
  const modules: SecurityPlanModuleDrift[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalChanged = 0;

  for (const liveModule of live.modules) {
    seenKeys.add(liveModule.key);
    const signedModule = signedModulesByKey.get(liveModule.key);
    const signedItemsById = new Map((signedModule?.items ?? []).map((i) => [i.id, i]));
    const liveIds = new Set(liveModule.items.map((i) => i.id));

    const added: SecurityPlanAssembledItem[] = [];
    const changed: SecurityPlanModuleDrift["changed"][number][] = [];
    for (const item of liveModule.items) {
      const prior = signedItemsById.get(item.id);
      if (!prior) {
        added.push(item);
      } else if (!sameContent(prior, item)) {
        changed.push({
          id: item.id,
          title: item.title,
          from: { state: prior.state, detail: prior.detail },
          to: { state: item.state, detail: item.detail },
        });
      }
    }
    const removed = (signedModule?.items ?? []).filter((i) => !liveIds.has(i.id));

    if (added.length || removed.length || changed.length) {
      modules.push({ moduleKey: liveModule.key, label: liveModule.label, added, removed, changed });
      totalAdded += added.length;
      totalRemoved += removed.length;
      totalChanged += changed.length;
    }
  }

  // A module that existed in the signed snapshot but is entirely absent from the live
  // read (e.g. a source module that stopped returning any rows) — every one of its
  // signed items is a removal.
  for (const signedModule of lastSigned.modules) {
    if (seenKeys.has(signedModule.key) || signedModule.items.length === 0) continue;
    modules.push({
      moduleKey: signedModule.key,
      label: signedModule.label,
      added: [],
      removed: signedModule.items,
      changed: [],
    });
    totalRemoved += signedModule.items.length;
  }

  return {
    hasLastSignedVersion: true,
    lastSignedVersionUid: lastSignedMeta.versionUid,
    lastSignedVersionNumber: lastSignedMeta.versionNumber,
    lastSignedAt: lastSignedMeta.signedAt,
    modules,
    totalAdded,
    totalRemoved,
    totalChanged,
  };
}

/** Assembles the live (honest) document for `tenant`, reads the last signed version (if
 * any), and returns both plus their diff. The live half is always the honest, unscoped
 * view — drift is meant to answer "what actually moved since the signature," and
 * comparing against a caller-supplied scope would make that answer depend on what the
 * caller happened to ask for rather than what changed. */
export async function getSecurityPlanDrift(
  tenant: TenantScope,
): Promise<{ live: SecurityPlanContent; drift: SecurityPlanDrift }> {
  const [live, lastSignedRow] = await Promise.all([
    assembleSecurityPlan(tenant, HONEST_SCOPE),
    getLastSignedSecurityPlanVersion(tenant.mspId, tenant.customerId),
  ]);

  const drift = computeSecurityPlanDrift(
    live,
    lastSignedRow?.content ?? null,
    lastSignedRow
      ? {
          versionUid: lastSignedRow.versionUid,
          versionNumber: lastSignedRow.versionNumber,
          signedAt: lastSignedRow.signedAt instanceof Date ? lastSignedRow.signedAt.toISOString() : null,
        }
      : null,
  );

  return { live, drift };
}

/**
 * free-scan-write-scopes.ts — Git #1375 (Phase of Feature #1352, Free Scan).
 *
 * Which Microsoft Graph application permissions the Remediate step asks a Free
 * Scan Prospect to approve, DERIVED from the phases they actually bought in the
 * Review step (#1374) and from their own scan's findings — never a fixed list.
 *
 * ── The derivation, end to end ────────────────────────────────────────────────
 * Every link in this chain is real data already in the platform. Nothing here
 * authors a permission or a justification of its own.
 *
 *   paid phase (free_scan_engagements.selected_phase_slugs)
 *     → the phase's pillar          (FREE_SCAN_SOW_PHASES — one phase, one pillar)
 *     → this tenant's OPEN findings on that pillar
 *         (resolveRemediationChecklist → the latest run's critical/warning
 *          findings, filed to a pillar by buildCheckKeyPillarMap/pillarForCheckKey,
 *          i.e. exactly the same #521 resolution the pillar cards use)
 *     → the ACTIVE config packs whose templates map those check keys
 *         (config_pack_templates.check_key — the same live-pack join #1539's
 *          `writePackAvailable` already keys the fix route on)
 *     → those templates' real Graph writes (baseline_action_templates.method /
 *       .endpoint / .body_template)
 *     → the application permission Microsoft documents for that exact
 *       method + path (requiredPermissionsForWrite, lib/graph-write-permissions.ts)
 *
 * So a Prospect who bought only Identity & Access Hardening is shown only the
 * permissions the identity-pillar findings in THEIR tenant would actually
 * consume, and a Prospect with no open finding on a bought phase is told that
 * plainly rather than shown a permission nothing would use.
 *
 * ── What this list is NOT ─────────────────────────────────────────────────────
 * It is NOT a narrowing of the grant itself, and it must never be presented as
 * one. Microsoft's v2 `/adminconsent` flow passes no scope parameter at all
 * (see `buildAdminConsentUrl`) — it grants whatever the WRITE App Registration
 * declares in Entra, full stop. This module therefore intersects the derived
 * set with `REQUIRED_WRITE_APP_PERMISSIONS` (the union the registration is kept
 * in step with) and returns `grantedBeyondScope`: the permissions the same
 * single click also grants that the bought phases do NOT need. Showing the
 * derived subset while silently implying the grant stops there would be the
 * false-narrow version of exactly the false-green `admin-write-permissions.ts`
 * exists to kill.
 *
 * A permission a rule needs but the platform deliberately does not request
 * (`grantRecommended: false`) is excluded: consenting cannot produce it, so
 * listing it on a consent screen would promise something the click cannot do.
 */

import { db, servicesTable, configPacksTable, configPackTemplatesTable, baselineActionTemplatesTable, monitorChecksTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { FREE_SCAN_SOW_PHASES } from "./free-scan-sow.ts";
import { resolveRemediationChecklist } from "./remediation-checklist.ts";
import { buildCheckKeyPillarMap, pillarForCheckKey, type PillarSummaryKey } from "./pillar-summary-stats.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import {
  requiredPermissionsForWrite,
  isNonGraphEndpoint,
} from "./graph-write-permissions.ts";
import { REQUIRED_WRITE_APP_PERMISSIONS } from "./graph.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "integration.azure" });

/**
 * The confirmed design's own copy for the three permissions it names, verbatim
 * from `Design/marketing/marketing_handoff/Marketing Checkout.dc.html`'s
 * `writeScopes`. Copy, not data: it is used only when the derivation above has
 * ALREADY established that this Prospect's bought phases genuinely require the
 * permission. A permission the design does not name falls back to the real
 * `justification` its matched rule carries in `graph-write-permissions.ts`,
 * which that file defines as "the concrete product step that needs it — this is
 * the customer-facing justification".
 */
const DESIGN_SCOPE_COPY: Readonly<Record<string, string>> = {
  "Policy.ReadWrite.ConditionalAccess":
    "Lets Identity & Access Hardening apply the policy set instead of describing it.",
  "Directory.ReadWrite.All": "Removes the standing Global Admins and stale guests the scan named.",
  "Sites.FullControl.All":
    "Closes the oversharing on the specific sites Sharing Exposure Remediation covers.",
};

/** One permission the Remediate step asks for, and why THIS Prospect needs it. */
export interface FreeScanWriteScope {
  /** The Graph application permission (appRole `value`). */
  permission: string;
  /** Customer-facing justification — the design's copy where it names one, the rule's own otherwise. */
  why: string;
  /** The bought phases whose findings drive it. */
  phaseSlugs: string[];
  phaseNames: string[];
  /** The tenant's real open check keys behind it — the evidence, not decoration. */
  checkKeys: string[];
}

/** A bought phase that has nothing for write access to do, and the honest reason. */
export interface FreeScanPhaseWithoutWrite {
  slug: string;
  name: string;
  /**
   * `no_open_findings`  — the scan found nothing adverse on this phase's pillar.
   * `no_executable_fix` — it found findings, but no active config pack maps any
   *                       of them, so nothing on this phase can be applied for
   *                       the customer whatever they consent to.
   */
  reason: "no_open_findings" | "no_executable_fix";
}

export interface FreeScanWriteScopeResult {
  /** `msp_diagnostic_runs.run_id` the findings came from, or null when the tenant has never scanned. */
  runId: string | null;
  /** Derived, deduped, ordered — the "Scopes requested" card. */
  scopes: FreeScanWriteScope[];
  /** Bought phases contributing no scope, each with its real reason. */
  phasesWithoutWrite: FreeScanPhaseWithoutWrite[];
  /**
   * Permissions the ONE admin-consent click also grants, beyond what the bought
   * phases need. Never empty for a partial-scope purchase — Microsoft's
   * /adminconsent grants the whole registration. Surfaced so the screen can be
   * honest rather than implying a per-phase grant that does not exist.
   */
  grantedBeyondScope: string[];
}

/** `services.slug` → `services.name` for the six real phase rows. */
async function phaseNamesBySlug(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await db
    .select({ slug: servicesTable.slug, name: servicesTable.name })
    .from(servicesTable)
    .where(inArray(servicesTable.slug, slugs));
  return new Map(rows.flatMap((r) => (r.slug ? [[r.slug, r.name] as const] : [])));
}

/**
 * The real check → pillar table, resolved exactly as `buildPillarSummary` does
 * it (#521): `signal_derivation_rules.pillar` for the check's owning signal
 * first, `PILLAR_CHECK_DOMAINS` prefix fallback second. Built here rather than
 * taken off `buildPillarSummary` because that function's per-card `findings`
 * array is CAPPED for display, and a capped list would silently drop a
 * permission a real finding needs.
 */
async function buildPillarResolver(): Promise<(checkKey: string) => PillarSummaryKey | null> {
  const [{ rules }, checkDefinitions] = await Promise.all([
    fetchSignalRulesAndGroups(),
    db
      .select({ key: monitorChecksTable.key, mapping: monitorChecksTable.mapping, properties: monitorChecksTable.properties })
      .from(monitorChecksTable),
  ]);
  const map = buildCheckKeyPillarMap(rules, checkDefinitions);
  return (checkKey: string) => pillarForCheckKey(checkKey, map);
}

/**
 * Resolve the write scopes the Remediate step should request for one Prospect.
 *
 * `selectedPhaseSlugs` is the engagement's own stored selection — the caller
 * reads it off `free_scan_engagements`, never off the request body.
 */
export async function resolveFreeScanWriteScopes(
  customerId: number,
  selectedPhaseSlugs: readonly string[],
): Promise<FreeScanWriteScopeResult> {
  const requestable = new Set(REQUIRED_WRITE_APP_PERMISSIONS);

  // Bought phases, in the catalog's delivery order.
  const boughtPhases = FREE_SCAN_SOW_PHASES.filter((p) => selectedPhaseSlugs.includes(p.slug));
  const names = await phaseNamesBySlug(boughtPhases.map((p) => p.slug));

  if (boughtPhases.length === 0) {
    return { runId: null, scopes: [], phasesWithoutWrite: [], grantedBeyondScope: [...requestable].sort() };
  }

  const [{ runId, items }, pillarOf] = await Promise.all([
    resolveRemediationChecklist(customerId),
    buildPillarResolver(),
  ]);

  // ── Which of this tenant's open findings belong to which bought phase ───────
  const phaseByPillar = new Map<PillarSummaryKey, (typeof boughtPhases)[number]>(
    boughtPhases.map((p) => [p.pillar, p]),
  );
  const checkKeysByPhase = new Map<string, Set<string>>(boughtPhases.map((p) => [p.slug, new Set<string>()]));
  for (const item of items) {
    const pillar = pillarOf(item.checkKey);
    if (!pillar) continue; // unclaimed check — attaches to no card and to no phase
    const phase = phaseByPillar.get(pillar);
    if (!phase) continue; // a pillar whose phase the Prospect deferred
    checkKeysByPhase.get(phase.slug)!.add(item.checkKey);
  }

  const allCheckKeys = [...new Set([...checkKeysByPhase.values()].flatMap((s) => [...s]))];

  // ── The real executable steps those checks map to ───────────────────────────
  // Same join `remediation-checklist.ts` uses for `writePackAvailable`, carried
  // one hop further into the template that holds the actual method + endpoint.
  const steps = allCheckKeys.length
    ? await db
        .select({
          checkKey: configPackTemplatesTable.checkKey,
          templateId: baselineActionTemplatesTable.templateId,
          method: baselineActionTemplatesTable.method,
          endpoint: baselineActionTemplatesTable.endpoint,
          bodyTemplate: baselineActionTemplatesTable.bodyTemplate,
        })
        .from(configPackTemplatesTable)
        .innerJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId))
        .innerJoin(
          baselineActionTemplatesTable,
          eq(baselineActionTemplatesTable.templateId, configPackTemplatesTable.templateId),
        )
        .where(
          and(
            inArray(configPackTemplatesTable.checkKey, allCheckKeys),
            isNotNull(configPackTemplatesTable.checkKey),
            eq(configPacksTable.status, "active"),
          ),
        )
    : [];

  const stepsByCheckKey = new Map<string, typeof steps>();
  for (const s of steps) {
    if (!s.checkKey) continue;
    const list = stepsByCheckKey.get(s.checkKey) ?? [];
    list.push(s);
    stepsByCheckKey.set(s.checkKey, list);
  }

  // ── Fold every bought phase's steps into one permission → evidence map ──────
  interface Accum {
    phaseSlugs: Set<string>;
    phaseNames: Set<string>;
    checkKeys: Set<string>;
    justifications: string[];
  }
  const byPermission = new Map<string, Accum>();
  const phasesWithoutWrite: FreeScanPhaseWithoutWrite[] = [];

  for (const phase of boughtPhases) {
    const phaseName = names.get(phase.slug) ?? phase.pillarLabel;
    const checkKeys = [...(checkKeysByPhase.get(phase.slug) ?? [])];

    if (checkKeys.length === 0) {
      phasesWithoutWrite.push({ slug: phase.slug, name: phaseName, reason: "no_open_findings" });
      continue;
    }

    let contributed = false;
    for (const checkKey of checkKeys) {
      for (const step of stepsByCheckKey.get(checkKey) ?? []) {
        // Exchange Online / Defender endpoints: no Graph permission can make
        // these run, so no Graph consent should be attributed to them.
        if (isNonGraphEndpoint(step.endpoint)) continue;

        const look = requiredPermissionsForWrite(step.method, step.endpoint, {
          templateId: step.templateId,
          body: step.bodyTemplate,
        });
        // An unmapped step's requirement is UNKNOWN, not "none" — it contributes
        // no permission rather than a guessed one (`rule: null`).
        if (!look.rule || look.appOnlyUnsupported) continue;

        const notRequested = new Set(look.notRequested);
        for (const permission of look.required) {
          // Deliberately-not-requested, or simply not declared by the write app:
          // consenting cannot produce it, so it is never shown as a scope.
          if (notRequested.has(permission) || !requestable.has(permission)) continue;
          const acc = byPermission.get(permission) ?? {
            phaseSlugs: new Set<string>(),
            phaseNames: new Set<string>(),
            checkKeys: new Set<string>(),
            justifications: [],
          };
          acc.phaseSlugs.add(phase.slug);
          acc.phaseNames.add(phaseName);
          acc.checkKeys.add(checkKey);
          acc.justifications.push(look.rule.justification);
          byPermission.set(permission, acc);
          contributed = true;
        }
      }
    }

    if (!contributed) {
      phasesWithoutWrite.push({ slug: phase.slug, name: phaseName, reason: "no_executable_fix" });
    }
  }

  // ── Order: the design's own three first, then the rest alphabetically ───────
  // The design names these in a deliberate order; anything derived beyond them
  // is stable-sorted so two reads of the same state cannot disagree.
  const designOrder = Object.keys(DESIGN_SCOPE_COPY);
  const orderOf = (permission: string): number => {
    const i = designOrder.indexOf(permission);
    return i === -1 ? designOrder.length : i;
  };

  const scopes: FreeScanWriteScope[] = [...byPermission.entries()]
    .map(([permission, acc]) => ({
      permission,
      why: DESIGN_SCOPE_COPY[permission] ?? acc.justifications[0] ?? "",
      phaseSlugs: [...acc.phaseSlugs],
      phaseNames: [...acc.phaseNames],
      checkKeys: [...acc.checkKeys].sort(),
    }))
    .sort((a, b) => orderOf(a.permission) - orderOf(b.permission) || a.permission.localeCompare(b.permission));

  const asked = new Set(scopes.map((s) => s.permission));
  const grantedBeyondScope = [...requestable].filter((p) => !asked.has(p)).sort();

  log.info(
    {
      customerId,
      runId,
      boughtPhases: boughtPhases.length,
      scopeCount: scopes.length,
      phasesWithoutWrite: phasesWithoutWrite.length,
      grantedBeyondScope: grantedBeyondScope.length,
    },
    "free-scan write scopes derived from paid phases and real findings",
  );

  return { runId, scopes, phasesWithoutWrite, grantedBeyondScope };
}

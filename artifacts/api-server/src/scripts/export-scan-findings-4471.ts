// Git #4471 — export one COMPLETED diagnostics run's findings to JSON, with a per-finding
// cross-reference against the real remediation catalog.
//
//   node artifacts/api-server/run-script.mjs src/scripts/export-scan-findings-4471.ts <runId> <outFile>
//
// Everything written comes from the database rows of that run and the live catalog tables,
// classified by the SAME functions the product uses. Nothing is estimated:
//
//   executable          — >=1 config_pack_templates row maps this check_key, with a non-null
//                         template_id, in a config_packs row whose status is 'active'. This is
//                         the exact `writePackAvailable` predicate from remediation-checklist.ts
//                         and routes/msp-remediation-fix-routes.ts (cited with line numbers in
//                         the output's `method.citations`).
//   knowledge_base_only — no executable mapping, but a remediation_knowledge_base row with
//                         status 'published' (the only rows fetchPublishedKnowledgeBaseRows /
//                         the checklist ever surface).
//   none                — neither.
//
// A run that is still pending/running, or failed, is refused: partial results are not exported.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db, type TenantConsentMap, type RemediationFixRoute } from "@workspace/db";
import { resolveFindingCeiling, resolveFixRoute, resolveTenantWriteCeiling } from "../lib/remediation-fix-route.ts";
import { requiredPermissionsForWrite } from "../lib/graph-write-permissions.ts";
import { resolveServiceExecutable, MICROREM_TEMPLATE_BY_SLUG } from "../lib/remediation-catalog.ts";
import { buildCheckKeyPillarMap, pillarForCheckKey } from "../lib/pillar-summary-stats.ts";
import { fetchSignalRulesAndGroups } from "../lib/priority-engine.ts";

const runId = process.argv[2];
const outArg = process.argv[3];
if (!runId || !outArg) {
  console.error("usage: export-scan-findings-4471.ts <runId> <outFile>");
  process.exit(1);
}

const repoRoot = path.resolve(process.cwd());
const outFile = path.isAbsolute(outArg) ? outArg : path.join(repoRoot, outArg);

type Row = Record<string, unknown>;
const q = async (query: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(query)).rows as Row[];

// ── Citations: find the real line of each predicate in the source, at this commit ─────
async function lineOf(relFile: string, needle: string): Promise<string> {
  const text = await readFile(path.join(repoRoot, relFile), "utf8");
  const idx = text.split(/\r?\n/).findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`citation needle not found in ${relFile}: ${needle}`);
  return `${relFile}:${idx + 1}`;
}

// ── The run ───────────────────────────────────────────────────────────────────────────
const [run] = await q(sql`select * from msp_diagnostic_runs where run_id = ${runId}::uuid`);
if (!run) {
  console.error(`run ${runId} not found`);
  process.exit(1);
}
if (!["completed", "partial"].includes(String(run.status))) {
  console.error(`run ${runId} has status '${run.status}' — refusing to export a run that did not finish`);
  process.exit(1);
}

const [tenant] = await q(
  sql`select id, msp_id, customer_name, tenant_id, domain, status, is_testbed, consent from tenants where id = ${run.customer_id}`,
);
const consent = (tenant?.consent ?? null) as TenantConsentMap | null;

const findings = await q(sql`
  select f.*, mc.label as check_definition_label, mc.description as check_description,
         mc.executor_type, mc.ps_cmdlet_key, mc.engines, mc.requires_customer_script,
         mc.is_customer_facing, mc.status as check_definition_status
    from msp_diagnostic_findings f
    left join monitor_checks mc on mc.key = f.check_key
   where f.run_id = ${runId}::uuid
   order by f.id`);

const profiles = await q(sql`
  select check_key, status, severity_matched, severity_label, error_message, item_count, page_count, collected_at
    from tenant_monitor_profiles
   where trigger_id = ${`diag-run-${runId}`}`);
const profileByKey = new Map(profiles.map((p) => [String(p.check_key), p]));

const pkgChecks = await q(sql`
  select pc.check_key, pc.sort_order from monitoring_package_checks pc
   where pc.package_key = ${run.package_key} order by pc.sort_order`);

const trackerRows = await q(sql`
  select step_id, status, verification_state, completed_at, verified_at
    from remediation_tracker_steps where customer_id = ${run.customer_id}`);
const trackerByKey = new Map(trackerRows.map((r) => [String(r.step_id), r]));

const checkKeys = [...new Set(findings.map((f) => String(f.check_key)))];

// ── Catalog: config packs → templates, for these check keys ─────────────────────────────
const packRows = checkKeys.length
  ? await q(sql`
      select cpt.id as row_id, cpt.check_key, cpt.template_id, cpt.sort_order, cpt.parameter_mapping,
             cp.pack_key, cp.label as pack_label, cp.status as pack_status,
             bat.label as template_label, bat.status as template_status, bat.method, bat.endpoint,
             bat.body_template, bat.reversible, bat.requires_verification_gate
        from config_pack_templates cpt
        join config_packs cp on cp.id = cpt.pack_id
        left join baseline_action_templates bat on bat.template_id = cpt.template_id
       where cpt.check_key in (select jsonb_array_elements_text(${JSON.stringify(checkKeys)}::jsonb))
       order by cpt.check_key, cp.pack_key, cpt.sort_order, cpt.id`)
  : [];

// Sellable catalog products (services) → the pack / micro-remediation they execute,
// resolved with the real remediation-catalog.ts resolver.
const serviceRows = await q(sql`
  select id, slug, name, category, is_public, visibility, type_attributes from services
   where category in ('config_pack', 'micro_remediation')`);
const servicesByPackKey = new Map<string, Row[]>();
const servicesByTemplateId = new Map<string, Row[]>();
for (const s of serviceRows) {
  const resolved = resolveServiceExecutable({
    slug: (s.slug as string) ?? null,
    category: (s.category as string) ?? null,
    typeAttributes: s.type_attributes,
  });
  const entry = { slug: s.slug, name: s.name, isPublic: s.is_public, visibility: s.visibility, resolved };
  if (resolved.kind === "config_pack") {
    servicesByPackKey.set(resolved.packKey, [...(servicesByPackKey.get(resolved.packKey) ?? []), entry]);
  } else if (resolved.kind === "micro_remediation") {
    servicesByTemplateId.set(resolved.templateId, [...(servicesByTemplateId.get(resolved.templateId) ?? []), entry]);
  }
}

const kbRows = checkKeys.length
  ? await q(sql`
      select check_key, title, summary, status, fix_route_capability, admin_center_path, admin_center_url,
             jsonb_array_length(remediation_steps) as step_count, validation_step, validation_command,
             verified_by, verified_against, last_verified_at, source_urls
        from remediation_knowledge_base where check_key in (select jsonb_array_elements_text(${JSON.stringify(checkKeys)}::jsonb))`)
  : [];
const kbByKey = new Map(kbRows.map((r) => [String(r.check_key), r]));

// Real pillar resolution (signal_derivation_rules first, PILLAR_CHECK_DOMAINS fallback),
// built the same way free-scan-write-scopes.ts buildPillarResolver() does.
const [{ rules }, checkDefinitions] = await Promise.all([
  fetchSignalRulesAndGroups(),
  q(sql`select key, mapping, properties from monitor_checks`),
]);
const pillarMap = buildCheckKeyPillarMap(
  rules,
  checkDefinitions.map((c) => ({
    key: String(c.key),
    mapping: c.mapping as Array<{ sourceField: string; targetField: string; transform?: string }> | null,
    properties: c.properties as string[] | null,
  })),
);

// ── Per-finding cross-reference ─────────────────────────────────────────────────────────
type Bucket = "executable" | "knowledge_base_only" | "none";

function crossReference(checkKey: string) {
  const mappings = packRows.filter((p) => p.check_key === checkKey);
  const packMappings = mappings.map((m) => {
    const perm = m.method && m.endpoint
      ? requiredPermissionsForWrite(String(m.method), String(m.endpoint), {
          templateId: String(m.template_id ?? ""),
          body: m.body_template,
        })
      : null;
    const templateId = (m.template_id as string | null) ?? null;
    return {
      configPackTemplatesRowId: m.row_id,
      packKey: m.pack_key,
      packLabel: m.pack_label,
      packStatus: m.pack_status,
      templateId,
      templateLabel: m.template_label ?? null,
      templateStatus: m.template_status ?? null,
      templateIsMicroRemediation: templateId?.startsWith("microrem.") ?? false,
      method: m.method ?? null,
      endpoint: m.endpoint ?? null,
      reversible: m.reversible ?? null,
      requiresVerificationGate: m.requires_verification_gate ?? null,
      hasParameterMapping: m.parameter_mapping != null,
      sortOrder: m.sort_order,
      // The executable predicate, evaluated on this row alone.
      countsAsExecutable: templateId != null && m.pack_status === "active",
      writePermission: perm
        ? {
            nonGraphEndpoint: perm.nonGraph,
            appOnlyUnsupported: perm.appOnlyUnsupported,
            ruleMatched: perm.rule != null,
            requiredApplicationPermissions: perm.required,
            documentedButNotRequested: perm.notRequested,
          }
        : null,
      sellableAsConfigPackProducts: servicesByPackKey.get(String(m.pack_key)) ?? [],
      sellableAsMicroRemediationProducts: templateId ? (servicesByTemplateId.get(templateId) ?? []) : [],
    };
  });

  // Distinct (pack, template) pairs — exposes duplicated config_pack_templates rows.
  const distinctPairs = new Set(packMappings.map((m) => `${m.packKey}|${m.templateId}`));
  const writePackAvailable = packMappings.some((m) => m.countsAsExecutable);

  const kb = kbByKey.get(checkKey) ?? null;
  const publishedKb = kb && kb.status === "published" ? kb : null;
  const capability = (publishedKb?.fix_route_capability as RemediationFixRoute | undefined) ?? null;

  const bucket: Bucket = writePackAvailable ? "executable" : publishedKb ? "knowledge_base_only" : "none";

  const executableRows = packMappings.filter((m) => m.countsAsExecutable);
  return {
    bucket,
    writePackAvailable,
    configPackMappings: packMappings,
    configPackMappingRowCount: packMappings.length,
    configPackDistinctPackTemplatePairs: distinctPairs.size,
    executableCaveats: writePackAvailable
      ? {
          anyMappedTemplateNotActive: executableRows.some((m) => m.templateStatus !== "active"),
          anyMappedTemplateAppOnlyUnsupported: executableRows.some((m) => m.writePermission?.appOnlyUnsupported === true),
          anyMappedTemplateNeedsUnrequestedPermission: executableRows.some(
            (m) => (m.writePermission?.documentedButNotRequested.length ?? 0) > 0,
          ),
          anyMappedTemplateNonGraph: executableRows.some((m) => m.writePermission?.nonGraphEndpoint === true),
          anyMappedTemplateHasNoPermissionRule: executableRows.some(
            (m) => m.writePermission != null && !m.writePermission.nonGraphEndpoint && !m.writePermission.ruleMatched,
          ),
          sellableProductExists: executableRows.some(
            (m) => m.sellableAsConfigPackProducts.length > 0 || m.sellableAsMicroRemediationProducts.length > 0,
          ),
        }
      : null,
    knowledgeBase: kb
      ? {
          status: kb.status,
          surfacedByProduct: kb.status === "published",
          fixRouteCapability: kb.fix_route_capability,
          title: kb.title,
          summary: kb.summary,
          adminCenterPath: kb.admin_center_path,
          adminCenterUrl: kb.admin_center_url,
          remediationStepCount: kb.step_count,
          validationStep: kb.validation_step,
          hasValidationCommand: kb.validation_command != null,
          verifiedBy: kb.verified_by,
          verifiedAgainst: kb.verified_against,
          lastVerifiedAt: kb.last_verified_at,
          sourceUrls: kb.source_urls,
        }
      : null,
    fixRoute: {
      findingCeiling: resolveFindingCeiling({ capability, writePackAvailable }),
      forThisTenant: resolveFixRoute({ capability, writePackAvailable, consent }),
    },
  };
}

const exportedFindings = findings.map((f) => {
  const key = String(f.check_key);
  const profile = profileByKey.get(key) ?? null;
  const tracker = trackerByKey.get(key) ?? null;
  return {
    findingId: f.finding_id,
    checkKey: key,
    checkLabel: f.check_label,
    checkDescription: f.check_description ?? null,
    domain: key.split(":")[0],
    pillar: pillarForCheckKey(key, pillarMap),
    engines: f.engines ?? null,
    executorType: f.executor_type ?? null,
    psCmdletKey: f.ps_cmdlet_key ?? null,
    requiresCustomerScript: f.requires_customer_script ?? null,
    isCustomerFacing: f.is_customer_facing ?? null,
    severity: f.severity,
    checkStatus: f.check_status,
    findingSource: f.finding_source,
    title: f.title,
    description: f.description,
    recommendation: f.recommendation,
    evidence: f.extracted_properties,
    profile: profile
      ? {
          status: profile.status,
          severityMatched: profile.severity_matched,
          severityLabel: profile.severity_label,
          errorMessage: profile.error_message,
          itemCount: profile.item_count,
          pageCount: profile.page_count,
          collectedAt: profile.collected_at,
        }
      : null,
    currentStatus: {
      acknowledgedAt: f.acknowledged_at ?? null,
      remediationTrackerStep: tracker
        ? {
            status: tracker.status,
            verificationState: tracker.verification_state,
            completedAt: tracker.completed_at,
            verifiedAt: tracker.verified_at,
          }
        : null,
    },
    remediation: crossReference(key),
  };
});

// ── Summary ─────────────────────────────────────────────────────────────────────────────
function tally<T>(items: T[], keyOf: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[keyOf(i)] = (out[keyOf(i)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}
const actionable = exportedFindings.filter((f) => f.severity === "critical" || f.severity === "warning");
const executedKeys = new Set(profiles.map((p) => String(p.check_key)));

const summary = {
  findingCount: exportedFindings.length,
  bySeverity: tally(exportedFindings, (f) => String(f.severity)),
  byCheckStatus: tally(exportedFindings, (f) => String(f.checkStatus ?? "null (derived finding)")),
  byPillar: tally(exportedFindings, (f) => String(f.pillar ?? "unresolved")),
  remediationBucket: {
    allFindings: tally(exportedFindings, (f) => f.remediation.bucket),
    actionableFindings_criticalOrWarning: tally(actionable, (f) => f.remediation.bucket),
  },
  fixRouteForThisTenant: {
    allFindings: tally(exportedFindings, (f) => f.remediation.fixRoute.forThisTenant),
    actionableFindings_criticalOrWarning: tally(actionable, (f) => f.remediation.fixRoute.forThisTenant),
  },
  actionableFindingCount: actionable.length,
  packageCheckCount: pkgChecks.length,
  packageChecksWithoutAProfileRow: pkgChecks.map((p) => String(p.check_key)).filter((k) => !executedKeys.has(k)),
  configPackKeysWithDuplicatedTemplateRows: [
    ...new Set(
      exportedFindings
        .filter((f) => f.remediation.configPackMappingRowCount > f.remediation.configPackDistinctPackTemplatePairs)
        .flatMap((f) => f.remediation.configPackMappings.map((m) => String(m.packKey))),
    ),
  ].sort(),
};

const commit = execSync("git rev-parse HEAD", { cwd: repoRoot }).toString().trim();

const out = {
  exportVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedBy: "artifacts/api-server/src/scripts/export-scan-findings-4471.ts (Git #4471)",
  sourceCommit: commit,
  tenant: tenant
    ? {
        tenantsRowId: tenant.id,
        mspId: tenant.msp_id,
        customerName: tenant.customer_name,
        microsoftTenantId: tenant.tenant_id,
        domain: tenant.domain,
        status: tenant.status,
        isTestbed: tenant.is_testbed,
        writeBackConsentStatus: consent?.writeBack?.status ?? null,
        tenantWriteCeiling: resolveTenantWriteCeiling(consent),
      }
    : null,
  run: {
    runId: run.run_id,
    diagnosticRunRowId: run.id,
    packageKey: run.package_key,
    status: run.status,
    runStatus: run.run_status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    checksTotal: run.checks_total,
    checksOk: run.checks_ok,
    checksError: run.checks_error,
    checksRequiresScript: run.checks_requires_script,
    checksLicenseGap: run.checks_license_gap,
    runSummary: run.summary,
    triggeredByUserId: run.triggered_by_user_id,
  },
  method: {
    buckets: {
      executable:
        "config_pack_templates.check_key = checkKey AND template_id IS NOT NULL AND config_packs.status = 'active' (the product's writePackAvailable predicate)",
      knowledge_base_only:
        "not executable, but remediation_knowledge_base has a row for checkKey with status = 'published'",
      none: "neither of the above (a draft-only KB row is not surfaced by the product and counts as none)",
    },
    fixRoute:
      "resolveFindingCeiling / resolveFixRoute from remediation-fix-route.ts; forThisTenant applies tenants.consent.writeBack (anything but 'granted' caps at you_must_run)",
    citations: {
      writePackAvailablePredicate_checklist: await lineOf(
        "artifacts/api-server/src/lib/remediation-checklist.ts",
        "const packCheckKeys = new Set(packRows",
      ),
      writePackAvailablePredicate_fixRoutesRoute: await lineOf(
        "artifacts/api-server/src/routes/msp-remediation-fix-routes.ts",
        "const packCheckKeys = new Set<string>()",
      ),
      publishedKnowledgeBaseOnly: await lineOf(
        "artifacts/api-server/src/lib/remediation-knowledge-base.ts",
        'eq(remediationKnowledgeBaseTable.status, "published")',
      ),
      resolveFindingCeiling: await lineOf("artifacts/api-server/src/lib/remediation-fix-route.ts", "export function resolveFindingCeiling"),
      resolveTenantWriteCeiling: await lineOf("artifacts/api-server/src/lib/remediation-fix-route.ts", "export function resolveTenantWriteCeiling"),
      microRemediationServiceToTemplateMap: await lineOf("artifacts/api-server/src/lib/remediation-catalog.ts", "export const MICROREM_TEMPLATE_BY_SLUG"),
      resolveServiceExecutable: await lineOf("artifacts/api-server/src/lib/remediation-catalog.ts", "export function resolveServiceExecutable"),
      requiredPermissionsForWrite: await lineOf("artifacts/api-server/src/lib/graph-write-permissions.ts", "export function requiredPermissionsForWrite"),
      configPackOrchestratorTemplateLoad: await lineOf(
        "artifacts/api-server/src/lib/config-pack-orchestrator.ts",
        ".where(eq(configPackTemplatesTable.packId, pack.id))",
      ),
      severityClassification: await lineOf("artifacts/api-server/src/lib/diagnostics-runner.ts", "export function classifyCheckSeverity"),
      pillarForCheckKey: await lineOf("artifacts/api-server/src/lib/pillar-summary-stats.ts", "export function pillarForCheckKey"),
    },
    microRemediationNote:
      "micro-remediation templates (baseline_action_templates 'microrem.*') carry no check_key of their own; the only check_key link to one is a config_pack_templates row. " +
      `remediation-catalog.ts declares ${Object.keys(MICROREM_TEMPLATE_BY_SLUG).length} micro-remediation products, ` +
      `${Object.values(MICROREM_TEMPLATE_BY_SLUG).filter((v) => v === null).length} of them with no template.`,
  },
  summary,
  findings: exportedFindings,
};

// Companion index: the same findings and cross-reference, minus the raw evidence payloads
// (one Secure Score evidence blob alone is ~880 KB), so the file can be read in one pass.
const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
const index = {
  exportVersion: out.exportVersion,
  generatedAt: out.generatedAt,
  generatedBy: out.generatedBy,
  sourceCommit: out.sourceCommit,
  fullExport: path.basename(outFile),
  tenant: out.tenant,
  run: out.run,
  method: out.method,
  summary,
  findings: [...exportedFindings]
    .sort(
      (a, b) =>
        (severityRank[String(a.severity)] ?? 9) - (severityRank[String(b.severity)] ?? 9) ||
        a.checkKey.localeCompare(b.checkKey),
    )
    .map((f) => {
      const r = f.remediation;
      const pairs = new Map<string, (typeof r.configPackMappings)[number]>();
      for (const m of r.configPackMappings) pairs.set(`${m.packKey}|${m.templateId}`, m);
      return {
        checkKey: f.checkKey,
        checkLabel: f.checkLabel,
        pillar: f.pillar,
        severity: f.severity,
        checkStatus: f.checkStatus,
        title: f.title,
        description: f.description,
        profileError: f.profile?.errorMessage ?? null,
        evidenceBytes: JSON.stringify(f.evidence ?? null).length,
        remediation: {
          bucket: r.bucket,
          fixRouteFindingCeiling: r.fixRoute.findingCeiling,
          fixRouteForThisTenant: r.fixRoute.forThisTenant,
          configPackSteps: [...pairs.values()].map((m) => ({
            packKey: m.packKey,
            packStatus: m.packStatus,
            templateId: m.templateId,
            templateLabel: m.templateLabel,
            templateStatus: m.templateStatus,
            countsAsExecutable: m.countsAsExecutable,
            nonGraphEndpoint: m.writePermission?.nonGraphEndpoint ?? null,
            appOnlyUnsupported: m.writePermission?.appOnlyUnsupported ?? null,
            requiredApplicationPermissions: m.writePermission?.requiredApplicationPermissions ?? null,
            documentedButNotRequested: m.writePermission?.documentedButNotRequested ?? null,
            sellableProducts: [...m.sellableAsConfigPackProducts, ...m.sellableAsMicroRemediationProducts].map(
              (s) => (s as { slug?: unknown }).slug,
            ),
            duplicatedRowCount: r.configPackMappings.filter(
              (x) => x.packKey === m.packKey && x.templateId === m.templateId,
            ).length,
          })),
          executableCaveats: r.executableCaveats,
          knowledgeBase: r.knowledgeBase
            ? {
                status: r.knowledgeBase.status,
                fixRouteCapability: r.knowledgeBase.fixRouteCapability,
                title: r.knowledgeBase.title,
                adminCenterUrl: r.knowledgeBase.adminCenterUrl,
                remediationStepCount: r.knowledgeBase.remediationStepCount,
              }
            : null,
        },
      };
    }),
};
const indexFile = outFile.replace(/\.json$/, ".index.json");

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`, "utf8");
await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`wrote ${outFile}`);
console.log(`wrote ${indexFile}`);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);

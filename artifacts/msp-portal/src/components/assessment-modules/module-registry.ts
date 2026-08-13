/**
 * module-registry.ts
 *
 * Assessment Dashboard Module Registry — the direct customer-portal analogue of
 * the engine-registry.ts ENGINE_DEFS pattern used in the admin-panel.
 *
 * Each entry in ASSESSMENT_MODULE_DEFS describes one renderable dashboard module.
 * The generic shell (AssessmentModulePanel.tsx) looks up a module by key and
 * renders its registered component — zero per-module branching in the shell.
 *
 * Adding a new module requires only a new registry entry + component file.
 * No new routes, no new page files, no schema changes.
 *
 * Config mechanism: the services table has a type_attributes JSONB column.
 * Per assessment service row, set:
 *   type_attributes.dashboardModules = ["priority-health", "findings", "governance", ...]
 * The assessment-dashboard.tsx page reads that array and renders only those
 * module keys, in that order. If dashboardModules is absent, PILLAR_FAMILY_MODULE_KEYS
 * (the original 8) renders — this remains the routing path for the `pillar_scored`
 * and `copilot` Results Template families.
 *
 * Results Template family routing (#162/#163, parent #161): assessment-dashboard.tsx
 * additionally reads the product's resultsTemplateFamily (from /api/catalog/assessments,
 * joined onto results_templates). The `framework_gap_list` and `readiness_logistics`
 * families don't fit this pillar-module system at all, so for those two the page
 * overrides dashboardModules entirely and renders the single matching module below
 * (`framework-gap-list` / `readiness-logistics`) instead — see PILLAR_FAMILY_MODULE_KEYS.
 *
 * Pillar taxonomy (from signal_derivation_rules.pillar — do not invent new values):
 *   governance | security | compliance | adoption | copilot | architecture | costLicensing
 */

import type React from "react";

// ── Shared API response types ──────────────────────────────────────────────────
// Shape of GET /api/portal/assessment-results/:serviceSlug
// Field-level shape inside pillars may shift as the backend task finalises —
// keep these flexible with | null guards so modules render honest empty states.

export type AssessmentRunStatus = "pending" | "running" | "complete" | "failed";
export type PillarStatus = "complete" | "pending" | "not_applicable";

export interface PillarResult {
  score: number | null;
  status: PillarStatus;
  findings: string[];
  recommendations: string[];
}

export interface AssessmentResultsPayload {
  status: AssessmentRunStatus;
  runId: string | null;
  generatedAt: string | null;
  summary: {
    compositeScore: number | null;
    priorityItems: string[];
  } | null;
  pillars: {
    governance?: PillarResult;
    security?: PillarResult;
    compliance?: PillarResult;
    adoption?: PillarResult;
    copilot?: PillarResult;
    architecture?: PillarResult;
    costLicensing?: PillarResult;
  } | null;
  document: {
    documentId: number | null;
    docType: string;
    downloadUrl: string | null;
  } | null;
}

// ── Module contract ────────────────────────────────────────────────────────────

export interface AssessmentModuleProps {
  /** The service slug — used as the key for /api/portal/assessment-results/:serviceSlug */
  serviceSlug: string;
  /** Pre-fetched assessment results from the parent page. */
  results: AssessmentResultsPayload | null;
  /** True while the parent page is still fetching. */
  loading: boolean;
  /** Non-null if the parent page fetch failed. */
  error: string | null;
}

export interface AssessmentModuleDef {
  /** Unique stable key — used in type_attributes.dashboardModules[] */
  key: string;
  /** Display label shown as the module card header */
  label: string;
  /** One-line description of what this module shows */
  description: string;
  /** The signal pillars this module primarily reads from */
  pillars: string[];
  /** The React component that renders this module */
  component: React.ComponentType<AssessmentModuleProps>;
}

// ── Imports — deferred to bottom of file to avoid circular deps ───────────────
import GovernanceModule from "./GovernanceModule";
import SecurityModule from "./SecurityModule";
import ComplianceModule from "./ComplianceModule";
import CopilotModule from "./CopilotModule";
import ArchitectureModule from "./ArchitectureModule";
import CostModule from "./CostModule";
import PriorityHealthModule from "./PriorityHealthModule";
import FindingsModule from "./FindingsModule";
import FrameworkGapListModule from "./FrameworkGapListModule";
import ReadinessLogisticsModule from "./ReadinessLogisticsModule";

// ── Registry ───────────────────────────────────────────────────────────────────

export const ASSESSMENT_MODULE_DEFS: AssessmentModuleDef[] = [
  {
    key: "priority-health",
    label: "Priority & Health Score",
    description: "Composite health score and highest-priority action items from this assessment run.",
    pillars: [],
    component: PriorityHealthModule,
  },
  {
    key: "findings",
    label: "Findings & Recommendations",
    description: "Full list of findings and recommendations across all pillars, sorted by priority.",
    pillars: [],
    component: FindingsModule,
  },
  {
    key: "governance",
    label: "Governance",
    description: "Policy maturity, admin role hygiene, and tenant governance signals.",
    pillars: ["governance"],
    component: GovernanceModule,
  },
  {
    key: "security",
    label: "Security",
    description: "Identity, DLP, conditional access, and data-loss-prevention coverage signals.",
    pillars: ["security"],
    component: SecurityModule,
  },
  {
    key: "compliance",
    label: "Compliance",
    description: "Regulatory retention posture, audit logs, and compliance policy gaps.",
    pillars: ["compliance"],
    component: ComplianceModule,
  },
  {
    key: "copilot",
    label: "Copilot AI Readiness",
    description: "Microsoft Copilot licence readiness, enablement blockers, and adoption signals.",
    pillars: ["copilot"],
    component: CopilotModule,
  },
  {
    key: "architecture",
    label: "Architecture",
    description: "Tenant topology complexity, hybrid configuration, and platform architecture signals.",
    pillars: ["architecture"],
    component: ArchitectureModule,
  },
  {
    key: "cost",
    label: "Cost & Licensing",
    description: "Licence utilisation, pricing impact signals, and cost optimisation opportunities.",
    pillars: ["costLicensing"],
    component: CostModule,
  },

  // ── Non-pillar Results Template family modules (#162, parent #161) ──────────
  // `framework_gap_list` (SOC 2 / NIST CSF / ISO 27001 / CMMC) and
  // `readiness_logistics` (Migration Readiness, Conditional Access, License
  // Waste Audit, License & Cost Optimization) don't fit the 7-pillar taxonomy
  // at all — each gets exactly one self-contained, full-width module instead
  // of a set of per-pillar cards. Registered in the same array as the 8
  // pillar modules above so AssessmentModulePanel.tsx's generic
  // `ASSESSMENT_MODULE_DEFS.find(...)` lookup keeps working unchanged — but
  // deliberately excluded from PILLAR_FAMILY_MODULE_KEYS below, since they
  // must never appear in the `pillar_scored`/`copilot` fallback module set.
  {
    key: "framework-gap-list",
    label: "Framework Compliance Gap List",
    description: "Control-by-control gap list against the assessment's named compliance framework.",
    pillars: [],
    component: FrameworkGapListModule,
  },
  {
    key: "readiness-logistics",
    label: "Readiness & Decision Data",
    description: "Decision-relevant readiness data — not pillar-scored.",
    pillars: [],
    component: ReadinessLogisticsModule,
  },
];

// The original 8 pillar-module keys, in default display order — the
// fallback set for the `pillar_scored` and `copilot` Results Template
// families (#162), both of which reuse this module system as-is (confirmed
// by audit, #163: CopilotModule.tsx is already structurally identical to
// the other pillar modules). Kept as an explicit literal rather than
// `ASSESSMENT_MODULE_DEFS.map(d => d.key)` now that array also holds the
// two non-pillar family modules above, which must NOT be part of this set.
export const PILLAR_FAMILY_MODULE_KEYS: string[] = [
  "priority-health",
  "findings",
  "governance",
  "security",
  "compliance",
  "copilot",
  "architecture",
  "cost",
];

// ── Lookup helper ──────────────────────────────────────────────────────────────

export function getModuleDef(key: string): AssessmentModuleDef | undefined {
  return ASSESSMENT_MODULE_DEFS.find((m) => m.key === key);
}

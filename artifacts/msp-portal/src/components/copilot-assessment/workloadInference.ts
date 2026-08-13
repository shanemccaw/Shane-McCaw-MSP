/**
 * workloadInference.ts — #270 (Copilot Assessment epic #183).
 *
 * Derives the four QuizProfile workload weights (draftingLoad / researchLoad /
 * communicationLoad / repetitiveLoad) from answers the quiz ALREADY collects.
 *
 * Why this exists: the original Workload Mix step (four sliders) was removed
 * per Shane's direction, and buildQuizProfile() was left returning a hardcoded
 * 0.5 for all four — so every customer in the platform produced the identical
 * ROI score (roiScoringEngine.ts / final-report-narrative-generator.ts both
 * weight exactly these four fields) and the identical "Workload loads" line in
 * the use-case generation prompt. #270 replaces that with real inference.
 * Confirmed with Shane: no sliders come back.
 *
 * ── THE SCORING DECISION, IN FULL ───────────────────────────────────────────
 *
 * Four signals, all of them real answers, blended into each dimension:
 *
 *   1. SELECTED USE CASES (weight 0.45) — the strongest signal, because the
 *      customer picked these specific pieces of work by hand. Every use case in
 *      ADAPTIVE_USE_CASES is categorised below into a primary and (usually) a
 *      secondary workload dimension. The categorisation is the real editorial
 *      one already implicit in the catalog copy, made explicit:
 *        drafting      — producing a NEW artifact from inputs (memos, briefs,
 *                        proposals, contracts, specs, plans, marketing copy).
 *        research      — synthesising ACROSS many sources or a large corpus
 *                        (literature/trial synthesis, discovery review, trend
 *                        and telemetry analysis, due diligence).
 *        communication — outbound person-to-person messages (press releases,
 *                        newsletters, constituent/customer correspondence,
 *                        stakeholder and investor updates, briefings).
 *        repetitive    — standardised recurring records on a fixed template
 *                        (logs, work orders, inspection/compliance reports,
 *                        intake forms, reconciliations, tracking updates).
 *
 *   2. SELECTED PERSONAS (weight 0.25) — who the customer says they support,
 *      independent of which use cases they ticked. Read through the SAME
 *      categorisation: a persona's workload profile is the aggregate of the
 *      catalog use cases attached to it via personaId. No second hand-written
 *      persona table, so the two signals can never drift apart.
 *
 *   3. ROLE / DEPARTMENT free text (weight 0.15) — a keyword lens over what the
 *      quiz-taker typed about themselves on About You, using the same function
 *      vocabulary the persona catalog uses ("writer", "analyst", "dispatcher",
 *      "press officer", …). Deliberately weak: it is free text and can be
 *      anything. If nothing matches, the signal is DROPPED rather than pulled
 *      to neutral (see below).
 *
 *   4. WORKFLOW STRUCTURE (weight 0.15) — the real 'structured' /
 *      'unstructured' answer. Structured work is SOP/checklist/templated work,
 *      which is where the repetitive and drafting dimensions live; unstructured
 *      work is discovery- and coordination-heavy, which is where research and
 *      communication live. Direction only, never a large swing.
 *
 * A signal with no data (no personas ticked, no keyword match) is dropped and
 * its weight is redistributed across the signals that DO have data — a missing
 * answer must not drag every dimension back toward the 0.5 this issue exists to
 * remove.
 *
 * Each signal scores a dimension 0–1 RELATIVE to that customer's own strongest
 * dimension (points / maxPoints), not as a share of their week. That is
 * deliberate: these four are independent intensities, not a distribution — the
 * removed sliders did not sum to 100 either (#184), and the ROI weights
 * (0.3/0.25/0.2/0.15) assume independent 0–1 values.
 *
 * The blended 0–1 result is then mapped onto [FLOOR, FLOOR + SPAN]. The floor
 * exists because no knowledge worker genuinely does zero drafting, zero
 * research, zero communication or zero repetitive work — a true 0 would tell
 * the use-case generator to refuse an entire category ("A load near 0 should
 * NOT drive a use case", see USE_CASE_PROMPT_FALLBACK), which is a stronger
 * claim than this inference can support.
 *
 * What this deliberately does NOT use: persona clusters, adoption speed and
 * change-management need are rollout-velocity answers, not workload answers,
 * and are persisted in their own QuizProfile fields instead (#270).
 */

// Explicit .ts extensions: this module is exercised directly by Node's own test
// runner (workloadInference.test.ts — msp-portal has no vitest), which resolves
// real ESM specifiers. tsconfig has allowImportingTsExtensions and Vite resolves
// them unchanged, so the app build is unaffected.
import { ADAPTIVE_USE_CASES, ADAPTIVE_PERSONAS } from './quizCatalog.ts';
import type { WorkflowStyle } from './types.ts';

export type WorkloadDimension = 'drafting' | 'research' | 'communication' | 'repetitive';

export interface WorkloadMix {
  draftingLoad: number;
  researchLoad: number;
  communicationLoad: number;
  repetitiveLoad: number;
}

export const WORKLOAD_DIMENSIONS: WorkloadDimension[] = ['drafting', 'research', 'communication', 'repetitive'];

/**
 * Every use case in ADAPTIVE_USE_CASES, categorised. Index 0 is the primary
 * dimension, index 1 (where present) the secondary — most real work sits mostly
 * in one dimension and partly in another (a "Fault Tree Report" is drafting
 * built on research; a "Shift Handoff Note" is a repetitive record that is also
 * a message to the next shift).
 *
 * Kept complete: workloadInference.test.ts fails if any catalog use case is
 * missing here, or if any entry here no longer exists in the catalog — a new
 * use case must not silently score as nothing.
 */
export const USE_CASE_WORKLOAD: Record<string, WorkloadDimension[]> = {
  // ── space ──
  lit_synthesis_space: ['research', 'drafting'],
  grant_drafting_space: ['drafting', 'research'],
  telemetry_pattern: ['research', 'repetitive'],
  sample_reporting: ['repetitive', 'drafting'],
  mission_log_synth: ['research', 'repetitive'],
  contingency_drafting: ['drafting', 'research'],
  trajectory_notes: ['repetitive', 'drafting'],
  biotelemetry_summary: ['research', 'repetitive'],
  integration_specs: ['drafting', 'repetitive'],
  sys_budget_docs: ['drafting', 'repetitive'],
  fault_tree_reports: ['drafting', 'research'],
  traceability_matrix: ['repetitive', 'drafting'],
  agency_status_reports: ['repetitive', 'communication'],
  mission_briefings: ['communication', 'drafting'],
  compliance_briefs_space: ['drafting', 'research'],

  // ── healthcare ──
  chart_summarization: ['research', 'repetitive'],
  shift_handoff_notes: ['repetitive', 'communication'],
  care_plan_drafting: ['drafting', 'repetitive'],
  clinical_trial_synth: ['research', 'drafting'],
  lab_result_reporting: ['repetitive', 'drafting'],
  hipaa_policy_updates: ['drafting', 'research'],
  dictation_polish: ['repetitive', 'drafting'],
  billing_scheduling_docs: ['repetitive', 'drafting'],

  // ── finance ──
  market_digest: ['research', 'communication'],
  trade_rationale_notes: ['repetitive', 'drafting'],
  investor_letters: ['communication', 'drafting'],
  risk_narrative_drafting: ['drafting', 'research'],
  kyc_aml_docs: ['repetitive', 'drafting'],
  audit_workpapers: ['repetitive', 'drafting'],
  backtest_reporting: ['research', 'drafting'],
  competitive_analysis_synth: ['research', 'drafting'],
  settlement_recon_notes: ['repetitive', 'drafting'],

  // ── technology ──
  pr_doc_drafting: ['drafting', 'repetitive'],
  runbook_drafting: ['drafting', 'repetitive'],
  model_card_drafting: ['drafting', 'repetitive'],
  prd_drafting: ['drafting', 'research'],
  design_spec_drafting: ['drafting', 'research'],
  kb_article_drafting: ['drafting', 'repetitive'],

  // ── manufacturing ──
  process_flow_docs: ['drafting', 'repetitive'],
  controls_doc_drafting: ['drafting', 'repetitive'],
  nonconformance_reports: ['repetitive', 'drafting'],
  safety_incident_reports: ['repetitive', 'drafting'],
  shift_handover_briefs: ['repetitive', 'communication'],
  capacity_planning_docs: ['drafting', 'research'],
  work_order_drafting: ['repetitive', 'drafting'],
  failure_analysis_reports: ['research', 'drafting'],

  // ── education ──
  lesson_plan_drafting: ['drafting', 'repetitive'],
  pd_material_drafting: ['drafting', 'research'],
  lit_review_drafting: ['research', 'drafting'],
  citation_management: ['repetitive', 'research'],
  enrollment_reporting: ['repetitive', 'drafting'],
  accreditation_drafting: ['drafting', 'research'],
  syllabus_drafting: ['drafting', 'repetitive'],
  assessment_design: ['drafting', 'repetitive'],

  // ── government ──
  legislative_brief_drafting: ['drafting', 'research'],
  constituent_correspondence: ['communication', 'repetitive'],
  interagency_status_reports: ['repetitive', 'communication'],
  rfp_drafting: ['drafting', 'repetitive'],
  case_file_documentation: ['repetitive', 'research'],
  foia_response_drafting: ['repetitive', 'research'],
  press_release_drafting: ['communication', 'drafting'],
  engagement_material_drafting: ['communication', 'drafting'],

  // ── legal ──
  brief_drafting: ['drafting', 'research'],
  discovery_review_summaries: ['research', 'repetitive'],
  contract_drafting: ['drafting', 'repetitive'],
  due_diligence_summaries: ['research', 'drafting'],
  regulatory_filing_drafting: ['drafting', 'repetitive'],
  audit_response_drafting_legal: ['drafting', 'repetitive'],
  billing_narrative_drafting: ['repetitive', 'drafting'],
  correspondence_drafting_legal: ['communication', 'repetitive'],

  // ── retail ──
  assortment_plan_drafting: ['drafting', 'research'],
  vendor_negotiation_memos: ['drafting', 'communication'],
  staffing_reports: ['repetitive', 'drafting'],
  shrinkage_analysis_reports: ['research', 'repetitive'],
  listing_copy_drafting: ['drafting', 'repetitive'],
  ad_copy_drafting: ['drafting', 'communication'],
  service_script_drafting: ['communication', 'drafting'],
  retention_analysis_reports: ['research', 'drafting'],

  // ── energy ──
  inspection_reporting: ['repetitive', 'drafting'],
  safety_walkthrough_docs: ['repetitive', 'drafting'],
  reservoir_modeling_reports: ['research', 'drafting'],
  load_analysis_docs: ['research', 'repetitive'],
  emissions_reporting: ['repetitive', 'drafting'],
  permit_application_drafting: ['drafting', 'repetitive'],
  market_analysis_drafting: ['research', 'drafting'],
  hedging_strategy_docs: ['drafting', 'research'],

  // ── transportation ──
  route_plan_drafting: ['repetitive', 'drafting'],
  carrier_comm_drafting: ['communication', 'repetitive'],
  maintenance_log_reporting: ['repetitive', 'drafting'],
  utilization_reporting: ['research', 'repetitive'],
  dot_audit_prep: ['repetitive', 'drafting'],
  hazmat_documentation: ['repetitive', 'drafting'],
  shipment_tracking_updates: ['communication', 'repetitive'],
  claims_resolution_drafting: ['communication', 'drafting'],

  // ── agriculture ──
  yield_reporting: ['repetitive', 'research'],
  irrigation_log_reporting: ['repetitive', 'research'],
  herd_health_reporting: ['repetitive', 'research'],
  vet_visit_summaries: ['repetitive', 'drafting'],
  field_trial_reporting: ['research', 'drafting'],
  data_collection_logs: ['repetitive', 'research'],
  contract_structuring_docs: ['drafting', 'research'],
  storage_transport_planning: ['drafting', 'repetitive'],

  // ── nonprofit ──
  outcome_reporting: ['repetitive', 'drafting'],
  intake_documentation: ['repetitive', 'communication'],
  donor_proposal_drafting: ['drafting', 'communication'],
  grant_application_drafting: ['drafting', 'research'],
  budget_reporting: ['repetitive', 'drafting'],
  compliance_tracking_docs: ['repetitive', 'drafting'],
  newsletter_drafting: ['communication', 'drafting'],
  engagement_content_drafting: ['communication', 'drafting'],

  // ── other ──
  board_memo_drafting: ['drafting', 'communication'],
  roadmap_drafting: ['drafting', 'research'],
  status_report_drafting: ['repetitive', 'communication'],
  process_doc_drafting: ['drafting', 'repetitive'],
  research_synthesis_other: ['research', 'drafting'],
  kb_article_drafting_other: ['drafting', 'repetitive'],
  account_plan_drafting: ['drafting', 'communication'],
  stakeholder_update_drafting: ['communication', 'drafting'],

  // ── default (industry with no bespoke catalog) ──
  strategic_memo_drafting: ['drafting', 'communication'],
  doc_synthesis_default: ['research', 'drafting'],
  process_doc_default: ['drafting', 'repetitive'],
  ticket_response_drafting: ['communication', 'repetitive'],
};

/**
 * Keyword lens over the quiz-taker's own free-text role/department. Same
 * function vocabulary the persona catalog uses for those job families — this is
 * NOT a job-title database, and it is weighted accordingly (0.15).
 */
const ROLE_KEYWORDS: Record<WorkloadDimension, string[]> = {
  drafting: [
    'writer', 'write', 'author', 'editor', 'copy', 'content', 'draft', 'proposal', 'grant',
    'counsel', 'attorney', 'lawyer', 'paralegal', 'legal', 'curriculum', 'instructional',
    'designer', 'design', 'architect', 'engineer', 'product', 'marketing', 'bid', 'tender',
  ],
  research: [
    'research', 'researcher', 'analyst', 'analysis', 'analytics', 'scientist', 'science',
    'data', 'quant', 'insight', 'intelligence', 'investigat', 'discovery', 'lab', 'academic',
    'agronom', 'strategy', 'strategist', 'actuar',
  ],
  communication: [
    'communication', 'comms', 'press', 'media', 'public affairs', 'public relations',
    'outreach', 'engagement', 'customer', 'client', 'account', 'relations', 'sales',
    'support', 'service', 'success', 'liaison', 'donor', 'fundrais', 'advocacy', 'helpdesk',
  ],
  repetitive: [
    'admin', 'administrator', 'administration', 'operations', 'ops', 'clerk', 'clerical',
    'processing', 'scheduling', 'scheduler', 'dispatch', 'technician', 'maintenance',
    'billing', 'payroll', 'bookkeep', 'records', 'registrar', 'intake', 'compliance',
    'audit', 'quality', 'inspect', 'logistics', 'warehouse', 'coordinator',
  ],
};

/**
 * Direction only. Structured work is SOP/checklist/template work (repetitive,
 * and the templated end of drafting); unstructured work is discovery and
 * ad-hoc coordination (research and communication).
 */
const WORKFLOW_SIGNAL: Record<WorkflowStyle, Record<WorkloadDimension, number>> = {
  structured: { drafting: 0.6, research: 0.35, communication: 0.45, repetitive: 0.85 },
  unstructured: { drafting: 0.55, research: 0.85, communication: 0.7, repetitive: 0.25 },
};

// Points one selected item contributes to its primary vs secondary dimension.
const PRIMARY_POINTS = 1;
const SECONDARY_POINTS = 0.5;

// Relative weight of each signal in the blend. Any signal with no real data is
// dropped and its weight shared out across the rest.
const SIGNAL_WEIGHTS = {
  useCases: 0.45,
  personas: 0.25,
  roleText: 0.15,
  workflow: 0.15,
} as const;

// A dimension the role/department text says nothing about still scores
// something — silence about a function is not evidence the person never does it.
const ROLE_TEXT_UNMATCHED = 0.3;

// The blended 0-1 result is mapped onto [FLOOR, FLOOR + SPAN]. See the header
// comment for why the floor is not zero.
const WORKLOAD_FLOOR = 0.15;
const WORKLOAD_SPAN = 0.8;

type DimensionScores = Record<WorkloadDimension, number>;

function emptyPoints(): DimensionScores {
  return { drafting: 0, research: 0, communication: 0, repetitive: 0 };
}

/** points / maxPoints — each dimension relative to this customer's strongest. Null when nothing scored. */
function normalizeToStrongest(points: DimensionScores): DimensionScores | null {
  const max = Math.max(...WORKLOAD_DIMENSIONS.map((d) => points[d]));
  if (max <= 0) return null;
  const out = emptyPoints();
  WORKLOAD_DIMENSIONS.forEach((d) => {
    out[d] = points[d] / max;
  });
  return out;
}

function accumulateUseCaseIds(ids: string[]): DimensionScores {
  const points = emptyPoints();
  ids.forEach((id) => {
    const dims = USE_CASE_WORKLOAD[id];
    if (!dims || dims.length === 0) return;
    points[dims[0]] += PRIMARY_POINTS;
    if (dims[1]) points[dims[1]] += SECONDARY_POINTS;
  });
  return points;
}

/** Signal 1 — the use cases the customer actually ticked. */
function useCaseSignal(useCaseIds: string[]): DimensionScores | null {
  return normalizeToStrongest(accumulateUseCaseIds(useCaseIds));
}

/**
 * Signal 2 — the personas the customer said they support, read through the
 * catalog use cases attached to each persona rather than a second hand-written
 * table, so persona and use-case scoring can never disagree about what a given
 * piece of work is.
 */
function personaSignal(personaIds: string[], industry: string): DimensionScores | null {
  if (personaIds.length === 0) return null;
  const catalog = ADAPTIVE_USE_CASES[industry] || ADAPTIVE_USE_CASES['default'];
  const selected = new Set(personaIds);
  const ids = catalog.filter((u) => u.personaId && selected.has(u.personaId)).map((u) => u.id);
  return normalizeToStrongest(accumulateUseCaseIds(ids));
}

/** Signal 3 — keyword lens over the quiz-taker's own About You free text. */
function roleTextSignal(role: string, department: string): DimensionScores | null {
  const haystack = `${role} ${department}`.toLowerCase();
  if (haystack.trim().length === 0) return null;

  const hits = emptyPoints();
  WORKLOAD_DIMENSIONS.forEach((d) => {
    hits[d] = ROLE_KEYWORDS[d].filter((kw) => haystack.includes(kw)).length;
  });

  const max = Math.max(...WORKLOAD_DIMENSIONS.map((d) => hits[d]));
  if (max <= 0) return null; // free text we can't read — drop the signal entirely

  const out = emptyPoints();
  WORKLOAD_DIMENSIONS.forEach((d) => {
    out[d] = hits[d] > 0 ? hits[d] / max : ROLE_TEXT_UNMATCHED;
  });
  return out;
}

export interface WorkloadInferenceInput {
  /** Industry option id, e.g. 'space' — selects which use-case catalog personas resolve against. */
  industry: string;
  /** Option ids ticked on the Use Cases step. */
  useCaseIds: string[];
  /** Option ids ticked on the Personas step. */
  personaIds: string[];
  /** About You free text. */
  role: string;
  department: string;
  /** The real, already-normalized Workflow Structure answer. */
  workflowStyle: WorkflowStyle;
}

/**
 * Infer the four 0-1 workload weights from real quiz answers. See the header
 * comment for the full scoring decision; it is a real one, not a placeholder.
 */
export function inferWorkloadMix(input: WorkloadInferenceInput): WorkloadMix {
  const signals: { weight: number; scores: DimensionScores }[] = [];

  const pushIfPresent = (weight: number, scores: DimensionScores | null) => {
    if (scores) signals.push({ weight, scores });
  };

  pushIfPresent(SIGNAL_WEIGHTS.useCases, useCaseSignal(input.useCaseIds));
  pushIfPresent(SIGNAL_WEIGHTS.personas, personaSignal(input.personaIds, input.industry));
  pushIfPresent(SIGNAL_WEIGHTS.roleText, roleTextSignal(input.role, input.department));
  // Workflow structure is a required single-select step, so this signal is
  // always present — which also guarantees signals[] is never empty.
  pushIfPresent(SIGNAL_WEIGHTS.workflow, WORKFLOW_SIGNAL[input.workflowStyle]);

  // Redistribute: weights are relative, so dividing by the weight actually
  // present is exactly "share the missing signal's weight across the rest".
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);

  const load = (d: WorkloadDimension): number => {
    const blended = signals.reduce((sum, s) => sum + s.weight * s.scores[d], 0) / totalWeight;
    return Math.round((WORKLOAD_FLOOR + WORKLOAD_SPAN * blended) * 100) / 100;
  };

  return {
    draftingLoad: load('drafting'),
    researchLoad: load('research'),
    communicationLoad: load('communication'),
    repetitiveLoad: load('repetitive'),
  };
}

/**
 * Every persona id the catalogs define, for the coverage test — exported here
 * rather than recomputed in the test so the test and the inference agree on
 * what "the catalog" means.
 */
export function allCatalogUseCaseIds(): string[] {
  return Object.values(ADAPTIVE_USE_CASES).flat().map((u) => u.id);
}

export function allCatalogPersonaIds(industry: string): string[] {
  return (ADAPTIVE_PERSONAS[industry] || ADAPTIVE_PERSONAS['default']).map((p) => p.id);
}

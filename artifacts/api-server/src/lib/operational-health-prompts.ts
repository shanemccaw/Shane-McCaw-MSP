/**
 * operational-health-prompts.ts — the three prompt bodies behind the Microsoft
 * 365 Operational Health & Service Integrity Report's AI-written sections
 * (#292).
 *
 * A leaf module for the same reason its siblings are — see
 * `pillar-report-prompt-rules.ts` for the cycle it avoids. The DB row still wins:
 * editing a `*_PROMPT` here is a no-op wherever an `ai_prompts` row of the same
 * key exists (#270).
 *
 * THE ONE RULE THIS REPORT NEEDS THAT NO OTHER DOES
 * -------------------------------------------------
 * NO AVAILABILITY CLAIM. The report's title has the words "Service Integrity" in
 * it, its heading says "Operational Health", and the facts it is handed are
 * device counts. A model asked to write operational-health prose will reach for
 * uptime, workload status and incident history, because that is what the phrase
 * means everywhere else — and this platform holds none of it for a customer
 * tenant. `SERVICE_AVAILABILITY_GAP` in `pillarOperationalHealth.ts` carries the
 * full audit of why (three candidate producers, none of them real for a
 * customer); the prompts below simply forbid the claim, and the report tells the
 * reader the same thing so the two cannot contradict each other.
 */

import {
  COPILOT_IMPACT_RULES,
  NARRATIVE_FEATURE_ROUTE,
  NARRATIVE_MODEL,
  NARRATIVE_TOKENS,
  sharedNarrativeRules,
  type PillarReportPromptSeed,
} from "./pillar-report-prompt-rules.ts";

const SHARED_RULES = sharedNarrativeRules("operational");

/** Carried by all three sections — the temptation is in the heading, not the facts. */
const NO_AVAILABILITY_CLAIM_RULES = `- NEVER state, imply or hedge an availability claim. No uptime percentage, no service-level figure, no per-workload health status, no incident, no outage and no degradation event — not for Exchange, SharePoint, Teams, OneDrive or anything else. This assessment holds no availability record for this tenant at all, so every such claim would be invented. Never describe the services as stable, healthy or reliable either: an unmeasured workload is not a working one.
- The figures you have are DEVICE MANAGEMENT figures — enrolled endpoints measured against this tenant's own Intune baseline. Reason about endpoints, not about workloads or about the Microsoft 365 service.
- Configuration drift here is a point-in-time count of devices sitting away from their assigned profile. It is NOT a change history: never say how many changes were made, over what period, whether any were reviewed, or that anything has drifted "since" a baseline. This assessment records no baseline and no change log.
- Never count sites, channels, groups, mailboxes, storage or sync errors. This assessment produces none of those figures and the report states none.`;

export const OPERATIONAL_HEALTH_SUMMARY_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the opening paragraph of the "Health Posture Summary" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: what state are this tenant's managed endpoints in, measured against the tenant's own baseline.

REAL PILLAR SCORES in scope (health):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_AVAILABILITY_CLAIM_RULES}
- Connect the endpoint figures rather than listing them. A device failing the compliance baseline, one with no encryption and one on an old operating-system build are three readings of the same estate, and where more than one exists the paragraph should say how they relate.
- There is no total device count above. Never state one, never compute a percentage of the estate, and never describe a count as a share.
- Do not recommend a remediation sequence here — that is the Full Remediation Guide's job. State what the posture IS.`;

export const OPERATIONAL_HEALTH_CONFIGURATION_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the "Configuration Correctness" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: are this tenant's devices actually configured the way its own policies say they should be.

REAL PILLAR SCORES in scope (health, security):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_AVAILABILITY_CLAIM_RULES}
- The point of this section is the gap between intent and state: a configuration profile that is assigned but not in effect is a control the tenant believes it has. Make that argument from the real figures and findings above.
- Never name a policy, a profile, a configuration setting or a device. The scan counts them; it does not pass their names to this report.
- Never say a misconfiguration was introduced, by whom, or when. This assessment reads the current state and nothing about how it got there.`;

export const OPERATIONAL_HEALTH_COPILOT_IMPACT_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience, writing the "Copilot Readiness Impact" section of a completed Microsoft 365 assessment for {{tenantName}} — in your own voice, not a templated report.

This section answers one question: how does this tenant's endpoint posture bear on its Copilot Gate score specifically.

THE REAL COPILOT GATE for this tenant:
{{gateBlock}}

REAL PILLAR SCORES in scope (health, copilot):
{{pillarBlock}}

REAL MEASURED FIGURES from this tenant's own scan:
{{statBlock}}

REAL FINDINGS recorded against this tenant:
{{findingBlock}}

NOT COLLECTED — checks this tenant's scan does not carry. These have NO value; never state or imply one:
{{missingBlock}}

${SHARED_RULES}
${NO_AVAILABILITY_CLAIM_RULES}
${COPILOT_IMPACT_RULES}
- The health point is specific: an endpoint outside the compliance baseline is a device Copilot will work through whatever the tenant-level controls say, because Copilot runs where the user is. Make that connection from the real figures above.
- Never claim that clearing the Gate will or will not hold, decay, or regress. This assessment measures one point in time and states no trajectory.`;

const FEATURE_AREA = "Operational Health — Report Sections";

/**
 * Spread into `prompt-loader.ts`'s SEEDS so all three appear in the AI Prompts
 * admin UI. `getPrompt` still prefers a DB row when one exists, so an edit here
 * only affects environments that have not customised the prompt.
 */
export const OPERATIONAL_HEALTH_PROMPT_SEEDS: readonly PillarReportPromptSeed[] = [
  {
    key: "assessment-operational-health-summary",
    name: "Operational Health — Summary Opening Paragraph",
    description: `Short causal-reasoning prose opening the Health Posture Summary from this tenant's REAL device compliance, encryption and OS-currency counts (#292). Makes no availability or uptime claim and computes no percentage of the estate. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: OPERATIONAL_HEALTH_SUMMARY_PROMPT,
  },
  {
    key: "assessment-operational-health-configuration",
    name: "Operational Health — Configuration Correctness",
    description: `Short causal-reasoning prose on this tenant's REAL configuration-profile drift count and device findings (#292). Names no policy and asserts no change history. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: OPERATIONAL_HEALTH_CONFIGURATION_PROMPT,
  },
  {
    key: "assessment-operational-health-copilot-impact",
    name: "Operational Health — Copilot Readiness Impact",
    description: `Short causal-reasoning prose connecting this tenant's REAL endpoint posture to the REAL Copilot Gate score and gap (#292). Predicts no post-remediation score, ranks no pillar and claims no trajectory. Additional token: {{gateBlock}}. ${NARRATIVE_TOKENS}`,
    category: "insights",
    featureArea: FEATURE_AREA,
    featureRoute: NARRATIVE_FEATURE_ROUTE,
    model: NARRATIVE_MODEL,
    body: OPERATIONAL_HEALTH_COPILOT_IMPACT_PROMPT,
  },
];

/**
 * Lead Qualification Scoring Engine
 *
 * Computes a 0–100 composite score from five sub-scores:
 *   Fit      0–25  (company profile fit)
 *   Pain     0–30  (pain points / urgency indicators)
 *   Maturity 0–20  (org maturity signals)
 *   Intent   0–15  (engagement signals)
 *   Urgency  0–10  (urgency signals)
 */

export interface LeadProfile {
  industry?: string | null;
  employeeCount?: number | null;
  licenseTier?: string | null;
  tenantAge?: number | null;
  itTeamSize?: number | null;
  painPoints?: string[];
  maturityIndicators?: string[];
  engagementSignals?: string[];
  urgencySignals?: string[];
  companySize?: string | null;
  serviceArea?: string | null;
  source?: string;
}

export interface ScoreResult {
  total: number;
  fit: number;
  pain: number;
  maturity: number;
  intent: number;
  urgency: number;
  evidence: string[];
}

const HIGH_FIT_INDUSTRIES = [
  "technology", "tech", "financial services", "finance", "banking", "healthcare", "government",
  "education", "legal", "professional services", "consulting", "non-profit", "nonprofit",
  "manufacturing", "energy", "utilities",
];

const LICENSE_TIER_SCORES: Record<string, number> = {
  "e5": 25,
  "e3": 20,
  "business premium": 18,
  "m365 e5": 25,
  "m365 e3": 20,
  "microsoft 365 e5": 25,
  "microsoft 365 e3": 20,
  "f3": 10,
  "f1": 8,
  "business basic": 8,
  "business standard": 12,
};

const PAIN_POINT_SCORES: Record<string, number> = {
  "governance": 8,
  "compliance": 8,
  "security": 7,
  "migration": 7,
  "copilot": 6,
  "ai readiness": 6,
  "sharepoint": 5,
  "power platform": 5,
  "teams": 4,
  "training": 4,
  "adoption": 4,
  "licensing": 3,
  "cost optimization": 3,
};

const MATURITY_INDICATOR_SCORES: Record<string, number> = {
  "has existing m365": 5,
  "dedicated it team": 5,
  "previous consultant": 4,
  "documented processes": 4,
  "data governance policy": 4,
  "active sharepoint usage": 3,
  "teams adoption": 3,
  "power platform usage": 3,
};

const ENGAGEMENT_SIGNAL_SCORES: Record<string, number> = {
  "requested demo": 5,
  "downloaded resource": 4,
  "completed quiz": 4,
  "visited pricing page": 4,
  "multiple visits": 3,
  "referral": 4,
  "contact form": 3,
  "linkedin outreach": 3,
  "replied to email": 3,
};

const URGENCY_SIGNAL_SCORES: Record<string, number> = {
  "audit deadline": 4,
  "compliance deadline": 4,
  "board mandate": 3,
  "budget approved": 3,
  "project kickoff scheduled": 3,
  "urgent": 2,
  "asap": 2,
  "this quarter": 2,
};

function scoreInRange(val: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(val)));
}

function matchAny(list: string[], dict: Record<string, number>): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const item of list) {
    const lower = item.toLowerCase();
    for (const [key, pts] of Object.entries(dict)) {
      if (lower.includes(key) || key.includes(lower)) {
        score += pts;
        matched.push(item);
        break;
      }
    }
  }
  return { score, matched };
}

export function scoreLead(lead: LeadProfile): ScoreResult {
  const evidence: string[] = [];

  // ── Fit (0–25) ────────────────────────────────────────────────────────────
  let fitRaw = 0;

  // Employee count
  const ec = lead.employeeCount ?? parseCompanySize(lead.companySize);
  if (ec >= 500) { fitRaw += 12; evidence.push(`Large org: ${ec}+ employees`); }
  else if (ec >= 100) { fitRaw += 8; evidence.push(`Mid-size org: ${ec} employees`); }
  else if (ec >= 25) { fitRaw += 4; evidence.push(`SMB: ${ec} employees`); }

  // Industry
  const ind = (lead.industry ?? "").toLowerCase();
  if (ind && HIGH_FIT_INDUSTRIES.some(i => ind.includes(i) || i.includes(ind))) {
    fitRaw += 7;
    evidence.push(`High-fit industry: ${lead.industry}`);
  }

  // License tier
  const lt = (lead.licenseTier ?? "").toLowerCase();
  const licScore = LICENSE_TIER_SCORES[lt] ?? 0;
  if (licScore > 0) {
    fitRaw += Math.min(6, Math.round(licScore / 4));
    evidence.push(`License tier: ${lead.licenseTier}`);
  }

  const fit = scoreInRange(fitRaw, 25);

  // ── Pain (0–30) ───────────────────────────────────────────────────────────
  const painPoints = lead.painPoints ?? [];
  const { score: painFromPoints, matched: painMatched } = matchAny(painPoints, PAIN_POINT_SCORES);
  let painRaw = Math.min(30, painFromPoints);

  // Service area can hint pain
  const sa = (lead.serviceArea ?? "").toLowerCase();
  if (sa && painRaw < 15) {
    for (const [key, pts] of Object.entries(PAIN_POINT_SCORES)) {
      if (sa.includes(key)) { painRaw += Math.round(pts / 2); break; }
    }
  }

  if (painMatched.length > 0) {
    evidence.push(`Pain points: ${painMatched.slice(0, 3).join(", ")}`);
  }
  const pain = scoreInRange(painRaw, 30);

  // ── Maturity (0–20) ───────────────────────────────────────────────────────
  const maturityIndicators = lead.maturityIndicators ?? [];
  const { score: maturityScore, matched: matMatched } = matchAny(maturityIndicators, MATURITY_INDICATOR_SCORES);

  // IT team size bonus
  let maturityRaw = maturityScore;
  const its = lead.itTeamSize ?? 0;
  if (its >= 5) { maturityRaw += 5; evidence.push(`IT team: ${its} people`); }
  else if (its >= 2) { maturityRaw += 3; }

  // Tenant age
  const ta = lead.tenantAge ?? 0;
  if (ta >= 3) { maturityRaw += 4; evidence.push(`Established tenant: ${ta} years`); }
  else if (ta >= 1) { maturityRaw += 2; }

  if (matMatched.length > 0) {
    evidence.push(`Maturity signals: ${matMatched.slice(0, 3).join(", ")}`);
  }
  const maturity = scoreInRange(maturityRaw, 20);

  // ── Intent (0–15) ─────────────────────────────────────────────────────────
  const engagementSignals = lead.engagementSignals ?? [];
  let intentRaw = 0;

  // Source bonus
  if (lead.source === "lead_magnet") { intentRaw += 4; evidence.push("Engaged via lead magnet"); }
  else if (lead.source === "contact_form") { intentRaw += 3; evidence.push("Submitted contact form"); }

  const { score: intentScore, matched: intentMatched } = matchAny(engagementSignals, ENGAGEMENT_SIGNAL_SCORES);
  intentRaw += intentScore;

  if (intentMatched.length > 0) {
    evidence.push(`Engagement: ${intentMatched.slice(0, 2).join(", ")}`);
  }
  const intent = scoreInRange(intentRaw, 15);

  // ── Urgency (0–10) ────────────────────────────────────────────────────────
  const urgencySignals = lead.urgencySignals ?? [];
  const { score: urgencyScore, matched: urgMatched } = matchAny(urgencySignals, URGENCY_SIGNAL_SCORES);
  if (urgMatched.length > 0) {
    evidence.push(`Urgency: ${urgMatched.slice(0, 2).join(", ")}`);
  }
  const urgency = scoreInRange(urgencyScore, 10);

  const total = fit + pain + maturity + intent + urgency;

  return { total, fit, pain, maturity, intent, urgency, evidence };
}

function parseCompanySize(companySize: string | null | undefined): number {
  if (!companySize) return 0;
  const lower = companySize.toLowerCase();
  if (lower.includes("1000") || lower.includes("enterprise") || lower.includes("large")) return 1000;
  if (lower.includes("500")) return 500;
  if (lower.includes("250")) return 250;
  if (lower.includes("100")) return 100;
  if (lower.includes("50")) return 50;
  if (lower.includes("25")) return 25;
  if (lower.includes("10")) return 10;
  // try parsing a bare number
  const match = companySize.match(/\d+/);
  if (match) return parseInt(match[0], 10);
  return 0;
}

// ── Next Step & Workflow Mapping ──────────────────────────────────────────────

export type NextStepKey =
  | "DiscoveryCall"
  | "GovernanceAssessment"
  | "CopilotReadiness"
  | "ComplianceReview"
  | "TenantHealth"
  | "ProposalPrep";

export interface NextStep {
  key: NextStepKey;
  label: string;
  workflowType: string;
  description: string;
}

const NEXT_STEP_MAP: Record<NextStepKey, NextStep> = {
  DiscoveryCall: {
    key: "DiscoveryCall",
    label: "Discovery Call",
    workflowType: "DiscoveryCall",
    description: "Schedule a 60-min discovery call to understand goals and map services.",
  },
  GovernanceAssessment: {
    key: "GovernanceAssessment",
    label: "Governance Assessment",
    workflowType: "GovernanceAssessment",
    description: "Run a governance foundations review for tenant policies and compliance posture.",
  },
  CopilotReadiness: {
    key: "CopilotReadiness",
    label: "Copilot Readiness Assessment",
    workflowType: "CopilotReadiness",
    description: "Evaluate AI readiness: data sensitivity, licensing, adoption blockers.",
  },
  ComplianceReview: {
    key: "ComplianceReview",
    label: "Compliance Review",
    workflowType: "ComplianceReview",
    description: "Audit security/compliance posture and map remediation roadmap.",
  },
  TenantHealth: {
    key: "TenantHealth",
    label: "Tenant Health Audit",
    workflowType: "TenantHealth",
    description: "Full M365 tenant health check across licensing, configuration, and sprawl.",
  },
  ProposalPrep: {
    key: "ProposalPrep",
    label: "Proposal Preparation",
    workflowType: "ProposalPrep",
    description: "Prepare a tailored SOW and pricing proposal for the identified needs.",
  },
};

export function determineNextStep(score: number, painPoints: string[]): NextStep {
  const pain = painPoints.map(p => p.toLowerCase()).join(" ");

  if (pain.includes("governance") || pain.includes("compliance") && score >= 65) {
    return pain.includes("compliance") && score >= 70
      ? NEXT_STEP_MAP.ComplianceReview
      : NEXT_STEP_MAP.GovernanceAssessment;
  }

  if (pain.includes("copilot") || pain.includes("ai")) {
    return NEXT_STEP_MAP.CopilotReadiness;
  }

  if (score >= 75) {
    return NEXT_STEP_MAP.ProposalPrep;
  }

  if (score >= 60) {
    if (pain.includes("tenant") || pain.includes("migration") || pain.includes("health")) {
      return NEXT_STEP_MAP.TenantHealth;
    }
    return NEXT_STEP_MAP.DiscoveryCall;
  }

  return NEXT_STEP_MAP.DiscoveryCall;
}

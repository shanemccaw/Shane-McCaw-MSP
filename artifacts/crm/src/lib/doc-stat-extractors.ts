// Shared stat-extraction helpers used by both the Overview teaser cards
// (PresentationFlow.tsx) and the per-document OMG panel (DocumentPanel.tsx).
// Keep both surfaces in sync by importing from here — never duplicate the logic.

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatSeverity = "critical" | "warning" | "info";

export interface StatCard {
  value: string;
  label: string;
  detail: string;
  severity: StatSeverity;
}

export type DocTypeFamily =
  | "security"    // security_hardening_plan, security_posture_report, full_readiness_report
  | "license"     // license_optimization_report
  | "governance"  // governance_maturity_report, governance_framework
  | "copilot"     // copilot_enablement_plan
  | "remediation" // remediation_plan, identity_modernization_plan
  | "exposure"    // data_exposure_risk_report
  | "executive"   // executive_summary
  | "deployment"  // deployment_plan
  | "sow";        // sow, consolidated_sow (→ always compact fallback)

// ─── Doc-type → family mapping ────────────────────────────────────────────────

export const DOC_FAMILY: Record<string, DocTypeFamily> = {
  security_hardening_plan: "security",
  security_posture_report: "security",
  full_readiness_report: "security",
  license_optimization_report: "license",
  governance_maturity_report: "governance",
  governance_framework: "governance",
  copilot_enablement_plan: "copilot",
  remediation_plan: "remediation",
  identity_modernization_plan: "remediation",
  data_exposure_risk_report: "exposure",
  executive_summary: "executive",
  deployment_plan: "deployment",
  sow: "sow",
  consolidated_sow: "sow",
};

// ─── Cost-of-inaction cards (static, well-researched defaults) ────────────────
// Source: IBM Cost of a Data Breach Report 2024 + Ponemon Institute SMB data.

export const BREACH_COST_CARD: Partial<Record<string, StatCard>> = {
  security_hardening_plan: {
    value: "~$4.9M",
    label: "Avg Breach Cost",
    detail: "IBM 2024 — misconfiguration is the #1 breach vector",
    severity: "critical",
  },
  copilot_enablement_plan: {
    value: "~$3.8M",
    label: "Avg Breach Cost",
    detail: "IBM 2024 — AI/data exposure incidents, orgs your size",
    severity: "critical",
  },
  full_readiness_report: {
    value: "~$4.9M",
    label: "Avg Breach Cost",
    detail: "IBM 2024 — global avg when multiple control domains are unprotected",
    severity: "critical",
  },
};

// ─── HTML strip helper ────────────────────────────────────────────────────────

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Per-family stat extractors ───────────────────────────────────────────────
// Each returns up to 4 StatCards with targeted, family-specific patterns.

/** Security family: security_hardening_plan, security_posture_report, full_readiness_report */
export function extractSecurityCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Lowest X/100 health/composite score
  const scores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1])).filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (scores.length) {
    const worst = Math.min(...scores);
    if (worst <= 30) add({ value: `${worst}/100`, label: "Health Score", detail: worst === 0 ? "Across all security domains" : "Below minimum security threshold", severity: worst <= 10 ? "critical" : "warning" });
  }

  // Conditional Access absence
  if (/zero\s+conditional\s+access|0\s+conditional\s+access|no\s+conditional\s+access\s+polic/i.test(text)) {
    add({ value: "ZERO", label: "Conditional Access Policies", detail: "Identity protection is completely absent", severity: "critical" });
  }

  // Security control cluster (Intune / Defender / DLP / Labels)
  const gaps: string[] = [];
  if (/no\s+intune|intune\s+not\s+(?:deployed|configured)|intune\s+not\s+configured/i.test(text)) gaps.push("Intune");
  if (/no\s+defender|defender\s+not\s+deployed|microsoft\s+defender\s+not\s+deployed/i.test(text)) gaps.push("Defender");
  if (/0\s+dlp\s+polic|zero\s+dlp|no\s+dlp\s+polic|dlp\s+polic.*not\s+configured/i.test(text)) gaps.push("DLP");
  if (/0\s+sensitivity\s+labels?|zero\s+sensitivity|no\s+sensitivity\s+labels?/i.test(text)) gaps.push("Labels");
  if (gaps.length >= 2) add({ value: "ZERO", label: "Advanced Security Controls", detail: `No ${gaps.join(" · ")} deployed`, severity: "critical" });
  else if (gaps.length === 1) add({ value: "NONE", label: `${gaps[0]} Deployment`, detail: "Advanced security control not configured", severity: "warning" });

  // Unlicensed user %
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|operating without[^.]{0,40}licens|without[^.]{0,30}licens)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Operating without Microsoft 365 licenses", severity: pct >= 70 ? "critical" : "warning" });
  } else {
    const fracM = text.match(/only\s+(\d+)\s+of\s+(\d+)\s+users?[^.]{0,40}(?:hold|have)\s+(?:active\s+)?(?:M365|Microsoft 365)\s+licens/i);
    if (fracM) {
      const pct = Math.round(((parseInt(fracM[2]) - parseInt(fracM[1])) / parseInt(fracM[2])) * 100);
      add({ value: `${pct}%`, label: "Users Unlicensed", detail: `${fracM[1]} of ${fracM[2]} users hold active M365 licenses`, severity: pct >= 70 ? "critical" : "warning" });
    }
  }

  // Cmdlet / script availability failures
  if (/cmdlet[^.]{0,40}(?:fail|unavailab|non.functional)|(?:powershell|script)[^.]{0,30}fail/i.test(text)) {
    add({ value: "BLOCKED", label: "Audit Scripts", detail: "Cmdlet failures limit visibility — gaps may be larger", severity: "warning" });
  }

  return cards.slice(0, 4);
}

/** License family: license_optimization_report */
export function extractLicenseCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Unlicensed %
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|inactive|without[^.]{0,30}licens|not\s+licensed)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    add({ value: `${pct}%`, label: "Inactive / Unlicensed Users", detail: "Paying for seats with no active usage", severity: pct >= 50 ? "critical" : "warning" });
  }

  // "X of Y users" fraction
  const fracM = text.match(/(\d+)\s+of\s+(\d+)\s+users?[^.]{0,40}(?:unlicensed|inactive|without[^.]{0,30}licens)/i)
    ?? text.match(/only\s+(\d+)\s+of\s+(\d+)\s+users?[^.]{0,40}(?:active|licens)/i);
  if (fracM && !seen.has("Inactive / Unlicensed Users")) {
    const unlicensed = parseInt(fracM[1]);
    const total = parseInt(fracM[2]);
    if (total > 0) {
      const pct = Math.round((unlicensed / total) * 100);
      add({ value: `${pct}%`, label: "Inactive / Unlicensed Users", detail: `${unlicensed} of ${total} users inactive or unlicensed`, severity: pct >= 50 ? "critical" : "warning" });
    }
  }

  // Wasted seats
  const wastedM = text.match(/\b(\d+)\s+unused\s+licens|\b(\d+)\s+(?:unassigned|wasted)\s+(?:licens|seats?)/i);
  if (wastedM) {
    const n = parseInt(wastedM[1] ?? wastedM[2]);
    add({ value: `${n}`, label: "Unused Licenses", detail: "Seats being paid for with no active user", severity: "warning" });
  }

  // Cost waste
  const costM = text.match(/\$\s*(\d[\d,]+)\s*(?:per year|\/year|annual|wasted)/i)
    ?? text.match(/annual[^.]{0,20}waste[^.]{0,20}\$\s*(\d[\d,]+)/i);
  if (costM) {
    add({ value: `$${costM[1]}`, label: "Annual License Waste", detail: "Estimated yearly spend on unused licenses", severity: "warning" });
  }

  return cards.slice(0, 4);
}

/** Governance family: governance_maturity_report, governance_framework */
export function extractGovernanceCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Lowest domain X/100 score
  const scores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1])).filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (scores.length) {
    const worst = Math.min(...scores);
    if (worst <= 30) add({ value: `${worst}/100`, label: "Governance Score", detail: worst === 0 ? "Across all governance domains" : "Below acceptable governance baseline", severity: worst <= 10 ? "critical" : "warning" });
  }

  // Zero governance policies
  if (/zero\s+(?:dlp|data\s+loss|retention|governance)\s+polic|no\s+(?:dlp|retention)\s+polic|0\s+(?:dlp|retention)\s+polic/i.test(text)) {
    add({ value: "ZERO", label: "Governance Policies", detail: "No DLP, retention, or classification rules exist", severity: "critical" });
  }

  // Unmanaged Teams / SharePoint sites count
  const unmanagedM = text.match(/(\d+)\s+(?:unmanaged|ungoverned|orphaned|abandoned)\s+(?:teams?|sites?|groups?|workspaces?)/i)
    ?? text.match(/(\d+)\s+(?:teams?|sites?|groups?)[^.]{0,30}(?:without\s+(?:owner|governance|policy)|no\s+(?:owner|policy))/i);
  if (unmanagedM) {
    add({ value: unmanagedM[1], label: "Unmanaged Teams/Sites", detail: "No owner, policy, or lifecycle controls", severity: "warning" });
  }

  // Unlicensed %
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+)?users?[^.]{0,40}(?:unlicensed|without[^.]{0,20}licens)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Compliance coverage gap", severity: pct >= 70 ? "critical" : "warning" });
  }

  return cards.slice(0, 4);
}

/** Copilot family: copilot_enablement_plan */
export function extractCopilotCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Copilot readiness / composite score
  const scores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1])).filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (scores.length) {
    const worst = Math.min(...scores);
    if (worst <= 40) add({ value: `${worst}/100`, label: "Copilot Readiness Score", detail: worst === 0 ? "Not ready for Copilot deployment" : "Below minimum Copilot readiness threshold", severity: worst <= 10 ? "critical" : "warning" });
  }

  // Unlicensed %
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|without[^.]{0,30}licens|not\s+licensed)/i)
    ?? text.match(/only\s+(\d+)\s+of\s+(\d+)\s+users?[^.]{0,40}(?:hold|have)\s+(?:active\s+)?(?:M365|Microsoft 365)\s+licens/i);
  if (pctM) {
    if (pctM[2]) {
      const pct = Math.round(((parseInt(pctM[2]) - parseInt(pctM[1])) / parseInt(pctM[2])) * 100);
      add({ value: `${pct}%`, label: "Users Without M365 License", detail: `${pctM[1]} of ${pctM[2]} users licensed — Copilot requires M365`, severity: pct >= 70 ? "critical" : "warning" });
    } else {
      const pct = Math.round(parseFloat(pctM[1]));
      if (pct > 0) add({ value: `${pct}%`, label: "Users Without M365 License", detail: "Copilot requires active M365 licensing for all users", severity: pct >= 70 ? "critical" : "warning" });
    }
  }

  // Prerequisites not met
  const prereqM = text.match(/(\d+)\s+(?:of\s+\d+\s+)?(?:copilot\s+)?prerequisite[s]?\s+(?:not\s+met|failed|missing|unmet)/i)
    ?? text.match(/(\d+)\s+(?:critical\s+)?(?:prerequisite|requirement)[s]?\s+(?:are\s+)?(?:not\s+satisfied|not\s+met|unmet|missing)/i);
  if (prereqM) {
    add({ value: prereqM[1], label: "Prerequisites Not Met", detail: "Must be resolved before Copilot can be deployed", severity: "critical" });
  }

  // Zero data governance
  if (/zero\s+(?:dlp|data\s+governance|sensitivity)|no\s+(?:dlp|sensitivity\s+labels?|data\s+classification)/i.test(text)) {
    add({ value: "ZERO", label: "Data Governance Controls", detail: "No DLP or sensitivity labels — Copilot will expose sensitive data", severity: "critical" });
  }

  return cards.slice(0, 4);
}

/** Remediation family: remediation_plan, identity_modernization_plan */
export function extractRemediationCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Current state score
  const scores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1])).filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (scores.length) {
    const worst = Math.min(...scores);
    if (worst <= 30) add({ value: `${worst}/100`, label: "Current Security Score", detail: "Score before remediation is applied", severity: worst <= 10 ? "critical" : "warning" });
  }

  // Unlicensed %
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|operating without[^.]{0,40}licens|without[^.]{0,30}licens)/i)
    ?? text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+users?[^.]{0,30}(?:unlicensed|without|inactive)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Must be remediated as immediate first step", severity: pct >= 70 ? "critical" : "warning" });
  } else {
    const fracM = text.match(/only\s+(\d+)\s+of\s+(\d+)\s+users?[^.]{0,40}(?:hold|have|with)\s+(?:active\s+)?(?:M365|Microsoft 365)/i);
    if (fracM) {
      const pct = Math.round(((parseInt(fracM[2]) - parseInt(fracM[1])) / parseInt(fracM[2])) * 100);
      add({ value: `${pct}%`, label: "Users Unlicensed", detail: `${fracM[1]} of ${fracM[2]} users have active licenses`, severity: pct >= 70 ? "critical" : "warning" });
    }
  }

  // Critical gap / finding count
  const critM = text.match(/(\d+)\s+critical\s+(?:gaps?|findings?|issues?|vulnerabilities?|risks?)/i)
    ?? text.match(/(\d+)\s+(?:gaps?|issues?|findings?)\s+(?:identified|requiring|that\s+require)/i);
  if (critM && parseInt(critM[1]) > 1) {
    add({ value: critM[1], label: "Critical Gaps Identified", detail: "Must be addressed before Copilot or compliance deadlines", severity: "critical" });
  }

  // Timeline urgency
  const timeM = text.match(/(\d+)\s+phases?\s+over\s+(\d+)\s+(weeks?|days?|months?)/i)
    ?? text.match(/(\d+)[- ](?:week|day|month)[^.]{0,20}remediation/i);
  if (timeM) {
    add({ value: timeM[1], label: "Remediation Phases", detail: `Structured plan to close all critical gaps`, severity: "info" });
  }

  return cards.slice(0, 4);
}

/** Exposure family: data_exposure_risk_report */
export function extractExposureCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // External sharing %
  const extM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+)?(?:files?|documents?|items?|sites?)[^.]{0,30}(?:externally\s+shared|shared\s+externally|with\s+external)/i)
    ?? text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:external|over.exposed|overshared)/i);
  if (extM) {
    const pct = Math.round(parseFloat(extM[1]));
    add({ value: `${pct}%`, label: "Files Externally Exposed", detail: "Shared with users outside your organization", severity: pct >= 30 ? "critical" : "warning" });
  }

  // Files/items without sensitivity labels
  const unlabeledM = text.match(/(\d[\d,]+)\s+(?:files?|documents?|items?)[^.]{0,30}(?:without|no|missing)\s+(?:sensitivity\s+)?labels?/i)
    ?? text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:files?|documents?)[^.]{0,30}(?:unlabeled|without[^.]{0,20}label)/i);
  if (unlabeledM) {
    add({ value: unlabeledM[1].includes(".") ? `${Math.round(parseFloat(unlabeledM[1]))}%` : unlabeledM[1], label: "Files Without Labels", detail: "Sensitive data with no classification or protection", severity: "critical" });
  }

  // DLP policy gaps
  if (/no\s+dlp\s+polic|zero\s+dlp|0\s+dlp/i.test(text)) {
    add({ value: "ZERO", label: "DLP Policies Active", detail: "Data can leave your tenant without restriction", severity: "critical" });
  }

  // Score
  const scores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1])).filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (scores.length) {
    const worst = Math.min(...scores);
    if (worst <= 40) add({ value: `${worst}/100`, label: "Data Protection Score", detail: "Exposure risk level across all data assets", severity: worst <= 20 ? "critical" : "warning" });
  }

  return cards.slice(0, 4);
}

/** Executive family: executive_summary */
export function extractExecutiveCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Overall composite/readiness score
  const scores = [...text.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)]
    .map(m => parseInt(m[1])).filter(n => !isNaN(n) && n >= 0 && n <= 100);
  if (scores.length) {
    const worst = Math.min(...scores);
    if (worst <= 40) add({ value: `${worst}/100`, label: "Overall Health Score", detail: worst === 0 ? "Across all measured domains" : "Below acceptable baseline", severity: worst <= 10 ? "critical" : "warning" });
  }

  // Critical finding count
  const critCount = [...text.matchAll(/\bCRITICAL\b/gi)].length;
  if (critCount >= 3) add({ value: `${critCount}`, label: "Critical Findings", detail: "Requiring immediate attention", severity: "critical" });

  // Unlicensed %
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+)?(?:users?\s+)?(?:unlicensed|without[^.]{0,30}licens)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Affecting compliance and security coverage", severity: pct >= 70 ? "critical" : "warning" });
  }

  // Zero security controls
  if (/zero\s+conditional\s+access|no\s+(?:dlp|intune|defender)\s+polic|0\s+conditional\s+access/i.test(text)) {
    add({ value: "ZERO", label: "Security Controls", detail: "No identity, endpoint, or data protection deployed", severity: "critical" });
  }

  return cards.slice(0, 4);
}

/** Deployment family: deployment_plan */
export function extractDeploymentCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Phase count
  const phaseM = text.match(/(\d+)\s+(?:deployment\s+)?phases?/i);
  if (phaseM && parseInt(phaseM[1]) > 1) {
    add({ value: phaseM[1], label: "Deployment Phases", detail: "Structured rollout to minimize business disruption", severity: "info" });
  }

  // Total user / seat count being migrated
  // Note: [^.\d]{0,30} excludes digits from the gap so the greedy quantifier
  // cannot over-consume comma-formatted numbers like "1,200" → "00".
  const userM = text.match(/deploying to[^.\d]{0,30}(\d[\d,]+)\s+users?/i)
    ?? text.match(/(\d[\d,]+)\s+users?\s+(?:to be migrated|migrating|across|in scope)/i);
  if (userM) {
    add({ value: userM[1], label: "Users in Scope", detail: "Being migrated or onboarded in this engagement", severity: "info" });
  }

  // Timeline
  // Note: [^.\d]{0,20} excludes digits from the gap so a comma-formatted number
  // like "1,200" in "estimated over 1,200 months" cannot be partially consumed
  // by the quantifier before the (\d+) capture group, matching the same fix
  // applied to the "deploying to" gap in the Users-in-Scope pattern above.
  const weekM = text.match(/(\d+)[- ](?:week|month)\s+(?:rollout|deployment|migration|timeline|plan)/i)
    ?? text.match(/estimated[^.\d]{0,20}(\d+)\s+(weeks?|months?)/i);
  if (weekM) {
    add({ value: `${weekM[1]} ${weekM[2] ?? "wk"}`, label: "Estimated Timeline", detail: "From kickoff to completion", severity: "info" });
  }

  return cards.slice(0, 4);
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export function extractStatCards(html: string, docType: string): StatCard[] {
  if (!html) return [];
  const text = htmlToText(html);
  const family: DocTypeFamily = DOC_FAMILY[docType] ?? "executive";
  const breachCard = BREACH_COST_CARD[docType];

  // For doc types that carry a breach-cost card, cap the family extractor at 3
  // so the breach-cost card always occupies the final slot (4th position).
  const limit = breachCard ? 3 : 4;

  let cards: StatCard[];
  switch (family) {
    case "security":    cards = extractSecurityCards(text).slice(0, limit);    break;
    case "license":     cards = extractLicenseCards(text).slice(0, limit);     break;
    case "governance":  cards = extractGovernanceCards(text).slice(0, limit);  break;
    case "copilot":     cards = extractCopilotCards(text).slice(0, limit);     break;
    case "remediation": cards = extractRemediationCards(text).slice(0, limit); break;
    case "exposure":    cards = extractExposureCards(text).slice(0, limit);    break;
    case "executive":   cards = extractExecutiveCards(text).slice(0, limit);   break;
    case "deployment":  cards = extractDeploymentCards(text).slice(0, limit);  break;
    case "sow":         return [];
    default:            cards = extractExecutiveCards(text).slice(0, limit);   break;
  }

  if (breachCard) cards.push(breachCard);
  return cards;
}

// ─── Overview aggregate stats ─────────────────────────────────────────────────
// Derived from extractStatCards() so numbers match the per-document OMG panel.

export interface OverviewStats {
  worstScore: number | null;
  criticalMentions: number;
  wastedLicenses: number | null;
  annualWaste: string | null;
  hasZeroDlp: boolean;
}

/**
 * Aggregate findings across all documents using the same per-family extractors
 * used by the DocumentPanel OMG panel. This ensures the Overview teaser cards
 * show numbers consistent with what the client sees in each individual report.
 */
export function computeOverviewStats(
  documents: Array<{ htmlContent: string; docType: string }>
): OverviewStats {
  let worstScore: number | null = null;
  let criticalCount = 0;
  let wastedLicenses: number | null = null;
  let annualWaste: string | null = null;
  let hasZeroDlp = false;

  for (const doc of documents) {
    const cards = extractStatCards(doc.htmlContent, doc.docType);

    for (const card of cards) {
      // X/100 scores — track the worst (lowest)
      const scoreMatch = card.value.match(/^(\d+)\/100$/);
      if (scoreMatch) {
        const n = parseInt(scoreMatch[1]);
        if (!isNaN(n) && (worstScore === null || n < worstScore)) worstScore = n;
      }

      // Critical severity cards → count as "critical findings"
      // Exclude breach-cost advisory cards (label = "Avg Breach Cost") as they
      // are static industry benchmarks, not tenant-specific issues.
      // Each card always counts as exactly 1, regardless of its displayed value,
      // so the Overview number reflects distinct critical findings (stable across
      // different document-set compositions).
      if (card.severity === "critical" && card.label !== "Avg Breach Cost") {
        criticalCount += 1;
      }

      // License waste — highest unused-license count wins
      if (card.label === "Unused Licenses") {
        const n = parseInt(card.value.replace(/,/g, ""), 10);
        if (!isNaN(n) && (wastedLicenses === null || n > wastedLicenses)) wastedLicenses = n;
      }

      // Annual cost waste — first found wins
      if (card.label === "Annual License Waste" && annualWaste === null) {
        annualWaste = card.value;
      }

      // Zero DLP — set when any critical/warning card signals absent DLP controls,
      // regardless of which family extractor produced it.
      if (
        card.value === "ZERO" &&
        (/dlp/i.test(card.label) ||
          /dlp/i.test(card.detail) ||
          /governance\s+polic/i.test(card.label) ||
          /data\s+governance/i.test(card.label))
      ) {
        hasZeroDlp = true;
      }
    }
  }

  return {
    worstScore,
    criticalMentions: criticalCount,
    wastedLicenses,
    annualWaste,
    hasZeroDlp,
  };
}

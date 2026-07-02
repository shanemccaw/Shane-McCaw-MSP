import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface DocumentPanelProps {
  doc: {
    id: number;
    title: string;
    category: "report" | "consulting";
    docType: string;
    htmlContent: string;
    createdAt: string | null;
  };
  onReady?: () => void;
}

// ─── per-docType static metadata ──────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  full_readiness_report: "Full Readiness Report",
  security_posture_report: "Security Posture Report",
  governance_maturity_report: "Governance Maturity Report",
  data_exposure_risk_report: "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
  sow: "Statement of Work",
  consolidated_sow: "Consolidated SOW",
  remediation_plan: "Remediation Plan",
  deployment_plan: "Deployment Plan",
  governance_framework: "Governance Framework",
  security_hardening_plan: "Security Hardening Plan",
  copilot_enablement_plan: "Copilot Enablement Plan",
  identity_modernization_plan: "Identity Modernization Plan",
};

type RiskLevel = "critical" | "high" | "medium" | "low";

interface DocMeta {
  riskLevel: RiskLevel;
  covers: [string, string, string];
  headline: string;
}

const DOC_TYPE_META: Record<string, DocMeta> = {
  executive_summary: {
    riskLevel: "high",
    covers: ["Top-line tenant health at a glance", "Priority remediation highlights", "Recommended next steps"],
    headline: "Critical risks were identified that require immediate attention.",
  },
  full_readiness_report: {
    riskLevel: "critical",
    covers: ["End-to-end Microsoft 365 tenant assessment", "Security, compliance & licensing gaps", "Roadmap for Copilot readiness"],
    headline: "Your Microsoft 365 environment has critical gaps across multiple domains.",
  },
  security_posture_report: {
    riskLevel: "critical",
    covers: ["Identity & access control gaps", "Conditional Access and MFA coverage", "Immediate hardening priorities"],
    headline: "Significant identity and access vulnerabilities were found in your environment.",
  },
  governance_maturity_report: {
    riskLevel: "high",
    covers: ["Data governance maturity baseline", "SharePoint & Teams sprawl analysis", "Policy and retention gaps"],
    headline: "Governance gaps leave your data, teams, and compliance posture exposed.",
  },
  data_exposure_risk_report: {
    riskLevel: "critical",
    covers: ["External sharing and oversharing risks", "Sensitive data without protection labels", "DLP policy coverage gaps"],
    headline: "Sensitive data is being shared without controls — every file is at risk.",
  },
  license_optimization_report: {
    riskLevel: "medium",
    covers: ["License utilization and waste analysis", "Unlicensed or underused user accounts", "Cost reduction opportunities"],
    headline: "Significant licensing waste was found in your Microsoft 365 tenant.",
  },
  remediation_plan: {
    riskLevel: "high",
    covers: ["Immediate stabilization steps", "90-day hardening roadmap", "Required controls for Copilot readiness"],
    headline: "Immediate action is required to restore a baseline security posture.",
  },
  deployment_plan: {
    riskLevel: "medium",
    covers: ["Phased rollout schedule", "User adoption milestones", "Technical prerequisites and dependencies"],
    headline: "A structured deployment plan ensures a smooth rollout with minimal disruption.",
  },
  governance_framework: {
    riskLevel: "high",
    covers: ["Governance policies and standards", "Teams and SharePoint provisioning controls", "Lifecycle management procedures"],
    headline: "Without governance policies, your tenant is running entirely without guardrails.",
  },
  security_hardening_plan: {
    riskLevel: "critical",
    covers: ["Immediate stabilization steps", "90-day hardening roadmap", "Required controls for Copilot readiness"],
    headline: "Your tenant has critical security gaps that expose every user and every file.",
  },
  copilot_enablement_plan: {
    riskLevel: "critical",
    covers: ["Copilot prerequisite compliance", "User readiness and training plan", "Governance guardrails for AI usage"],
    headline: "Copilot cannot be safely deployed until these foundational gaps are closed.",
  },
  identity_modernization_plan: {
    riskLevel: "high",
    covers: ["Identity hygiene and stale account cleanup", "Conditional Access modernization", "MFA and passwordless adoption path"],
    headline: "Identity vulnerabilities are putting every user account at risk right now.",
  },
  consolidated_sow: {
    riskLevel: "medium",
    covers: ["Full scope of engagement and deliverables", "Timeline and phased pricing breakdown", "Acceptance criteria per phase"],
    headline: "Your engagement roadmap — scope, phases, and investment at a glance.",
  },
  sow: {
    riskLevel: "medium",
    covers: ["Scope of work and engagement terms", "Deliverables and timeline", "Investment and payment structure"],
    headline: "Scope, deliverables, and investment for your engagement.",
  },
};

// ─── Stat card types ───────────────────────────────────────────────────────────

type StatSeverity = "critical" | "warning" | "info";

interface StatCard {
  value: string;
  label: string;
  detail: string;
  severity: StatSeverity;
}

// ─── HTML strip helper ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Per-family stat extractors ───────────────────────────────────────────────
// Each returns up to 4 StatCards with targeted, family-specific patterns.

type DocTypeFamily =
  | "security"    // security_hardening_plan, security_posture_report, full_readiness_report
  | "license"     // license_optimization_report
  | "governance"  // governance_maturity_report, governance_framework
  | "copilot"     // copilot_enablement_plan
  | "remediation" // remediation_plan, identity_modernization_plan
  | "exposure"    // data_exposure_risk_report
  | "executive"   // executive_summary
  | "deployment"  // deployment_plan
  | "sow";        // sow, consolidated_sow (→ always compact fallback)

const DOC_FAMILY: Record<string, DocTypeFamily> = {
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

/** Security family: security_hardening_plan, security_posture_report, full_readiness_report */
function extractSecurityCards(text: string): StatCard[] {
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

  // Conditional Access absence — "zero Conditional Access policies" / "0 Conditional Access"
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

  // Unlicensed user %: "91% of users operating without M365 licensing"
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|operating without[^.]{0,40}licens|without[^.]{0,30}licens)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Operating without Microsoft 365 licenses", severity: pct >= 70 ? "critical" : "warning" });
  } else {
    // "X of Y users (N%) without M365 licensing" / "only 2 of 22 users"
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
function extractLicenseCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Unlicensed % (most prominent signal for license docs)
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

  // Wasted seats: "X unused licenses" / "X seats not assigned"
  const wastedM = text.match(/\b(\d+)\s+unused\s+licens|\b(\d+)\s+(?:unassigned|wasted)\s+(?:licens|seats?)/i);
  if (wastedM) {
    const n = parseInt(wastedM[1] ?? wastedM[2]);
    add({ value: `${n}`, label: "Unused Licenses", detail: "Seats being paid for with no active user", severity: "warning" });
  }

  // Cost waste: "$X,XXX wasted" / "saving $X" / "annual waste"
  const costM = text.match(/\$\s*(\d[\d,]+)\s*(?:per year|\/year|annual|wasted)/i)
    ?? text.match(/annual[^.]{0,20}waste[^.]{0,20}\$\s*(\d[\d,]+)/i);
  if (costM) {
    add({ value: `$${costM[1]}`, label: "Annual License Waste", detail: "Estimated yearly spend on unused licenses", severity: "warning" });
  }

  return cards.slice(0, 4);
}

/** Governance family: governance_maturity_report, governance_framework */
function extractGovernanceCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Lowest domain X/100 score (governance has multiple domain scores)
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

  // Unlicensed % (may appear in governance context too)
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+)?users?[^.]{0,40}(?:unlicensed|without[^.]{0,20}licens)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Compliance coverage gap", severity: pct >= 70 ? "critical" : "warning" });
  }

  return cards.slice(0, 4);
}

/** Copilot family: copilot_enablement_plan */
function extractCopilotCards(text: string): StatCard[] {
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

  // Unlicensed %: "only 2 of 22 users (9.09%) hold active M365 licenses"
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|without[^.]{0,30}licens|not\s+licensed)/i)
    ?? text.match(/only\s+(\d+)\s+of\s+(\d+)\s+users?[^.]{0,40}(?:hold|have)\s+(?:active\s+)?(?:M365|Microsoft 365)\s+licens/i);
  if (pctM) {
    if (pctM[2]) {
      // fraction form
      const pct = Math.round(((parseInt(pctM[2]) - parseInt(pctM[1])) / parseInt(pctM[2])) * 100);
      add({ value: `${pct}%`, label: "Users Without M365 License", detail: `${pctM[1]} of ${pctM[2]} users licensed — Copilot requires M365`, severity: pct >= 70 ? "critical" : "warning" });
    } else {
      const pct = Math.round(parseFloat(pctM[1]));
      if (pct > 0) add({ value: `${pct}%`, label: "Users Without M365 License", detail: "Copilot requires active M365 licensing for all users", severity: pct >= 70 ? "critical" : "warning" });
    }
  }

  // Prerequisites not met: "X of Y prerequisites" / "X prerequisites not met/failed"
  const prereqM = text.match(/(\d+)\s+(?:of\s+\d+\s+)?(?:copilot\s+)?prerequisite[s]?\s+(?:not\s+met|failed|missing|unmet)/i)
    ?? text.match(/(\d+)\s+(?:critical\s+)?(?:prerequisite|requirement)[s]?\s+(?:are\s+)?(?:not\s+satisfied|not\s+met|unmet|missing)/i);
  if (prereqM) {
    add({ value: prereqM[1], label: "Prerequisites Not Met", detail: "Must be resolved before Copilot can be deployed", severity: "critical" });
  }

  // Zero data governance (critical for Copilot readiness)
  if (/zero\s+(?:dlp|data\s+governance|sensitivity)|no\s+(?:dlp|sensitivity\s+labels?|data\s+classification)/i.test(text)) {
    add({ value: "ZERO", label: "Data Governance Controls", detail: "No DLP or sensitivity labels — Copilot will expose sensitive data", severity: "critical" });
  }

  return cards.slice(0, 4);
}

/** Remediation family: remediation_plan, identity_modernization_plan */
function extractRemediationCards(text: string): StatCard[] {
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

  // Unlicensed % (common in remediation docs)
  const pctM = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+(?:of\s+(?:users?\s+)?)?(?:unlicensed|operating without[^.]{0,40}licens|without[^.]{0,30}licens)/i)
    ?? text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%\s+users?[^.]{0,30}(?:unlicensed|without|inactive)/i);
  if (pctM) {
    const pct = Math.round(parseFloat(pctM[1]));
    if (pct > 0) add({ value: `${pct}%`, label: "Users Unlicensed", detail: "Must be remediated as immediate first step", severity: pct >= 70 ? "critical" : "warning" });
  } else {
    // fraction: "only N of M users"
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

  // Timeline urgency: "X phases over Y weeks/days"
  const timeM = text.match(/(\d+)\s+phases?\s+over\s+(\d+)\s+(weeks?|days?|months?)/i)
    ?? text.match(/(\d+)[- ](?:week|day|month)[^.]{0,20}remediation/i);
  if (timeM) {
    const label = timeM[2] ? `${timeM[1]} Phases · ${timeM[2]} ${timeM[3]}` : `${timeM[1]}-${timeM[2] ? timeM[2] + " " : ""}Week Plan`;
    add({ value: timeM[1], label: "Remediation Phases", detail: `Structured plan to close all critical gaps`, severity: "info" });
  }

  return cards.slice(0, 4);
}

/** Exposure family: data_exposure_risk_report */
function extractExposureCards(text: string): StatCard[] {
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
function extractExecutiveCards(text: string): StatCard[] {
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
function extractDeploymentCards(text: string): StatCard[] {
  const cards: StatCard[] = [];
  const seen = new Set<string>();
  const add = (c: StatCard) => { if (!seen.has(c.label)) { seen.add(c.label); cards.push(c); } };

  // Phase count
  const phaseM = text.match(/(\d+)\s+(?:deployment\s+)?phases?/i);
  if (phaseM && parseInt(phaseM[1]) > 1) {
    add({ value: phaseM[1], label: "Deployment Phases", detail: "Structured rollout to minimize business disruption", severity: "info" });
  }

  // Total user / seat count being migrated
  const userM = text.match(/deploying to[^.]{0,30}(\d[\d,]+)\s+users?/i)
    ?? text.match(/(\d[\d,]+)\s+users?\s+(?:to be migrated|migrating|across|in scope)/i);
  if (userM) {
    add({ value: userM[1], label: "Users in Scope", detail: "Being migrated or onboarded in this engagement", severity: "info" });
  }

  // Timeline: "X weeks" / "X months"
  const weekM = text.match(/(\d+)[- ](?:week|month)\s+(?:rollout|deployment|migration|timeline|plan)/i)
    ?? text.match(/estimated[^.]{0,20}(\d+)\s+(weeks?|months?)/i);
  if (weekM) {
    add({ value: `${weekM[1]} ${weekM[2] ?? "wk"}`, label: "Estimated Timeline", detail: "From kickoff to completion", severity: "info" });
  }

  return cards.slice(0, 4);
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

function extractStatCards(html: string, docType: string): StatCard[] {
  if (!html) return [];
  const text = htmlToText(html);
  const family: DocTypeFamily = DOC_FAMILY[docType] ?? "executive";
  switch (family) {
    case "security":    return extractSecurityCards(text);
    case "license":     return extractLicenseCards(text);
    case "governance":  return extractGovernanceCards(text);
    case "copilot":     return extractCopilotCards(text);
    case "remediation": return extractRemediationCards(text);
    case "exposure":    return extractExposureCards(text);
    case "executive":   return extractExecutiveCards(text);
    case "deployment":  return extractDeploymentCards(text);
    case "sow":         return []; // always compact fallback
    default:            return extractExecutiveCards(text);
  }
}

// ─── Visual theme per risk level ──────────────────────────────────────────────

const PANEL_THEME: Record<RiskLevel, {
  gradient: string;
  badgeBg: string; badgeText: string; dot: string; badgeLabel: string;
  cardBg: string; cardBorder: string; cardValueColor: string;
  tenantTextColor: string; headlineColor: string; coversColor: string;
}> = {
  critical: {
    gradient: "bg-gradient-to-br from-red-950 via-red-900 to-[#0A2540]",
    badgeBg: "bg-red-500/25", badgeText: "text-red-200", dot: "bg-red-400", badgeLabel: "Critical Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-red-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
  high: {
    gradient: "bg-gradient-to-br from-orange-950 via-orange-900 to-[#0A2540]",
    badgeBg: "bg-orange-500/25", badgeText: "text-orange-200", dot: "bg-orange-400", badgeLabel: "High Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-orange-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
  medium: {
    gradient: "bg-gradient-to-br from-amber-900 via-amber-800 to-[#0A2540]",
    badgeBg: "bg-amber-500/25", badgeText: "text-amber-200", dot: "bg-amber-400", badgeLabel: "Medium Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-amber-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
  low: {
    gradient: "bg-gradient-to-br from-green-950 via-green-900 to-[#0A2540]",
    badgeBg: "bg-green-500/25", badgeText: "text-green-200", dot: "bg-green-400", badgeLabel: "Low Risk",
    cardBg: "bg-white/10", cardBorder: "border-white/20", cardValueColor: "text-white",
    tenantTextColor: "text-green-200/80", headlineColor: "text-white", coversColor: "text-white/70",
  },
};

const STAT_SEVERITY_ACCENT: Record<StatSeverity, string> = {
  critical: "border-t-red-400",
  warning:  "border-t-orange-400",
  info:     "border-t-blue-400",
};

// ─── Compact fallback bar (SOW / deployment plan / docs with < 2 stat cards) ──

const COMPACT_THEME: Record<RiskLevel, { bg: string; border: string; text: string; dot: string; label: string }> = {
  critical: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500", label: "Critical" },
  high:     { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", dot: "bg-orange-500", label: "High" },
  medium:   { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700", dot: "bg-yellow-400", label: "Medium" },
  low:      { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", dot: "bg-green-500", label: "Low" },
};

// ─── Document iframe helpers ───────────────────────────────────────────────────

const DOC_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.8; color: #1e293b; background: #fff; padding: 2.5rem 3rem; max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.75rem; font-weight: 800; color: #0A2540; margin: 0 0 0.25rem; letter-spacing: -0.02em; line-height: 1.2; }
  h1 + p, h1 + div { margin-top: 0.75rem; }
  h2 { font-weight: 700; color: #0078D4; margin: 2.25rem 0 0.6rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em; padding-bottom: 0.35rem; border-bottom: 1px solid #e2e8f0; }
  h3 { font-size: 1rem; font-weight: 700; color: #0A2540; margin: 1.5rem 0 0.4rem; }
  h4 { font-size: 0.875rem; font-weight: 600; color: #334155; margin: 1.25rem 0 0.35rem; }
  p { margin: 0 0 0.875rem; color: #334155; line-height: 1.8; }
  ul, ol { margin: 0.25rem 0 1rem 1.5rem; padding: 0; color: #334155; }
  li { margin-bottom: 0.3rem; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0 1.5rem; font-size: 0.85rem; }
  thead tr { background: #f1f5f9; border-bottom: 2px solid #cbd5e1; }
  th { text-align: left; padding: 0.55rem 0.75rem; font-weight: 600; color: #475569; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 0.55rem 0.75rem; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  blockquote { border-left: 3px solid #0078D4; background: #f8fafc; padding: 0.875rem 1.125rem; margin: 0.75rem 0 1.25rem; border-radius: 0 6px 6px 0; color: #475569; }
  blockquote p { margin: 0; color: #475569; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.75rem 0; }
  strong, b { font-weight: 600; color: #0A2540; }
  code { font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 0.8em; background: #f1f5f9; color: #0078D4; padding: 0.15em 0.4em; border-radius: 4px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; font-size: 0.82rem; }
  pre code { background: transparent; color: inherit; padding: 0; }
  a { color: #0078D4; text-decoration: none; }
  a:hover { text-decoration: underline; }
  section { margin-bottom: 1.5rem; }
`;

function stripFence(html: string): string {
  return html.replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
}
function cleanInlineStyles(html: string): string {
  return html.replace(/\s+style="[^"]*"/gi, "").replace(/\s+style='[^']*'/gi, "");
}
function buildSrcdoc(rawHtml: string): string {
  const body = cleanInlineStyles(stripFence(rawHtml));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${DOC_CSS}</style></head><body>${body}</body></html>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DocumentPanel({ doc, onReady }: DocumentPanelProps) {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const handleIframeLoad = () => { setIframeLoaded(true); onReady?.(); };

  const srcdoc = useMemo(() => buildSrcdoc(doc.htmlContent), [doc.htmlContent]);
  const statCards = useMemo(() => extractStatCards(doc.htmlContent, doc.docType), [doc.htmlContent, doc.docType]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/insights-documents/${doc.id}/view`);
      const data = await res.json() as { htmlContent?: string };
      const html = data.htmlContent ?? "";
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/\s+/g, "-")}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloading(false); }
  };

  const typeLabel = DOC_TYPE_LABELS[doc.docType] ?? doc.docType;
  const categoryLabel = doc.category === "consulting" ? "Consulting Deliverable" : "Assessment Report";
  const meta = DOC_TYPE_META[doc.docType] ?? null;
  const riskLevel: RiskLevel = meta?.riskLevel ?? "medium";
  const theme = PANEL_THEME[riskLevel];
  const compactTheme = COMPACT_THEME[riskLevel];
  const formattedDate = formatDate(doc.createdAt);

  // OMG panel requires at least 2 stat cards; otherwise fall back to compact bar
  const hasOmgPanel = statCards.length >= 2;

  const gridClass = statCards.length === 2
    ? "grid-cols-2"
    : statCards.length === 3
    ? "grid-cols-3"
    : "grid-cols-2 sm:grid-cols-4";

  return (
    <>
      {/* Keyframe for OMG panel entrance — injected once, no layout shift */}
      <style>{`@keyframes omgPanelIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div className="flex flex-col h-full">

        {/* ── Document header bar ── */}
        <div className="flex items-start justify-between gap-4 mb-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-[#0A2540] truncate">{doc.title}</h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${doc.category === "consulting" ? "bg-purple-100 text-purple-700" : "bg-[#0078D4]/10 text-[#0078D4]"}`}>
                  {categoryLabel}
                </span>
                <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">{typeLabel}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors px-3 py-1.5 border border-[#0078D4]/30 rounded-lg hover:bg-[#0078D4]/5 flex-shrink-0 disabled:opacity-50"
          >
            {downloading
              ? <div className="w-4 h-4 border-2 border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            }
            Download
          </button>
        </div>

        {/* ── OMG PANEL (≥ 2 stat cards found) ── */}
        {hasOmgPanel && meta ? (
          <div
            className={`flex-shrink-0 mb-3 rounded-xl overflow-hidden shadow-lg ${theme.gradient}`}
            style={{ animation: "omgPanelIn 0.35s ease-out" }}
          >
            {/* Top strip: risk badge + tenant tag */}
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap gap-y-1.5">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-bold ${theme.badgeBg} ${theme.badgeText} border-white/20`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${theme.dot}`} />
                {theme.badgeLabel}
              </div>
              <div className={`flex items-center gap-1.5 text-xs ${theme.tenantTextColor}`}>
                <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="font-semibold text-white/90">Generated from your tenant</span>
                {formattedDate && <span>· {formattedDate}</span>}
              </div>
            </div>

            {/* Headline */}
            <div className="px-4 pb-3">
              <p className={`text-sm font-bold leading-snug ${theme.headlineColor}`}>{meta.headline}</p>
            </div>

            {/* Stat cards */}
            <div className="px-4 pb-3">
              <div className={`grid gap-3 ${gridClass}`}>
                {statCards.map((card, i) => (
                  <div
                    key={i}
                    className={`${theme.cardBg} border-2 ${theme.cardBorder} border-t-4 ${STAT_SEVERITY_ACCENT[card.severity]} rounded-xl px-3 py-3 flex flex-col`}
                  >
                    <span className={`text-3xl sm:text-4xl font-black tabular-nums leading-none tracking-tight ${theme.cardValueColor}`}>
                      {card.value}
                    </span>
                    <span className="text-[11px] font-bold text-white/90 mt-1.5 leading-tight">{card.label}</span>
                    <span className="text-[10px] text-white/55 mt-0.5 leading-tight">{card.detail}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* What This Covers strip */}
            <div className="px-4 pb-3 border-t border-white/10 pt-2.5">
              <p className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5">What This Document Covers</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {meta.covers.map((c, i) => (
                  <span key={i} className={`flex items-center gap-1.5 text-[11px] ${theme.coversColor}`}>
                    <span className="text-white/40">•</span>{c}
                  </span>
                ))}
              </div>
            </div>
          </div>

        ) : (
          /* ── Compact fallback bar (< 2 stats found, SOW, deployment plan) ── */
          <div className="flex-shrink-0 mb-3 rounded-xl border border-border bg-slate-50 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border flex-wrap gap-y-1.5">
              {meta ? (
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-semibold ${compactTheme.bg} ${compactTheme.border} ${compactTheme.text}`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${compactTheme.dot}`} />
                  Risk Level: {compactTheme.label}
                </div>
              ) : <span />}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <svg className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span className="font-medium text-[#0078D4]">Generated from your tenant</span>
                {formattedDate && <span className="text-muted-foreground">· {formattedDate}</span>}
              </div>
            </div>
            {meta && (
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">What This Covers</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {meta.covers.map((c, i) => (
                    <span key={i} className="flex items-center gap-1.5 text-xs text-slate-700">
                      <span className="text-[#0078D4] font-bold">•</span>{c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── "Full Report" evidence divider ── */}
        <div className="flex-shrink-0 flex items-center gap-3 mb-2">
          <div className="h-px flex-1 bg-border" />
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/70 whitespace-nowrap">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Full Report
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* ── Document iframe ── */}
        <div className="flex-1 overflow-hidden rounded-xl border border-border shadow-sm bg-white relative min-h-0">
          {!iframeLoaded && (
            <div className="absolute inset-0 bg-white rounded-xl p-6 flex flex-col gap-3 z-10">
              {[["w-1/2", "h-7", "rounded-lg"], ["w-full", "h-4", "rounded"], ["w-11/12", "h-4", "rounded"], ["w-4/5", "h-4", "rounded"]].map(([w, h, r], i) => (
                <div key={i} className={`${h} bg-slate-100 ${r} ${w} overflow-hidden relative`}>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
                </div>
              ))}
              <div className="mt-2 h-px bg-slate-100 w-full" />
              {[["w-full", "h-4"], ["w-10/12", "h-4"]].map(([w, h], i) => (
                <div key={i} className={`${h} bg-slate-100 rounded ${w} overflow-hidden relative`}>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.2s_ease-in-out_infinite]" />
                </div>
              ))}
            </div>
          )}
          <iframe
            srcDoc={srcdoc}
            title={doc.title}
            className="w-full h-full border-0"
            sandbox="allow-same-origin"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>
    </>
  );
}

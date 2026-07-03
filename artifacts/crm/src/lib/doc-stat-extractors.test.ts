import { describe, it, expect } from "vitest";
import {
  htmlToText,
  extractSecurityCards,
  extractLicenseCards,
  extractGovernanceCards,
  extractCopilotCards,
  extractRemediationCards,
  extractExposureCards,
  extractExecutiveCards,
  extractDeploymentCards,
  extractStatCards,
  computeOverviewStats,
  DOC_FAMILY,
  BREACH_COST_CARD,
} from "./doc-stat-extractors";

// ─── htmlToText ────────────────────────────────────────────────────────────────

describe("htmlToText", () => {
  it("strips tags and collapses whitespace", () => {
    const result = htmlToText("<p>Hello  <b>World</b></p>");
    expect(result).toBe("Hello World");
  });

  it("removes <style> blocks entirely", () => {
    const result = htmlToText("<style>body { color: red; }</style><p>Text</p>");
    expect(result).not.toContain("color");
    expect(result).toContain("Text");
  });

  it("removes <script> blocks entirely", () => {
    const result = htmlToText("<script>alert('x')</script><p>Safe</p>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });

  it("returns plain text unchanged (no tags)", () => {
    expect(htmlToText("plain text")).toBe("plain text");
  });
});

// ─── extractSecurityCards ──────────────────────────────────────────────────────

describe("extractSecurityCards", () => {
  it("returns empty array when text has no matching patterns", () => {
    expect(extractSecurityCards("This document is clean and fully compliant.")).toEqual([]);
  });

  it("picks up the lowest X/100 score and marks critical when <= 10", () => {
    const cards = extractSecurityCards("Security composite score: 5/100 across domains. Also 80/100 for uptime.");
    const scoreCard = cards.find(c => c.label === "Health Score");
    expect(scoreCard).toBeDefined();
    expect(scoreCard!.value).toBe("5/100");
    expect(scoreCard!.severity).toBe("critical");
  });

  it("marks Health Score as warning when score is between 11 and 30", () => {
    const cards = extractSecurityCards("Score: 20/100 across all security domains.");
    const scoreCard = cards.find(c => c.label === "Health Score");
    expect(scoreCard).toBeDefined();
    expect(scoreCard!.severity).toBe("warning");
  });

  it("ignores scores above 30", () => {
    const cards = extractSecurityCards("Score: 50/100 — acceptable.");
    expect(cards.find(c => c.label === "Health Score")).toBeUndefined();
  });

  it("detects zero conditional access", () => {
    const cards = extractSecurityCards("There are zero conditional access policies configured.");
    const card = cards.find(c => c.label === "Conditional Access Policies");
    expect(card).toBeDefined();
    expect(card!.value).toBe("ZERO");
    expect(card!.severity).toBe("critical");
  });

  it("detects multiple security gaps and rolls them into Advanced Security Controls", () => {
    const cards = extractSecurityCards(
      "No Intune configured. Microsoft Defender not deployed. 0 DLP policies found."
    );
    const card = cards.find(c => c.label === "Advanced Security Controls");
    expect(card).toBeDefined();
    expect(card!.value).toBe("ZERO");
    expect(card!.severity).toBe("critical");
  });

  it("detects a single gap as its own NONE card", () => {
    const cards = extractSecurityCards("No Intune configured.");
    const card = cards.find(c => c.label === "Intune Deployment");
    expect(card).toBeDefined();
    expect(card!.value).toBe("NONE");
    expect(card!.severity).toBe("warning");
  });

  it("detects unlicensed % from direct percentage match", () => {
    const cards = extractSecurityCards("75% of users unlicensed and operating without M365.");
    const card = cards.find(c => c.label === "Users Unlicensed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("75%");
    expect(card!.severity).toBe("critical");
  });

  it("derives unlicensed % from 'only X of Y users hold M365 licenses'", () => {
    const cards = extractSecurityCards("Only 30 of 100 users hold active M365 licenses in the tenant.");
    const card = cards.find(c => c.label === "Users Unlicensed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("70%");
  });

  it("detects blocked audit scripts", () => {
    const cards = extractSecurityCards("Cmdlet failures limit visibility into the environment.");
    const card = cards.find(c => c.label === "Audit Scripts");
    expect(card).toBeDefined();
    expect(card!.value).toBe("BLOCKED");
    expect(card!.severity).toBe("warning");
  });

  it("returns at most 4 cards", () => {
    const rich = [
      "5/100 composite score.",
      "zero conditional access policies.",
      "No Intune configured. Microsoft Defender not deployed.",
      "75% of users unlicensed.",
      "Cmdlet failures limit visibility.",
    ].join(" ");
    expect(extractSecurityCards(rich).length).toBeLessThanOrEqual(4);
  });

  it("does not add duplicate labels", () => {
    const text = "5/100 score. Also 10/100 score.";
    const cards = extractSecurityCards(text);
    const labels = cards.map(c => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ─── extractLicenseCards ──────────────────────────────────────────────────────

describe("extractLicenseCards", () => {
  it("returns empty array for clean text", () => {
    expect(extractLicenseCards("All licenses are active and assigned.")).toEqual([]);
  });

  it("picks up unlicensed % via direct match", () => {
    // Regex requires % immediately followed by the term (no verb like "are" in between)
    const cards = extractLicenseCards("60% of users unlicensed across the tenant.");
    const card = cards.find(c => c.label === "Inactive / Unlicensed Users");
    expect(card).toBeDefined();
    expect(card!.value).toBe("60%");
    expect(card!.severity).toBe("critical");
  });

  it("picks up unlicensed from fraction (X of Y users unlicensed)", () => {
    const cards = extractLicenseCards("20 of 80 users are unlicensed in the organization.");
    const card = cards.find(c => c.label === "Inactive / Unlicensed Users");
    expect(card).toBeDefined();
    expect(card!.value).toBe("25%");
    expect(card!.severity).toBe("warning");
  });

  it("detects wasted seats", () => {
    const cards = extractLicenseCards("There are 45 unused licenses assigned to inactive accounts.");
    const card = cards.find(c => c.label === "Unused Licenses");
    expect(card).toBeDefined();
    expect(card!.value).toBe("45");
  });

  it("detects annual cost waste", () => {
    const cards = extractLicenseCards("Annual waste of $12,000 on unused Microsoft 365 licenses.");
    const card = cards.find(c => c.label === "Annual License Waste");
    expect(card).toBeDefined();
    expect(card!.value).toContain("12,000");
  });

  it("returns at most 4 cards", () => {
    const rich = [
      "55% of users are inactive or unlicensed.",
      "30 of 80 users are unlicensed.",
      "100 unused licenses sitting idle.",
      "$15,000 per year wasted on inactive seats.",
    ].join(" ");
    expect(extractLicenseCards(rich).length).toBeLessThanOrEqual(4);
  });
});

// ─── extractGovernanceCards ───────────────────────────────────────────────────

describe("extractGovernanceCards", () => {
  it("returns empty array for clean text", () => {
    expect(extractGovernanceCards("Full governance maturity achieved across all domains.")).toEqual([]);
  });

  it("picks up governance score", () => {
    const cards = extractGovernanceCards("Governance score: 15/100 across all domains.");
    const card = cards.find(c => c.label === "Governance Score");
    expect(card).toBeDefined();
    expect(card!.value).toBe("15/100");
    expect(card!.severity).toBe("warning");
  });

  it("ignores governance score above 30", () => {
    const cards = extractGovernanceCards("Governance score: 55/100.");
    expect(cards.find(c => c.label === "Governance Score")).toBeUndefined();
  });

  it("detects zero governance/DLP policies", () => {
    const cards = extractGovernanceCards("There are zero DLP policies configured in this tenant.");
    const card = cards.find(c => c.label === "Governance Policies");
    expect(card).toBeDefined();
    expect(card!.value).toBe("ZERO");
    expect(card!.severity).toBe("critical");
  });

  it("detects unmanaged teams count", () => {
    const cards = extractGovernanceCards("There are 23 unmanaged Teams workspaces with no owner.");
    const card = cards.find(c => c.label === "Unmanaged Teams/Sites");
    expect(card).toBeDefined();
    expect(card!.value).toBe("23");
  });

  it("detects unlicensed % for compliance gap", () => {
    const cards = extractGovernanceCards("80% of users are unlicensed, creating a compliance coverage gap.");
    const card = cards.find(c => c.label === "Users Unlicensed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("80%");
    expect(card!.severity).toBe("critical");
  });
});

// ─── extractCopilotCards ──────────────────────────────────────────────────────

describe("extractCopilotCards", () => {
  it("returns empty array for clean text", () => {
    expect(extractCopilotCards("Copilot is fully ready for deployment.")).toEqual([]);
  });

  it("picks up copilot readiness score <= 40", () => {
    const cards = extractCopilotCards("Copilot readiness score: 25/100. Not ready.");
    const card = cards.find(c => c.label === "Copilot Readiness Score");
    expect(card).toBeDefined();
    expect(card!.value).toBe("25/100");
    expect(card!.severity).toBe("warning");
  });

  it("marks copilot score 0/100 as critical", () => {
    const cards = extractCopilotCards("Overall readiness: 0/100.");
    const card = cards.find(c => c.label === "Copilot Readiness Score");
    expect(card).toBeDefined();
    expect(card!.severity).toBe("critical");
  });

  it("ignores copilot score above 40", () => {
    const cards = extractCopilotCards("Readiness: 60/100 — above threshold.");
    expect(cards.find(c => c.label === "Copilot Readiness Score")).toBeUndefined();
  });

  it("detects unlicensed % directly", () => {
    // Regex requires % followed immediately by the term — no verb like "are" in between
    const cards = extractCopilotCards("65% of users not licensed for Microsoft 365.");
    const card = cards.find(c => c.label === "Users Without M365 License");
    expect(card).toBeDefined();
    expect(card!.value).toBe("65%");
  });

  it("derives unlicensed from 'only X of Y users hold M365 licenses'", () => {
    const cards = extractCopilotCards("Only 40 of 200 users hold active Microsoft 365 licenses.");
    const card = cards.find(c => c.label === "Users Without M365 License");
    expect(card).toBeDefined();
    expect(card!.value).toBe("80%");
  });

  it("detects prerequisites not met", () => {
    const cards = extractCopilotCards("5 prerequisites not met before Copilot can be deployed.");
    const card = cards.find(c => c.label === "Prerequisites Not Met");
    expect(card).toBeDefined();
    expect(card!.value).toBe("5");
    expect(card!.severity).toBe("critical");
  });

  it("detects zero data governance", () => {
    const cards = extractCopilotCards("No DLP or sensitivity labels configured — Copilot will expose data.");
    const card = cards.find(c => c.label === "Data Governance Controls");
    expect(card).toBeDefined();
    expect(card!.value).toBe("ZERO");
    expect(card!.severity).toBe("critical");
  });
});

// ─── extractRemediationCards ──────────────────────────────────────────────────

describe("extractRemediationCards", () => {
  it("returns empty array for clean text", () => {
    expect(extractRemediationCards("All remediation steps have been completed successfully.")).toEqual([]);
  });

  it("picks up current security score <= 30", () => {
    const cards = extractRemediationCards("Current state security score is 12/100 before remediation.");
    const card = cards.find(c => c.label === "Current Security Score");
    expect(card).toBeDefined();
    expect(card!.value).toBe("12/100");
    expect(card!.severity).toBe("warning");
  });

  it("detects unlicensed % from direct match", () => {
    const cards = extractRemediationCards("68% of users operating without valid Microsoft 365 licenses.");
    const card = cards.find(c => c.label === "Users Unlicensed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("68%");
  });

  it("derives unlicensed from fraction fallback", () => {
    const cards = extractRemediationCards("Only 10 of 100 users have active Microsoft 365 licenses.");
    const card = cards.find(c => c.label === "Users Unlicensed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("90%");
  });

  it("detects critical gaps count (>1)", () => {
    const cards = extractRemediationCards("8 critical gaps identified requiring immediate remediation.");
    const card = cards.find(c => c.label === "Critical Gaps Identified");
    expect(card).toBeDefined();
    expect(card!.value).toBe("8");
    expect(card!.severity).toBe("critical");
  });

  it("ignores critical gaps count of 1", () => {
    const cards = extractRemediationCards("1 critical gap identified.");
    expect(cards.find(c => c.label === "Critical Gaps Identified")).toBeUndefined();
  });

  it("detects remediation phases over N weeks", () => {
    const cards = extractRemediationCards("3 phases over 12 weeks of structured remediation work.");
    const card = cards.find(c => c.label === "Remediation Phases");
    expect(card).toBeDefined();
    expect(card!.value).toBe("3");
    expect(card!.severity).toBe("info");
  });
});

// ─── extractExposureCards ─────────────────────────────────────────────────────

describe("extractExposureCards", () => {
  it("returns empty array for clean text", () => {
    expect(extractExposureCards("No data exposure risks detected.")).toEqual([]);
  });

  it("detects external sharing % — critical at >= 30%", () => {
    const cards = extractExposureCards("35% of files are externally shared with users outside the org.");
    const card = cards.find(c => c.label === "Files Externally Exposed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("35%");
    expect(card!.severity).toBe("critical");
  });

  it("detects external sharing % — warning below 30%", () => {
    const cards = extractExposureCards("12% of files shared externally.");
    const card = cards.find(c => c.label === "Files Externally Exposed");
    expect(card).toBeDefined();
    expect(card!.severity).toBe("warning");
  });

  it("detects files without labels (absolute count)", () => {
    const cards = extractExposureCards("4,200 files without sensitivity labels across OneDrive.");
    const card = cards.find(c => c.label === "Files Without Labels");
    expect(card).toBeDefined();
    expect(card!.value).toBe("4,200");
    expect(card!.severity).toBe("critical");
  });

  it("detects files without labels (percentage)", () => {
    // Regex requires "% files?" with no "of" in between.
    // The extractor only appends "%" for decimal values; integer captures are returned as-is.
    const cards = extractExposureCards("72% files are unlabeled and have no classification.");
    const card = cards.find(c => c.label === "Files Without Labels");
    expect(card).toBeDefined();
    expect(card!.value).toBe("72");
  });

  it("detects zero DLP policies", () => {
    const cards = extractExposureCards("No DLP policies are configured in the tenant.");
    const card = cards.find(c => c.label === "DLP Policies Active");
    expect(card).toBeDefined();
    expect(card!.value).toBe("ZERO");
    expect(card!.severity).toBe("critical");
  });

  it("detects data protection score <= 40", () => {
    const cards = extractExposureCards("Data protection score: 30/100.");
    const card = cards.find(c => c.label === "Data Protection Score");
    expect(card).toBeDefined();
    expect(card!.value).toBe("30/100");
  });
});

// ─── extractExecutiveCards ────────────────────────────────────────────────────

describe("extractExecutiveCards", () => {
  it("returns empty array for clean text", () => {
    expect(extractExecutiveCards("Executive summary: all systems are within acceptable parameters.")).toEqual([]);
  });

  it("picks up overall health score <= 40", () => {
    const cards = extractExecutiveCards("Overall health score: 20/100 across all measured domains.");
    const card = cards.find(c => c.label === "Overall Health Score");
    expect(card).toBeDefined();
    expect(card!.value).toBe("20/100");
  });

  it("counts CRITICAL mentions (>= 3 triggers a card)", () => {
    const text = "CRITICAL finding. CRITICAL exposure. CRITICAL gap. CRITICAL alert.";
    const cards = extractExecutiveCards(text);
    const card = cards.find(c => c.label === "Critical Findings");
    expect(card).toBeDefined();
    expect(parseInt(card!.value)).toBeGreaterThanOrEqual(3);
    expect(card!.severity).toBe("critical");
  });

  it("does not add Critical Findings card for fewer than 3 mentions", () => {
    const text = "CRITICAL finding. CRITICAL issue.";
    const cards = extractExecutiveCards(text);
    expect(cards.find(c => c.label === "Critical Findings")).toBeUndefined();
  });

  it("detects unlicensed %", () => {
    // Regex matches "% of? users? unlicensed" — no verb between "users" and the term
    const cards = extractExecutiveCards("72% of users unlicensed, affecting security coverage.");
    const card = cards.find(c => c.label === "Users Unlicensed");
    expect(card).toBeDefined();
    expect(card!.value).toBe("72%");
  });

  it("detects zero security controls (no DLP)", () => {
    const cards = extractExecutiveCards("No DLP policies configured and zero conditional access present.");
    const card = cards.find(c => c.label === "Security Controls");
    expect(card).toBeDefined();
    expect(card!.value).toBe("ZERO");
    expect(card!.severity).toBe("critical");
  });
});

// ─── extractDeploymentCards ───────────────────────────────────────────────────

describe("extractDeploymentCards", () => {
  it("returns empty array for text with no deployment patterns", () => {
    expect(extractDeploymentCards("Initial assessment phase.")).toEqual([]);
  });

  it("detects phase count > 1", () => {
    const cards = extractDeploymentCards("The project is organized into 4 deployment phases.");
    const card = cards.find(c => c.label === "Deployment Phases");
    expect(card).toBeDefined();
    expect(card!.value).toBe("4");
    expect(card!.severity).toBe("info");
  });

  it("ignores phase count of 1", () => {
    const cards = extractDeploymentCards("1 deployment phase planned.");
    expect(cards.find(c => c.label === "Deployment Phases")).toBeUndefined();
  });

  it("detects users in scope via 'deploying to' branch with comma-formatted number", () => {
    const cards = extractDeploymentCards("Deploying to all 1,200 users across the organization.");
    const card = cards.find(c => c.label === "Users in Scope");
    expect(card).toBeDefined();
    expect(card!.value).toBe("1,200");
  });

  it("detects users in scope via 'users in scope' branch", () => {
    const cards = extractDeploymentCards("10,500 users in scope for this engagement.");
    const card = cards.find(c => c.label === "Users in Scope");
    expect(card).toBeDefined();
    expect(card!.value).toBe("10,500");
  });

  it("detects estimated timeline", () => {
    const cards = extractDeploymentCards("8-week rollout from kickoff to completion.");
    const card = cards.find(c => c.label === "Estimated Timeline");
    expect(card).toBeDefined();
    expect(card!.value).toContain("8");
    expect(card!.severity).toBe("info");
  });

  it("detects estimated timeline via 'estimated … N weeks' branch", () => {
    const cards = extractDeploymentCards("Estimated timeline: 12 weeks from kickoff.");
    const card = cards.find(c => c.label === "Estimated Timeline");
    expect(card).toBeDefined();
    expect(card!.value).toContain("12");
    expect(card!.severity).toBe("info");
  });

  it("detects estimated timeline with short filler words before the number", () => {
    // Gap [^.\\d]{0,20} allows up to 20 non-digit, non-period chars between
    // "estimated" and the number — filler like " at " or " over " works fine.
    const cards = extractDeploymentCards("Estimated at 6 months end-to-end.");
    const card = cards.find(c => c.label === "Estimated Timeline");
    expect(card).toBeDefined();
    expect(card!.value).toContain("6");
  });

  it("estimated timeline gap never silently truncates a number (old [^.]{0,20} returned '00' for comma-formatted input)", () => {
    // With the old regex [^.]{0,20}, the gap could consume "1,2" from "1,200",
    // leaving only "00" for the (\\d+) capture — silently returning a wrong value.
    // With the fixed [^.\\d]{0,20}, digits are excluded from the gap, so the gap
    // stops before the number and (\\d+) cannot capture a truncated fragment.
    // For comma-formatted input, the net result is no match (undefined card),
    // which is correct: failing loudly beats returning "00".
    const cards = extractDeploymentCards("Estimated at 1,200 months for full adoption.");
    const card = cards.find(c => c.label === "Estimated Timeline");
    // Must NOT silently produce the truncated fragment "00".
    expect(card?.value).not.toBe("00");
  });
});

// ─── extractStatCards (dispatcher) ────────────────────────────────────────────

describe("extractStatCards", () => {
  it("returns empty array for empty html", () => {
    expect(extractStatCards("", "security_hardening_plan")).toEqual([]);
  });

  it("returns empty array for SOW doc types", () => {
    const html = "<p>This SOW includes many terms and critical requirements.</p>";
    expect(extractStatCards(html, "sow")).toEqual([]);
    expect(extractStatCards(html, "consolidated_sow")).toEqual([]);
  });

  it("appends breach cost card for security_hardening_plan and caps family cards at 3", () => {
    const rich = [
      "Score: 5/100.",
      "zero conditional access policies.",
      "No Intune configured. No Defender deployed.",
      "75% of users unlicensed.",
    ].join(" ");
    const html = `<p>${rich}</p>`;
    const cards = extractStatCards(html, "security_hardening_plan");
    expect(cards.length).toBeLessThanOrEqual(4);
    const last = cards[cards.length - 1];
    expect(last.label).toBe("Avg Breach Cost");
    expect(last.value).toBe("~$4.9M");
  });

  it("appends breach cost card for copilot_enablement_plan", () => {
    const html = "<p>No DLP configured. 0/100 readiness.</p>";
    const cards = extractStatCards(html, "copilot_enablement_plan");
    const last = cards[cards.length - 1];
    expect(last.label).toBe("Avg Breach Cost");
    expect(last.value).toBe("~$3.8M");
  });

  it("does not append breach cost card for license_optimization_report", () => {
    const html = "<p>60% of users are unlicensed. 50 unused licenses.</p>";
    const cards = extractStatCards(html, "license_optimization_report");
    expect(cards.every(c => c.label !== "Avg Breach Cost")).toBe(true);
  });

  it("uses executive extractor as fallback for unknown doc types", () => {
    const html = "<p>Overall health: 10/100. CRITICAL. CRITICAL. CRITICAL. CRITICAL.</p>";
    const cards = extractStatCards(html, "unknown_doc_type");
    expect(cards.length).toBeGreaterThan(0);
  });

  it("routes all known doc types without throwing", () => {
    const html = "<p>25/100 score. 5 critical gaps. 70% users unlicensed. No DLP policies.</p>";
    const knownTypes = Object.keys(DOC_FAMILY);
    for (const docType of knownTypes) {
      expect(() => extractStatCards(html, docType)).not.toThrow();
    }
  });
});

// ─── computeOverviewStats ─────────────────────────────────────────────────────

describe("computeOverviewStats", () => {
  it("returns all-null/false stats for empty document list", () => {
    const stats = computeOverviewStats([]);
    expect(stats.worstScore).toBeNull();
    expect(stats.criticalMentions).toBe(0);
    expect(stats.wastedLicenses).toBeNull();
    expect(stats.annualWaste).toBeNull();
    expect(stats.hasZeroDlp).toBe(false);
  });

  it("returns all-null/false stats when documents have no matching content", () => {
    const stats = computeOverviewStats([
      { htmlContent: "<p>All systems are healthy and compliant.</p>", docType: "executive_summary" },
    ]);
    expect(stats.worstScore).toBeNull();
    expect(stats.criticalMentions).toBe(0);
    expect(stats.hasZeroDlp).toBe(false);
  });

  it("tracks the worst (lowest) score across documents", () => {
    const stats = computeOverviewStats([
      { htmlContent: "<p>Score: 25/100 overall health.</p>", docType: "executive_summary" },
      { htmlContent: "<p>Score: 8/100 governance rating.</p>", docType: "governance_maturity_report" },
    ]);
    expect(stats.worstScore).toBe(8);
  });

  it("counts critical-severity cards (excluding Avg Breach Cost)", () => {
    const stats = computeOverviewStats([
      {
        htmlContent: "<p>zero conditional access policies. No Intune. No Defender. Score 5/100.</p>",
        docType: "security_hardening_plan",
      },
    ]);
    expect(stats.criticalMentions).toBeGreaterThan(0);
    // Breach cost card itself must NOT be counted
    const cards = extractStatCards(
      "<p>zero conditional access policies. No Intune. No Defender. Score 5/100.</p>",
      "security_hardening_plan"
    );
    const breachCards = cards.filter(c => c.label === "Avg Breach Cost");
    const criticalNonBreachCards = cards.filter(c => c.severity === "critical" && c.label !== "Avg Breach Cost");
    expect(stats.criticalMentions).toBe(criticalNonBreachCards.length);
    expect(breachCards.length).toBeGreaterThan(0); // breach card is present but not counted
  });

  it("tracks the highest unused license count", () => {
    const stats = computeOverviewStats([
      { htmlContent: "<p>50 unused licenses sitting idle.</p>", docType: "license_optimization_report" },
      { htmlContent: "<p>120 unused licenses going to waste.</p>", docType: "license_optimization_report" },
    ]);
    expect(stats.wastedLicenses).toBe(120);
  });

  it("picks up annual waste dollar figure", () => {
    const stats = computeOverviewStats([
      { htmlContent: "<p>$18,000 per year wasted on unused licenses.</p>", docType: "license_optimization_report" },
    ]);
    expect(stats.annualWaste).not.toBeNull();
    expect(stats.annualWaste).toContain("18,000");
  });

  it("sets hasZeroDlp when a DLP-zero card is present", () => {
    const stats = computeOverviewStats([
      { htmlContent: "<p>No DLP policies are active in this tenant.</p>", docType: "data_exposure_risk_report" },
    ]);
    expect(stats.hasZeroDlp).toBe(true);
  });

  it("sets hasZeroDlp from governance zero-policy card", () => {
    const stats = computeOverviewStats([
      { htmlContent: "<p>zero DLP policies configured across the tenant.</p>", docType: "governance_maturity_report" },
    ]);
    expect(stats.hasZeroDlp).toBe(true);
  });

  // KEY CONSISTENCY TEST: overview aggregate must equal individual card sums
  it("criticalMentions exactly matches sum of critical non-breach cards across all docs", () => {
    const docs = [
      { htmlContent: "<p>Score 5/100. zero conditional access.</p>", docType: "security_hardening_plan" },
      { htmlContent: "<p>25/100 governance score. zero DLP policies.</p>", docType: "governance_maturity_report" },
      { htmlContent: "<p>5 prerequisites not met. No DLP. 0/100.</p>", docType: "copilot_enablement_plan" },
    ];

    const expectedCritical = docs.reduce((sum, doc) => {
      const cards = extractStatCards(doc.htmlContent, doc.docType);
      return sum + cards.filter(c => c.severity === "critical" && c.label !== "Avg Breach Cost").length;
    }, 0);

    const stats = computeOverviewStats(docs);
    expect(stats.criticalMentions).toBe(expectedCritical);
  });

  it("worstScore exactly matches the minimum X/100 value found across all extracted cards", () => {
    const docs = [
      { htmlContent: "<p>Health score: 18/100.</p>", docType: "security_hardening_plan" },
      { htmlContent: "<p>Governance: 5/100 baseline.</p>", docType: "governance_maturity_report" },
    ];

    const allScores: number[] = [];
    for (const doc of docs) {
      const cards = extractStatCards(doc.htmlContent, doc.docType);
      for (const card of cards) {
        const m = card.value.match(/^(\d+)\/100$/);
        if (m) allScores.push(parseInt(m[1]));
      }
    }

    const expectedWorst = allScores.length ? Math.min(...allScores) : null;
    const stats = computeOverviewStats(docs);
    expect(stats.worstScore).toBe(expectedWorst);
  });

  it("aggregates across multiple document types without throwing", () => {
    const docs = Object.keys(DOC_FAMILY).map(docType => ({
      htmlContent: `<p>25/100 score. 70% unlicensed. zero DLP policies. 5 critical gaps. No Intune. No Defender.</p>`,
      docType,
    }));
    expect(() => computeOverviewStats(docs)).not.toThrow();
  });
});

// ─── DOC_FAMILY completeness check ────────────────────────────────────────────

describe("DOC_FAMILY mapping", () => {
  it("every registered doc type maps to a known family", () => {
    const validFamilies = new Set([
      "security", "license", "governance", "copilot",
      "remediation", "exposure", "executive", "deployment", "sow",
    ]);
    for (const [docType, family] of Object.entries(DOC_FAMILY)) {
      expect(validFamilies.has(family), `${docType} → ${family} is not a valid family`).toBe(true);
    }
  });
});

// ─── BREACH_COST_CARD consistency ─────────────────────────────────────────────

describe("BREACH_COST_CARD", () => {
  it("all breach cost entries have severity 'critical'", () => {
    for (const [docType, card] of Object.entries(BREACH_COST_CARD)) {
      if (card) {
        expect(card.severity, `${docType} breach card severity`).toBe("critical");
      }
    }
  });

  it("all breach cost cards are labeled 'Avg Breach Cost'", () => {
    for (const [docType, card] of Object.entries(BREACH_COST_CARD)) {
      if (card) {
        expect(card.label, `${docType} breach card label`).toBe("Avg Breach Cost");
      }
    }
  });
});

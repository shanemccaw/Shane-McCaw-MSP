/**
 * workstream-normalizer.ts
 *
 * Maps engagement project title variants to one of the 5 canonical workstream
 * keys used in the Tier 02 ADJUSTMENT MAP. This prevents the AI from silently
 * omitting or misapplying adjustments when a project arrives with a slightly
 * different label (e.g. "Data Protection & DLP" vs "Data Protection / DLP").
 *
 * The canonical keys match the ADJUSTMENT MAP exactly:
 *   Governance Remediation
 *   Security Remediation
 *   Data Protection / DLP
 *   Copilot Readiness
 *   Licensing Optimization
 */

import { logger } from "./logger";
const log = logger.child({ channel: "growth.quiz" });

export type WorkstreamKey =
  | "Governance Remediation"
  | "Security Remediation"
  | "Data Protection / DLP"
  | "Copilot Readiness"
  | "Licensing Optimization";

export const WORKSTREAM_KEYS: WorkstreamKey[] = [
  "Governance Remediation",
  "Security Remediation",
  "Data Protection / DLP",
  "Copilot Readiness",
  "Licensing Optimization",
];

/**
 * Normalise a raw engagement project title to a canonical WorkstreamKey.
 * Returns null when no match is found (caller should warn).
 *
 * Matching strategy (applied in order):
 *  1. Exact match (case-insensitive)
 *  2. Known alias table (covers common variants, ampersands, word reordering)
 *  3. Keyword heuristics as a last resort
 */
export function normalizeWorkstreamLabel(title: string): WorkstreamKey | null {
  const t = title.trim().toLowerCase();

  // ── 1. Exact / normalised exact match ────────────────────────────────────────
  for (const key of WORKSTREAM_KEYS) {
    if (t === key.toLowerCase()) return key;
  }

  // ── 2. Alias table (exhaustive list of known label variants) ─────────────────
  const ALIASES: Record<string, WorkstreamKey> = {
    // Governance Remediation
    "governance remediation":             "Governance Remediation",
    "governance":                         "Governance Remediation",
    "governance & compliance":            "Governance Remediation",
    "governance and compliance":          "Governance Remediation",
    "m365 governance":                    "Governance Remediation",
    "sharepoint governance":              "Governance Remediation",
    "information governance":             "Governance Remediation",
    "teams governance":                   "Governance Remediation",
    "tenant governance":                  "Governance Remediation",
    "governance framework":               "Governance Remediation",
    "governance maturity":                "Governance Remediation",

    // Security Remediation
    "security remediation":               "Security Remediation",
    "security":                           "Security Remediation",
    "security hardening":                 "Security Remediation",
    "security posture":                   "Security Remediation",
    "identity & access":                  "Security Remediation",
    "identity and access":                "Security Remediation",
    "identity modernization":             "Security Remediation",
    "identity modernisation":             "Security Remediation",
    "zero trust":                         "Security Remediation",
    "zero trust security":                "Security Remediation",
    "conditional access":                 "Security Remediation",
    "entra id":                           "Security Remediation",
    "entra id remediation":               "Security Remediation",
    "mfa enforcement":                    "Security Remediation",
    "mfa remediation":                    "Security Remediation",
    "defender configuration":             "Security Remediation",
    "security & identity":                "Security Remediation",
    "security and identity":              "Security Remediation",
    "privileged access":                  "Security Remediation",
    "privileged identity management":     "Security Remediation",

    // Data Protection / DLP
    "data protection / dlp":              "Data Protection / DLP",
    "data protection & dlp":              "Data Protection / DLP",
    "data protection and dlp":            "Data Protection / DLP",
    "data protection":                    "Data Protection / DLP",
    "dlp":                                "Data Protection / DLP",
    "dlp & sensitivity labels":           "Data Protection / DLP",
    "dlp and sensitivity labels":         "Data Protection / DLP",
    "sensitivity labels":                 "Data Protection / DLP",
    "information protection":             "Data Protection / DLP",
    "data loss prevention":               "Data Protection / DLP",
    "purview":                            "Data Protection / DLP",
    "microsoft purview":                  "Data Protection / DLP",
    "compliance & data protection":       "Data Protection / DLP",
    "compliance and data protection":     "Data Protection / DLP",
    "data classification":                "Data Protection / DLP",
    "retention policies":                 "Data Protection / DLP",

    // Copilot Readiness
    "copilot readiness":                  "Copilot Readiness",
    "copilot":                            "Copilot Readiness",
    "copilot ai readiness":               "Copilot Readiness",
    "copilot ai":                         "Copilot Readiness",
    "microsoft 365 copilot":              "Copilot Readiness",
    "m365 copilot":                       "Copilot Readiness",
    "m365 copilot readiness":             "Copilot Readiness",
    "copilot enablement":                 "Copilot Readiness",
    "copilot adoption":                   "Copilot Readiness",
    "copilot deployment":                 "Copilot Readiness",
    "copilot & ai readiness":             "Copilot Readiness",
    "copilot and ai readiness":           "Copilot Readiness",
    "ai readiness":                       "Copilot Readiness",

    // Licensing Optimization
    "licensing optimization":             "Licensing Optimization",
    "licensing optimisation":             "Licensing Optimization",
    "license optimization":               "Licensing Optimization",
    "license optimisation":               "Licensing Optimization",
    "licensing":                          "Licensing Optimization",
    "license review":                     "Licensing Optimization",
    "licensing review":                   "Licensing Optimization",
    "license audit":                      "Licensing Optimization",
    "licensing audit":                    "Licensing Optimization",
    "m365 licensing":                     "Licensing Optimization",
    "microsoft 365 licensing":            "Licensing Optimization",
    "license rightsizing":                "Licensing Optimization",
    "license management":                 "Licensing Optimization",
  };

  if (t in ALIASES) return ALIASES[t]!;

  // ── 3. Keyword heuristics (broad fallback) ────────────────────────────────────
  if (t.includes("governance"))                             return "Governance Remediation";
  if (t.includes("security") || t.includes("identity"))    return "Security Remediation";
  if (t.includes("dlp") || t.includes("data protection") || t.includes("purview") || t.includes("sensitivity")) return "Data Protection / DLP";
  if (t.includes("copilot") || t.includes("ai readiness")) return "Copilot Readiness";
  if (t.includes("licens"))                                 return "Licensing Optimization";

  return null;
}

/**
 * Normalize an array of raw project titles and return:
 *  - resolvedKeys: unique canonical WorkstreamKey values found
 *  - unresolvedTitles: raw titles that could not be mapped (logged as warnings)
 *
 * Logs a warning for each unresolved title so operators are alerted immediately.
 */
export function resolveWorkstreamKeys(projectTitles: string[]): {
  resolvedKeys: WorkstreamKey[];
  unresolvedTitles: string[];
} {
  const resolvedSet = new Set<WorkstreamKey>();
  const unresolvedTitles: string[] = [];

  for (const title of projectTitles) {
    const key = normalizeWorkstreamLabel(title);
    if (key !== null) {
      resolvedSet.add(key);
    } else {
      unresolvedTitles.push(title);
      log.warn(
        { rawTitle: title },
        "workstream-normalizer: unknown project title — no canonical workstream key matched; adjustment eligibility may be incomplete",
      );
    }
  }

  return {
    resolvedKeys: [...resolvedSet],
    unresolvedTitles,
  };
}

/**
 * Build the WORKSTREAM CONTEXT block that is injected into SOW prompts.
 * This gives the AI a server-resolved, authoritative list of canonical
 * workstream keys so the ADJUSTMENT MAP is applied correctly even when
 * the engagement project titles use non-standard labels.
 */
export function buildWorkstreamContextBlock(
  rawProjectTitles: string[],
  resolvedKeys: WorkstreamKey[],
  unresolvedTitles: string[],
): string {
  const lines: string[] = [
    "WORKSTREAM CONTEXT (server-resolved — use ONLY these canonical names when consulting the ADJUSTMENT MAP):",
  ];

  if (resolvedKeys.length > 0) {
    lines.push("  Canonical workstream keys for this engagement:");
    for (const key of resolvedKeys) {
      lines.push(`    • ${key}`);
    }
  } else {
    lines.push("  No workstreams could be resolved — use findings to determine applicable workstreams.");
  }

  if (unresolvedTitles.length > 0) {
    lines.push("  Projects with unresolved workstream keys (use your judgment to map these to the nearest canonical key):");
    for (const t of unresolvedTitles) {
      lines.push(`    • ${t}`);
    }
  }

  if (rawProjectTitles.length > 0) {
    lines.push(`  Raw project titles from catalogue: ${rawProjectTitles.join(", ")}`);
  }

  lines.push(
    "  RULE: When evaluating the ADJUSTMENT MAP, treat each canonical key above as the workstream name.",
    "  Do NOT use raw catalogue titles when cross-referencing the ADJUSTMENT MAP.",
  );

  return lines.join("\n");
}

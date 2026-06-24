/**
 * derive-quiz-signals.ts
 *
 * Server-side implementation of the quiz → lead signal derivation logic.
 * Extracted from LeadDetail.tsx so the same derivation runs consistently
 * at quiz submission time, on background recalculation, and in the API.
 *
 * Usage:
 *   import { deriveSignalsFromQuiz, loadQuizPainConfig } from "./derive-quiz-signals";
 *   const config = await loadQuizPainConfig();
 *   const signals = deriveSignalsFromQuiz(quiz, leadSource, config);
 */

import { db, quizPainSignalConfigTable } from "@workspace/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuizForDerivation {
  quizType: string;
  categoryScores: Record<string, number>;
  conversation: { role: "user" | "assistant"; content: string }[];
}

export interface QuizPainConfig {
  quizTypePainMap: Record<string, string[]>;
  categoryPainMap: [string, string][];
}

export interface DerivedSignals {
  painPoints: string[];
  maturityIndicators: string[];
  engagementSignals: string[];
  urgencySignals: string[];
  provenance: Record<string, string>;
}

// ─── Hardcoded defaults (used when no custom config is saved) ─────────────────

export const DEFAULT_QUIZ_TYPE_PAIN_MAP: Record<string, string[]> = {
  sharepoint: ["SharePoint", "Governance"],
  migration: ["Migration"],
  "security-compliance": ["Security", "Compliance", "Governance"],
  copilot: ["Copilot", "AI Readiness"],
  teams: ["Teams"],
  "power-platform": ["Power Platform", "Governance"],
  governance: ["Governance", "Compliance"],
  "m365-health": ["Security", "Compliance", "Governance"],
};

export const DEFAULT_CATEGORY_PAIN_MAP: [string, string][] = [
  ["sharepoint", "SharePoint"],
  ["teams", "Teams"],
  ["powerplatform", "Power Platform"],
  ["power", "Power Platform"],
  ["security", "Security"],
  ["compliance", "Compliance"],
  ["governance", "Governance"],
  ["copilot", "Copilot"],
  ["migration", "Migration"],
  ["adoption", "Adoption"],
  ["training", "Training"],
];

export const DEFAULT_CONFIG: QuizPainConfig = {
  quizTypePainMap: DEFAULT_QUIZ_TYPE_PAIN_MAP,
  categoryPainMap: DEFAULT_CATEGORY_PAIN_MAP,
};

// ─── DB config loader ─────────────────────────────────────────────────────────

/**
 * Loads the quiz pain config from the database.
 * Falls back to DEFAULT_CONFIG if no row exists.
 */
export async function loadQuizPainConfig(): Promise<QuizPainConfig> {
  try {
    const rows = await db.select().from(quizPainSignalConfigTable).limit(1);
    const row = rows[0];
    if (!row) return DEFAULT_CONFIG;
    return {
      quizTypePainMap: row.quizTypePainMap as Record<string, string[]>,
      categoryPainMap: row.categoryPainMap as [string, string][],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ─── Core derivation ─────────────────────────────────────────────────────────

/**
 * Derives pain points, maturity indicators, engagement signals, and urgency
 * signals from a completed quiz submission.
 *
 * @param quiz        Quiz data (type, category scores, conversation transcript)
 * @param leadSource  How the lead originally arrived ("contact_form" | "lead_magnet")
 * @param config      Pain mapping config — defaults to hardcoded values
 */
export function deriveSignalsFromQuiz(
  quiz: QuizForDerivation,
  leadSource: "contact_form" | "lead_magnet",
  config: QuizPainConfig = DEFAULT_CONFIG,
): DerivedSignals {
  const painPoints = new Set<string>();
  const maturityIndicators = new Set<string>();
  const engagementSignals = new Set<string>();
  const urgencySignals = new Set<string>();
  const provenance: Record<string, string> = {};

  // 1. Quiz type → Pain Points
  const typePains = config.quizTypePainMap[quiz.quizType] ?? [];
  typePains.forEach(p => {
    painPoints.add(p);
    provenance[p] = `Quiz type: ${quiz.quizType}`;
  });

  // 2. Category scores ≤ 5 → Pain Points (low score = gap = pain)
  for (const [key, score] of Object.entries(quiz.categoryScores)) {
    if (score <= 5) {
      const normalized = key.toLowerCase().replace(/[\s_-]/g, "");
      for (const [mapKey, pain] of config.categoryPainMap) {
        if (normalized.includes(mapKey)) {
          painPoints.add(pain);
          provenance[pain] = `Low ${key} score (${score}/10)`;
          break;
        }
      }
    }
  }

  // 3. Transcript analysis — user turns only
  const userTurns = (quiz.conversation as { role: string; content: string }[])
    .filter(t => t.role === "user")
    .map(t => t.content)
    .join(" ");

  // 3a. Maturity Indicators from transcript keywords
  const maturityRules: [RegExp, string, string][] = [
    [/sharepoint/i, "Active SharePoint usage", "Keyword in transcript: SharePoint"],
    [/\bteams\b/i, "Teams adoption", "Keyword in transcript: Teams"],
    [/power\s*platform|powerapps/i, "Power Platform usage", "Keyword in transcript: Power Platform"],
    [/it\s*team|it\s*department|dedicated\s*it/i, "Dedicated IT team", "Keyword in transcript: IT team"],
    [/\bE3\b|\bE5\b|business\s*premium/i, "Has existing M365", "Keyword in transcript: M365 license tier"],
    [/governance\s*policy/i, "Data governance policy", "Keyword in transcript: governance policy"],
    [/\bdocumented\b/i, "Documented processes", "Keyword in transcript: documented"],
    [/previous\s*consultant|worked\s*with/i, "Previous consultant", "Keyword in transcript: previous consultant"],
  ];
  for (const [pattern, indicator, reason] of maturityRules) {
    if (pattern.test(userTurns)) {
      maturityIndicators.add(indicator);
      provenance[indicator] = reason;
    }
  }

  // 3b. Urgency Signals from transcript keywords
  const urgencyRules: [RegExp, string, string][] = [
    [/\baudit\b/i, "Audit deadline", "Keyword in transcript: audit"],
    [/\bdeadline\b/i, "Compliance deadline", "Keyword in transcript: deadline"],
    [/\bboard\b/i, "Board mandate", "Keyword in transcript: board"],
    [/budget\s*approved/i, "Budget approved", "Keyword in transcript: budget approved"],
    [/this\s*quarter|Q[1-4]\b/i, "This quarter", "Keyword in transcript: quarter reference"],
    [/\bASAP\b|\burgent\b/i, "Urgent", "Keyword in transcript: ASAP / urgent"],
  ];
  for (const [pattern, signal, reason] of urgencyRules) {
    if (pattern.test(userTurns)) {
      urgencySignals.add(signal);
      provenance[signal] = reason;
    }
  }

  // 4. Engagement Signals
  engagementSignals.add("Completed quiz");
  provenance["Completed quiz"] = `Completed the ${quiz.quizType} quiz`;
  if (leadSource === "lead_magnet") {
    engagementSignals.add("Downloaded resource");
    provenance["Downloaded resource"] = "Lead source: lead magnet download";
  }

  return {
    painPoints: [...painPoints],
    maturityIndicators: [...maturityIndicators],
    engagementSignals: [...engagementSignals],
    urgencySignals: [...urgencySignals],
    provenance,
  };
}

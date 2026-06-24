/**
 * m365-quiz-mapping.ts (admin-panel)
 *
 * Pure functions that map completed quiz results to a partial M365 Profile.
 * Score ranges: ≥ 7 → feature likely enabled; ≤ 3 → feature likely absent.
 * Tier → copilotReadinessScore: Beginner→1, Developing→2, Emerging→3, Advanced→4, Ready→5.
 */

export interface QuizResult {
  id: number;
  quizType: string;
  totalScore: number;
  tier: string;
  categoryScores: Record<string, number>;
  createdAt: string;
}

export type DerivedM365Partial = {
  copilotReadinessScore?: string;
  hasCopilotLicenses?: boolean;
  copilotUseCase?: string;
  dataGovernanceConcerns?: string;
  usesExchange?: boolean;
  usesTeams?: boolean;
  usesSharePoint?: boolean;
  usesOneDrive?: boolean;
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  allUsersLicensed?: boolean;
  externalSharingEnabled?: boolean;
  guestUsersPresent?: boolean;
  sensitivityLabelsConfigured?: boolean;
  hasDLP?: boolean;
  hasRetentionPolicies?: boolean;
  hasInsiderRisk?: boolean;
  usesComplianceCenter?: boolean;
};

const TIER_SCORE_MAP: Record<string, string> = {
  Beginner: "1",
  Developing: "2",
  Emerging: "3",
  Advanced: "4",
  Ready: "5",
};

const TIER_USE_CASE_MAP: Record<string, string> = {
  Beginner: "Starting with Microsoft 365 basics — email and calendar modernisation, initial Teams rollout.",
  Developing: "Expanding from core workloads to collaboration features — Teams channels, SharePoint intranets.",
  Emerging: "Adopting advanced features — Power Platform automation, SharePoint governance, Copilot pilots.",
  Advanced: "Scaling adoption — enterprise governance, Copilot at scale, cross-tenant collaboration.",
  Ready: "Fully mature M365 environment — optimising security, compliance, and AI-driven productivity.",
};

function high(score: number | undefined): boolean | null {
  if (score === undefined) return null;
  if (score >= 7) return true;
  if (score <= 3) return false;
  return null;
}

function deriveFromQuiz(quiz: QuizResult): DerivedM365Partial {
  const cs = quiz.categoryScores;
  const result: DerivedM365Partial = {};

  switch (quiz.quizType) {
    case "copilot": {
      const tierScore = TIER_SCORE_MAP[quiz.tier];
      if (tierScore) result.copilotReadinessScore = tierScore;

      const useCase = TIER_USE_CASE_MAP[quiz.tier];
      if (useCase) result.copilotUseCase = useCase;

      const aiH = high(cs["aiLiteracy"]);
      if (aiH !== null) result.hasCopilotLicenses = aiH;

      if (cs["data"] !== undefined && cs["data"] <= 3) {
        result.dataGovernanceConcerns =
          "Assessment indicates potential data governance gaps — review sensitivity labelling and oversharing risks before Copilot deployment.";
      }
      break;
    }

    case "m365-health": {
      const infraH = high(cs["infrastructure"]);
      if (infraH !== null) {
        result.usesExchange = infraH;
        result.usesTeams = infraH;
        result.usesSharePoint = infraH;
        result.usesOneDrive = infraH;
      }
      const dataH = high(cs["data"]);
      if (dataH !== null) {
        result.mfaEnforced = dataH;
        result.conditionalAccessEnabled = dataH;
      }
      const bizH = high(cs["businessProcess"]);
      if (bizH !== null) result.allUsersLicensed = bizH;
      break;
    }

    case "sharepoint": {
      const dataH = high(cs["data"]);
      if (dataH !== null) {
        result.sensitivityLabelsConfigured = dataH;
        result.externalSharingEnabled = !dataH;
      }
      const infraH = high(cs["infrastructure"]);
      if (infraH !== null) {
        result.guestUsersPresent = !infraH;
      }
      break;
    }

    case "governance": {
      const dataH = high(cs["data"]);
      if (dataH !== null) {
        result.hasDLP = dataH;
        result.hasRetentionPolicies = dataH;
        result.sensitivityLabelsConfigured = dataH;
        result.usesComplianceCenter = dataH;
      }
      const cmH = high(cs["changeManagement"]);
      if (cmH !== null) {
        result.hasInsiderRisk = cmH;
        if (cmH) result.usesComplianceCenter = true;
      }
      break;
    }

    default:
      break;
  }

  return result;
}

/**
 * Derive a merged partial M365 profile from all quiz results.
 * Processes oldest first so newest results take precedence (API returns newest-first).
 */
export function deriveM365FromQuizzes(quizzes: QuizResult[]): DerivedM365Partial {
  const merged: DerivedM365Partial = {};
  // Reverse so oldest is first — newest quiz of each type wins
  for (const q of [...quizzes].reverse()) {
    const derived = deriveFromQuiz(q);
    Object.assign(merged, derived);
  }
  return merged;
}

/**
 * Merge derived values into an existing profile, only filling empty/undefined fields.
 * Returns the set of keys that were actually set.
 * For booleans: only fills when the current value is undefined/null (explicit false counts as filled).
 */
export function mergeIntoProfile<T extends Record<string, unknown>>(
  current: T,
  derived: DerivedM365Partial,
): { updated: T; filledKeys: Set<string> } {
  const updated = { ...current };
  const filledKeys = new Set<string>();

  for (const [key, val] of Object.entries(derived)) {
    if (val === undefined || val === null) continue;
    const existing = (current as Record<string, unknown>)[key];
    const isEmpty =
      existing === undefined ||
      existing === null ||
      existing === "" ||
      (typeof existing === "string" && existing.trim() === "");
    if (isEmpty) {
      (updated as Record<string, unknown>)[key] = val;
      filledKeys.add(key);
    }
  }

  return { updated, filledKeys };
}

export const QUIZ_TYPE_LABELS: Record<string, string> = {
  copilot: "Copilot Readiness",
  "m365-health": "M365 Health",
  sharepoint: "SharePoint",
  "power-platform": "Power Platform",
  "security-compliance": "Security & Compliance",
  teams: "Teams",
  migration: "Migration",
  governance: "Governance",
};

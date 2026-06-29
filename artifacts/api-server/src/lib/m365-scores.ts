export type M365ScoreCategory = "security" | "compliance" | "copilot" | "governance" | "productivity";

function m365BoolScore(fields: (boolean | undefined)[]): number {
  if (fields.length === 0) return 0;
  return Math.round((fields.filter(f => f === true).length / fields.length) * 100);
}

export function computeM365Scores(profile: Record<string, unknown>): Record<M365ScoreCategory, number> {
  const v = profile as {
    mfaEnforced?: boolean; conditionalAccessEnabled?: boolean; intuneEnabled?: boolean;
    hasAADP1orP2?: boolean; hasDefender?: boolean; hasDLP?: boolean; usesComplianceCenter?: boolean;
    sensitivityLabelsConfigured?: boolean; hasRetentionPolicies?: boolean; hasInsiderRisk?: boolean;
    hasCopilotLicenses?: boolean; activeUserPercent?: string; allUsersLicensed?: boolean;
  };
  const pct = parseInt(v.activeUserPercent ?? "0", 10);
  return {
    security:    m365BoolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]),
    compliance:  m365BoolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]),
    copilot:     m365BoolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]),
    governance:  m365BoolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]),
    productivity: Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100),
  };
}

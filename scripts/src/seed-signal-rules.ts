import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  const existing = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM signal_derivation_rules`);
  const count = (existing.rows[0] as { cnt: number }).cnt;

  if (count > 0) {
    console.log(`Skipping: ${count} signal rules already exist. Remove them first to re-seed.`);
    process.exit(0);
  }

  console.log("Seeding default signal rules...");

  const insertRule = async (
    signalKey: string,
    ruleType: string,
    sourceKey: string,
    compareValue?: string | null,
    groupId?: number | null,
    sortOrder = 0,
  ) => {
    await db.execute(sql`
      INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, sort_order)
      VALUES (${signalKey}, ${groupId ?? null}, ${ruleType}, ${sourceKey}, ${compareValue ?? null}, ${sortOrder})
    `);
  };

  const insertGroup = async (signalKey: string, logic: "AND" | "OR", label?: string): Promise<number> => {
    const result = await db.execute(sql`
      INSERT INTO signal_rule_groups (signal_key, logic, label)
      VALUES (${signalKey}, ${logic}, ${label ?? null})
      RETURNING id
    `);
    return (result.rows[0] as { id: number }).id;
  };

  // hasExchangeOnPrem — three OR keyword rules (ungrouped)
  await insertRule("hasExchangeOnPrem", "findings_keyword", "Exchange On-Premises", null, null, 0);
  await insertRule("hasExchangeOnPrem", "findings_keyword", "hybrid connector", null, null, 1);
  await insertRule("hasExchangeOnPrem", "findings_keyword", "mailbox migration", null, null, 2);

  // hasPowerPlatformUsage — OR rules (ungrouped)
  await insertRule("hasPowerPlatformUsage", "findings_keyword", "Power Automate", null, null, 0);
  await insertRule("hasPowerPlatformUsage", "findings_keyword", "Power Apps", null, null, 1);
  await insertRule("hasPowerPlatformUsage", "profile_key_truthy", "hasPowerPlatformUsage", null, null, 2);

  // hasGovernanceGaps — OR rules (ungrouped)
  await insertRule("hasGovernanceGaps", "profile_key_lt", "governanceScore", "60", null, 0);
  await insertRule("hasGovernanceGaps", "profile_key_truthy", "hasGovernanceGaps", null, null, 1);

  // hasSecurityGaps — one AND group (mfaEnforced + CA = 0), one OR ungrouped (securityScore)
  const secAndGroupId = await insertGroup("hasSecurityGaps", "AND", "MFA + Conditional Access check");
  await insertRule("hasSecurityGaps", "profile_key_falsy", "mfaEnforced", null, secAndGroupId, 0);
  await insertRule("hasSecurityGaps", "profile_key_eq", "conditionalAccessPolicyCount", "0", secAndGroupId, 1);
  await insertRule("hasSecurityGaps", "profile_key_lt", "securityScore", "60", null, 2);

  // hasCopilotLicenses — single ungrouped rule
  await insertRule("hasCopilotLicenses", "profile_key_gt", "copilotLicenseCount", "0", null, 0);

  // hasSharePointIssues — ungrouped rules
  await insertRule("hasSharePointIssues", "profile_key_gt", "sharepointSiteCount", "0", null, 0);
  await insertRule("hasSharePointIssues", "findings_keyword", "SharePoint", null, null, 1);

  // hasLicensingWaste — ungrouped rules
  await insertRule("hasLicensingWaste", "findings_keyword", "unlicensed", null, null, 0);
  await insertRule("hasLicensingWaste", "profile_key_truthy", "hasLicensingWaste", null, null, 1);

  // hasDLPGaps — ungrouped rules
  await insertRule("hasDLPGaps", "profile_key_eq", "dlpPoliciesCount", "0", null, 0);
  await insertRule("hasDLPGaps", "profile_key_falsy", "sensitivityLabelsConfigured", null, null, 1);

  const finalCount = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM signal_derivation_rules`);
  console.log(`Done. ${(finalCount.rows[0] as { cnt: number }).cnt} signal rules seeded.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });

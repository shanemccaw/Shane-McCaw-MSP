import { db, emailDomainRulesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Given a sender domain, resolve it to a user ID using:
 * 1. emailDomainRules table (exact match, highest priority)
 * 2. users table (email domain suffix match)
 * Returns null if no match found.
 */
export async function matchDomainToUser(domain: string): Promise<number | null> {
  if (!domain) return null;

  const normalised = domain.toLowerCase().trim();

  const [rule] = await db
    .select({ linkedUserId: emailDomainRulesTable.linkedUserId })
    .from(emailDomainRulesTable)
    .where(eq(emailDomainRulesTable.domain, normalised))
    .limit(1);

  if (rule) return rule.linkedUserId;

  const users = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable);

  for (const user of users) {
    const userDomain = user.email.split("@")[1]?.toLowerCase();
    if (userDomain && userDomain === normalised) {
      return user.id;
    }
  }

  return null;
}

export function extractDomain(emailAddress: string): string {
  const parts = emailAddress.split("@");
  return (parts[1] ?? "").toLowerCase().trim();
}

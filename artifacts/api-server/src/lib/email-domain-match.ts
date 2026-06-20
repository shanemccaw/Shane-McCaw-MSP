import { db, emailDomainRulesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Given a full sender email address, resolve it to a user ID using:
 * 1. emailDomainRules — exact email-address match (rule.domain contains "@")
 * 2. emailDomainRules — domain match (rule.domain has no "@")
 * 3. users table — email domain suffix match
 * Returns null if no match found.
 */
export async function matchSenderToUser(senderAddress: string): Promise<number | null> {
  if (!senderAddress) return null;

  const normAddress = senderAddress.toLowerCase().trim();
  const domain = extractDomain(normAddress);

  // Load all rules once for both checks
  const rules = await db
    .select({ domain: emailDomainRulesTable.domain, linkedUserId: emailDomainRulesTable.linkedUserId })
    .from(emailDomainRulesTable);

  // 1. Exact address match (rule value contains "@")
  const addressRule = rules.find(r => r.domain.includes("@") && r.domain === normAddress);
  if (addressRule) return addressRule.linkedUserId;

  // 2. Domain match (rule value has no "@")
  if (domain) {
    const domainRule = rules.find(r => !r.domain.includes("@") && r.domain === domain);
    if (domainRule) return domainRule.linkedUserId;
  }

  // 3. Fall back: user whose login email shares the same domain
  if (domain) {
    const users = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable);

    for (const user of users) {
      const userDomain = user.email.split("@")[1]?.toLowerCase();
      if (userDomain && userDomain === domain) {
        return user.id;
      }
    }
  }

  return null;
}

/** @deprecated Use matchSenderToUser instead. */
export async function matchDomainToUser(domain: string): Promise<number | null> {
  return matchSenderToUser(`_@${domain}`);
}

export function extractDomain(emailAddress: string): string {
  const parts = emailAddress.split("@");
  return (parts[1] ?? "").toLowerCase().trim();
}

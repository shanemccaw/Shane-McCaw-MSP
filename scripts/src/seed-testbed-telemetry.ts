import { db } from "@workspace/db";
import { mspCustomersTable, mspUsersTable, clientM365ProfilesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

async function main() {
  console.log("Starting testbed M365 profile telemetry seeding...");

  // 1. Fetch testbed customers (WHERE is_testbed = true)
  const testbedCustomers = await db
    .select({
      id: mspCustomersTable.id,
      name: mspCustomersTable.name,
      domain: mspCustomersTable.domain,
    })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.isTestbed, true));

  console.log(`Found ${testbedCustomers.length} testbed customer(s).`);

  if (testbedCustomers.length === 0) {
    console.log("No testbed customers found in msp_customers table. Exiting.");
    process.exit(0);
  }

  let seededCount = 0;

  for (const customer of testbedCustomers) {
    console.log(`\nProcessing testbed customer: "${customer.name}" (ID: ${customer.id})`);

    // Fetch linked user IDs via msp_users table
    const mspUsers = await db
      .select({ userId: mspUsersTable.userId })
      .from(mspUsersTable)
      .where(eq(mspUsersTable.customerId, customer.id));

    // Also fetch users matched by company name to be thorough
    const companyUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.company, customer.name));

    const userIds = Array.from(
      new Set([...mspUsers.map((u) => u.userId), ...companyUsers.map((u) => u.id)])
    ).filter((id): id is number => id != null);

    console.log(`Found ${userIds.length} user(s) associated with customer "${customer.name}".`);

    for (const userId of userIds) {
      // Determine realistic and deterministic M365 profile metrics
      const mfaEnforced = userId % 2 === 0;
      const conditionalAccessPolicyCount = 4 + (userId % 3);
      const securityScore = 55 + (userId % 5) * 5;
      const totalSeats = 100 + (userId % 6) * 20;
      const activeSeats = totalSeats - (userId % 8) - 1;

      // Fetch existing profile to merge keys without overwriting other telemetry
      const [existingRow] = await db
        .select()
        .from(clientM365ProfilesTable)
        .where(eq(clientM365ProfilesTable.clientId, userId))
        .limit(1);

      const existingProfile = (existingRow?.profile as Record<string, unknown> | null) ?? {};

      const mergedProfile = {
        ...existingProfile,
        mfaEnforced,
        conditionalAccessPolicyCount,
        securityScore,
        totalSeats,
        activeSeats,
      };

      console.log(`  Seeding user ID ${userId}:`, {
        mfaEnforced,
        conditionalAccessPolicyCount,
        securityScore,
        totalSeats,
        activeSeats,
      });

      await db
        .insert(clientM365ProfilesTable)
        .values({
          clientId: userId,
          profile: mergedProfile,
        })
        .onConflictDoUpdate({
          target: clientM365ProfilesTable.clientId,
          set: {
            profile: mergedProfile,
            updatedAt: new Date(),
          },
        });

      seededCount++;
    }
  }

  console.log(`\nSuccessfully seeded M365 telemetry for ${seededCount} customer user profile(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to seed testbed telemetry:", err);
  process.exit(1);
});

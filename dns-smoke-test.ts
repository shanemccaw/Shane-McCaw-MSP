import { executeMonitorCheck } from "./artifacts/api-server/src/lib/monitor-executor";
import { db, monitorChecksTable } from "./lib/db/src";
import { eq } from "drizzle-orm";

async function main() {
  const [check] = await db.select().from(monitorChecksTable).where(eq(monitorChecksTable.key, "exchange:dkim-spf-dmarc-status"));
  if (!check) throw new Error("exchange:dkim-spf-dmarc-status row not found — did the migration SQL actually run?");

  const result = await executeMonitorCheck({
    check,
    tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3",
    triggerId: "manual-dns-smoke-test",
    skipIdempotency: true,
    includeItems: true,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});

import { seedMarketingServices } from "../lib/seed-portal";

async function main() {
  console.log("[seed-marketing] Running marketing services seed...");
  await seedMarketingServices();
  console.log("[seed-marketing] Done.");
  process.exit(0);
}

main().catch((err) => {
  // Deliberate exception: standalone CLI script, runs outside the live server
  // process, so the SSE hub / Log Stream have no listener when this fires.
  console.error("[seed-marketing] Failed:", err);
  process.exit(1);
});

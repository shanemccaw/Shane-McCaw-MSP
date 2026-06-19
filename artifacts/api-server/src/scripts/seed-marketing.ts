import { seedMarketingServices } from "../lib/seed-portal";

async function main() {
  console.log("[seed-marketing] Running marketing services seed...");
  await seedMarketingServices();
  console.log("[seed-marketing] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-marketing] Failed:", err);
  process.exit(1);
});

import app from "./app";
import { logger } from "./lib/logger";
import { seedAdminUser } from "./routes/auth";
import { seedPortalDemo, seedServiceTemplates, seedMarketingServices } from "./lib/seed-portal";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  seedAdminUser().then(() => {
    logger.info("CRM admin user seeded (no-op if exists)");
  }).catch((seedErr) => {
    logger.warn({ err: seedErr }, "Could not seed admin user");
  });

  seedServiceTemplates().then(() => {
    logger.info("Service workflow/project templates seeded (no-op if exists)");
  }).catch((seedErr) => {
    logger.warn({ err: seedErr }, "Could not seed service templates");
  });

  seedMarketingServices().then(() => {
    logger.info("Marketing services seeded/updated");
  }).catch((seedErr) => {
    logger.warn({ err: seedErr }, "Could not seed marketing services");
  });

  if (process.env.NODE_ENV !== "production") {
    seedPortalDemo().then(() => {
      logger.info("Portal demo data seeded (no-op if exists)");
    }).catch((seedErr) => {
      logger.warn({ err: seedErr }, "Could not seed portal demo data");
    });
  }
});

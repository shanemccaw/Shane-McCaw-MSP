import app from "./app";
import { logger } from "./lib/logger";
import { validateStripeKeyOnStartup } from "./lib/stripe";
import { seedAdminUser } from "./routes/auth";
import { seedPortalDemo, seedServiceTemplates } from "./lib/seed-portal";
import { seedEmailTemplates } from "./lib/seed-email-templates";
import { initGraphSubscription } from "./lib/graph-subscription";
import { seedServicePageTriggerKeys } from "./lib/seed-service-page-triggers";
import { pool } from "@workspace/db";

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

validateStripeKeyOnStartup();

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

  seedEmailTemplates().then(() => {
    logger.info("Email templates seeded (no-op if exists)");
  }).catch((seedErr) => {
    logger.warn({ err: seedErr }, "Could not seed email templates");
  });

  seedServicePageTriggerKeys().then(() => {
    logger.info("Service page trigger keys seeded (no-op if exists)");
  }).catch((seedErr) => {
    logger.warn({ err: seedErr }, "Could not seed service page trigger keys");
  });

  if (process.env.NODE_ENV !== "production") {
    seedPortalDemo().then(() => {
      logger.info("Portal demo data seeded (no-op if exists)");
    }).catch((seedErr) => {
      logger.warn({ err: seedErr }, "Could not seed portal demo data");
    });
  }

  initGraphSubscription().catch((err) => {
    logger.warn({ err }, "Graph subscription init failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS coupon_code TEXT,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2)
  `).then(() => {
    logger.info("Migration: invoices coupon columns ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: failed to add coupon columns to invoices (non-fatal)");
  });

  pool.query(`
    ALTER TABLE coupons
    ADD COLUMN IF NOT EXISTS requires_testimonial BOOLEAN NOT NULL DEFAULT false
  `).then(() => {
    logger.info("Migration: coupons.requires_testimonial column ensured");
    return pool.query(`
      INSERT INTO coupons (code, discount_type, discount_value, active, requires_testimonial)
      VALUES ('TESTIMONIAL', 'percentage', 10, true, true)
      ON CONFLICT (code) DO UPDATE
        SET discount_type = 'percentage',
            discount_value = 10,
            active = true,
            requires_testimonial = true
    `);
  }).then(() => {
    logger.info("Seed: TESTIMONIAL coupon upserted");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration/seed: coupons.requires_testimonial or TESTIMONIAL coupon failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS recipient_type TEXT NOT NULL DEFAULT 'client'
  `).then(() => {
    return pool.query(`
      UPDATE email_templates
      SET recipient_type = 'admin'
      WHERE slug IN (
        'contact-inquiry-notification',
        'client-thread-reply',
        'service-overview-lead-notification',
        'quiz-lead-notification',
        'admin-purchase-alert',
        'admin-message-notification'
      ) AND recipient_type = 'client'
    `);
  }).then(() => {
    logger.info("Migration: email_templates.recipient_type column ensured and backfilled");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: email_templates.recipient_type failed (non-fatal)");
  });
});

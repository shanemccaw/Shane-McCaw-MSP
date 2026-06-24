import app from "./app";
import { logger } from "./lib/logger";
import { validateStripeKeyOnStartup, checkWebhookHealthOnStartup } from "./lib/stripe";
import { seedAdminUser } from "./routes/auth";
import { seedPortalDemo, seedServiceTemplates, seedMarketingServices } from "./lib/seed-portal";
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

  seedMarketingServices().then(() => {
    logger.info("Marketing services pageHref/pageSlug seeded (no-op if exists)");
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

  checkWebhookHealthOnStartup(logger).catch((err) => {
    logger.warn({ err }, "Stripe webhook health check failed (non-fatal)");
  });

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

  pool.query(`
    CREATE TABLE IF NOT EXISTS next_best_actions (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT 'general',
      entity_id INTEGER,
      entity_name TEXT,
      action TEXT NOT NULL,
      rationale TEXT,
      confidence INTEGER NOT NULL DEFAULT 50,
      link_path TEXT,
      resolved_at TIMESTAMP,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: next_best_actions table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: next_best_actions table failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS revenue_forecasts (
      id SERIAL PRIMARY KEY,
      period TEXT NOT NULL,
      forecast NUMERIC(12,2) NOT NULL,
      lower_bound NUMERIC(12,2) NOT NULL,
      upper_bound NUMERIC(12,2) NOT NULL,
      narrative TEXT,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: revenue_forecasts table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: revenue_forecasts table failed (non-fatal)");
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS client_health_history (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      score INTEGER NOT NULL,
      recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).then(() => {
    logger.info("Migration: client_health_history table ensured");
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: client_health_history table failed (non-fatal)");
  });
});

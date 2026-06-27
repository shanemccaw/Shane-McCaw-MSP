import app from "./app";
import { logger } from "./lib/logger";
import { validateStripeKeyOnStartup, checkWebhookHealthOnStartup } from "./lib/stripe";
import { initGraphSubscription } from "./lib/graph-subscription";
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

  checkWebhookHealthOnStartup(logger).catch((err) => {
    logger.warn({ err }, "Stripe webhook health check failed (non-fatal)");
  });

  initGraphSubscription().catch((err) => {
    logger.warn({ err }, "Graph subscription init failed (non-fatal)");
  });

  // ── DDL migrations (schema-only, no data inserts) ─────────────────────────
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
  }).catch((err: unknown) => {
    logger.warn({ err }, "Migration: coupons.requires_testimonial column failed (non-fatal)");
  });

  pool.query(`
    ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS recipient_type TEXT NOT NULL DEFAULT 'client'
  `).then(() => {
    logger.info("Migration: email_templates.recipient_type column ensured");
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

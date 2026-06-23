ALTER TABLE "email_templates" ADD COLUMN IF NOT EXISTS "recipient_type" text DEFAULT 'client' NOT NULL;
--> statement-breakpoint
UPDATE "email_templates"
SET "recipient_type" = 'admin'
WHERE "slug" IN (
  'contact-inquiry-notification',
  'client-thread-reply',
  'service-overview-lead-notification',
  'quiz-lead-notification',
  'admin-purchase-alert',
  'admin-message-notification'
);

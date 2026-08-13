-- checkout_sessions: server-side session that survives cross-origin redirects
-- (e.g. Microsoft admin-consent). Only the sessionId UUID is kept client-side;
-- PII (name, email) lives here. Expires after 24 h.
-- Safe to re-apply: all DDL uses IF NOT EXISTS / DO NOTHING guards.

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tenant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS checkout_sessions_email_idx ON checkout_sessions(email);
CREATE INDEX IF NOT EXISTS checkout_sessions_expires_at_idx ON checkout_sessions(expires_at);

-- failed_notifications: written by mailer.ts when a Graph email send fails after
-- one retry. Lets admins identify customers who never received transactional emails.

CREATE TABLE IF NOT EXISTS failed_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  template_name TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS failed_notifications_recipient_idx ON failed_notifications(recipient_email);
CREATE INDEX IF NOT EXISTS failed_notifications_resolved_idx ON failed_notifications(resolved);

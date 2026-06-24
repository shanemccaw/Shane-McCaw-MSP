-- Inbox Message Links: links Graph message IDs to CRM entities and kanban tasks
CREATE TABLE IF NOT EXISTS "inbox_message_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "graph_message_id" text NOT NULL UNIQUE,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "opportunity_id" integer REFERENCES "opportunities"("id") ON DELETE SET NULL,
  "customer_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "task_id" integer REFERENCES "kanban_tasks"("id") ON DELETE SET NULL,
  "direction" text NOT NULL DEFAULT 'inbound',
  "created_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "kanban_tasks" ALTER COLUMN "priority" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ALTER COLUMN "priority" SET DEFAULT 'medium';

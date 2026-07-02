CREATE TABLE IF NOT EXISTS "presentation_doc_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"presentation_id" integer NOT NULL,
	"document_id" integer,
	"document_title" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	"dwell_seconds" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "presentation_doc_views" ADD CONSTRAINT "presentation_doc_views_presentation_id_quick_win_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."quick_win_presentations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "presentation_doc_views" ADD CONSTRAINT "presentation_doc_views_document_id_insights_generated_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."insights_generated_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

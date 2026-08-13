CREATE TABLE "quiz_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"total_score" integer NOT NULL DEFAULT 0,
	"tier" text NOT NULL DEFAULT 'Beginner',
	"recommended_service" text,
	"category_scores" jsonb NOT NULL DEFAULT '{}',
	"conversation" jsonb NOT NULL DEFAULT '[]',
	"created_at" timestamp DEFAULT now() NOT NULL
);

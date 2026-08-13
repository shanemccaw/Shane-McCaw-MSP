CREATE TABLE "quick_win_quiz_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"answers" jsonb NOT NULL,
	"scores" jsonb NOT NULL,
	"ranked_slugs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

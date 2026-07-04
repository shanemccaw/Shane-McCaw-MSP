ALTER TABLE "quick_win_presentations" ADD COLUMN "first_visited_at" timestamp;--> statement-breakpoint
ALTER TABLE "quick_win_presentations" ADD COLUMN "pay_today_discount_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quick_win_presentations" ADD COLUMN "discounted_total_cents" integer;

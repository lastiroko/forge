ALTER TABLE "solutions" ADD COLUMN "hidden_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "hidden_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "suspended_at" timestamp with time zone;

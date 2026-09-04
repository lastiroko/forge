ALTER TABLE "app"."users" ALTER COLUMN "github_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "deleted_at" timestamp with time zone;

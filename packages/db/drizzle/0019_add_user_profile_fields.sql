ALTER TABLE "app"."users" ADD COLUMN "bio" text;
--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;

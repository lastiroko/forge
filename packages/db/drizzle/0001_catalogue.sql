CREATE TABLE IF NOT EXISTS "stacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" text NOT NULL,
	"framework" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"level" text NOT NULL,
	"backend_enabled" boolean DEFAULT true NOT NULL,
	"fullstack_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenge_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"level" text NOT NULL,
	"rubric" jsonb NOT NULL,
	"openapi_ref" text NOT NULL,
	"hidden_tests_ref" text NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "challenge_versions_challenge_id_version_unique" UNIQUE("challenge_id","version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challenge_versions" ADD CONSTRAINT "challenge_versions_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

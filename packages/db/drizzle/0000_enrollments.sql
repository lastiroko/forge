CREATE TABLE IF NOT EXISTS "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_version_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"stack_id" uuid NOT NULL,
	"repo_url" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

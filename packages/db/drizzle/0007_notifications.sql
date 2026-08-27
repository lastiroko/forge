CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_user_id_event_type_unique" UNIQUE("user_id","event_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

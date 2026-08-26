ALTER TABLE "challenges" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenge_stacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"stack_id" uuid NOT NULL,
	CONSTRAINT "challenge_stacks_challenge_id_stack_id_unique" UNIQUE("challenge_id","stack_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challenge_stacks" ADD CONSTRAINT "challenge_stacks_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challenge_stacks" ADD CONSTRAINT "challenge_stacks_stack_id_stacks_id_fk" FOREIGN KEY ("stack_id") REFERENCES "stacks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

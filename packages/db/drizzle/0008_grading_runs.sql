-- TODO: The approved 0007 filename was already occupied by the solutions migration, so this migration uses the next available sequence number.
CREATE TABLE IF NOT EXISTS "grading_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" text NOT NULL,
	"score" numeric NOT NULL,
	"report_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "grading_runs" ADD CONSTRAINT "grading_runs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_grading_run_id_grading_runs_id_fk" FOREIGN KEY ("grading_run_id") REFERENCES "grading_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

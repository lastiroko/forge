ALTER TABLE "grading_runs" ALTER COLUMN "score" DROP NOT NULL;
ALTER TABLE "grading_runs" ADD COLUMN "current_stage" text;
ALTER TABLE "grading_runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "grading_runs" ADD COLUMN "completion_event_sent_at" timestamp with time zone;

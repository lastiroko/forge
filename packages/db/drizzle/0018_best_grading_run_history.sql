ALTER TABLE "grading_runs" ADD COLUMN "build_log_url" text;
ALTER TABLE "grading_runs" ADD COLUMN "app_log_url" text;
ALTER TABLE "enrollments" ADD COLUMN "best_grading_run_id" uuid;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_best_grading_run_id_grading_runs_id_fk" FOREIGN KEY ("best_grading_run_id") REFERENCES "public"."grading_runs"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "enrollments_best_grading_run_id_idx" ON "enrollments" USING btree ("best_grading_run_id");

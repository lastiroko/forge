CREATE UNIQUE INDEX "points_ledger_grading_run_id_unique" ON "points_ledger" USING btree ("grading_run_id") WHERE "grading_run_id" IS NOT NULL;

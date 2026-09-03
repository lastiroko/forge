CREATE UNIQUE INDEX "users_github_id_unique" ON "app"."users" USING btree ("github_id");

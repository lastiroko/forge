ALTER TABLE "challenges" ADD COLUMN "content_slug" text;
--> statement-breakpoint
ALTER TABLE "stacks" ADD COLUMN "template_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_content_slug_unique" ON "challenges" USING btree ("content_slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "stacks_template_key_unique" ON "stacks" USING btree ("template_key");

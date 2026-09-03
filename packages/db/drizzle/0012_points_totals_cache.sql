CREATE TABLE IF NOT EXISTS "points_totals_cache" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"total_points" integer NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invalidate_points_totals_cache() RETURNS trigger AS $$
BEGIN
	DELETE FROM "points_totals_cache" WHERE "user_id" = NEW."user_id";
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER points_ledger_invalidate_totals_cache
AFTER INSERT ON "points_ledger"
FOR EACH ROW
EXECUTE FUNCTION invalidate_points_totals_cache();

CREATE OR REPLACE FUNCTION prevent_published_challenge_version_update() RETURNS trigger AS $$
BEGIN
	IF OLD."published_at" IS NOT NULL THEN
		RAISE EXCEPTION 'published challenge versions are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER challenge_versions_prevent_published_update
BEFORE UPDATE ON "challenge_versions"
FOR EACH ROW
EXECUTE FUNCTION prevent_published_challenge_version_update();

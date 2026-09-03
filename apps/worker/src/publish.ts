import { createDbClient } from '@forge/db';
import { loadEnv } from '@forge/shared';
import { PublishingGateError, publishChallengeVersion, type PublishingDatabase } from './publishing.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const [challengeDir, versionId, ...extra] = process.argv.slice(2);
  if (!challengeDir || !versionId || extra.length > 0) {
    throw new Error('Usage: npm run publish:challenge -- <challenge-directory> <challenge-version-id>');
  }
  if (!UUID_PATTERN.test(versionId)) throw new Error('challenge-version-id must be a UUID');

  const { pool } = createDbClient(loadEnv().DATABASE_URL);
  const database: PublishingDatabase = {
    async publishDraftVersion(id) {
      const result = await pool.query(
        'UPDATE challenge_versions SET published_at = NOW() WHERE id = $1 AND published_at IS NULL RETURNING id',
        [id],
      );
      return result.rowCount === 1;
    },
  };

  try {
    const result = await publishChallengeVersion(challengeDir, versionId, { database });
    console.log(`reference solution score: ${result.reference.score}`);
    console.log(
      `broken solution failed checks: ${result.broken.checks.filter((check) => !check.passed).map((check) => check.name).join(', ')}`,
    );
    console.log(`published challenge version ${versionId}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PublishingGateError) {
    console.error(`Publishing refused — ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});

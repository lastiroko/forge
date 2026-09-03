import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createDbClient } from '@forge/db';
import {
  PublishingGateError,
  publishChallengeVersion,
  type PublishingDatabase,
  type SolutionEvaluation,
  type SolutionName,
} from './publishing.js';

const passing: SolutionEvaluation = { score: 100, checks: [{ name: 'functional:create', passed: true }] };
const failing: SolutionEvaluation = {
  score: 70,
  checks: [{ name: 'functional:create', passed: false, message: 'wrong status' }],
};

function fakeDatabase(publish = true) {
  const writes: string[] = [];
  const database: PublishingDatabase = {
    async publishDraftVersion(versionId) {
      writes.push(versionId);
      return publish;
    },
  };
  return { database, writes };
}

test('publishes only after the reference passes and the broken solution fails', async () => {
  const events: string[] = [];
  const database: PublishingDatabase = {
    async publishDraftVersion(versionId) {
      events.push(`publish:${versionId}`);
      return true;
    },
  };
  const evaluate = async (_directory: string, solution: SolutionName) => {
    events.push(`evaluate:${solution}`);
    return solution === 'reference' ? passing : failing;
  };

  const result = await publishChallengeVersion('/challenge', 'version-id', { database, evaluate });

  assert.equal(result.reference.score, 100);
  assert.equal(result.broken.checks[0].passed, false);
  assert.deepEqual(events, ['evaluate:reference', 'evaluate:broken', 'publish:version-id']);
});

test('refuses a reference score below 100 without evaluating broken or writing', async () => {
  const { database, writes } = fakeDatabase();
  const evaluated: SolutionName[] = [];

  await assert.rejects(
    publishChallengeVersion('/challenge', 'version-id', {
      database,
      evaluate: async (_directory, solution) => {
        evaluated.push(solution);
        return failing;
      },
    }),
    (error: unknown) =>
      error instanceof PublishingGateError &&
      error.gate === 'reference solution score' &&
      error.message.includes('got 70'),
  );
  assert.deepEqual(evaluated, ['reference']);
  assert.deepEqual(writes, []);
});

test('refuses a broken solution that passes every named check without writing', async () => {
  const { database, writes } = fakeDatabase();

  await assert.rejects(
    publishChallengeVersion('/challenge', 'version-id', {
      database,
      evaluate: async () => passing,
    }),
    (error: unknown) =>
      error instanceof PublishingGateError &&
      error.gate === 'broken solution checks' &&
      error.message.includes('functional:create'),
  );
  assert.deepEqual(writes, []);
});

test('refuses a missing or already-published draft version after both evaluations', async () => {
  const { database, writes } = fakeDatabase(false);

  await assert.rejects(
    publishChallengeVersion('/challenge', 'missing-version', {
      database,
      evaluate: async (_directory, solution) => (solution === 'reference' ? passing : failing),
    }),
    (error: unknown) => error instanceof PublishingGateError && error.gate === 'draft challenge version',
  );
  assert.deepEqual(writes, ['missing-version']);
});

const runDockerTests = process.env.RUN_DOCKER_TESTS === '1';
const challengeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'challenges', 'todo-api');

test('publishing gate accepts S68 and rejects a copy with a broken reference', { skip: !runDockerTests }, async (t) => {
  const { pool } = createDbClient(process.env.DATABASE_URL);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'forge-publishing-'));
  const brokenChallengeDir = path.join(temporaryRoot, 'todo-api');
  const challengeId = randomUUID();
  const acceptedVersionId = randomUUID();
  const rejectedVersionId = randomUUID();
  const database: PublishingDatabase = {
    async publishDraftVersion(versionId) {
      const result = await pool.query(
        'UPDATE challenge_versions SET published_at = NOW() WHERE id = $1 AND published_at IS NULL RETURNING id',
        [versionId],
      );
      return result.rowCount === 1;
    },
  };

  await cp(challengeDir, brokenChallengeDir, { recursive: true });
  await rm(path.join(brokenChallengeDir, 'solutions', 'reference'), { recursive: true, force: true });
  await cp(
    path.join(brokenChallengeDir, 'solutions', 'broken'),
    path.join(brokenChallengeDir, 'solutions', 'reference'),
    { recursive: true },
  );
  await pool.query(
    'INSERT INTO challenges (id, title, level) VALUES ($1, $2, $3)',
    [challengeId, 'Publishing integration', 'junior'],
  );
  for (const [id, version] of [[acceptedVersionId, 1], [rejectedVersionId, 2]] as const) {
    await pool.query(
      `INSERT INTO challenge_versions
        (id, challenge_id, version, level, brief, rubric, openapi_ref, hidden_tests_ref)
       VALUES ($1, $2, $3, 'junior', '', $4, 'openapi.yaml', 'checks/functional-hidden.json')`,
      [id, challengeId, version, JSON.stringify({ functional: 60, contract: 15, robustness: 15, quality: 10 })],
    );
  }

  t.after(async () => {
    await pool.query('DELETE FROM challenge_versions WHERE challenge_id = $1', [challengeId]);
    await pool.query('DELETE FROM challenges WHERE id = $1', [challengeId]);
    await pool.end();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  const accepted = await publishChallengeVersion(challengeDir, acceptedVersionId, { database });
  assert.equal(accepted.reference.score, 100);
  assert.ok(accepted.broken.checks.some((check) => !check.passed && check.name.length > 0));
  const acceptedRow = await pool.query('SELECT published_at FROM challenge_versions WHERE id = $1', [acceptedVersionId]);
  assert.ok(acceptedRow.rows[0].published_at);

  await assert.rejects(
    publishChallengeVersion(brokenChallengeDir, rejectedVersionId, { database }),
    (error: unknown) =>
      error instanceof PublishingGateError &&
      error.gate === 'reference solution score' &&
      error.message.includes('got'),
  );
  const rejectedRow = await pool.query('SELECT published_at FROM challenge_versions WHERE id = $1', [rejectedVersionId]);
  assert.equal(rejectedRow.rows[0].published_at, null);
});

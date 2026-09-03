import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createDbClient, schema } from '@forge/db';
import { eq } from 'drizzle-orm';
import { getPublicProfile } from './index.js';

const { users, challenges, challengeVersions, stacks, enrollments, submissions, gradingRuns } = schema;

test('returns completed challenges with the highest successful score only', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  const ids: Record<string, string[]> = { users: [], challenges: [], versions: [], stacks: [], enrollments: [], submissions: [], runs: [] };
  try {
    const [user] = await db.insert(users).values({
      githubId: 56001, handle: 'profile-query', displayName: 'Profile Query', email: 'profile@example.com', role: 'member',
      bio: 'Building backend APIs for fun.', links: ['https://example.com', 'https://github.com/profile-query'],
    }).returning(); ids.users.push(user.id);
    const [challenge] = await db.insert(challenges).values({ title: 'Junior API', level: 'junior' }).returning(); ids.challenges.push(challenge.id);
    const [version] = await db.insert(challengeVersions).values({ challengeId: challenge.id, version: 1, level: 'junior', rubric: {}, openapiRef: 'api.yaml', hiddenTestsRef: 'tests', publishedAt: new Date() }).returning(); ids.versions.push(version.id);
    const [stack] = await db.insert(stacks).values({ language: 'TypeScript', framework: 'Fastify' }).returning(); ids.stacks.push(stack.id);
    const [completed, active] = await db.insert(enrollments).values([
      { userId: user.id, challengeVersionId: version.id, mode: 'backend', stackId: stack.id, status: 'completed' },
      { userId: user.id, challengeVersionId: version.id, mode: 'backend', stackId: stack.id, status: 'active' },
    ]).returning(); ids.enrollments.push(completed.id, active.id);
    const [completedSubmission, activeSubmission] = await db.insert(submissions).values([
      { enrollmentId: completed.id, commitSha: 'completed', status: 'graded' },
      { enrollmentId: active.id, commitSha: 'active', status: 'graded' },
    ]).returning(); ids.submissions.push(completedSubmission.id, activeSubmission.id);
    const runs = await db.insert(gradingRuns).values([
      { submissionId: completedSubmission.id, status: 'successful', score: 72.5 },
      { submissionId: completedSubmission.id, status: 'successful', score: 91.25 },
      { submissionId: completedSubmission.id, status: 'failed', score: 99 },
      { submissionId: activeSubmission.id, status: 'successful', score: 100 },
    ]).returning(); ids.runs.push(...runs.map((run) => run.id));

    assert.deepEqual(await getPublicProfile('profile-query', databaseUrl), {
      displayName: 'Profile Query', handle: 'profile-query',
      bio: 'Building backend APIs for fun.', links: ['https://example.com', 'https://github.com/profile-query'],
      completedChallenges: [{ title: 'Junior API', language: 'TypeScript', framework: 'Fastify', mode: 'backend', score: 91.25 }],
    });
    assert.equal(await getPublicProfile('unknown-profile-query', databaseUrl), undefined);
  } finally {
    for (const id of ids.runs) await db.delete(gradingRuns).where(eq(gradingRuns.id, id));
    for (const id of ids.submissions) await db.delete(submissions).where(eq(submissions.id, id));
    for (const id of ids.enrollments) await db.delete(enrollments).where(eq(enrollments.id, id));
    for (const id of ids.versions) await db.delete(challengeVersions).where(eq(challengeVersions.id, id));
    for (const id of ids.challenges) await db.delete(challenges).where(eq(challenges.id, id));
    for (const id of ids.stacks) await db.delete(stacks).where(eq(stacks.id, id));
    for (const id of ids.users) await db.delete(users).where(eq(users.id, id));
    await pool.end();
  }
});

import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';

const { users, challenges, challengeVersions, stacks, enrollments, submissions, gradingRuns } = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3421;
const { db, pool } = createDbClient(databaseUrl);
const ids: Record<string, string[]> = { users: [], challenges: [], versions: [], stacks: [], enrollments: [], submissions: [], runs: [] };
let server: ChildProcess | undefined;

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

before(async () => {
  const [user] = await db.insert(users).values({
    githubId: 56002, handle: 'public-member', displayName: 'Public Member', email: 'public@example.com', role: 'member',
    bio: 'Ships backend APIs for fun.', links: ['https://example.com', 'https://github.com/public-member'],
  }).returning(); ids.users.push(user.id);
  const completedTitles = ['HTTP Junior Challenge', 'Active Hidden Challenge'];
  const insertedChallenges = await db.insert(challenges).values(completedTitles.map((title) => ({ title, level: 'junior' }))).returning(); ids.challenges.push(...insertedChallenges.map((row) => row.id));
  const insertedVersions = await db.insert(challengeVersions).values(insertedChallenges.map((challenge) => ({ challengeId: challenge.id, version: 1, level: 'junior', rubric: {}, openapiRef: 'api.yaml', hiddenTestsRef: 'tests', publishedAt: new Date() }))).returning(); ids.versions.push(...insertedVersions.map((row) => row.id));
  const [stack] = await db.insert(stacks).values({ language: 'TypeScript', framework: 'Fastify' }).returning(); ids.stacks.push(stack.id);
  const insertedEnrollments = await db.insert(enrollments).values([
    { userId: user.id, challengeVersionId: insertedVersions[0].id, mode: 'backend', stackId: stack.id, status: 'completed' },
    { userId: user.id, challengeVersionId: insertedVersions[1].id, mode: 'backend', stackId: stack.id, status: 'active' },
  ]).returning(); ids.enrollments.push(...insertedEnrollments.map((row) => row.id));
  const insertedSubmissions = await db.insert(submissions).values(insertedEnrollments.map((enrollment, index) => ({ enrollmentId: enrollment.id, commitSha: `route-${index}`, status: 'graded' }))).returning(); ids.submissions.push(...insertedSubmissions.map((row) => row.id));
  const runs = await db.insert(gradingRuns).values(insertedSubmissions.map((submission, index) => ({ submissionId: submission.id, status: 'successful', score: index === 0 ? 88.5 : 100 }))).returning(); ids.runs.push(...runs.map((row) => row.id));

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  server = spawn('node', ['.next/standalone/apps/web/server.js'], { cwd: webRoot, env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' } });
  await waitForServer(`http://127.0.0.1:${port}/u/public-member`);
});

after(async () => {
  if (server) server.kill();
  for (const id of ids.runs) await db.delete(gradingRuns).where(eq(gradingRuns.id, id));
  for (const id of ids.submissions) await db.delete(submissions).where(eq(submissions.id, id));
  for (const id of ids.enrollments) await db.delete(enrollments).where(eq(enrollments.id, id));
  for (const id of ids.versions) await db.delete(challengeVersions).where(eq(challengeVersions.id, id));
  for (const id of ids.challenges) await db.delete(challenges).where(eq(challenges.id, id));
  for (const id of ids.stacks) await db.delete(stacks).where(eq(stacks.id, id));
  for (const id of ids.users) await db.delete(users).where(eq(users.id, id));
  await pool.end();
});

test('GET /u/:handle publicly shows completed challenge details and solution empty state', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/u/public-member`);
  const body = await response.text();
  assert.equal(response.status, 200);
  for (const content of ['HTTP Junior Challenge', 'TypeScript', 'Fastify', 'backend', '88.5', 'Published solutions', 'No published solutions yet.']) assert.ok(body.includes(content));
  assert.ok(!body.includes('Active Hidden Challenge'));
  assert.ok(body.includes('Ships backend APIs for fun.'));
  assert.ok(body.includes('href="https://example.com"'));
  assert.ok(body.includes('href="https://github.com/public-member"'));
});

test('GET /u/:handle returns 404 for an unknown handle', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/u/unknown-public-member`);
  assert.equal(response.status, 404);
});

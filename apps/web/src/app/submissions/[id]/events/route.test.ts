import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import type { User } from '../../../../modules/identity/index.js';
import { createGetHandler } from './handler.js';
import { GET } from './route.js';

const { enrollments, submissions, gradingRuns } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const { db, pool } = createDbClient(databaseUrl);
const userId = randomUUID();
const user = {
  id: userId, githubId: 50, handle: 'sse-owner', displayName: 'SSE Owner', avatarUrl: null,
  email: 'sse@example.com', role: 'member', bio: null, links: [], deletedAt: null, createdAt: new Date(),
} satisfies User;
let enrollmentId: string;
let submissionId: string;
let runId: string;

before(async () => {
  const [enrollment] = await db.insert(enrollments).values({
    userId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active',
  }).returning();
  enrollmentId = enrollment.id;
  const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'sse-sha', status: 'queued' }).returning();
  submissionId = submission.id;
  const [run] = await db.insert(gradingRuns).values({ submissionId, status: 'queued' }).returning();
  runId = run.id;
});

after(async () => {
  await db.delete(gradingRuns).where(eq(gradingRuns.id, runId));
  await db.delete(submissions).where(eq(submissions.id, submissionId));
  await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
  await pool.end();
});

test('submission event stream returns 404 for an unknown submission', async () => {
  const id = randomUUID();
  const response = await GET(new Request(`http://localhost/submissions/${id}/events`), { params: { id } });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not found' });
});

test('submission event stream hides a known submission from a different user', async () => {
  const handler = createGetHandler({ currentUser: async () => ({ ...user, id: randomUUID() }) });
  const response = await handler(new Request(`http://localhost/submissions/${submissionId}/events`), { params: { id: submissionId } });
  assert.equal(response.status, 404);
});

test('submission event stream emits ordered durable stages within five seconds and closes at completion', async () => {
  const handler = createGetHandler({ currentUser: async () => user });
  const response = await handler(new Request(`http://localhost/submissions/${submissionId}/events`), { params: { id: submissionId } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const readStatus = async () => {
    const result = await reader.read();
    assert.equal(result.done, false);
    const text = decoder.decode(result.value);
    assert.match(text, /event: status/);
    return JSON.parse(text.match(/data: (.+)\n/)![1]) as { currentStage: string | null; status: string };
  };

  assert.deepEqual((await readStatus()).currentStage, null);
  for (const [index, stage] of ['build', 'start', 'functional'].entries()) {
    const updatedAt = new Date(Date.now() + index + 1);
    await db.update(gradingRuns).set({ status: 'running', currentStage: stage, updatedAt }).where(eq(gradingRuns.id, runId));
    const startedAt = Date.now();
    assert.equal((await readStatus()).currentStage, stage);
    assert.ok(Date.now() - startedAt < 5_000, `${stage} event exceeded five seconds`);
  }

  await db.update(gradingRuns).set({
    status: 'successful', score: 91, currentStage: 'complete', updatedAt: new Date(Date.now() + 10),
  }).where(eq(gradingRuns.id, runId));
  assert.equal((await readStatus()).status, 'successful');
  assert.equal((await reader.read()).done, true);
});

test('submission event stream stops polling when the request is aborted', async () => {
  await db.update(gradingRuns).set({ status: 'running', score: null, currentStage: 'build', updatedAt: new Date() })
    .where(eq(gradingRuns.id, runId));
  const abort = new AbortController();
  const handler = createGetHandler({ currentUser: async () => user });
  const response = await handler(new Request(`http://localhost/submissions/${submissionId}/events`, { signal: abort.signal }), { params: { id: submissionId } });
  const reader = response.body!.getReader();
  await reader.read();
  abort.abort();
  assert.equal((await reader.read()).done, true);
});

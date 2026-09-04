import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import type { User } from '../../../modules/identity/index.js';
import { subscribeToSubmissionStatus } from './SubmissionStatus.js';
import { renderSubmissionPage } from './render.js';

const { enrollments, submissions, gradingRuns } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const { db, pool } = createDbClient(databaseUrl);
const userId = randomUUID();
const user = {
  id: userId, githubId: 51, handle: 'page-owner', displayName: 'Page Owner', avatarUrl: null,
  email: 'page@example.com', role: 'member', bio: null, links: [], deletedAt: null, createdAt: new Date(),
} satisfies User;
let enrollmentId: string;
let submissionId: string;
let runId: string;

before(async () => {
  const [enrollment] = await db.insert(enrollments).values({
    userId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active',
  }).returning();
  enrollmentId = enrollment.id;
  const [submission] = await db.insert(submissions).values({ enrollmentId, commitSha: 'page-sha', status: 'queued' }).returning();
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

async function renderPage(): Promise<string> {
  return renderToStaticMarkup(await renderSubmissionPage(submissionId, user));
}

test('submission page renders queued, running, and completed durable states', async () => {
  assert.match(await renderPage(), /Queued/);

  await db.update(gradingRuns).set({ status: 'running', currentStage: 'functional', updatedAt: new Date() })
    .where(eq(gradingRuns.id, runId));
  assert.match(await renderPage(), /functional/);

  await db.update(gradingRuns).set({
    status: 'successful', score: 93, reportUrl: 'https://reports.example/run', updatedAt: new Date(),
  }).where(eq(gradingRuns.id, runId));
  const completed = await renderPage();
  assert.match(completed, /Successful/);
  assert.match(completed, /Score:.*93/);
  assert.match(completed, /https:\/\/reports\.example\/run/);
});

test('submission page renders the cancelled terminal state without a score', async () => {
  await db.update(gradingRuns).set({
    status: 'cancelled', score: null, currentStage: 'functional', updatedAt: new Date(),
  }).where(eq(gradingRuns.id, runId));
  const cancelled = await renderPage();
  assert.match(cancelled, /Cancelled/);
  assert.doesNotMatch(cancelled, /Score:/);
});

test('submission page rejects a user who does not own the enrollment', async () => {
  await assert.rejects(
    () => renderSubmissionPage(submissionId, { ...user, id: randomUUID() }),
    /NEXT_NOT_FOUND/,
  );
});

test('live status subscription targets this submission and applies stage and score events without navigation', () => {
  let listener: ((event: Event) => void) | undefined;
  let openedUrl: string | undefined;
  let closeCalls = 0;
  const received: Array<{ currentStage: string | null; score: number | null }> = [];
  const source = {
    onerror: null as ((event: Event) => void) | null,
    addEventListener(type: string, next: (event: Event) => void) {
      assert.equal(type, 'status');
      listener = next;
    },
    close() { closeCalls += 1; },
  };
  const unsubscribe = subscribeToSubmissionStatus(
    submissionId,
    (status) => received.push(status),
    () => assert.fail('unexpected EventSource error'),
    (url) => { openedUrl = url; return source; },
  );

  assert.equal(openedUrl, `/submissions/${submissionId}/events`);
  listener!({ data: JSON.stringify({ currentStage: 'build', score: null, status: 'running' }) } as MessageEvent<string>);
  listener!({ data: JSON.stringify({ currentStage: 'functional', score: null, status: 'running' }) } as MessageEvent<string>);
  listener!({ data: JSON.stringify({ currentStage: 'complete', score: 96, status: 'successful' }) } as MessageEvent<string>);
  assert.deepEqual(received, [
    { currentStage: 'build', score: null, status: 'running' },
    { currentStage: 'functional', score: null, status: 'running' },
    { currentStage: 'complete', score: 96, status: 'successful' },
  ]);
  assert.equal(closeCalls, 1);
  unsubscribe();
  assert.equal(closeCalls, 2);
});

test('live status subscription closes the EventSource when a cancelled event arrives', () => {
  let listener: ((event: Event) => void) | undefined;
  let closeCalls = 0;
  const received: Array<{ currentStage: string | null; score: number | null; status: string }> = [];
  const source = {
    onerror: null as ((event: Event) => void) | null,
    addEventListener(type: string, next: (event: Event) => void) {
      assert.equal(type, 'status');
      listener = next;
    },
    close() { closeCalls += 1; },
  };
  subscribeToSubmissionStatus(
    submissionId,
    (status) => received.push(status),
    () => assert.fail('unexpected EventSource error'),
    () => source,
  );

  listener!({ data: JSON.stringify({ currentStage: 'build', score: null, status: 'running' }) } as MessageEvent<string>);
  assert.equal(closeCalls, 0);
  listener!({ data: JSON.stringify({ currentStage: 'build', score: null, status: 'cancelled' }) } as MessageEvent<string>);
  assert.deepEqual(received, [
    { currentStage: 'build', score: null, status: 'running' },
    { currentStage: 'build', score: null, status: 'cancelled' },
  ]);
  assert.equal(closeCalls, 1);
});

import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { renderEnrollmentPage } from './page.js';

const { enrollments, submissions, gradingRuns } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const { db, pool } = createDbClient(databaseUrl);
const ownerId = randomUUID();
let enrollmentId: string;
let submissionIds: string[] = [];
let runIds: string[] = [];

before(async () => {
  const [enrollment] = await db.insert(enrollments).values({
    userId: ownerId, challengeVersionId: randomUUID(), mode: 'backend', stackId: randomUUID(), status: 'active',
  }).returning();
  enrollmentId = enrollment.id;
  const seededSubmissions = await db.insert(submissions).values([
    { enrollmentId, commitSha: 'commit-forty', status: 'successful' },
    { enrollmentId, commitSha: 'commit-ninety', status: 'successful' },
  ]).returning();
  submissionIds = seededSubmissions.map(({ id }) => id);
  const seededRuns = await db.insert(gradingRuns).values(seededSubmissions.map((submission, index) => ({
    submissionId: submission.id, status: 'successful', score: index ? 90 : 40,
    reportUrl: `https://report.example/${index}`, buildLogUrl: `https://build.example/${index}`,
    appLogUrl: `https://app.example/${index}`,
  }))).returning();
  runIds = seededRuns.map(({ id }) => id);
});

after(async () => {
  for (const id of runIds) await db.delete(gradingRuns).where(eq(gradingRuns.id, id));
  for (const id of submissionIds) await db.delete(submissions).where(eq(submissions.id, id));
  if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
  await pool.end();
});

test('enrollment history page renders every run and artifact for owner and admin', async () => {
  for (const viewer of [{ id: ownerId, role: 'member' }, { id: randomUUID(), role: 'admin' }]) {
    const html = renderToStaticMarkup(await renderEnrollmentPage(enrollmentId, viewer));
    assert.match(html, /Run history/);
    assert.match(html, /commit-forty/);
    assert.match(html, /commit-ninety/);
    assert.match(html, /Score:.*40/);
    assert.match(html, /Score:.*90/);
    for (const kind of ['report', 'build', 'app']) {
      assert.match(html, new RegExp(`href="https://${kind}\\.example/[01]"`));
    }
  }
});

test('enrollment history page rejects outsiders and unknown enrollments', async () => {
  await assert.rejects(() => renderEnrollmentPage(enrollmentId, undefined), /NEXT_NOT_FOUND/);
  await assert.rejects(() => renderEnrollmentPage(enrollmentId, { id: randomUUID(), role: 'member' }), /NEXT_NOT_FOUND/);
  await assert.rejects(() => renderEnrollmentPage(randomUUID(), { id: ownerId, role: 'member' }), /NEXT_NOT_FOUND/);
});

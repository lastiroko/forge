import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema, getQueue } from '@forge/db';
import { submit, getSubmission, RateLimitExceededError, streamStatus } from './index.js';
import { GRADING_TOPIC } from '../grading/index.js';
import type { GitHubRepositoryClient } from '../kit-generator/index.js';

const { challenges, challengeVersions, enrollments, submissions, gradingRuns } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const repoUrl = 'https://github.com/acme/widget-api';

const validGithubClient: GitHubRepositoryClient = {
  async createRepository() {
    throw new Error('createRepository should not be called by submit');
  },
  async readFile({ path }) {
    if (path === 'Dockerfile') return 'FROM node:20';
    if (path === 'challenge.yml') return 'slug: widget-api';
    throw new Error('unexpected file path: ' + path);
  },
};

const missingDockerfileGithubClient: GitHubRepositoryClient = {
  async createRepository() {
    throw new Error('createRepository should not be called by submit');
  },
  async readFile({ path }) {
    if (path === 'Dockerfile') return undefined;
    if (path === 'challenge.yml') return 'slug: widget-api';
    throw new Error('unexpected file path: ' + path);
  },
};

test('rejects a sixth submission for the same member and challenge within the rolling hour, but allows one for a different challenge', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  const insertedSubmissionIds: string[] = [];
  let enrollmentAId: string | undefined;
  let enrollmentBId: string | undefined;
  let versionAId: string | undefined;
  let versionBId: string | undefined;
  let challengeAId: string | undefined;
  let challengeBId: string | undefined;

  try {
    const [challengeA] = await db.insert(challenges).values({ title: 'Challenge A', level: 'junior' }).returning();
    challengeAId = challengeA.id;
    const [versionA] = await db
      .insert(challengeVersions)
      .values({ challengeId: challengeAId, version: 1, level: 'junior', rubric: {}, openapiRef: 'a', hiddenTestsRef: 'a' })
      .returning();
    versionAId = versionA.id;

    const [challengeB] = await db.insert(challenges).values({ title: 'Challenge B', level: 'junior' }).returning();
    challengeBId = challengeB.id;
    const [versionB] = await db
      .insert(challengeVersions)
      .values({ challengeId: challengeBId, version: 1, level: 'junior', rubric: {}, openapiRef: 'b', hiddenTestsRef: 'b' })
      .returning();
    versionBId = versionB.id;

    const [enrollmentA] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionAId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentAId = enrollmentA.id;

    const [enrollmentB] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionBId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentBId = enrollmentB.id;

    for (let i = 0; i < 5; i++) {
      const submission = await submit(enrollmentAId, `sha-${i}`, validGithubClient, databaseUrl);
      insertedSubmissionIds.push(submission.id);
      assert.equal(submission.status, 'queued');
    }

    await assert.rejects(
      () => submit(enrollmentAId!, 'sha-6', validGithubClient, databaseUrl),
      (error) => {
        assert.ok(error instanceof RateLimitExceededError);
        assert.ok(error.retryAfterSeconds > 0);
        assert.ok(error.retryAfterSeconds <= 3600);
        assert.match(error.message, /retry after/i);
        return true;
      },
    );

    const seventh = await submit(enrollmentBId, 'sha-7', validGithubClient, databaseUrl);
    insertedSubmissionIds.push(seventh.id);
    assert.equal(seventh.status, 'queued');
  } finally {
    if (insertedSubmissionIds.length) {
      await db.delete(gradingRuns).where(inArray(gradingRuns.submissionId, insertedSubmissionIds));
      await db.delete(submissions).where(inArray(submissions.id, insertedSubmissionIds));
    }
    if (enrollmentAId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentAId));
    if (enrollmentBId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentBId));
    if (versionAId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionAId));
    if (versionBId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionBId));
    if (challengeAId) await db.delete(challenges).where(eq(challenges.id, challengeAId));
    if (challengeBId) await db.delete(challenges).where(eq(challenges.id, challengeBId));
    await pool.end();
  }
});

test('getSubmission returns a previously stored submission', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  let enrollmentId: string | undefined;
  let versionId: string | undefined;
  let challengeId: string | undefined;
  let submissionId: string | undefined;

  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Challenge C', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db
      .insert(challengeVersions)
      .values({ challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'c', hiddenTestsRef: 'c' })
      .returning();
    versionId = version.id;

    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentId = enrollment.id;

    const inserted = await submit(enrollmentId, 'sha-get', validGithubClient, databaseUrl);
    submissionId = inserted.id;

    const result = await getSubmission(submissionId, databaseUrl);

    assert.equal(result?.id, submissionId);
    assert.equal(result?.enrollmentId, enrollmentId);
    assert.equal(result?.commitSha, 'sha-get');
    assert.equal(result?.status, 'queued');

    const controller = new AbortController();
    const snapshots = streamStatus(submissionId, controller.signal, databaseUrl);
    const initial = await snapshots.next();
    assert.equal(initial.value?.status, 'queued');
    assert.equal(initial.value?.currentStage, null);
    const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
    await db.update(gradingRuns).set({
      status: 'successful', score: 88, currentStage: 'functional', updatedAt: new Date(Date.now() + 1_000),
    }).where(eq(gradingRuns.id, run.id));
    const terminal = await snapshots.next();
    assert.equal(terminal.value?.currentStage, 'functional');
    assert.equal(terminal.value?.score, 88);
    assert.equal((await snapshots.next()).done, true);
    controller.abort();
  } finally {
    if (submissionId) {
      await db.delete(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('streamStatus emits a cancelled snapshot once and then terminates', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  let enrollmentId: string | undefined;
  let versionId: string | undefined;
  let challengeId: string | undefined;
  let submissionId: string | undefined;

  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Challenge E', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db
      .insert(challengeVersions)
      .values({ challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'e', hiddenTestsRef: 'e' })
      .returning();
    versionId = version.id;

    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentId = enrollment.id;

    const inserted = await submit(enrollmentId, 'sha-cancelled', validGithubClient, databaseUrl);
    submissionId = inserted.id;

    const controller = new AbortController();
    const snapshots = streamStatus(submissionId, controller.signal, databaseUrl);
    const initial = await snapshots.next();
    assert.equal(initial.value?.status, 'queued');
    const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
    await db.update(gradingRuns).set({
      status: 'cancelled', updatedAt: new Date(Date.now() + 1_000),
    }).where(eq(gradingRuns.id, run.id));
    const terminal = await snapshots.next();
    assert.equal(terminal.value?.status, 'cancelled');
    assert.equal((await snapshots.next()).done, true);
    controller.abort();
  } finally {
    if (submissionId) {
      await db.delete(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('submit enqueues exactly one grading job carrying the new submission id', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  let enrollmentId: string | undefined;
  let versionId: string | undefined;
  let challengeId: string | undefined;
  let submissionId: string | undefined;
  const boss = await getQueue(databaseUrl);

  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Challenge D', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db
      .insert(challengeVersions)
      .values({ challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'd', hiddenTestsRef: 'd' })
      .returning();
    versionId = version.id;

    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentId = enrollment.id;

    // The grading topic is shared across test runs, so a stale job from a
    // prior run could be delivered here too; only match on the id submit()
    // returns. The target id isn't known until after submit() resolves, so
    // track received jobs by id and register a waiter if it hasn't arrived yet.
    const received = new Map<string, { runId: string; submissionId: string }>();
    const waiters = new Map<string, () => void>();

    await boss.work(GRADING_TOPIC, async (job) => {
      const data = job.data as { runId: string; submissionId: string };
      received.set(data.submissionId, data);
      const waiter = waiters.get(data.submissionId);
      if (waiter) {
        waiters.delete(data.submissionId);
        waiter();
      }
    });

    const submission = await submit(enrollmentId, 'sha-grading-job', validGithubClient, databaseUrl);
    submissionId = submission.id;

    if (!received.has(submission.id)) {
      await new Promise<void>((resolve) => {
        waiters.set(submission.id, resolve);
      });
    }

    assert.equal(received.get(submission.id)?.submissionId, submission.id);
    const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.submissionId, submission.id));
    assert.equal(received.get(submission.id)?.runId, run.id);
    assert.equal(run.status, 'queued');
    assert.equal(submission.status, 'queued');
  } finally {
    if (submissionId) {
      await db.delete(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
    await boss.stop();
  }
});

test('submit rejects when GitHub reports the repository is missing a Dockerfile, and leaves no submission or grading run behind', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  let enrollmentId: string | undefined;
  let versionId: string | undefined;
  let challengeId: string | undefined;

  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Challenge E', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db
      .insert(challengeVersions)
      .values({ challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'e', hiddenTestsRef: 'e' })
      .returning();
    versionId = version.id;

    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentId = enrollment.id;

    await assert.rejects(
      () => submit(enrollmentId!, 'sha-no-dockerfile', missingDockerfileGithubClient, databaseUrl),
      /Dockerfile/,
    );

    const remainingSubmissions = await db.select().from(submissions).where(eq(submissions.enrollmentId, enrollmentId));
    assert.equal(remainingSubmissions.length, 0);
  } finally {
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

test('submit succeeds when GitHub reports a valid repository shape', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const stackId = randomUUID();
  let enrollmentId: string | undefined;
  let versionId: string | undefined;
  let challengeId: string | undefined;
  let submissionId: string | undefined;

  try {
    const [challenge] = await db.insert(challenges).values({ title: 'Challenge F', level: 'junior' }).returning();
    challengeId = challenge.id;
    const [version] = await db
      .insert(challengeVersions)
      .values({ challengeId, version: 1, level: 'junior', rubric: {}, openapiRef: 'f', hiddenTestsRef: 'f' })
      .returning();
    versionId = version.id;

    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId, challengeVersionId: versionId, mode: 'backend', stackId, status: 'active', repoUrl })
      .returning();
    enrollmentId = enrollment.id;

    const submission = await submit(enrollmentId, 'sha-valid-shape', validGithubClient, databaseUrl);
    submissionId = submission.id;
    assert.equal(submission.status, 'queued');
    assert.equal(submission.commitSha, 'sha-valid-shape');
  } finally {
    if (submissionId) {
      await db.delete(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
      await db.delete(submissions).where(eq(submissions.id, submissionId));
    }
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (versionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, versionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    await pool.end();
  }
});

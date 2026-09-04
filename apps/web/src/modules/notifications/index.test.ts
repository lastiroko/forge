import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import type { User } from '../identity/index.js';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  listForUser,
  markRead,
  notify,
  notifyCommentReceived,
  notifyRunCompleted,
  preferences,
} from './index.js';

const {
  users, challenges, challengeVersions, enrollments, submissions, gradingRuns, solutions, comments,
  notifications, notificationPreferences,
} = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const mailTransport = { sendMail: async () => undefined };

interface Fixture {
  db: ReturnType<typeof createDbClient>['db'];
  owner: User;
  other: User;
  challengeId: string;
  createRun(status: string, score: number | null): Promise<{ runId: string; submissionId: string }>;
  createSolutionComment(authorId: string, body: string): Promise<{ commentId: string; solutionId: string }>;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const enrollmentIds: string[] = [];
  const submissionIds: string[] = [];
  const solutionIds: string[] = [];
  const commentIds: string[] = [];
  const notificationIds: string[] = [];
  const preferenceIds: string[] = [];
  let challengeId: string | undefined;
  let challengeVersionId: string | undefined;

  async function createUser(label: string): Promise<User> {
    const unique = randomUUID();
    const [user] = await db.insert(users).values({
      githubId: Math.floor(Math.random() * 1_000_000_000),
      handle: `notifications-${label}-${unique}`,
      displayName: `Notifications ${label}`,
      email: `notifications-${label}-${unique}@example.com`,
      role: 'member',
    }).returning();
    userIds.push(user.id);
    return user;
  }

  try {
    const owner = await createUser('owner');
    const other = await createUser('other');

    const [challenge] = await db.insert(challenges).values({
      title: `Notifications challenge ${randomUUID()}`,
      level: 'junior',
    }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId,
      version: 1,
      level: 'junior',
      rubric: {},
      openapiRef: 'notifications/openapi.yaml',
      hiddenTestsRef: 'notifications/hidden-tests',
      publishedAt: new Date(),
    }).returning();
    challengeVersionId = version.id;

    async function createRun(status: string, score: number | null) {
      const [enrollment] = await db.insert(enrollments).values({
        userId: owner.id,
        challengeVersionId: version.id,
        mode: 'backend',
        stackId: randomUUID(),
        status: 'active',
      }).returning();
      enrollmentIds.push(enrollment.id);
      const [submission] = await db.insert(submissions).values({
        enrollmentId: enrollment.id,
        commitSha: randomUUID(),
        status: 'graded',
      }).returning();
      submissionIds.push(submission.id);
      const [gradingRun] = await db.insert(gradingRuns).values({ submissionId: submission.id, status, score }).returning();
      return { runId: gradingRun.id, submissionId: submission.id };
    }

    async function createSolutionComment(authorId: string, body: string) {
      const { submissionId } = await createRun('successful', 90);
      const [solution] = await db.insert(solutions).values({
        submissionId,
        title: 'A solution',
        writeup: 'A writeup',
        publishedAt: new Date(),
      }).returning();
      solutionIds.push(solution.id);
      const [insertedComment] = await db.insert(comments).values({
        targetType: 'solution',
        targetId: solution.id,
        authorId,
        body,
      }).returning();
      commentIds.push(insertedComment.id);
      return { commentId: insertedComment.id, solutionId: solution.id };
    }

    await run({ db, owner, other, challengeId, createRun, createSolutionComment });

    const insertedNotifications = await db.select({ id: notifications.id }).from(notifications)
      .where(inArray(notifications.userId, userIds));
    notificationIds.push(...insertedNotifications.map((row) => row.id));
    const insertedPreferences = await db.select({ id: notificationPreferences.id }).from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, userIds));
    preferenceIds.push(...insertedPreferences.map((row) => row.id));
  } finally {
    if (notificationIds.length > 0) await db.delete(notifications).where(inArray(notifications.id, notificationIds));
    if (preferenceIds.length > 0) await db.delete(notificationPreferences).where(inArray(notificationPreferences.id, preferenceIds));
    if (commentIds.length > 0) await db.delete(comments).where(inArray(comments.id, commentIds));
    if (solutionIds.length > 0) await db.delete(solutions).where(inArray(solutions.id, solutionIds));
    if (submissionIds.length > 0) await db.delete(gradingRuns).where(inArray(gradingRuns.submissionId, submissionIds));
    if (submissionIds.length > 0) await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    if (enrollmentIds.length > 0) await db.delete(enrollments).where(inArray(enrollments.id, enrollmentIds));
    if (challengeVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, challengeVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
}

test('notify inserts exactly one unread row with the exact event type and payload', async () => {
  await withFixture(async ({ owner }) => {
    const inserted = await notify(
      owner,
      { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 88 },
      databaseUrl,
    );
    assert.equal(inserted.userId, owner.id);
    assert.equal(inserted.eventType, GRADING_FINISHED_EVENT);
    assert.equal(inserted.readAt, null);
    assert.equal((inserted.payload as { score: number }).score, 88);

    const rows = await listForUser(owner, databaseUrl);
    assert.equal(rows.filter((row) => row.id === inserted.id).length, 1);
  });
});

test('preferences returns only the requested user persisted preferences', async () => {
  await withFixture(async ({ db, owner, other }) => {
    await db.insert(notificationPreferences).values({ userId: owner.id, eventType: GRADING_FINISHED_EVENT, emailEnabled: false });
    await db.insert(notificationPreferences).values({ userId: other.id, eventType: GRADING_FINISHED_EVENT, emailEnabled: true });

    const ownerPreferences = await preferences(owner, databaseUrl);
    assert.equal(ownerPreferences.length, 1);
    assert.equal(ownerPreferences[0].userId, owner.id);
    assert.equal(ownerPreferences[0].emailEnabled, false);
  });
});

test('listForUser excludes another user rows and orders newest first', async () => {
  await withFixture(async ({ owner, other }) => {
    const first = await notify(owner, { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 70 }, databaseUrl);
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    const second = await notify(owner, { type: COMMENT_RECEIVED_EVENT, commentId: randomUUID(), solutionId: randomUUID(), body: 'hi' }, databaseUrl);
    await notify(other, { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 70 }, databaseUrl);

    const rows = await listForUser(owner, databaseUrl);
    assert.deepEqual(rows.map((row) => row.id), [second.id, first.id]);
  });
});

test('markRead marks only requested ids owned by the supplied user', async () => {
  await withFixture(async ({ owner, other }) => {
    const ownerNotification = await notify(owner, { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 70 }, databaseUrl);
    const otherNotification = await notify(other, { type: GRADING_FINISHED_EVENT, runId: randomUUID(), submissionId: randomUUID(), score: 70 }, databaseUrl);

    await markRead(owner, [ownerNotification.id, otherNotification.id], databaseUrl);

    const ownerRows = await listForUser(owner, databaseUrl);
    const otherRows = await listForUser(other, databaseUrl);
    assert.notEqual(ownerRows.find((row) => row.id === ownerNotification.id)?.readAt, null);
    assert.equal(otherRows.find((row) => row.id === otherNotification.id)?.readAt, null);
  });
});

test('notifyRunCompleted resolves the enrollment owner and creates one unread grading_finished row', async () => {
  await withFixture(async ({ owner, createRun }) => {
    const { runId } = await createRun('successful', 92);
    const created = await notifyRunCompleted({ id: runId, score: 92 }, databaseUrl, mailTransport);

    assert.equal(created.userId, owner.id);
    assert.equal(created.eventType, GRADING_FINISHED_EVENT);
    assert.equal(created.readAt, null);
    assert.equal((created.payload as { runId: string }).runId, runId);
    assert.equal((created.payload as { score: number }).score, 92);
  });
});

test('notifyRunCompleted throws when the run has no persisted owner', async () => {
  await assert.rejects(() => notifyRunCompleted({ id: randomUUID(), score: 90 }, databaseUrl), /no owner/);
});

test('notifyCommentReceived resolves the solution owner and creates one unread comment_received row', async () => {
  await withFixture(async ({ owner, other, createSolutionComment }) => {
    const { commentId, solutionId } = await createSolutionComment(other.id, 'Great work');
    const created = await notifyCommentReceived(
      { id: commentId, targetType: 'solution', targetId: solutionId, authorId: other.id, body: 'Great work' },
      databaseUrl,
      mailTransport,
    );

    assert.ok(created);
    assert.equal(created?.userId, owner.id);
    assert.equal(created?.eventType, COMMENT_RECEIVED_EVENT);
    assert.equal(created?.readAt, null);
    assert.equal((created?.payload as { commentId: string }).commentId, commentId);
  });
});

test('notifyCommentReceived ignores challenge comments and self-comments', async () => {
  await withFixture(async ({ owner, challengeId, createSolutionComment }) => {
    const challengeResult = await notifyCommentReceived(
      { id: randomUUID(), targetType: 'challenge', targetId: challengeId, authorId: owner.id, body: 'Challenge feedback' },
      databaseUrl,
      mailTransport,
    );
    assert.equal(challengeResult, undefined);

    const { commentId, solutionId } = await createSolutionComment(owner.id, 'Self comment');
    const selfResult = await notifyCommentReceived(
      { id: commentId, targetType: 'solution', targetId: solutionId, authorId: owner.id, body: 'Self comment' },
      databaseUrl,
      mailTransport,
    );
    assert.equal(selfResult, undefined);
  });
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  type MailTransport,
  notifyCommentReceived,
  notifyRunCompleted,
  setEmailPreference,
} from './index.js';

const {
  users, challenges, challengeVersions, enrollments, submissions, gradingRuns, solutions, comments,
  notifications, notificationPreferences,
} = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('event email delivery uses the owner email and independent preferences while retaining in-app rows', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const ids: Record<string, string[]> = {
    users: [], challenges: [], versions: [], enrollments: [], submissions: [], solutions: [], comments: [],
  };
  const messages: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const transport: MailTransport = { async sendMail(message) { messages.push(message); } };

  try {
    const [owner, other] = await db.insert(users).values([
      { githubId: Date.now(), handle: `email-owner-${randomUUID()}`, displayName: 'Owner', email: `owner-${randomUUID()}@example.com`, role: 'member' },
      { githubId: Date.now() + 1, handle: `email-other-${randomUUID()}`, displayName: 'Other', email: `other-${randomUUID()}@example.com`, role: 'member' },
    ]).returning();
    ids.users.push(owner.id, other.id);
    const [challenge] = await db.insert(challenges).values({ title: `Email ${randomUUID()}`, level: 'junior' }).returning();
    ids.challenges.push(challenge.id);
    const [version] = await db.insert(challengeVersions).values({
      challengeId: challenge.id, version: 1, level: 'junior', rubric: {}, openapiRef: 'email/openapi.yaml',
      hiddenTestsRef: 'email/hidden', publishedAt: new Date(),
    }).returning();
    ids.versions.push(version.id);

    async function createRun() {
      const [enrollment] = await db.insert(enrollments).values({
        userId: owner.id, challengeVersionId: version.id, mode: 'backend', stackId: randomUUID(), status: 'active',
      }).returning();
      ids.enrollments.push(enrollment.id);
      const [submission] = await db.insert(submissions).values({ enrollmentId: enrollment.id, commitSha: randomUUID(), status: 'graded' }).returning();
      ids.submissions.push(submission.id);
      const [run] = await db.insert(gradingRuns).values({ submissionId: submission.id, status: 'successful', score: 91 }).returning();
      return { run, submission };
    }

    const first = await createRun();
    await notifyRunCompleted({ id: first.run.id, score: 91 }, databaseUrl, transport);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, owner.email);
    assert.equal(messages[0].subject, 'Your Forge grading run is finished');

    await setEmailPreference(owner, GRADING_FINISHED_EVENT, true, databaseUrl);
    const second = await createRun();
    await notifyRunCompleted({ id: second.run.id, score: 91 }, databaseUrl, transport);
    assert.equal(messages.length, 2);

    await setEmailPreference(owner, GRADING_FINISHED_EVENT, false, databaseUrl);
    const third = await createRun();
    await notifyRunCompleted({ id: third.run.id, score: 91 }, databaseUrl, transport);
    assert.equal(messages.length, 2);
    const disabledRows = await db.select().from(notifications).where(eq(notifications.userId, owner.id));
    assert.equal(disabledRows.filter((row) => row.eventType === GRADING_FINISHED_EVENT).length, 3);

    const commentRun = await createRun();
    const [solution] = await db.insert(solutions).values({
      submissionId: commentRun.submission.id, title: 'Email solution', writeup: 'Writeup', publishedAt: new Date(),
    }).returning();
    ids.solutions.push(solution.id);

    async function sendComment(authorId: string, targetType = 'solution') {
      const [comment] = await db.insert(comments).values({ targetType, targetId: solution.id, authorId, body: 'Helpful feedback' }).returning();
      ids.comments.push(comment.id);
      return notifyCommentReceived(
        { id: comment.id, targetType, targetId: solution.id, authorId, body: comment.body },
        databaseUrl,
        transport,
      );
    }

    await sendComment(other.id);
    assert.equal(messages.length, 3);
    assert.equal(messages[2].to, owner.email);
    assert.equal(messages[2].subject, 'New comment on your Forge solution');
    await setEmailPreference(owner, COMMENT_RECEIVED_EVENT, false, databaseUrl);
    await sendComment(other.id);
    assert.equal(messages.length, 3);
    assert.ok((await db.select().from(notifications).where(eq(notifications.userId, owner.id)))
      .some((row) => row.eventType === COMMENT_RECEIVED_EVENT));

    assert.equal(await sendComment(owner.id), undefined);
    assert.equal(await sendComment(other.id, 'challenge'), undefined);
    assert.equal(messages.length, 3);
  } finally {
    if (ids.users.length) await db.delete(notifications).where(inArray(notifications.userId, ids.users));
    if (ids.users.length) await db.delete(notificationPreferences).where(inArray(notificationPreferences.userId, ids.users));
    if (ids.comments.length) await db.delete(comments).where(inArray(comments.id, ids.comments));
    if (ids.solutions.length) await db.delete(solutions).where(inArray(solutions.id, ids.solutions));
    if (ids.submissions.length) await db.delete(gradingRuns).where(inArray(gradingRuns.submissionId, ids.submissions));
    if (ids.submissions.length) await db.delete(submissions).where(inArray(submissions.id, ids.submissions));
    if (ids.enrollments.length) await db.delete(enrollments).where(inArray(enrollments.id, ids.enrollments));
    if (ids.versions.length) await db.delete(challengeVersions).where(inArray(challengeVersions.id, ids.versions));
    if (ids.challenges.length) await db.delete(challenges).where(inArray(challenges.id, ids.challenges));
    if (ids.users.length) await db.delete(users).where(inArray(users.id, ids.users));
    await pool.end();
  }
});

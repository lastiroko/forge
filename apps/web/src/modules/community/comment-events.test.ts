import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import {
  createSession,
  SESSION_COOKIE,
  type SessionCookieReader,
  type User,
} from '../identity/index.js';
import { comment, onCommentReceived, publish, type Comment } from './index.js';

const {
  users, sessions, challenges, challengeVersions, enrollments, submissions, gradingRuns, solutions, comments,
} = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStoreFor(sessionId: string): SessionCookieReader {
  return { get: (name: string) => (name === SESSION_COOKIE ? { value: sessionId } : undefined) };
}

interface Fixture {
  challengeId: string;
  ownerCookies: SessionCookieReader;
  solutionId: string;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  let enrollmentId: string | undefined;
  let submissionId: string | undefined;
  let challengeId: string | undefined;
  let challengeVersionId: string | undefined;
  let solutionId: string | undefined;

  try {
    const unique = randomUUID();
    const [owner] = await db.insert(users).values({
      githubId: Math.floor(Math.random() * 1_000_000_000),
      handle: `comment-events-${unique}`,
      displayName: 'Comment Events Owner',
      email: `comment-events-${unique}@example.com`,
      role: 'member',
    }).returning();
    userIds.push(owner.id);
    const session = await createSession(owner.id, databaseUrl);
    sessionIds.push(session.id);
    const ownerCookies = cookieStoreFor(session.id);

    const [challenge] = await db.insert(challenges).values({
      title: `Comment events challenge ${unique}`,
      level: 'junior',
    }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId,
      version: 1,
      level: 'junior',
      rubric: {},
      openapiRef: 'comment-events/openapi.yaml',
      hiddenTestsRef: 'comment-events/hidden-tests',
      publishedAt: new Date(),
    }).returning();
    challengeVersionId = version.id;

    const [enrollment] = await db.insert(enrollments).values({
      userId: owner.id,
      challengeVersionId: version.id,
      mode: 'backend',
      stackId: randomUUID(),
      status: 'active',
    }).returning();
    enrollmentId = enrollment.id;
    const [submission] = await db.insert(submissions).values({
      enrollmentId: enrollment.id,
      commitSha: randomUUID(),
      status: 'graded',
    }).returning();
    submissionId = submission.id;
    await db.insert(gradingRuns).values({ submissionId: submission.id, status: 'successful', score: 90 });

    const solution = await publish(submission, 'Comment events solution', 'Writeup', ownerCookies, databaseUrl);
    solutionId = solution.id;

    await run({ challengeId, ownerCookies, solutionId });
  } finally {
    if (solutionId) {
      await db.delete(comments).where(inArray(comments.targetId, challengeId ? [solutionId, challengeId] : [solutionId]));
      await db.delete(solutions).where(eq(solutions.id, solutionId));
    }
    if (submissionId) await db.delete(gradingRuns).where(eq(gradingRuns.submissionId, submissionId));
    if (submissionId) await db.delete(submissions).where(eq(submissions.id, submissionId));
    if (enrollmentId) await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    if (challengeVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, challengeVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    if (sessionIds.length > 0) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
}

test('notifies a subscribed handler once per solution comment, not for challenge comments, and stops after unsubscribe', async () => {
  await withFixture(async ({ challengeId, ownerCookies, solutionId }) => {
    const received: Comment[] = [];
    const unsubscribe = onCommentReceived((received_) => { received.push(received_); });

    try {
      const solutionComment = await comment({ type: 'solution', id: solutionId }, 'Nice work', ownerCookies, databaseUrl);
      assert.equal(received.length, 1);
      assert.equal(received[0].id, solutionComment.id);
      assert.equal(received[0].targetType, 'solution');
      assert.equal(received[0].targetId, solutionId);

      await comment({ type: 'challenge', id: challengeId }, 'Challenge feedback', ownerCookies, databaseUrl);
      assert.equal(received.length, 1);

      unsubscribe();
      await comment({ type: 'solution', id: solutionId }, 'Later comment', ownerCookies, databaseUrl);
      assert.equal(received.length, 1);
    } finally {
      unsubscribe();
    }
  });
});

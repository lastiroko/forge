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
import { comment, publish, report, type CommentTarget, type ReportTarget } from './index.js';

const {
  users,
  sessions,
  challenges,
  challengeVersions,
  enrollments,
  submissions,
  gradingRuns,
  solutions,
  comments,
  reports,
} = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

function cookieStoreFor(sessionId: string | undefined): SessionCookieReader {
  return {
    get: (name: string) => (sessionId !== undefined && name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };
}

interface Fixture {
  db: ReturnType<typeof createDbClient>['db'];
  challengeId: string;
  owner: User;
  other: User;
  ownerCookies: SessionCookieReader;
  otherCookies: SessionCookieReader;
  createSubmission(userId: string, status: string, score: number | null): Promise<typeof submissions.$inferSelect>;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  const enrollmentIds: string[] = [];
  const submissionIds: string[] = [];
  let challengeId: string | undefined;
  let challengeVersionId: string | undefined;

  async function createUser(label: string): Promise<{ user: User; cookies: SessionCookieReader }> {
    const unique = randomUUID();
    const [user] = await db.insert(users).values({
      githubId: Math.floor(Math.random() * 1_000_000_000),
      handle: `community-${label}-${unique}`,
      displayName: `Community ${label}`,
      email: `community-${label}-${unique}@example.com`,
      role: 'member',
    }).returning();
    userIds.push(user.id);
    const session = await createSession(user.id, databaseUrl);
    sessionIds.push(session.id);
    return { user, cookies: cookieStoreFor(session.id) };
  }

  try {
    const owner = await createUser('owner');
    const other = await createUser('other');
    const [challenge] = await db.insert(challenges).values({
      title: `Community challenge ${randomUUID()}`,
      level: 'junior',
    }).returning();
    challengeId = challenge.id;
    const [version] = await db.insert(challengeVersions).values({
      challengeId,
      version: 1,
      level: 'junior',
      rubric: {},
      openapiRef: 'community/openapi.yaml',
      hiddenTestsRef: 'community/hidden-tests',
      publishedAt: new Date(),
    }).returning();
    challengeVersionId = version.id;

    async function createSubmission(userId: string, status: string, score: number | null) {
      const [enrollment] = await db.insert(enrollments).values({
        userId,
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
      await db.insert(gradingRuns).values({ submissionId: submission.id, status, score });
      return submission;
    }

    await run({
      db,
      challengeId,
      owner: owner.user,
      other: other.user,
      ownerCookies: owner.cookies,
      otherCookies: other.cookies,
      createSubmission,
    });
  } finally {
    if (submissionIds.length > 0) {
      const solutionRows = await db.select({ id: solutions.id }).from(solutions)
        .where(inArray(solutions.submissionId, submissionIds));
      const solutionIds = solutionRows.map((row) => row.id);
      if (solutionIds.length > 0) {
        const commentRows = await db.select({ id: comments.id }).from(comments)
          .where(inArray(comments.targetId, solutionIds));
        const commentIds = commentRows.map((row) => row.id);
        if (commentIds.length > 0) {
          await db.delete(reports).where(inArray(reports.targetId, commentIds));
        }
        await db.delete(reports).where(inArray(reports.targetId, solutionIds));
        await db.delete(comments).where(inArray(comments.targetId, solutionIds));
        await db.delete(comments).where(inArray(comments.id, commentIds));
        await db.delete(solutions).where(inArray(solutions.id, solutionIds));
      }
      if (challengeId) {
        await db.delete(comments).where(eq(comments.targetId, challengeId));
      }
      await db.delete(gradingRuns).where(inArray(gradingRuns.submissionId, submissionIds));
      await db.delete(submissions).where(inArray(submissions.id, submissionIds));
    }
    if (enrollmentIds.length > 0) await db.delete(enrollments).where(inArray(enrollments.id, enrollmentIds));
    if (challengeVersionId) await db.delete(challengeVersions).where(eq(challengeVersions.id, challengeVersionId));
    if (challengeId) await db.delete(challenges).where(eq(challenges.id, challengeId));
    if (sessionIds.length > 0) await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await pool.end();
  }
}

test('publishes the owner submission with a successful score of exactly 70', async () => {
  await withFixture(async ({ db, owner, ownerCookies, createSubmission }) => {
    const submission = await createSubmission(owner.id, 'successful', 70);
    const solution = await publish(submission, 'At the threshold', 'A complete writeup', ownerCookies, databaseUrl);
    const rows = await db.select().from(solutions).where(eq(solutions.submissionId, submission.id));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, solution.id);
    assert.equal(rows[0].title, 'At the threshold');
    assert.equal(rows[0].writeup, 'A complete writeup');
    assert.ok(rows[0].publishedAt instanceof Date);
  });
});

test('rejects publishing a below-threshold submission without inserting a solution', async () => {
  await withFixture(async ({ db, owner, ownerCookies, createSubmission }) => {
    const submission = await createSubmission(owner.id, 'successful', 69.99);
    await assert.rejects(() => publish(submission, 'Too low', 'Not complete', ownerCookies, databaseUrl), /not completed/);
    assert.equal((await db.select().from(solutions).where(eq(solutions.submissionId, submission.id))).length, 0);
  });
});

test('rejects another owner, a missing session, and an incomplete latest run', async () => {
  await withFixture(async ({ db, owner, ownerCookies, otherCookies, createSubmission }) => {
    const owned = await createSubmission(owner.id, 'successful', 95);
    await assert.rejects(() => publish(owned, 'Wrong owner', 'No', otherCookies, databaseUrl), /does not belong/);
    await assert.rejects(() => publish(owned, 'No session', 'No', cookieStoreFor(undefined), databaseUrl));

    const incomplete = await createSubmission(owner.id, 'queued', null);
    await assert.rejects(() => publish(incomplete, 'Queued', 'No', ownerCookies, databaseUrl), /not completed/);
    assert.equal((await db.select().from(solutions).where(inArray(solutions.submissionId, [owned.id, incomplete.id]))).length, 0);
  });
});

test('uses the latest grading run to determine whether publishing is complete', async () => {
  await withFixture(async ({ db, owner, ownerCookies, createSubmission }) => {
    const submission = await createSubmission(owner.id, 'successful', 90);
    await db.insert(gradingRuns).values({
      submissionId: submission.id,
      status: 'failed',
      score: null,
      createdAt: new Date(Date.now() + 1_000),
    });

    await assert.rejects(() => publish(submission, 'Stale result', 'No', ownerCookies, databaseUrl), /not completed/);
    assert.equal((await db.select().from(solutions).where(eq(solutions.submissionId, submission.id))).length, 0);
  });
});

test('rejects duplicate publication and keeps exactly one solution', async () => {
  await withFixture(async ({ db, owner, ownerCookies, createSubmission }) => {
    const submission = await createSubmission(owner.id, 'successful', 88);
    await publish(submission, 'First', 'First writeup', ownerCookies, databaseUrl);
    await assert.rejects(() => publish(submission, 'Second', 'Second writeup', ownerCookies, databaseUrl));
    const rows = await db.select().from(solutions).where(eq(solutions.submissionId, submission.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'First');
  });
});

test('comments on solutions and challenges and reports solutions and comments', async () => {
  await withFixture(async ({ db, owner, ownerCookies, challengeId, createSubmission }) => {
    const submission = await createSubmission(owner.id, 'successful', 91);
    const solution = await publish(submission, 'Target solution', 'Target writeup', ownerCookies, databaseUrl);
    const solutionComment = await comment(
      { type: 'solution', id: solution.id },
      'Solution feedback',
      ownerCookies,
      databaseUrl,
    );
    const challengeComment = await comment(
      { type: 'challenge', id: challengeId },
      'Challenge feedback',
      ownerCookies,
      databaseUrl,
    );
    const solutionReport = await report(
      { type: 'solution', id: solution.id },
      'Solution reason',
      ownerCookies,
      databaseUrl,
    );
    const commentReport = await report(
      { type: 'comment', id: solutionComment.id },
      'Comment reason',
      ownerCookies,
      databaseUrl,
    );
    const [storedSolutionComment] = await db.select().from(comments).where(eq(comments.id, solutionComment.id));
    const [storedChallengeComment] = await db.select().from(comments).where(eq(comments.id, challengeComment.id));
    const [storedSolutionReport] = await db.select().from(reports).where(eq(reports.id, solutionReport.id));
    const [storedCommentReport] = await db.select().from(reports).where(eq(reports.id, commentReport.id));

    assert.deepEqual(
      [storedSolutionComment.targetType, storedSolutionComment.targetId, storedSolutionComment.authorId, storedSolutionComment.body],
      ['solution', solution.id, owner.id, 'Solution feedback'],
    );
    assert.deepEqual(
      [storedChallengeComment.targetType, storedChallengeComment.targetId, storedChallengeComment.authorId, storedChallengeComment.body],
      ['challenge', challengeId, owner.id, 'Challenge feedback'],
    );
    assert.deepEqual(
      [storedSolutionReport.targetType, storedSolutionReport.targetId, storedSolutionReport.reporterId, storedSolutionReport.reason],
      ['solution', solution.id, owner.id, 'Solution reason'],
    );
    assert.deepEqual(
      [storedCommentReport.targetType, storedCommentReport.targetId, storedCommentReport.reporterId, storedCommentReport.reason],
      ['comment', solutionComment.id, owner.id, 'Comment reason'],
    );
  });
});

test('rejects nonexistent and unsupported community targets without inserting rows', async () => {
  await withFixture(async ({ db, ownerCookies }) => {
    await assert.rejects(() => comment({ type: 'solution', id: randomUUID() }, 'Missing', ownerCookies, databaseUrl), /no solution/);
    await assert.rejects(() => comment({ type: 'challenge', id: randomUUID() }, 'Missing', ownerCookies, databaseUrl), /no challenge/);
    await assert.rejects(() => report({ type: 'solution', id: randomUUID() }, 'Missing', ownerCookies, databaseUrl), /no solution/);
    await assert.rejects(() => report({ type: 'comment', id: randomUUID() }, 'Missing', ownerCookies, databaseUrl), /no comment/);
    await assert.rejects(() => comment({ type: 'comment', id: randomUUID() } as unknown as CommentTarget, 'Unsupported', ownerCookies, databaseUrl), /unsupported/);
    await assert.rejects(() => report({ type: 'challenge', id: randomUUID() } as unknown as ReportTarget, 'Unsupported', ownerCookies, databaseUrl), /unsupported/);
    assert.equal((await db.select().from(comments)).filter((row) => row.body === 'Missing' || row.body === 'Unsupported').length, 0);
    assert.equal((await db.select().from(reports)).filter((row) => row.reason === 'Missing' || row.reason === 'Unsupported').length, 0);
  });
});

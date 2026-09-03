import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, SESSION_COOKIE } from '../../modules/identity/index.js';
import { commentAction } from '../comment-actions.js';
import { appendComment, Comments, submitComment } from '../Comments.js';
import type { Comment } from '../../modules/community/index.js';

const {
  users, sessions, challenges, challengeVersions, enrollments, submissions, gradingRuns, solutions, comments,
} = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3423;
const { db, pool } = createDbClient(databaseUrl);

const ids: Record<string, string[]> = {
  users: [], sessions: [], challenges: [], versions: [], enrollments: [], submissions: [], runs: [], solutions: [], comments: [],
};
let server: ChildProcess | undefined;
let memberSessionId: string | undefined;
let publishedSolutionId: string | undefined;
let unpublishedSolutionId: string | undefined;
let repoUrl: string | undefined;
let commentActionId: string | undefined;

async function postCommentAction(
  target: { type: 'solution' | 'challenge'; id: string },
  body: string,
  sessionId?: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/solutions/${publishedSolutionId}`, {
    method: 'POST',
    headers: {
      Accept: 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Next-Action': commentActionId as string,
      ...(sessionId ? { Cookie: `${SESSION_COOKIE}=${sessionId}` } : {}),
    },
    body: JSON.stringify([target, body]),
  });
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

async function findCommentAction(
  directory: string,
  candidates: string[],
): Promise<{ id: string; distance: number } | undefined> {
  let closest: { id: string; distance: number } | undefined;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findCommentAction(entryPath, candidates);
      if (nested && (!closest || nested.distance < closest.distance)) closest = nested;
    } else if (entry.name.endsWith('.js')) {
      const source = await readFile(entryPath, 'utf-8');
      const exportPosition = source.indexOf('Comment cannot be empty.');
      if (exportPosition !== -1) {
        for (const id of candidates) {
          const idPosition = source.indexOf(id);
          if (idPosition !== -1 && (!closest || Math.abs(idPosition - exportPosition) < closest.distance)) {
            closest = { id, distance: Math.abs(idPosition - exportPosition) };
          }
        }
      }
    }
  }
  return closest;
}

before(async () => {
  const [member] = await db.insert(users).values({
    githubId: Math.floor(Math.random() * 1_000_000_000),
    handle: `solutions-page-member-${randomUUID()}`,
    displayName: 'Solutions Page Member',
    email: `solutions-page-${randomUUID()}@example.com`,
    role: 'member',
  }).returning();
  ids.users.push(member.id);
  const session = await createSession(member.id, databaseUrl);
  ids.sessions.push(session.id);
  memberSessionId = session.id;

  const [challenge] = await db.insert(challenges).values({
    title: `Solutions page challenge ${randomUUID()}`, level: 'junior',
  }).returning();
  ids.challenges.push(challenge.id);
  const [version] = await db.insert(challengeVersions).values({
    challengeId: challenge.id, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1', publishedAt: new Date(),
  }).returning();
  ids.versions.push(version.id);

  repoUrl = 'https://github.com/example/solutions-page-fixture';
  const [publishedEnrollment] = await db.insert(enrollments).values({
    userId: member.id, challengeVersionId: version.id, mode: 'backend', stackId: randomUUID(), repoUrl, status: 'completed',
  }).returning();
  ids.enrollments.push(publishedEnrollment.id);
  const [publishedSubmission] = await db.insert(submissions).values({
    enrollmentId: publishedEnrollment.id, commitSha: randomUUID(), status: 'graded',
  }).returning();
  ids.submissions.push(publishedSubmission.id);

  const [staleRun] = await db.insert(gradingRuns).values({
    submissionId: publishedSubmission.id, status: 'successful', score: 71, createdAt: new Date(Date.now() - 60_000),
  }).returning();
  ids.runs.push(staleRun.id);
  const [latestRun] = await db.insert(gradingRuns).values({
    submissionId: publishedSubmission.id, status: 'successful', score: 93.5, reportUrl: 'https://reports.example.com/latest',
  }).returning();
  ids.runs.push(latestRun.id);

  const [published] = await db.insert(solutions).values({
    submissionId: publishedSubmission.id,
    title: 'Published Gallery Solution',
    writeup: 'The write-up for the published fixture.',
    publishedAt: new Date(),
  }).returning();
  ids.solutions.push(published.id);
  publishedSolutionId = published.id;
  const insertedComments = await db.insert(comments).values([
    { targetType: 'solution', targetId: published.id, authorId: member.id, body: 'Earlier solution comment', createdAt: new Date('2026-01-02T00:00:00Z') },
    { targetType: 'solution', targetId: published.id, authorId: member.id, body: 'Later solution comment', createdAt: new Date('2026-01-03T00:00:00Z') },
  ]).returning();
  ids.comments.push(...insertedComments.map((comment) => comment.id));

  const [unpublishedEnrollment] = await db.insert(enrollments).values({
    userId: member.id, challengeVersionId: version.id, mode: 'backend', stackId: randomUUID(), status: 'completed',
  }).returning();
  ids.enrollments.push(unpublishedEnrollment.id);
  const [unpublishedSubmission] = await db.insert(submissions).values({
    enrollmentId: unpublishedEnrollment.id, commitSha: randomUUID(), status: 'graded',
  }).returning();
  ids.submissions.push(unpublishedSubmission.id);
  const [unpublishedRun] = await db.insert(gradingRuns).values({
    submissionId: unpublishedSubmission.id, status: 'successful', score: 80,
  }).returning();
  ids.runs.push(unpublishedRun.id);
  const [unpublished] = await db.insert(solutions).values({
    submissionId: unpublishedSubmission.id,
    title: 'Unpublished Gallery Solution',
    writeup: 'Not yet published.',
    publishedAt: null,
  }).returning();
  ids.solutions.push(unpublished.id);
  unpublishedSolutionId = unpublished.id;

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  const actionManifest = JSON.parse(await readFile(
    path.join(webRoot, '.next', 'server', 'server-reference-manifest.json'),
    'utf-8',
  )) as { node: Record<string, { workers: Record<string, unknown> }> };
  const pageActionIds = Object.entries(actionManifest.node)
    .filter(([, action]) => Object.hasOwn(action.workers, 'app/solutions/[id]/page'))
    .map(([id]) => id);
  commentActionId = (await findCommentAction(path.join(webRoot, '.next', 'server'), pageActionIds))?.id;
  assert.ok(commentActionId, 'expected the commentAction export in the solution page manifest');
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/solutions`);
});

after(async () => {
  if (server) server.kill();
  for (const id of ids.comments) await db.delete(comments).where(eq(comments.id, id));
  for (const id of ids.runs) await db.delete(gradingRuns).where(eq(gradingRuns.id, id));
  for (const id of ids.solutions) await db.delete(solutions).where(eq(solutions.id, id));
  for (const id of ids.submissions) await db.delete(submissions).where(eq(submissions.id, id));
  for (const id of ids.enrollments) await db.delete(enrollments).where(eq(enrollments.id, id));
  for (const id of ids.versions) await db.delete(challengeVersions).where(eq(challengeVersions.id, id));
  for (const id of ids.challenges) await db.delete(challenges).where(eq(challenges.id, id));
  for (const id of ids.sessions) await db.delete(sessions).where(eq(sessions.id, id));
  for (const id of ids.users) await db.delete(users).where(eq(users.id, id));
  await pool.end();
});

test('GET /solutions lists only published solution titles for a signed-in member', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/solutions`, {
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` },
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Published Gallery Solution'));
  assert.ok(body.includes(`/solutions/${publishedSolutionId}`));
  assert.ok(!body.includes('Unpublished Gallery Solution'));
});

test('GET /solutions/:id shows the write-up, repository link, latest score, and report link', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/solutions/${publishedSolutionId}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` },
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(body.includes('Published Gallery Solution'));
  assert.ok(body.includes('The write-up for the published fixture.'));
  assert.ok(body.includes(repoUrl as string));
  assert.ok(body.includes('93.5'));
  assert.ok(body.includes('https://reports.example.com/latest'));
  assert.ok(body.indexOf('Earlier solution comment') < body.indexOf('Later solution comment'));
  assert.ok(body.includes('Add a comment'));
  assert.ok(body.includes('Post comment'));
});

test('GET /solutions/:id returns 404 for an unpublished solution', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/solutions/${unpublishedSolutionId}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` },
  });
  assert.equal(res.status, 404);
});

test('GET /solutions/:id returns 404 for an unknown solution id', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/solutions/${randomUUID()}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` },
  });
  assert.equal(res.status, 404);
});

test('GET /solutions rejects signed-out visitors while published detail remains public without a form', async () => {
  const galleryRes = await fetch(`http://127.0.0.1:${port}/solutions`);
  const galleryBody = await galleryRes.text();
  assert.equal(galleryRes.status, 404);
  assert.ok(!galleryBody.includes('Published Gallery Solution'));

  const detailRes = await fetch(`http://127.0.0.1:${port}/solutions/${publishedSolutionId}`);
  const detailBody = await detailRes.text();
  assert.equal(detailRes.status, 200);
  assert.ok(detailBody.includes('The write-up for the published fixture.'));
  assert.ok(detailBody.indexOf('Earlier solution comment') < detailBody.indexOf('Later solution comment'));
  assert.ok(!detailBody.includes('Add a comment'));
  assert.ok(!detailBody.includes('Post comment'));
});

test('comment action rejects whitespace with a stable validation message without inserting a row', async () => {
  const before = await db.select().from(comments).where(eq(comments.targetId, publishedSolutionId as string));

  await assert.rejects(
    () => commentAction({ type: 'solution', id: publishedSolutionId as string }, '   \n '),
    { message: 'Comment cannot be empty.' },
  );

  const after = await db.select().from(comments).where(eq(comments.targetId, publishedSolutionId as string));
  assert.equal(after.length, before.length);
});

test('comment action authorizes members and inserts trimmed solution and challenge comments', async () => {
  const unique = randomUUID();
  const solutionBody = `Live solution comment ${unique}`;
  const challengeBody = `Live challenge comment ${unique}`;
  const solutionResponse = await postCommentAction(
    { type: 'solution', id: publishedSolutionId as string },
    `  ${solutionBody}  `,
    memberSessionId,
  );
  assert.equal(solutionResponse.status, 200);
  assert.ok((await solutionResponse.text()).includes(solutionBody));

  const challengeResponse = await postCommentAction(
    { type: 'challenge', id: ids.challenges[0] },
    challengeBody,
    memberSessionId,
  );
  assert.equal(challengeResponse.status, 200);
  assert.ok((await challengeResponse.text()).includes(challengeBody));

  const inserted = (await db.select().from(comments))
    .filter((row) => row.body === solutionBody || row.body === challengeBody);
  ids.comments.push(...inserted.map((comment) => comment.id));
  assert.equal(inserted.length, 2);
  const solutionComment = inserted.find((comment) => comment.body === solutionBody);
  assert.deepEqual(
    [solutionComment?.targetType, solutionComment?.targetId, solutionComment?.authorId],
    ['solution', publishedSolutionId, ids.users[0]],
  );
  const challengeComment = inserted.find((comment) => comment.body === challengeBody);
  assert.deepEqual(
    [challengeComment?.targetType, challengeComment?.targetId, challengeComment?.authorId],
    ['challenge', ids.challenges[0], ids.users[0]],
  );
});

test('comment action rejects a signed-out submission without inserting a row', async () => {
  const body = `Rejected signed-out comment ${randomUUID()}`;
  const response = await postCommentAction(
    { type: 'solution', id: publishedSolutionId as string },
    body,
  );

  assert.equal(response.status, 500);
  const inserted = (await db.select().from(comments)).filter((row) => row.body === body);
  assert.equal(inserted.length, 0);
});

test('appending a returned comment preserves existing comments and places it last', () => {
  const existing: Comment[] = [{
    id: randomUUID(),
    targetType: 'solution',
    targetId: publishedSolutionId as string,
    authorId: randomUUID(),
    body: 'Existing',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }];
  const inserted: Comment = {
    id: randomUUID(),
    targetType: 'solution',
    targetId: publishedSolutionId as string,
    authorId: randomUUID(),
    body: 'Inserted',
    createdAt: new Date('2026-01-02T00:00:00Z'),
  };

  const displayed = appendComment(existing, inserted);

  assert.deepEqual(displayed, [existing[0], inserted]);
  assert.notEqual(displayed, existing);
});

for (const targetType of ['solution', 'challenge'] as const) {
  test(`successful ${targetType} component submission appends visibly and clears without navigation`, async () => {
    const existing: Comment[] = [{
      id: randomUUID(),
      targetType,
      targetId: randomUUID(),
      authorId: randomUUID(),
      body: 'Already visible',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }];
    const inserted: Comment = {
      ...existing[0],
      id: randomUUID(),
      body: `New ${targetType} comment`,
      createdAt: new Date('2026-01-02T00:00:00Z'),
    };
    let displayed = existing;
    let draft = `Draft ${targetType} comment`;
    let failure: string | undefined;
    let actionCalls = 0;
    const target = { type: targetType, id: inserted.targetId };
    const initialMarkup = renderToStaticMarkup(createElement(Comments, {
      target,
      initialComments: displayed,
      isSignedIn: true,
    }));
    assert.ok(initialMarkup.includes('Already visible'));
    assert.ok(!initialMarkup.includes(inserted.body));

    await submitComment(
      target,
      draft,
      async (target, body) => {
        actionCalls += 1;
        assert.deepEqual(target, { type: targetType, id: inserted.targetId });
        assert.equal(body, draft);
        return inserted;
      },
      {
        append: (comment) => { displayed = appendComment(displayed, comment); },
        clear: () => { draft = ''; },
        fail: (message) => { failure = message; },
      },
    );

    assert.equal(actionCalls, 1);
    assert.deepEqual(displayed, [existing[0], inserted]);
    assert.equal(draft, '');
    assert.equal(failure, undefined);
    const updatedMarkup = renderToStaticMarkup(createElement(Comments, {
      target,
      initialComments: displayed,
      isSignedIn: true,
    }));
    assert.ok(updatedMarkup.indexOf('Already visible') < updatedMarkup.indexOf(inserted.body));
    assert.match(updatedMarkup, /<textarea[^>]*><\/textarea>/);
  });
}

test('failed component submission retains its draft and exposes the action error', async () => {
  let draft = 'Keep this draft';
  let failure: string | undefined;

  await submitComment(
    { type: 'solution', id: randomUUID() },
    draft,
    async () => { throw new Error('Comment cannot be empty.'); },
    {
      append: () => assert.fail('a failed submission must not append'),
      clear: () => { draft = ''; },
      fail: (message) => { failure = message; },
    },
  );

  assert.equal(draft, 'Keep this draft');
  assert.equal(failure, 'Comment cannot be empty.');
});

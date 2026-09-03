import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, SESSION_COOKIE } from '../modules/identity/index.js';
import { reportAction } from './report-actions.js';
import { submitReport } from './ReportForm.js';
import type { Report } from '../modules/community/index.js';

const {
  users, sessions, challenges, challengeVersions, enrollments, submissions, gradingRuns, solutions, comments, reports,
} = schema;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const port = 3425;
const { db, pool } = createDbClient(databaseUrl);

const ids: Record<string, string[]> = {
  users: [], sessions: [], challenges: [], versions: [], enrollments: [], submissions: [], runs: [], solutions: [], comments: [], reports: [],
};
let server: ChildProcess | undefined;
let fixtureServer: Server | undefined;
let fixtureUrl: string | undefined;
let memberSessionId: string | undefined;
let memberId: string | undefined;
let publishedSolutionId: string | undefined;
let challengeId: string | undefined;
let solutionCommentId: string | undefined;
let challengeCommentId: string | undefined;
let reportActionId: string | undefined;

async function postReportAction(
  pagePath: string,
  target: { type: 'solution' | 'comment'; id: string },
  reason: string,
  sessionId?: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${pagePath}`, {
    method: 'POST',
    headers: {
      Accept: 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Next-Action': reportActionId as string,
      ...(sessionId ? { Cookie: `${SESSION_COOKIE}=${sessionId}` } : {}),
    },
    body: JSON.stringify([target, reason]),
  });
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`server at ${url} did not become ready`);
}

async function startFixtureServer(): Promise<{ server: Server; url: string }> {
  const yaml = await readFile(
    path.join(webRoot, 'src', 'app', 'challenges', '[id]', 'fixtures', 'openapi.yaml'),
    'utf-8',
  );
  return new Promise((resolve) => {
    const httpServer = createServer((req, res) => {
      if (req.url === '/openapi.yaml') {
        res.writeHead(200, { 'content-type': 'application/yaml' });
        res.end(yaml);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      const listenPort = typeof address === 'object' && address ? address.port : 0;
      resolve({ server: httpServer, url: `http://127.0.0.1:${listenPort}/openapi.yaml` });
    });
  });
}

async function collectCompiledFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectCompiledFiles(entryPath)));
    else if (entry.name.endsWith('.js')) files.push(entryPath);
  }
  return files;
}

// The Next.js action-entry loader emits `'<id>': () => import(...).then(mod => mod["<exportName>"])`
// for every server action, so the export name always appears inside that id's own map entry
// (the span up to the next id in the source). Anchoring on the export name there is deterministic,
// unlike matching against a string that only happens to live somewhere in the action's compiled body.
async function findActionId(
  directory: string,
  candidates: string[],
  exportName: string,
): Promise<string | undefined> {
  const exportPattern = new RegExp(`[.[]["']?${exportName}\\b`);
  for (const filePath of await collectCompiledFiles(directory)) {
    const source = await readFile(filePath, 'utf-8');
    const occurrences = candidates
      .flatMap((id) => {
        const positions: { id: string; pos: number }[] = [];
        let from = 0;
        let index = source.indexOf(id, from);
        while (index !== -1) {
          positions.push({ id, pos: index });
          from = index + id.length;
          index = source.indexOf(id, from);
        }
        return positions;
      })
      .sort((a, b) => a.pos - b.pos);
    for (let i = 0; i < occurrences.length; i += 1) {
      const { id, pos } = occurrences[i];
      const next = occurrences[i + 1]?.pos ?? pos + 500;
      const segment = source.slice(pos, Math.min(next, pos + 500));
      if (exportPattern.test(segment)) return id;
    }
  }
  return undefined;
}

before(async () => {
  const fixture = await startFixtureServer();
  fixtureServer = fixture.server;
  fixtureUrl = fixture.url;

  const [member] = await db.insert(users).values({
    githubId: Math.floor(Math.random() * 1_000_000_000),
    handle: `reporting-member-${randomUUID()}`,
    displayName: 'Reporting Member',
    email: `reporting-${randomUUID()}@example.com`,
    role: 'member',
  }).returning();
  ids.users.push(member.id);
  memberId = member.id;
  const session = await createSession(member.id, databaseUrl);
  ids.sessions.push(session.id);
  memberSessionId = session.id;

  const [challenge] = await db.insert(challenges).values({
    title: `Reporting challenge ${randomUUID()}`, level: 'junior',
  }).returning();
  ids.challenges.push(challenge.id);
  challengeId = challenge.id;
  const [version] = await db.insert(challengeVersions).values({
    challengeId: challenge.id, version: 1, level: 'junior', rubric: {}, openapiRef: fixtureUrl, hiddenTestsRef: 'hidden/v1', publishedAt: new Date(),
  }).returning();
  ids.versions.push(version.id);

  const [enrollment] = await db.insert(enrollments).values({
    userId: member.id, challengeVersionId: version.id, mode: 'backend', stackId: randomUUID(), repoUrl: 'https://github.com/example/reporting-fixture', status: 'completed',
  }).returning();
  ids.enrollments.push(enrollment.id);
  const [submission] = await db.insert(submissions).values({
    enrollmentId: enrollment.id, commitSha: randomUUID(), status: 'graded',
  }).returning();
  ids.submissions.push(submission.id);
  const [run] = await db.insert(gradingRuns).values({
    submissionId: submission.id, status: 'successful', score: 90,
  }).returning();
  ids.runs.push(run.id);
  const [solution] = await db.insert(solutions).values({
    submissionId: submission.id,
    title: 'Reporting Fixture Solution',
    writeup: 'The write-up for the reporting fixture.',
    publishedAt: new Date(),
  }).returning();
  ids.solutions.push(solution.id);
  publishedSolutionId = solution.id;

  const [solutionComment] = await db.insert(comments).values({
    targetType: 'solution', targetId: solution.id, authorId: member.id, body: 'A solution comment to report',
  }).returning();
  ids.comments.push(solutionComment.id);
  solutionCommentId = solutionComment.id;

  const [challengeComment] = await db.insert(comments).values({
    targetType: 'challenge', targetId: challenge.id, authorId: member.id, body: 'A challenge comment to report',
  }).returning();
  ids.comments.push(challengeComment.id);
  challengeCommentId = challengeComment.id;

  execFileSync('npx', ['next', 'build'], { cwd: webRoot, stdio: 'inherit' });
  const actionManifest = JSON.parse(await readFile(
    path.join(webRoot, '.next', 'server', 'server-reference-manifest.json'),
    'utf-8',
  )) as { node: Record<string, { workers: Record<string, unknown> }> };
  const pageActionIds = Object.entries(actionManifest.node)
    .filter(([, action]) => Object.hasOwn(action.workers, 'app/solutions/[id]/page')
      || Object.hasOwn(action.workers, 'app/challenges/[id]/page'))
    .map(([id]) => id);
  reportActionId = await findActionId(path.join(webRoot, '.next', 'server'), pageActionIds, 'reportAction');
  assert.ok(reportActionId, 'expected the reportAction export in the solution or challenge page manifest');
  server = spawn('node', ['.next/standalone/apps/web/server.js'], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), HOSTNAME: '127.0.0.1' },
  });
  await waitForServer(`http://127.0.0.1:${port}/solutions/${publishedSolutionId}`);
});

after(async () => {
  if (server) server.kill();
  if (fixtureServer) fixtureServer.close();
  for (const id of ids.reports) await db.delete(reports).where(eq(reports.id, id));
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

test('GET /solutions/:id shows a Report control for the solution and its comment when signed in', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/solutions/${publishedSolutionId}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` },
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal((body.match(/>Report</g) ?? []).length, 2);
});

test('GET /solutions/:id shows no Report control when signed out', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/solutions/${publishedSolutionId}`);
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.ok(!body.includes('>Report<'));
});

test('GET /challenges/:id shows a Report control for its comment when signed in', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/challenges/${challengeId}`, {
    headers: { Cookie: `${SESSION_COOKIE}=${memberSessionId}` },
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal((body.match(/>Report</g) ?? []).length, 1);
});

test('report action rejects a blank reason with a stable validation message without inserting a row', async () => {
  const before = await db.select().from(reports).where(eq(reports.targetId, solutionCommentId as string));

  await assert.rejects(
    () => reportAction({ type: 'comment', id: solutionCommentId as string }, '   \n '),
    { message: 'Report reason cannot be empty.' },
  );

  const after = await db.select().from(reports).where(eq(reports.targetId, solutionCommentId as string));
  assert.equal(after.length, before.length);
});

test('reporting a comment authorizes the member and inserts a trimmed report row', async () => {
  const reason = `  Spam comment ${randomUUID()}  `;
  const response = await postReportAction(
    `/solutions/${publishedSolutionId}`,
    { type: 'comment', id: solutionCommentId as string },
    reason,
    memberSessionId,
  );
  assert.equal(response.status, 200);

  const inserted = await db.select().from(reports).where(eq(reports.targetId, solutionCommentId as string));
  ids.reports.push(...inserted.map((row) => row.id));
  assert.equal(inserted.length, 1);
  assert.deepEqual(
    [inserted[0].targetType, inserted[0].targetId, inserted[0].reporterId, inserted[0].reason],
    ['comment', solutionCommentId, memberId, reason.trim()],
  );
});

test('reporting the solution inserts a report row with targetType solution', async () => {
  const reason = `Plagiarized writeup ${randomUUID()}`;
  const response = await postReportAction(
    `/solutions/${publishedSolutionId}`,
    { type: 'solution', id: publishedSolutionId as string },
    reason,
    memberSessionId,
  );
  assert.equal(response.status, 200);

  const inserted = await db.select().from(reports).where(eq(reports.targetId, publishedSolutionId as string));
  ids.reports.push(...inserted.map((row) => row.id));
  assert.equal(inserted.length, 1);
  assert.deepEqual(
    [inserted[0].targetType, inserted[0].reporterId, inserted[0].reason],
    ['solution', memberId, reason],
  );
});

test('reporting a challenge comment inserts a report row referencing that comment', async () => {
  const reason = `Off topic ${randomUUID()}`;
  const response = await postReportAction(
    `/challenges/${challengeId}`,
    { type: 'comment', id: challengeCommentId as string },
    reason,
    memberSessionId,
  );
  assert.equal(response.status, 200);

  const inserted = await db.select().from(reports).where(eq(reports.targetId, challengeCommentId as string));
  const matching = inserted.filter((row) => row.reason === reason);
  ids.reports.push(...matching.map((row) => row.id));
  assert.equal(matching.length, 1);
  assert.deepEqual(
    [matching[0].targetType, matching[0].reporterId],
    ['comment', memberId],
  );
});

test('report action rejects a signed-out submission without inserting a row', async () => {
  const reason = `Rejected signed-out report ${randomUUID()}`;
  const response = await postReportAction(
    `/solutions/${publishedSolutionId}`,
    { type: 'comment', id: solutionCommentId as string },
    reason,
  );

  assert.equal(response.status, 500);
  const inserted = await db.select().from(reports).where(eq(reports.reason, reason));
  assert.equal(inserted.length, 0);
});

test('two reports for the same target both persist because deduplication is not enforced', async () => {
  const reasonOne = `Duplicate report one ${randomUUID()}`;
  const reasonTwo = `Duplicate report two ${randomUUID()}`;
  const target = { type: 'comment' as const, id: challengeCommentId as string };

  const first = await postReportAction(`/challenges/${challengeId}`, target, reasonOne, memberSessionId);
  const second = await postReportAction(`/challenges/${challengeId}`, target, reasonTwo, memberSessionId);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const inserted = await db.select().from(reports).where(eq(reports.targetId, challengeCommentId as string));
  const matching = inserted.filter((row) => row.reason === reasonOne || row.reason === reasonTwo);
  ids.reports.push(...matching.map((row) => row.id));
  assert.equal(matching.length, 2);
});

test('successful client submission reports success without throwing', async () => {
  const inserted = {
    id: randomUUID(),
    targetType: 'comment' as const,
    targetId: randomUUID(),
    reporterId: randomUUID(),
    reason: 'Spam',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  let succeededWith: Report | undefined;
  let failure: string | undefined;

  await submitReport(
    { type: 'comment', id: inserted.targetId },
    'Spam',
    async (target, reason) => {
      assert.deepEqual(target, { type: 'comment', id: inserted.targetId });
      assert.equal(reason, 'Spam');
      return inserted;
    },
    {
      succeed: (report) => { succeededWith = report; },
      fail: (message) => { failure = message; },
    },
  );

  assert.deepEqual(succeededWith, inserted);
  assert.equal(failure, undefined);
});

test('failed client submission surfaces the action error without succeeding', async () => {
  let succeeded = false;
  let failure: string | undefined;

  await submitReport(
    { type: 'solution', id: randomUUID() },
    '   ',
    async () => { throw new Error('Report reason cannot be empty.'); },
    {
      succeed: () => { succeeded = true; },
      fail: (message) => { failure = message; },
    },
  );

  assert.equal(succeeded, false);
  assert.equal(failure, 'Report reason cannot be empty.');
});

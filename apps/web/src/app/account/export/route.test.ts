import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import JSZip from 'jszip';
import { buildAccountExport } from '../../../modules/account-export/index.js';
import { AccountExportSizeError } from '../../../modules/grading/index.js';
import { AuthorizationError, type User } from '../../../modules/identity/index.js';
import { createAccountExportHandler } from './handler.js';

const user = {
  id: 'member-1', githubId: 1, handle: 'member', displayName: 'Member', avatarUrl: null,
  email: 'member@example.com', role: 'member', bio: null, links: [], createdAt: new Date('2025-01-01T00:00:00Z'),
} satisfies User;

test('authorizes before invoking archive assembly', async () => {
  const events: string[] = [];
  const handler = createAccountExportHandler({
    authorize: async () => { events.push('authorized'); return user; },
    buildArchive: async () => { events.push('built'); return Buffer.from('zip'); },
  });
  await handler();
  assert.deepEqual(events, ['authorized', 'built']);
});

test('returns 403 without any export or storage work when authorization fails', async () => {
  let calls = 0;
  const handler = createAccountExportHandler({
    authorize: async () => { throw new AuthorizationError(); },
    buildArchive: async () => { calls += 1; return Buffer.alloc(0); },
  });
  const response = await handler();
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('passes only the authorized id and returns exact ZIP bytes and download headers', async () => {
  const archive = Buffer.from('exact zip bytes');
  const received: unknown[] = [];
  const handler = createAccountExportHandler({
    authorize: async () => user,
    buildArchive: async (...args) => { received.push(...args); return archive; },
    now: () => new Date('2026-09-03T23:59:59Z'),
  });
  const response = await handler();
  assert.equal(response.status, 200);
  assert.deepEqual(received, [user.id]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archive);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="forge-account-export-2026-09-03.zip"');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

for (const source of ['per-report', 'aggregate']) {
  test(`maps ${source} size errors to 413`, async () => {
    const handler = createAccountExportHandler({
      authorize: async () => user,
      buildArchive: async () => { throw new AccountExportSizeError(source); },
    });
    assert.equal((await handler()).status, 413);
  });
}

test('integration-style handler archive excludes another member records and report', async () => {
  const ownEnrollment = {
    id: 'own-enrollment', userId: user.id, challengeVersionId: 'version', mode: 'backend', stackId: 'stack',
    repoUrl: null, status: 'completed', bestGradingRunId: 'own-run', createdAt: user.createdAt,
  };
  const ownSubmission = { id: 'own-submission', enrollmentId: ownEnrollment.id, commitSha: 'abc', status: 'completed', createdAt: user.createdAt };
  const handler = createAccountExportHandler({
    authorize: async () => user,
    buildArchive: (userId) => buildAccountExport(userId, {
      getProfile: async (id) => id === user.id ? user : undefined,
      listEnrollments: async (id) => id === user.id ? [ownEnrollment] : [],
      listSubmissions: async (id) => id === user.id ? [ownSubmission] : [],
      listReports: async (id) => id === user.id ? [{
        id: 'own-run', submissionId: ownSubmission.id, status: 'successful', score: 100,
        reportUrl: 'other-member-run-must-not-be-read', createdAt: user.createdAt,
      }] : [],
      readReportObject: async (key) => (async function* () {
        assert.equal(key, 'reports/own-run/report.json');
        yield Buffer.from('{"owner":"member-1"}');
      })(),
    }),
  });
  const zip = await JSZip.loadAsync(await (await handler()).arrayBuffer());
  const contents = await Promise.all(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.async('string')));
  assert.match(contents.join('\n'), /member-1/);
  assert.doesNotMatch(contents.join('\n'), /other-member/);
  assert.equal(zip.file('reports/other-run.json'), null);
});

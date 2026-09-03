import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import JSZip from 'jszip';
import { AccountExportSizeError } from '../grading/index.js';
import {
  buildAccountExport,
  MAX_AGGREGATE_REPORT_BYTES,
  MAX_REPORT_BYTES,
  type AccountExportDependencies,
} from './index.js';

const createdAt = new Date('2025-01-02T03:04:05.000Z');
const profile = {
  id: 'member-1', githubId: 12, handle: 'member', displayName: 'Member', avatarUrl: null,
  email: 'member@example.com', role: 'member', bio: null, links: [], createdAt,
};
const enrollment = {
  id: 'enrollment-1', userId: profile.id, challengeVersionId: 'version-1', mode: 'backend',
  stackId: 'stack-1', repoUrl: null, status: 'completed', bestGradingRunId: 'run-1', createdAt,
};
const submission = {
  id: 'submission-1', enrollmentId: enrollment.id, commitSha: 'abc123', status: 'completed', createdAt,
};
const run = {
  id: 'run-1', submissionId: submission.id, status: 'successful', score: 95,
  reportUrl: 'ignored/untrusted/url', createdAt,
};

function stream(value: string): AsyncIterable<Uint8Array> {
  return (async function* () { yield Buffer.from(value); })();
}

function dependencies(overrides: Partial<AccountExportDependencies> = {}): AccountExportDependencies {
  return {
    getProfile: async (userId) => userId === profile.id ? profile : undefined,
    listEnrollments: async (userId) => userId === profile.id ? [enrollment] : [],
    listSubmissions: async (userId) => userId === profile.id ? [submission] : [],
    listReports: async (userId) => userId === profile.id ? [run] : [],
    readReportObject: async () => stream('{"summary":"passed"}'),
    ...overrides,
  };
}

async function files(buffer: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buffer);
}

test('builds the member archive with profile, enrollment, submission, and owned report', async () => {
  const zip = await files(await buildAccountExport(profile.id, dependencies()));
  assert.deepEqual(Object.keys(zip.files), [
    'profile.json', 'enrollments.json', 'submissions.json', 'reports/', 'reports/run-1.json',
  ]);
  assert.equal(JSON.parse(await zip.file('profile.json')!.async('string')).id, profile.id);
  assert.equal(JSON.parse(await zip.file('enrollments.json')!.async('string'))[0].id, enrollment.id);
  assert.equal(JSON.parse(await zip.file('submissions.json')!.async('string'))[0].id, submission.id);
  const report = JSON.parse(await zip.file('reports/run-1.json')!.async('string'));
  assert.deepEqual(report, { summary: 'passed' });
});

test('preserves deterministic reader order and emits empty collections', async () => {
  const ordered = await files(await buildAccountExport(profile.id, dependencies({
    listEnrollments: async () => [{ ...enrollment, id: 'first' }, { ...enrollment, id: 'second' }],
    listSubmissions: async () => [],
    listReports: async () => [],
  })));
  assert.deepEqual(JSON.parse(await ordered.file('enrollments.json')!.async('string')).map((item: { id: string }) => item.id), ['first', 'second']);
  assert.deepEqual(JSON.parse(await ordered.file('submissions.json')!.async('string')), []);
  assert.equal(ordered.file('reports/'), null);
});

test('does not include records or reports excluded by member-scoped readers', async () => {
  let requestedKey = '';
  const zip = await files(await buildAccountExport(profile.id, dependencies({
    readReportObject: async (key) => { requestedKey = key; return stream('{}'); },
  })));
  assert.equal(requestedKey, 'reports/run-1/report.json');
  assert.doesNotMatch(await zip.file('profile.json')!.async('string'), /other-member/);
  assert.equal(zip.file('reports/other-run.json'), null);
});

test('rejects malformed report JSON', async () => {
  await assert.rejects(
    buildAccountExport(profile.id, dependencies({ readReportObject: async () => stream('{broken') })),
    /not valid JSON/,
  );
});

test('rejects a report above the per-object limit', async () => {
  const body = `"${'x'.repeat(MAX_REPORT_BYTES)}"`;
  await assert.rejects(
    buildAccountExport(profile.id, dependencies({ readReportObject: async () => stream(body) })),
    AccountExportSizeError,
  );
});

test('rejects reports above the aggregate limit', async () => {
  const reportRuns = Array.from({ length: 11 }, (_, index) => ({ ...run, id: `run-${index}` }));
  const payload = `"${'x'.repeat(MAX_REPORT_BYTES - 2)}"`;
  assert.ok(Buffer.byteLength(payload) <= MAX_REPORT_BYTES);
  assert.ok(Buffer.byteLength(payload) * reportRuns.length > MAX_AGGREGATE_REPORT_BYTES);
  await assert.rejects(
    buildAccountExport(profile.id, dependencies({
      listReports: async () => reportRuns,
      readReportObject: async () => stream(payload),
    })),
    AccountExportSizeError,
  );
});

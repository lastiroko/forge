import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Enrollment } from '../../../modules/enrollment/index.js';
import type { User } from '../../../modules/identity/index.js';
import { createGetHandler } from './route.js';

const owner = {
  id: 'member-1', githubId: 1, handle: 'member', displayName: 'Member', avatarUrl: null,
  email: 'member@example.com', role: 'member', bio: null, links: [], createdAt: new Date('2025-01-01T00:00:00Z'),
} satisfies User;

const activeEnrollment = {
  id: 'enrollment-1', userId: owner.id, challengeVersionId: 'version-1', mode: 'backend', stackId: 'stack-1',
  repoUrl: null, status: 'active', bestGradingRunId: null, createdAt: owner.createdAt,
} satisfies Enrollment;

function request(): Request {
  return new Request('http://localhost/starter-kits/enrollment-1');
}

test('returns 401 without reading the enrollment or archive when the caller is signed out', async () => {
  let getEnrollmentCalls = 0;
  let readArchiveCalls = 0;
  const handler = createGetHandler({
    currentUser: async () => undefined,
    getEnrollment: async () => { getEnrollmentCalls += 1; return activeEnrollment; },
    readArchive: async () => { readArchiveCalls += 1; return Buffer.from('zip'); },
  });
  const response = await handler(request(), { params: { enrollmentId: activeEnrollment.id } });
  assert.equal(response.status, 401);
  assert.equal(getEnrollmentCalls, 0);
  assert.equal(readArchiveCalls, 0);
});

test('returns 404 without reading the archive for an enrollment owned by another member', async () => {
  let readArchiveCalls = 0;
  const handler = createGetHandler({
    currentUser: async () => owner,
    getEnrollment: async () => ({ ...activeEnrollment, userId: 'someone-else' }),
    readArchive: async () => { readArchiveCalls += 1; return Buffer.from('zip'); },
  });
  const response = await handler(request(), { params: { enrollmentId: activeEnrollment.id } });
  assert.equal(response.status, 404);
  assert.equal(readArchiveCalls, 0);
});

test('returns 404 for an enrollment that is not active', async () => {
  const handler = createGetHandler({
    currentUser: async () => owner,
    getEnrollment: async () => ({ ...activeEnrollment, status: 'abandoned' }),
    readArchive: async () => Buffer.from('zip'),
  });
  const response = await handler(request(), { params: { enrollmentId: activeEnrollment.id } });
  assert.equal(response.status, 404);
});

test('returns 404 when no archive has been stored for the enrollment', async () => {
  const handler = createGetHandler({
    currentUser: async () => owner,
    getEnrollment: async () => activeEnrollment,
    readArchive: async () => undefined,
  });
  const response = await handler(request(), { params: { enrollmentId: activeEnrollment.id } });
  assert.equal(response.status, 404);
});

test('returns the exact archive bytes and download headers for the owning member', async () => {
  const archive = Buffer.from('exact zip bytes');
  const received: string[] = [];
  const handler = createGetHandler({
    currentUser: async () => owner,
    getEnrollment: async (id) => { received.push(id); return activeEnrollment; },
    readArchive: async (enrollmentId) => { received.push(enrollmentId); return archive; },
  });
  const response = await handler(request(), { params: { enrollmentId: activeEnrollment.id } });
  assert.equal(response.status, 200);
  assert.deepEqual(received, [activeEnrollment.id, activeEnrollment.id]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archive);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="starter-kit-${activeEnrollment.id}.zip"`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

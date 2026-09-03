import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { createSession, isAuthorizationError, SESSION_COOKIE, type SessionCookieReader } from '../identity/index.js';
import { generateKit, previewStarterKits, type ChallengeVersion, type StackTemplate } from './index.js';

const { users, sessions, challenges, challengeVersions, challengeStacks, stacks, enrollments } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const challengeDir = path.join(repoRoot, 'challenges', 'todo-api');
const templateDir = path.join(repoRoot, 'templates', 'python-fastapi');

function cookieStore(sessionId?: string): SessionCookieReader {
  return { get: (name) => (sessionId && name === SESSION_COOKIE) ? { value: sessionId } : undefined };
}

function expectedS68BackendFiles(): string[] {
  const version: ChallengeVersion = {
    level: 'junior',
    brief: readFileSync(path.join(challengeDir, 'brief.md'), 'utf8'),
    openapiYaml: readFileSync(path.join(challengeDir, 'openapi.yaml'), 'utf8'),
    challengeYml: readFileSync(path.join(challengeDir, 'challenge.yml'), 'utf8'),
    endpoints: [
      { method: 'get', path: '/health', operationId: 'getHealth', modes: ['backend'] },
      { method: 'get', path: '/items', operationId: 'getItems', modes: ['backend'] },
      { method: 'post', path: '/items', operationId: 'postItems', modes: ['backend'] },
      { method: 'get', path: '/items/{id}', operationId: 'getItemsById', modes: ['backend'] },
      { method: 'patch', path: '/items/{id}', operationId: 'patchItemsById', modes: ['backend'] },
      { method: 'delete', path: '/items/{id}', operationId: 'deleteItemsById', modes: ['backend'] },
    ],
    publicChecks: {
      'checks/functional-public.json': {
        content: readFileSync(path.join(challengeDir, 'checks', 'functional-public.json'), 'utf8'),
        modes: ['backend'],
      },
    },
    ciWorkflowYaml: readFileSync(path.join(templateDir, 'checks.workflow.yml'), 'utf8'),
  };
  const template: StackTemplate = {
    id: 'python-fastapi',
    dockerfile: readFileSync(path.join(templateDir, 'Dockerfile'), 'utf8'),
    composeSnippet: readFileSync(path.join(templateDir, 'compose.snippet.yml'), 'utf8'),
    readmeFragment: readFileSync(path.join(templateDir, 'README.fragment.md'), 'utf8'),
    routeStubTemplate: readFileSync(path.join(templateDir, 'route-stub.py.template'), 'utf8'),
    routeStubDir: 'app/routes',
    routeStubExtension: '.py',
  };
  return Object.keys(generateKit(version, template, 'backend')).sort();
}

async function seedDraft(databaseUrlToUse: string, templateKey = 'python-fastapi') {
  const { db, pool } = createDbClient(databaseUrlToUse);
  const [author, member] = await db.insert(users).values([
    { githubId: Math.floor(Math.random() * 1_000_000_000), handle: `preview-author-${randomUUID()}`, displayName: 'Preview Author', email: `preview-author-${randomUUID()}@example.com`, role: 'author' },
    { githubId: Math.floor(Math.random() * 1_000_000_000), handle: `preview-member-${randomUUID()}`, displayName: 'Preview Member', email: `preview-member-${randomUUID()}@example.com`, role: 'member' },
  ]).returning();
  const authorSession = await createSession(author.id, databaseUrlToUse);
  const memberSession = await createSession(member.id, databaseUrlToUse);

  const [challenge] = await db.insert(challenges).values({ title: 'Todo Items API', level: 'junior', contentSlug: 'todo-api' }).returning();
  const [draftVersion] = await db.insert(challengeVersions).values({
    challengeId: challenge.id, version: 1, level: 'junior', rubric: {}, openapiRef: 'openapi/v1.yaml', hiddenTestsRef: 'hidden/v1',
  }).returning();
  const [stack] = await db.insert(stacks).values({ language: 'Python', framework: 'FastAPI', templateKey }).returning();
  const [link] = await db.insert(challengeStacks).values({ challengeId: challenge.id, stackId: stack.id }).returning();

  return {
    db, pool, author, member, authorSession, memberSession, challenge, draftVersion, stack, link,
    async cleanup() {
      await db.delete(challengeStacks).where(eq(challengeStacks.id, link.id));
      await db.delete(stacks).where(eq(stacks.id, stack.id));
      await db.delete(challengeVersions).where(eq(challengeVersions.id, draftVersion.id));
      await db.delete(challenges).where(eq(challenges.id, challenge.id));
      await db.delete(sessions).where(eq(sessions.id, authorSession.id));
      await db.delete(sessions).where(eq(sessions.id, memberSession.id));
      await db.delete(users).where(eq(users.id, author.id));
      await db.delete(users).where(eq(users.id, member.id));
      await pool.end();
    },
  };
}

test('previewStarterKits returns the exact S68 Python FastAPI backend file list for an author', async () => {
  const fixture = await seedDraft(databaseUrl);
  try {
    const preview = await previewStarterKits(fixture.challenge.id, 1, cookieStore(fixture.authorSession.id), databaseUrl);

    assert.ok(preview);
    assert.equal(preview?.challengeId, fixture.challenge.id);
    assert.equal(preview?.version, 1);
    assert.equal(preview?.sections.length, 1);
    const [section] = preview?.sections ?? [];
    assert.equal(section.mode, 'backend');
    assert.equal(section.stackLabel, 'Python / FastAPI — backend');
    assert.deepEqual(section.files, expectedS68BackendFiles());
  } finally {
    await fixture.cleanup();
  }
});

test('previewStarterKits rejects member and anonymous callers before loading any content', async () => {
  const fixture = await seedDraft(databaseUrl);
  try {
    await assert.rejects(
      previewStarterKits(fixture.challenge.id, 1, cookieStore(fixture.memberSession.id), databaseUrl),
      (error: unknown) => isAuthorizationError(error),
    );
    await assert.rejects(
      previewStarterKits(fixture.challenge.id, 1, cookieStore(undefined), databaseUrl),
      (error: unknown) => isAuthorizationError(error),
    );
  } finally {
    await fixture.cleanup();
  }
});

test('previewStarterKits does not preview a published version', async () => {
  const fixture = await seedDraft(databaseUrl);
  try {
    await fixture.db.update(challengeVersions).set({ publishedAt: new Date() }).where(eq(challengeVersions.id, fixture.draftVersion.id));

    const preview = await previewStarterKits(fixture.challenge.id, 1, cookieStore(fixture.authorSession.id), databaseUrl);

    assert.equal(preview, undefined);
  } finally {
    await fixture.cleanup();
  }
});

test('previewStarterKits rejects a stack whose template key is not enabled by challenge.yml', async () => {
  const fixture = await seedDraft(databaseUrl, 'python-django');
  try {
    await assert.rejects(previewStarterKits(fixture.challenge.id, 1, cookieStore(fixture.authorSession.id), databaseUrl));
  } finally {
    await fixture.cleanup();
  }
});

test('the kit-generator module imports neither the enrollment module nor a GitHub adapter', () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
  assert.doesNotMatch(source, /from ['"].*enrollment/);
  assert.doesNotMatch(source, /from ['"].*github/i);
});

test('previewStarterKits creates no enrollment row as a side effect', async () => {
  const fixture = await seedDraft(databaseUrl);
  try {
    const before = await fixture.db.select().from(enrollments);
    await previewStarterKits(fixture.challenge.id, 1, cookieStore(fixture.authorSession.id), databaseUrl);
    const after = await fixture.db.select().from(enrollments);

    assert.equal(after.length, before.length);
  } finally {
    await fixture.cleanup();
  }
});

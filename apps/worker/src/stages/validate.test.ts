import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorkspace } from './validate.js';

async function createWorkspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'forge-validate-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

const validChallengeYml =
  'slug: sample-challenge\nlevel: mid\nrubric:\n  functional: 60\n  contract: 15\n  robustness: 15\n  quality: 10\nservices:\n  - postgres\n';

test('fails when challenge.yml is missing', async (t) => {
  const dir = await createWorkspace({ Dockerfile: 'FROM node:20\n' });
  t.after(() => rm(dir, { recursive: true, force: true }));

  await assert.rejects(validateWorkspace(dir), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('challenge.yml'));
    return true;
  });
});

test('fails when Dockerfile is missing', async (t) => {
  const dir = await createWorkspace({ 'challenge.yml': validChallengeYml });
  t.after(() => rm(dir, { recursive: true, force: true }));

  await assert.rejects(validateWorkspace(dir), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('Dockerfile'));
    return true;
  });
});

test('fails when challenge.yml does not match the schema', async (t) => {
  const dir = await createWorkspace({
    Dockerfile: 'FROM node:20\n',
    'challenge.yml': 'slug: sample\nlevel: junior\n',
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  await assert.rejects(validateWorkspace(dir), (error) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('does not match schema'));
    return true;
  });
});

test('resolves with the parsed challenge for a valid fixture', async (t) => {
  const dir = await createWorkspace({
    Dockerfile: 'FROM node:20\n',
    'challenge.yml': validChallengeYml,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await validateWorkspace(dir);

  assert.deepEqual(result, {
    challenge: {
      slug: 'sample-challenge',
      level: 'mid',
      rubric: { functional: 60, contract: 15, robustness: 15, quality: 10 },
      services: ['postgres'],
    },
  });
});

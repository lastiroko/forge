import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { validateChallengeContent } from './challenge-content.js';

const validChallengeContent = {
  slug: 'sample-challenge',
  level: 'mid',
  briefRef: 'briefs/sample-challenge.md',
  openapiRef: 'contracts/sample-challenge.openapi.yaml',
  hiddenTestsRef: 'tests/sample-challenge/hidden',
  rubric: {
    functional: 60,
    contract: 15,
    robustness: 15,
    quality: 10,
  },
  enabledModes: ['backend', 'fullstack'],
  enabledStacks: ['python-fastapi', 'java-spring-boot'],
};

test('validateChallengeContent returns parsed content for a valid challenge.yml fixture', () => {
  assert.deepEqual(validateChallengeContent(validChallengeContent), validChallengeContent);
});

test('validateChallengeContent names a missing rubric field', () => {
  const { rubric: _rubric, ...challengeWithoutRubric } = validChallengeContent;

  assert.throws(() => validateChallengeContent(challengeWithoutRubric), /rubric/);
});

test('validateChallengeContent names a missing OpenAPI reference', () => {
  const { openapiRef: _openapiRef, ...challengeWithoutOpenapiRef } = validChallengeContent;

  assert.throws(() => validateChallengeContent(challengeWithoutOpenapiRef), /openapiRef/);
});

test('validateChallengeContent accepts the todo-api challenge.yml content', async () => {
  const challengeYmlPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'challenges',
    'todo-api',
    'challenge.yml',
  );
  const raw = await readFile(challengeYmlPath, 'utf-8');
  const parsed = YAML.parse(raw);

  const result = validateChallengeContent(parsed);

  assert.equal(result.slug, 'todo-api');
  assert.equal(result.level, 'junior');
  assert.equal(result.briefRef, 'brief.md');
  assert.equal(result.openapiRef, 'openapi.yaml');
  assert.equal(result.hiddenTestsRef, 'checks/functional-hidden.json');
  assert.deepEqual(result.rubric, { functional: 60, contract: 15, robustness: 15, quality: 10 });
  assert.deepEqual(result.enabledModes, ['backend']);
  assert.deepEqual(result.enabledStacks, ['python-fastapi']);
});

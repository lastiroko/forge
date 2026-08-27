import { test } from 'node:test';
import { strict as assert } from 'node:assert';
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

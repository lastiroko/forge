import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getEnabledCombinations, type StackOption } from './enabled-combinations.js';

const stacks: StackOption[] = [
  { id: 'one', language: 'TypeScript', framework: 'Express' },
  { id: 'two', language: 'Go', framework: 'Fiber' },
];

test('a backend-only challenge yields one backend combination per stack', () => {
  const result = getEnabledCombinations({ backendEnabled: true, fullstackEnabled: false }, stacks);
  assert.equal(result.length, 2);
  assert.ok(result.every((combination) => combination.mode === 'backend'));
});

test('a challenge with both modes and two stacks yields four combinations', () => {
  const result = getEnabledCombinations({ backendEnabled: true, fullstackEnabled: true }, stacks);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((combination) => combination.mode), ['backend', 'backend', 'fullstack', 'fullstack']);
});

test('a challenge with no enabled stacks yields no combinations', () => {
  const result = getEnabledCombinations({ backendEnabled: true, fullstackEnabled: true }, []);
  assert.deepEqual(result, []);
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateKit, type ChallengeVersion, type StackTemplate } from './index.js';

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'templates',
  'python-fastapi',
);

function buildStackFixture(): StackTemplate {
  return {
    id: 'python-fastapi',
    dockerfile: readFileSync(path.join(templatesRoot, 'Dockerfile'), 'utf8'),
    composeSnippet: readFileSync(path.join(templatesRoot, 'compose.snippet.yml'), 'utf8'),
    readmeFragment: readFileSync(path.join(templatesRoot, 'README.fragment.md'), 'utf8'),
    routeStubTemplate: readFileSync(path.join(templatesRoot, 'route-stub.py.template'), 'utf8'),
    routeStubDir: 'app/routes',
    routeStubExtension: '.py',
  };
}

function buildVersionFixture(): ChallengeVersion {
  return {
    level: 'junior',
    brief: 'Build a small items API.',
    openapiYaml: 'openapi: 3.0.0\ninfo:\n  title: Items API\n',
    challengeYml: 'level: junior\ntitle: Items API\n',
    endpoints: [
      { method: 'get', path: '/items', operationId: 'listItems', modes: ['backend'] },
      { method: 'post', path: '/items', operationId: 'createItem', modes: ['backend'] },
      { method: 'get', path: '/admin', operationId: 'adminPanel', modes: ['fullstack'] },
    ],
    publicChecks: {
      'checks/test_items.py': { content: 'def test_list_items():\n    pass\n', modes: ['backend'] },
    },
    ciWorkflowYaml: 'name: checks\non: [push]\n',
  };
}

test('generateKit assembles a full kit for a junior challenge and the Python FastAPI stack', () => {
  const stack = buildStackFixture();
  const version = buildVersionFixture();

  const files = generateKit(version, stack, 'backend');

  assert.deepEqual(
    Object.keys(files).sort(),
    [
      '.github/workflows/checks.yml',
      'Dockerfile',
      'README.md',
      'app/routes/createItem.py',
      'app/routes/listItems.py',
      'challenge.yml',
      'checks/test_items.py',
      'docker-compose.yml',
      'openapi.yaml',
    ].sort(),
  );

  assert.equal(files['Dockerfile'], readFileSync(path.join(templatesRoot, 'Dockerfile'), 'utf8'));
  assert.match(files['app/routes/listItems.py'], /@router\.get\("\/items"\)/);
});

test('generateKit filters endpoints and checks by mode', () => {
  const stack = buildStackFixture();
  const version = buildVersionFixture();

  const files = generateKit(version, stack, 'backend');

  assert.equal(files['app/routes/adminPanel.py'], undefined);
  assert.ok(files['app/routes/listItems.py']);
  assert.ok(files['app/routes/createItem.py']);
});

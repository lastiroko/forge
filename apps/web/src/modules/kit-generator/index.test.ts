import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

import {
  createZipArchive,
  deliverStarterKit,
  generateKit,
  type ChallengeVersion,
  type GitHubRepositoryClient,
  type StackTemplate,
  type ZipStorage,
} from './index.js';

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

test('createZipArchive produces a zip whose entries match the generated kit exactly', async () => {
  const stack = buildStackFixture();
  const version = buildVersionFixture();
  const files = generateKit(version, stack, 'backend');

  const zipBuffer = await createZipArchive(files);
  const zip = await JSZip.loadAsync(zipBuffer);

  assert.deepEqual(Object.keys(zip.files).sort(), Object.keys(files).sort());
  for (const [filePath, content] of Object.entries(files)) {
    const entry = zip.file(filePath);
    assert.ok(entry, `expected zip entry for ${filePath}`);
    assert.equal(await entry.async('string'), content);
  }
});

test('deliverStarterKit returns the GitHub repository URL when creation succeeds', async () => {
  const files = { 'README.md': 'hello' };
  const githubClient: GitHubRepositoryClient = {
    async createRepository() {
      return 'https://github.com/example/starter-kit';
    },
    async readFile() {
      throw new Error('readFile should not be called during starter-kit delivery');
    },
  };
  const zipStorage: ZipStorage = {
    async upload() {
      throw new Error('zipStorage.upload should not be called when GitHub succeeds');
    },
  };

  const result = await deliverStarterKit('enrollment-1', files, githubClient, zipStorage);

  assert.deepEqual(result, { repoUrl: 'https://github.com/example/starter-kit', downloadUrl: null });
});

test('deliverStarterKit falls back to uploading the identical file map when GitHub creation fails', async () => {
  const stack = buildStackFixture();
  const version = buildVersionFixture();
  const files = generateKit(version, stack, 'backend');

  const githubClient: GitHubRepositoryClient = {
    async createRepository() {
      throw new Error('GitHub is unavailable');
    },
    async readFile() {
      throw new Error('readFile should not be called during starter-kit delivery');
    },
  };

  let uploadedKey: string | undefined;
  let uploadedZip: Buffer | undefined;
  const zipStorage: ZipStorage = {
    async upload(key, zip) {
      uploadedKey = key;
      uploadedZip = zip;
      return 'https://storage.example.com/starter-kits/enrollment-1.zip';
    },
  };

  const result = await deliverStarterKit('enrollment-1', files, githubClient, zipStorage);

  assert.deepEqual(result, { repoUrl: null, downloadUrl: 'https://storage.example.com/starter-kits/enrollment-1.zip' });
  assert.equal(uploadedKey, 'starter-kits/enrollment-1.zip');
  assert.ok(uploadedZip);

  const uploadedFiles = await JSZip.loadAsync(uploadedZip);
  assert.deepEqual(Object.keys(uploadedFiles.files).sort(), Object.keys(files).sort());
  for (const [filePath, content] of Object.entries(files)) {
    const entry = uploadedFiles.file(filePath);
    assert.ok(entry, `expected zip entry for ${filePath}`);
    assert.equal(await entry.async('string'), content);
  }
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateRepositoryShape } from './repo-validation.js';
import type { GitHubRepositoryClient } from '../kit-generator/index.js';

function makeGithubClient(files: Record<string, string>): {
  client: GitHubRepositoryClient;
  calls: Array<{ repoUrl: string; path: string; commitSha: string }>;
} {
  const calls: Array<{ repoUrl: string; path: string; commitSha: string }> = [];
  const client: GitHubRepositoryClient = {
    async createRepository() {
      throw new Error('createRepository should not be called by validateRepositoryShape');
    },
    async readFile(input) {
      calls.push(input);
      return files[input.path];
    },
  };
  return { client, calls };
}

test('validateRepositoryShape throws naming Dockerfile when the Dockerfile is missing', async () => {
  const { client } = makeGithubClient({ 'challenge.yml': 'slug: widget-api' });
  await assert.rejects(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-1', client),
    /Dockerfile/,
  );
});

test('validateRepositoryShape throws naming challenge.yml when challenge.yml is missing', async () => {
  const { client } = makeGithubClient({ Dockerfile: 'FROM node:20' });
  await assert.rejects(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-2', client),
    /challenge\.yml/,
  );
});

test('validateRepositoryShape throws naming challenge.yml when it is not valid YAML', async () => {
  const { client } = makeGithubClient({ Dockerfile: 'FROM node:20', 'challenge.yml': ': not: valid: yaml: [' });
  await assert.rejects(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-3', client),
    /challenge\.yml/,
  );
});

test('validateRepositoryShape resolves when Dockerfile is present and challenge.yml is valid YAML, reading both from the exact repo URL and commit SHA in order', async () => {
  const { client, calls } = makeGithubClient({ Dockerfile: 'FROM node:20', 'challenge.yml': 'slug: widget-api' });
  await assert.doesNotReject(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-4', client),
  );
  assert.deepEqual(calls, [
    { repoUrl: 'https://github.com/acme/widget-api', path: 'Dockerfile', commitSha: 'sha-4' },
    { repoUrl: 'https://github.com/acme/widget-api', path: 'challenge.yml', commitSha: 'sha-4' },
  ]);
});

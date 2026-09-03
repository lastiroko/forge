import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateRepositoryShape } from './repo-validation.js';

function makeFetch(files: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('Dockerfile')) {
      const content = files['Dockerfile'];
      if (content === undefined) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }), { status: 200 });
    }
    if (url.includes('challenge.yml')) {
      const content = files['challenge.yml'];
      if (content === undefined) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }), { status: 200 });
    }
    throw new Error('unexpected fetch url: ' + url);
  }) as typeof fetch;
}

test('validateRepositoryShape throws naming Dockerfile when the Dockerfile is missing', async () => {
  const fetchImpl = makeFetch({ 'challenge.yml': 'slug: widget-api' });
  await assert.rejects(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-1', fetchImpl),
    /Dockerfile/,
  );
});

test('validateRepositoryShape throws naming challenge.yml when challenge.yml is missing', async () => {
  const fetchImpl = makeFetch({ Dockerfile: 'FROM node:20' });
  await assert.rejects(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-2', fetchImpl),
    /challenge\.yml/,
  );
});

test('validateRepositoryShape throws naming challenge.yml when it is not valid YAML', async () => {
  const fetchImpl = makeFetch({ Dockerfile: 'FROM node:20', 'challenge.yml': ': not: valid: yaml: [' });
  await assert.rejects(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-3', fetchImpl),
    /challenge\.yml/,
  );
});

test('validateRepositoryShape resolves when Dockerfile is present and challenge.yml is valid YAML', async () => {
  const fetchImpl = makeFetch({ Dockerfile: 'FROM node:20', 'challenge.yml': 'slug: widget-api' });
  await assert.doesNotReject(
    () => validateRepositoryShape('https://github.com/acme/widget-api', 'sha-4', fetchImpl),
  );
});

test('validateRepositoryShape is a no-op when repoUrl is null', async () => {
  const fetchImpl = (async () => {
    assert.fail('fetch should not be called');
  }) as unknown as typeof fetch;
  await assert.doesNotReject(() => validateRepositoryShape(null, 'sha-5', fetchImpl));
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createGithubAuthorizationHandler } from './handler.js';

test('GitHub authorization redirects with matching state and secure cookie attributes', async () => {
  const handler = createGithubAuthorizationHandler({
    clientId: 'client-id',
    randomBytes: (() => Buffer.from('fixed-state')) as never,
  });
  const response = await handler(new Request('https://forge.example/auth/github'));

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://forge.example/auth/github/callback');
  assert.equal(location.searchParams.get('scope'), 'read:user user:email');
  const state = location.searchParams.get('state');
  assert.ok(state);

  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, new RegExp(`^github_oauth_state=${state};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /Secure/);
});

test('GitHub authorization omits Secure for an HTTP development request', async () => {
  const handler = createGithubAuthorizationHandler({
    clientId: 'client-id',
    randomBytes: (() => Buffer.from('state')) as never,
  });
  const response = await handler(new Request('http://localhost:3000/auth/github'));
  assert.doesNotMatch(response.headers.get('set-cookie')!, /Secure/);
});

test('GitHub authorization rejects an empty client ID', async () => {
  const handler = createGithubAuthorizationHandler({ clientId: '', randomBytes: (() => Buffer.alloc(32)) as never });
  assert.equal((await handler(new Request('http://localhost/auth/github'))).status, 500);
});

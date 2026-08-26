import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateDatabaseCredentials } from './credentials.js';

test('generates different credentials for different run ids', () => {
  const a = generateDatabaseCredentials('11111111-1111-1111-1111-111111111111');
  const b = generateDatabaseCredentials('22222222-2222-2222-2222-222222222222');

  assert.notEqual(a.username, b.username);
  assert.notEqual(a.password, b.password);
  assert.notEqual(a.database, b.database);
});

test('generates safe Postgres identifiers for username and database', () => {
  const { username, database } = generateDatabaseCredentials('33333333-3333-3333-3333-333333333333');

  assert.match(username, /^[a-z_][a-z0-9_]*$/);
  assert.match(database, /^[a-z_][a-z0-9_]*$/);
});

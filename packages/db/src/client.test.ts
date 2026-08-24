import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sql } from 'drizzle-orm';
import { createDbClient } from './client.js';

test('createDbClient returns a client that can query Postgres', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const result = await db.execute(sql`select 1 as value`);
    assert.equal(Number(result.rows[0].value), 1);
  } finally {
    await pool.end();
  }
});

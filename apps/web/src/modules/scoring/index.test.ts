import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { getTotals } from './index.js';

const { pointsLedger, pointsTotalsCache } = schema;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('getTotals sums three ledger rows for a member', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const ledgerIds: string[] = [];

  try {
    const inserted = await db
      .insert(pointsLedger)
      .values([
        { userId, delta: 10, reason: 'award-1' },
        { userId, delta: -3, reason: 'award-2' },
        { userId, delta: 8, reason: 'award-3' },
      ])
      .returning();
    ledgerIds.push(...inserted.map((row) => row.id));

    const total = await getTotals(userId, databaseUrl);

    assert.equal(total, 15);
  } finally {
    if (ledgerIds.length) await db.delete(pointsLedger).where(inArray(pointsLedger.id, ledgerIds));
    await db.delete(pointsTotalsCache).where(eq(pointsTotalsCache.userId, userId));
    await pool.end();
  }
});

test('a cached call does not re-query the ledger', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const ledgerIds: string[] = [];

  try {
    const inserted = await db
      .insert(pointsLedger)
      .values([
        { userId, delta: 10, reason: 'award-1' },
        { userId, delta: -3, reason: 'award-2' },
        { userId, delta: 8, reason: 'award-3' },
      ])
      .returning();
    ledgerIds.push(...inserted.map((row) => row.id));

    const first = await getTotals(userId, databaseUrl);
    assert.equal(first, 15);

    // Remove the ledger rows the cache was warmed from; if getTotals fell back
    // to querying the ledger it would now compute 0, so a persisting 15 is
    // evidence the second call served the cached value instead.
    await db.delete(pointsLedger).where(inArray(pointsLedger.id, ledgerIds));
    ledgerIds.length = 0;

    const second = await getTotals(userId, databaseUrl);
    assert.equal(second, 15);
  } finally {
    if (ledgerIds.length) await db.delete(pointsLedger).where(inArray(pointsLedger.id, ledgerIds));
    await db.delete(pointsTotalsCache).where(eq(pointsTotalsCache.userId, userId));
    await pool.end();
  }
});

test('a new ledger row invalidates the cached total for that member', async () => {
  const { db, pool } = createDbClient(databaseUrl);
  const userId = randomUUID();
  const ledgerIds: string[] = [];

  try {
    const [first] = await db.insert(pointsLedger).values({ userId, delta: 10, reason: 'award-1' }).returning();
    ledgerIds.push(first.id);

    const initial = await getTotals(userId, databaseUrl);
    assert.equal(initial, 10);

    const [cachedRow] = await db.select().from(pointsTotalsCache).where(eq(pointsTotalsCache.userId, userId));
    assert.ok(cachedRow, 'expected getTotals to populate the cache');

    const [second] = await db.insert(pointsLedger).values({ userId, delta: 5, reason: 'award-2' }).returning();
    ledgerIds.push(second.id);

    const [invalidatedRow] = await db.select().from(pointsTotalsCache).where(eq(pointsTotalsCache.userId, userId));
    assert.equal(invalidatedRow, undefined, 'expected the insert trigger to remove the stale cache row');

    const recomputed = await getTotals(userId, databaseUrl);
    assert.equal(recomputed, 15);
  } finally {
    if (ledgerIds.length) await db.delete(pointsLedger).where(inArray(pointsLedger.id, ledgerIds));
    await db.delete(pointsTotalsCache).where(eq(pointsTotalsCache.userId, userId));
    await pool.end();
  }
});

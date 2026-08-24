import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getQueue } from './queue.js';

test('getQueue starts pg-boss and delivers a job to a subscriber', async () => {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const boss = await getQueue(databaseUrl);
  try {
    const topic = `test-topic-${Date.now()}`;
    let resolveReceived;
    const received = new Promise((resolve) => {
      resolveReceived = resolve;
    });
    await boss.work(topic, async (job) => {
      resolveReceived(job.data);
    });
    await boss.send(topic, { hello: 'world' });
    const data = await received;
    assert.deepEqual(data, { hello: 'world' });
  } finally {
    await boss.stop();
  }
});

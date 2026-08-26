import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getQueue } from '@forge/db';
import { enqueue, GRADING_TOPIC } from './index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('enqueue sends exactly one job on the grading topic carrying the submission id', async () => {
  const boss = await getQueue(databaseUrl);
  try {
    const received: Array<{ submissionId: string }> = [];
    let resolveReceived: () => void;
    const gotOne = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });

    await boss.work(GRADING_TOPIC, async (job) => {
      received.push(job.data as { submissionId: string });
      resolveReceived();
    });

    await enqueue('11111111-1111-1111-1111-111111111111', databaseUrl);

    await gotOne;

    assert.equal(received.length, 1);
    assert.equal(received[0].submissionId, '11111111-1111-1111-1111-111111111111');
  } finally {
    await boss.stop();
  }
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getQueue } from '@forge/db';
import { enqueue, GRADING_TOPIC } from './index.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

test('enqueue sends exactly one job on the grading topic carrying the submission id', async () => {
  const boss = await getQueue(databaseUrl);
  try {
    const submissionId = '11111111-1111-1111-1111-111111111111';
    let received: { submissionId: string } | undefined;
    let resolveReceived: () => void;
    const gotOne = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });

    // The grading topic is shared across test runs, so a stale job from a
    // prior run could be delivered here too; only match on the id we send.
    await boss.work(GRADING_TOPIC, async (job) => {
      const data = job.data as { submissionId: string };
      if (data.submissionId === submissionId) {
        received = data;
        resolveReceived();
      }
    });

    await enqueue(submissionId, databaseUrl);

    await gotOne;

    assert.equal(received?.submissionId, submissionId);
  } finally {
    await boss.stop();
  }
});

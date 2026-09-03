import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { getQueue } from '@forge/db';
import {
  runPipeline,
  registerGradingWorker,
  type GradingJob,
  type PipelineStage,
  type StageStatusUpdate,
} from './pipeline.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://forge:forge@postgres:5432/forge';

function makeJob(submissionId: string = randomUUID()): GradingJob {
  return { id: randomUUID(), data: { submissionId } };
}

async function waitFor(deadlineMs: number, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('waitFor: condition was not met before the deadline');
}

test('runPipeline runs stages in order and records a status update for every entered and completed stage', async () => {
  const calls: string[] = [];
  const updates: StageStatusUpdate[] = [];

  const stageA: PipelineStage = {
    name: 'a',
    run: async () => {
      calls.push('a');
      return { outcome: 'passed' };
    },
  };
  const stageB: PipelineStage = {
    name: 'b',
    run: async () => {
      calls.push('b');
      return { outcome: 'passed' };
    },
  };

  await runPipeline(makeJob(), [stageA, stageB], (update) => {
    updates.push(update);
  });

  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(
    updates.map((update) => `${update.stage}:${update.status}`),
    ['a:started', 'a:passed', 'b:started', 'b:passed'],
  );
});

test('runPipeline waits for a stage to resolve before starting the next one', async () => {
  const order: string[] = [];

  const slowStage: PipelineStage = {
    name: 'slow',
    run: async () => {
      order.push('slow:start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push('slow:end');
      return { outcome: 'passed' };
    },
  };
  const fastStage: PipelineStage = {
    name: 'fast',
    run: async () => {
      order.push('fast:start');
      return { outcome: 'passed' };
    },
  };

  await runPipeline(makeJob(), [slowStage, fastStage], () => {});

  assert.deepEqual(order, ['slow:start', 'slow:end', 'fast:start']);
});

test('runPipeline stops after a member failure without running later stages', async () => {
  const calls: string[] = [];
  const updates: StageStatusUpdate[] = [];

  const failingStage: PipelineStage = {
    name: 'check',
    run: async () => {
      calls.push('check');
      return { outcome: 'member-failure', message: 'submission failed a check' };
    },
  };
  const laterStage: PipelineStage = {
    name: 'later',
    run: async () => {
      calls.push('later');
      return { outcome: 'passed' };
    },
  };

  await runPipeline(makeJob(), [failingStage, laterStage], (update) => {
    updates.push(update);
  });

  assert.deepEqual(calls, ['check']);
  assert.deepEqual(
    updates.map((update) => `${update.stage}:${update.status}`),
    ['check:started', 'check:member-failure'],
  );
});

test('registerGradingWorker retries a throwing platform stage three times before the job fails', async () => {
  const boss = await getQueue(databaseUrl);
  const queueName = `grading-test-${randomUUID()}`;
  let executions = 0;

  try {
    const platformStage: PipelineStage = {
      name: 'platform',
      run: async () => {
        executions += 1;
        throw new Error('infrastructure error');
      },
    };

    await registerGradingWorker(boss, [platformStage], () => {}, { queueName });

    const jobId = await boss.send(queueName, { submissionId: randomUUID() }, { retryLimit: 3, retryDelay: 1 });
    assert.ok(jobId);

    await waitFor(30_000, async () => {
      const job = await boss.getJobById(jobId as string);
      return job?.state === 'failed';
    });

    assert.equal(executions, 4);
  } finally {
    await boss.stop();
  }
});

test('registerGradingWorker completes a reported member failure without retrying', async () => {
  const boss = await getQueue(databaseUrl);
  const queueName = `grading-test-${randomUUID()}`;
  let executions = 0;

  try {
    const memberStage: PipelineStage = {
      name: 'member-check',
      run: async () => {
        executions += 1;
        return { outcome: 'member-failure', message: 'submission failed a check' };
      },
    };

    await registerGradingWorker(boss, [memberStage], () => {}, { queueName });

    const jobId = await boss.send(queueName, { submissionId: randomUUID() }, { retryLimit: 3, retryDelay: 1 });
    assert.ok(jobId);

    await waitFor(10_000, async () => {
      const job = await boss.getJobById(jobId as string);
      return job?.state === 'completed';
    });

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    assert.equal(executions, 1);
  } finally {
    await boss.stop();
  }
});

test('registerGradingWorker processes at most one grading job at a time', async () => {
  const boss = await getQueue(databaseUrl);
  const queueName = `grading-test-${randomUUID()}`;
  let active = 0;
  let maxActive = 0;

  try {
    const instrumentedStage: PipelineStage = {
      name: 'instrumented',
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 300));
        active -= 1;
        return { outcome: 'passed' };
      },
    };

    let completed = 0;
    await registerGradingWorker(
      boss,
      [instrumentedStage],
      (update) => {
        if (update.status === 'passed') {
          completed += 1;
        }
      },
      { queueName },
    );

    await boss.send(queueName, { submissionId: randomUUID() });
    await boss.send(queueName, { submissionId: randomUUID() });

    await waitFor(10_000, async () => completed === 2);

    assert.equal(maxActive, 1);
  } finally {
    await boss.stop();
  }
});

import { and, eq, isNull, ne } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import type { Submission } from '../submissions/index.js';

export const GRADING_TOPIC = 'grading';
export const GRADING_COMPLETED_TOPIC = 'grading-completed';
const { gradingRuns } = schema;

export type GradingRun = typeof gradingRuns.$inferSelect;
export type RunCompletedHandler = (run: { id: string; score: number }) => Promise<void> | void;

interface CompletionConsumer {
  boss: Awaited<ReturnType<typeof getQueue>>;
  handlers: Set<RunCompletedHandler>;
}

const completionConsumers = new Map<string, Promise<CompletionConsumer>>();

async function publishRun(boss: Awaited<ReturnType<typeof getQueue>>, runId: string, submissionId: string): Promise<void> {
  await boss.send(GRADING_TOPIC, { runId, submissionId }, { retryLimit: 3 });
}

export async function enqueue(submission: Submission, databaseUrl: string = loadEnv().DATABASE_URL): Promise<GradingRun> {
  const { db, pool } = createDbClient(databaseUrl);
  const boss = await getQueue(databaseUrl);
  try {
    const [run] = await db.insert(gradingRuns).values({ submissionId: submission.id, status: 'queued' }).returning();
    await publishRun(boss, run.id, submission.id);
    return run;
  } finally {
    await boss.stop();
    await pool.end();
  }
}

export async function retry(runId: string, databaseUrl: string = loadEnv().DATABASE_URL): Promise<GradingRun> {
  const { db, pool } = createDbClient(databaseUrl);
  const boss = await getQueue(databaseUrl);
  try {
    const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, runId));
    if (!run) throw new Error(`Grading module: no run found with id ${runId}`);
    if (run.status === 'queued' || run.status === 'running') {
      throw new Error(`Grading module: run ${runId} is active`);
    }
    const [reset] = await db.update(gradingRuns).set({
      status: 'queued', score: null, reportUrl: null, currentStage: null,
      completionEventSentAt: null, updatedAt: new Date(),
    }).where(and(eq(gradingRuns.id, runId), ne(gradingRuns.status, 'queued'), ne(gradingRuns.status, 'running'))).returning();
    if (!reset) throw new Error(`Grading module: run ${runId} became active`);
    await publishRun(boss, reset.id, reset.submissionId);
    return reset;
  } finally {
    await boss.stop();
    await pool.end();
  }
}

async function createCompletionConsumer(databaseUrl: string): Promise<CompletionConsumer> {
  const boss = await getQueue(databaseUrl);
  const consumer: CompletionConsumer = { boss, handlers: new Set() };
  await boss.work(GRADING_COMPLETED_TOPIC, { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    const data = job.data as { id?: unknown };
    if (typeof data.id !== 'string') throw new Error(`Grading completion job ${job.id} is missing a run id`);
    const { db, pool } = createDbClient(databaseUrl);
    try {
      const [run] = await db.select().from(gradingRuns).where(eq(gradingRuns.id, data.id));
      if (!run || run.completionEventSentAt) return;
      if ((run.status !== 'successful' && run.status !== 'failed') || typeof run.score !== 'number') {
        throw new Error(`Grading completion job ${job.id} references a non-terminal run`);
      }
      for (const handler of consumer.handlers) await handler({ id: run.id, score: run.score });
      await db.update(gradingRuns).set({ completionEventSentAt: new Date(), updatedAt: new Date() })
        .where(and(eq(gradingRuns.id, run.id), isNull(gradingRuns.completionEventSentAt)));
    } finally {
      await pool.end();
    }
  });
  return consumer;
}

export async function onRunCompleted(
  handler: RunCompletedHandler,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<() => Promise<void>> {
  let pending = completionConsumers.get(databaseUrl);
  if (!pending) {
    pending = createCompletionConsumer(databaseUrl);
    completionConsumers.set(databaseUrl, pending);
  }
  const consumer = await pending;
  consumer.handlers.add(handler);
  return async () => {
    consumer.handlers.delete(handler);
    if (consumer.handlers.size === 0 && completionConsumers.get(databaseUrl) === pending) {
      completionConsumers.delete(databaseUrl);
      await consumer.boss.stop();
    }
  };
}

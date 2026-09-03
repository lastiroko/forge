import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import type { Submission } from '../submissions/index.js';

export const GRADING_TOPIC = 'grading';
export const GRADING_COMPLETED_TOPIC = 'grading-completed';
const { gradingRuns, submissions, enrollments } = schema;

export type GradingRun = typeof gradingRuns.$inferSelect;
export type AccountExportGradingReport = Pick<GradingRun, 'id' | 'submissionId' | 'status' | 'score' | 'reportUrl' | 'createdAt'>;
export type ReportObjectReader = (key: string) => Promise<AsyncIterable<Uint8Array>>;

export class AccountExportSizeError extends Error {
  readonly status = 413;

  constructor(message = 'Account export is too large') {
    super(message);
    this.name = 'AccountExportSizeError';
  }
}

export function isAccountExportSizeError(error: unknown): error is AccountExportSizeError {
  return error instanceof Error && error.name === 'AccountExportSizeError';
}

export async function listAccountExportGradingReports(
  userId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<AccountExportGradingReport[]> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    return await db.select({
      id: gradingRuns.id,
      submissionId: gradingRuns.submissionId,
      status: gradingRuns.status,
      score: gradingRuns.score,
      reportUrl: gradingRuns.reportUrl,
      createdAt: gradingRuns.createdAt,
    }).from(gradingRuns)
      .innerJoin(submissions, eq(gradingRuns.submissionId, submissions.id))
      .innerJoin(enrollments, eq(submissions.enrollmentId, enrollments.id))
      .where(and(eq(enrollments.userId, userId), isNotNull(gradingRuns.reportUrl)))
      .orderBy(asc(gradingRuns.createdAt), asc(gradingRuns.id));
  } finally {
    await pool.end();
  }
}

export async function readAccountExportReportObject(key: string): Promise<AsyncIterable<Uint8Array>> {
  const env = loadEnv();
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  const response = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  if (!response.Body || !(Symbol.asyncIterator in response.Body)) {
    client.destroy();
    throw new Error(`Grading module: report object ${key} has no readable body`);
  }
  const body = response.Body as AsyncIterable<Uint8Array>;
  return (async function* () {
    try {
      yield* body;
    } finally {
      client.destroy();
    }
  })();
}

export async function loadAccountExportReport(
  runId: string,
  reader: ReportObjectReader,
  budget: { aggregateBytes: number },
  perReportLimit: number,
  aggregateLimit: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let reportBytes = 0;
  const key = `reports/${runId}/report.json`;
  const body = await reader(key);
  for await (const value of body) {
    const chunk = Buffer.from(value);
    reportBytes += chunk.byteLength;
    budget.aggregateBytes += chunk.byteLength;
    if (reportBytes > perReportLimit || budget.aggregateBytes > aggregateLimit) {
      throw new AccountExportSizeError();
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error(`Grading module: report object ${key} is not valid JSON`);
  }
}
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

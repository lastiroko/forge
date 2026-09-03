import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { loadEnv, type Env } from '@forge/shared';
import { registerLeaderboardSnapshotJob } from './lib/leaderboard-snapshot.js';
import { registerGradingWorker, type PipelineStage } from './pipeline.js';

export const GRADING_COMPLETED_TOPIC = 'grading-completed';
const { enrollments, gradingRuns, submissions, workerHeartbeats } = schema;
const workerId = randomUUID();

export function startWorkerHeartbeat(
  databaseUrl: string,
  intervalMs = 15_000,
  instanceId = workerId,
): () => Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  let stopped = false;
  let writeInProgress: Promise<void> | undefined;

  const writeHeartbeat = () => {
    if (stopped || writeInProgress) return;
    writeInProgress = db.insert(workerHeartbeats).values({ workerId: instanceId }).onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: { lastHeartbeatAt: sql`now()` },
    }).then(() => undefined).catch((error: unknown) => {
      console.error('Worker heartbeat write failed:', error);
    }).finally(() => {
      writeInProgress = undefined;
    });
  };

  writeHeartbeat();
  const interval = setInterval(writeHeartbeat, intervalMs);
  interval.unref();

  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    await writeInProgress;
    await pool.end();
  };
}

export async function registerWorker(
  boss: Awaited<ReturnType<typeof getQueue>>,
  stages: PipelineStage[],
  databaseUrl: string,
): Promise<void> {
  await registerGradingWorker(
    boss,
    stages,
    async (update) => {
      const { db, pool } = createDbClient(databaseUrl);
      try {
        const runStatus = update.status === 'started' || update.status === 'passed' ? 'running' : 'failed';
        await db.update(gradingRuns).set({
          status: runStatus,
          currentStage: update.stage,
          updatedAt: sql`greatest(${gradingRuns.updatedAt} + interval '1 millisecond', now())`,
        }).where(and(eq(gradingRuns.id, update.runId), eq(gradingRuns.submissionId, update.submissionId)));
        await db.update(submissions).set({ status: runStatus }).where(eq(submissions.id, update.submissionId));
      } finally {
        await pool.end();
      }
    },
    {},
    async (job, result) => {
      const { db, pool } = createDbClient(databaseUrl);
      try {
        const status = result.outcome === 'successful' ? 'successful' : 'failed';
        await db.transaction(async (tx) => {
          const [stored] = await tx.update(gradingRuns).set({
            status,
            score: result.score,
            reportUrl: result.reportUrl,
            buildLogUrl: result.buildLogUrl,
            appLogUrl: result.appLogUrl,
            updatedAt: sql`greatest(${gradingRuns.updatedAt} + interval '1 millisecond', now())`,
          }).where(and(eq(gradingRuns.id, job.data.runId), eq(gradingRuns.submissionId, job.data.submissionId))).returning({ id: gradingRuns.id });
          if (!stored) throw new Error(`Grading worker: run ${job.data.runId} does not match submission ${job.data.submissionId}`);
          await tx.update(submissions).set({ status }).where(eq(submissions.id, job.data.submissionId));
          if (result.outcome === 'successful') {
            await tx.execute(sql`
              UPDATE enrollments AS e SET best_grading_run_id = ${job.data.runId}
              FROM submissions AS s
              WHERE s.id = ${job.data.submissionId} AND e.id = s.enrollment_id
                AND (${result.score} > COALESCE((SELECT score FROM grading_runs WHERE id = e.best_grading_run_id), '-Infinity'::float8))
            `);
          }
        });
        await boss.send(
          GRADING_COMPLETED_TOPIC,
          { id: job.data.runId, score: result.score },
          { singletonKey: `grading-completed-${job.data.runId}` },
        );
      } finally {
        await pool.end();
      }
    },
  );
}

export function createServer() {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const server = createServer();
  server.listen(env.PORT, async () => {
    console.log(`worker listening on http://localhost:${env.PORT}`);
    const boss = await getQueue(env.DATABASE_URL);
    const stopHeartbeat = startWorkerHeartbeat(env.DATABASE_URL);
    await registerLeaderboardSnapshotJob(boss, { databaseUrl: env.DATABASE_URL });
    // TODO: assemble concrete production stages once their runtime inputs and
    // member/platform result classifications are defined.
    await registerWorker(boss, [], env.DATABASE_URL);

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await stopHeartbeat();
      await boss.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

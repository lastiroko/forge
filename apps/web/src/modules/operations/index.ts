import { cookies } from 'next/headers';
import { asc, desc, eq } from 'drizzle-orm';
import { createDbClient, getQueue, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import { cancel, GRADING_TOPIC, retry } from '../grading/index.js';
import { requireRole, type SessionCookieReader } from '../identity/index.js';

const { gradingRuns, workerHeartbeats, auditLog } = schema;

export interface OperationsRun {
  id: string;
  submissionId: string;
  stage: string | null;
  updatedAt: Date;
}

export interface WorkerHeartbeat {
  workerId: string;
  startedAt: Date;
  lastHeartbeatAt: Date;
  status: 'healthy' | 'stale';
}

export interface AdminOperations {
  queueLength: number;
  runningRuns: OperationsRun[];
  failedRuns: OperationsRun[];
  workers: WorkerHeartbeat[];
}

export async function getAdminOperations(
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
  now = new Date(),
): Promise<AdminOperations> {
  await requireRole('admin', cookieStore, databaseUrl);

  const boss = await getQueue(databaseUrl);
  try {
    const queueLength = await boss.getQueueSize(GRADING_TOPIC);
    const { db, pool } = createDbClient(databaseUrl);
    try {
      const [runningRuns, failedRuns, heartbeats] = await Promise.all([
        db.select({
          id: gradingRuns.id,
          submissionId: gradingRuns.submissionId,
          stage: gradingRuns.currentStage,
          updatedAt: gradingRuns.updatedAt,
        }).from(gradingRuns).where(eq(gradingRuns.status, 'running')).orderBy(desc(gradingRuns.updatedAt), desc(gradingRuns.id)),
        db.select({
          id: gradingRuns.id,
          submissionId: gradingRuns.submissionId,
          stage: gradingRuns.currentStage,
          updatedAt: gradingRuns.updatedAt,
        }).from(gradingRuns).where(eq(gradingRuns.status, 'failed')).orderBy(desc(gradingRuns.updatedAt), desc(gradingRuns.id)).limit(10),
        db.select().from(workerHeartbeats).orderBy(asc(workerHeartbeats.workerId)),
      ]);

      return {
        queueLength,
        runningRuns,
        failedRuns,
        workers: heartbeats.map((heartbeat) => ({
          ...heartbeat,
          status: now.getTime() - heartbeat.lastHeartbeatAt.getTime() <= 60_000 ? 'healthy' : 'stale',
        })),
      };
    } finally {
      await pool.end();
    }
  } finally {
    await boss.stop();
  }
}

export async function retryGradingRun(
  runId: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const admin = await requireRole('admin', cookieStore, databaseUrl);
  await retry(runId, databaseUrl);

  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.insert(auditLog).values({
      actorId: admin.id,
      action: 'grading_run.retry',
      targetType: 'grading_run',
      targetId: runId,
      reason: 'Admin retried a failed grading run',
    });
  } finally {
    await pool.end();
  }
}

export async function cancelGradingRun(
  runId: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const admin = await requireRole('admin', cookieStore, databaseUrl);
  await cancel(runId, databaseUrl);

  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.insert(auditLog).values({
      actorId: admin.id,
      action: 'grading_run.cancel',
      targetType: 'grading_run',
      targetId: runId,
      reason: 'Admin cancelled a running grading run',
    });
  } finally {
    await pool.end();
  }
}

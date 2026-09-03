import type PgBoss from 'pg-boss';

export const GRADING_TOPIC = 'grading';

export interface GradingJobData {
  runId: string;
  submissionId: string;
}

export interface GradingJob {
  id: string;
  data: GradingJobData;
}

export type PipelineStageResult =
  | { outcome: 'passed'; score?: number; reportUrl?: string }
  | { outcome: 'member-failure'; message: string };

export interface PipelineStage {
  name: string;
  run: (job: GradingJob) => Promise<PipelineStageResult>;
}

export type StageStatus = 'started' | 'platform-failure' | PipelineStageResult['outcome'];

export interface StageStatusUpdate {
  runId: string;
  submissionId: string;
  stage: string;
  status: StageStatus;
  message?: string;
}

export type UpdateStatus = (update: StageStatusUpdate) => Promise<void> | void;
export type PipelineResult =
  | { outcome: 'successful'; score: number; reportUrl: string | null }
  | { outcome: 'member-failure'; score: number; reportUrl: null; message: string };
export type CompletePipeline = (job: GradingJob, result: PipelineResult) => Promise<void> | void;

export async function runPipeline(
  job: GradingJob,
  stages: PipelineStage[],
  updateStatus: UpdateStatus,
  complete: CompletePipeline = () => {},
): Promise<PipelineResult> {
  let score = 0;
  let reportUrl: string | null = null;
  for (const stage of stages) {
    await updateStatus({ runId: job.data.runId, submissionId: job.data.submissionId, stage: stage.name, status: 'started' });

    let result: PipelineStageResult;
    try {
      result = await stage.run(job);
    } catch (error) {
      await updateStatus({
        runId: job.data.runId,
        submissionId: job.data.submissionId,
        stage: stage.name,
        status: 'platform-failure',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (result.outcome === 'member-failure') {
      await updateStatus({
        runId: job.data.runId,
        submissionId: job.data.submissionId,
        stage: stage.name,
        status: 'member-failure',
        message: result.message,
      });
      const terminal = { outcome: 'member-failure' as const, score: 0, reportUrl: null, message: result.message };
      await complete(job, terminal);
      return terminal;
    }

    if (typeof result.score === 'number') score = result.score;
    if (result.reportUrl) reportUrl = result.reportUrl;
    await updateStatus({ runId: job.data.runId, submissionId: job.data.submissionId, stage: stage.name, status: 'passed' });
  }
  const terminal = { outcome: 'successful' as const, score, reportUrl };
  await complete(job, terminal);
  return terminal;
}

function isGradingJobData(data: unknown): data is GradingJobData {
  const value = data as { runId?: unknown; submissionId?: unknown };
  return typeof data === 'object' && data !== null && typeof value.runId === 'string' && typeof value.submissionId === 'string';
}

export interface RegisterGradingWorkerOptions {
  queueName?: string;
}

export async function registerGradingWorker(
  boss: PgBoss,
  stages: PipelineStage[],
  updateStatus: UpdateStatus,
  options: RegisterGradingWorkerOptions = {},
  complete: CompletePipeline = () => {},
): Promise<void> {
  const queueName = options.queueName ?? GRADING_TOPIC;

  await boss.work(queueName, { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    if (!isGradingJobData(job.data)) {
      throw new Error(`Grading worker: job ${job.id} is missing string runId or submissionId`);
    }

    await runPipeline({ id: job.id, data: job.data }, stages, updateStatus, complete);
  });
}

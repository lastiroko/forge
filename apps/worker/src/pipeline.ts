import type PgBoss from 'pg-boss';

export const GRADING_TOPIC = 'grading';

export interface GradingJobData {
  submissionId: string;
}

export interface GradingJob {
  id: string;
  data: GradingJobData;
}

export type PipelineStageResult =
  | { outcome: 'passed' }
  | { outcome: 'member-failure'; message: string };

export interface PipelineStage {
  name: string;
  run: (job: GradingJob) => Promise<PipelineStageResult>;
}

export type StageStatus = 'started' | PipelineStageResult['outcome'];

export interface StageStatusUpdate {
  submissionId: string;
  stage: string;
  status: StageStatus;
  message?: string;
}

export type UpdateStatus = (update: StageStatusUpdate) => Promise<void> | void;

export async function runPipeline(
  job: GradingJob,
  stages: PipelineStage[],
  updateStatus: UpdateStatus,
): Promise<void> {
  for (const stage of stages) {
    await updateStatus({ submissionId: job.data.submissionId, stage: stage.name, status: 'started' });

    const result = await stage.run(job);

    if (result.outcome === 'member-failure') {
      await updateStatus({
        submissionId: job.data.submissionId,
        stage: stage.name,
        status: 'member-failure',
        message: result.message,
      });
      return;
    }

    await updateStatus({ submissionId: job.data.submissionId, stage: stage.name, status: 'passed' });
  }
}

function isGradingJobData(data: unknown): data is GradingJobData {
  return typeof data === 'object' && data !== null && typeof (data as { submissionId?: unknown }).submissionId === 'string';
}

export interface RegisterGradingWorkerOptions {
  queueName?: string;
}

export async function registerGradingWorker(
  boss: PgBoss,
  stages: PipelineStage[],
  updateStatus: UpdateStatus,
  options: RegisterGradingWorkerOptions = {},
): Promise<void> {
  const queueName = options.queueName ?? GRADING_TOPIC;

  await boss.work(queueName, { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    if (!isGradingJobData(job.data)) {
      throw new Error(`Grading worker: job ${job.id} is missing a string submissionId`);
    }

    await runPipeline({ id: job.id, data: job.data }, stages, updateStatus);
  });
}

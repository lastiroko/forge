import { getQueue } from '@forge/db';
import { loadEnv } from '@forge/shared';

export const GRADING_TOPIC = 'grading';

export async function enqueue(submissionId: string, databaseUrl: string = loadEnv().DATABASE_URL): Promise<void> {
  const boss = await getQueue(databaseUrl);
  try {
    await boss.send(GRADING_TOPIC, { submissionId });
  } finally {
    await boss.stop();
  }
}

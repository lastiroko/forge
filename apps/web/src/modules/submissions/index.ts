import { eq } from 'drizzle-orm';
import { createDbClient, submissions } from '@forge/db';

export interface SubmissionEnrollment {
  id: string;
  repoUrl: string;
}

export type Submission = typeof submissions.$inferSelect;

export const MOCKED_DEFAULT_BRANCH_HEAD_SHA = 'mock-default-branch-head-sha';

async function resolveDefaultBranchHeadSha(_repoUrl: string): Promise<string> {
  return MOCKED_DEFAULT_BRANCH_HEAD_SHA;
}

export async function submit(enrollment: SubmissionEnrollment, sha?: string): Promise<Submission> {
  const commitSha = sha ?? (await resolveDefaultBranchHeadSha(enrollment.repoUrl));
  const { db, pool } = createDbClient();
  try {
    const [inserted] = await db
      .insert(submissions)
      .values({ enrollmentId: enrollment.id, commitSha, status: 'queued' })
      .returning();
    return inserted;
  } finally {
    await pool.end();
  }
}

export async function getSubmission(id: string): Promise<Submission | undefined> {
  const { db, pool } = createDbClient();
  try {
    const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
    return row;
  } finally {
    await pool.end();
  }
}

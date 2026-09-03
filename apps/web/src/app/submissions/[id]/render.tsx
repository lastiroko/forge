import React from 'react';
import { notFound } from 'next/navigation';
import type { User } from '../../../modules/identity/index.js';
import { getLatestGradingStatus, getSubmissionForUser } from '../../../modules/submissions/index.js';
import { SubmissionStatus } from './SubmissionStatus.js';

export async function renderSubmissionPage(id: string, user: User) {
  const submission = await getSubmissionForUser(id, user.id);
  if (!submission) notFound();
  const status = await getLatestGradingStatus(submission.id);

  return (
    <main>
      <h1>Submission</h1>
      <p>Commit: {submission.commitSha}</p>
      <SubmissionStatus submissionId={submission.id} initialStatus={status} />
    </main>
  );
}

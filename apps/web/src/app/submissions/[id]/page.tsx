import React from 'react';
import { notFound } from 'next/navigation';
import { getCurrentUser, type User } from '../../../modules/identity/index.js';
import { getLatestGradingStatus, getSubmissionForUser } from '../../../modules/submissions/index.js';
import { SubmissionStatus } from './SubmissionStatus.js';

export const dynamic = 'force-dynamic';

export default async function SubmissionPage({ params }: { params: { id: string } }) {
  let user: User | undefined;
  try {
    user = await getCurrentUser();
  } catch {
    user = undefined;
  }
  if (!user) notFound();
  return renderSubmissionPage(params.id, user);
}

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

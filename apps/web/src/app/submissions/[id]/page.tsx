import { notFound } from 'next/navigation';
import { getLatestGradingStatus, getSubmission } from '../../../modules/submissions/index.js';
import { SubmissionStatus } from './SubmissionStatus.js';

export const dynamic = 'force-dynamic';

export default async function SubmissionPage({ params }: { params: { id: string } }) {
  // TODO: enforce submission ownership once identity exposes a non-throwing
  // authenticated-user lookup suitable for server pages.
  const submission = await getSubmission(params.id);
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

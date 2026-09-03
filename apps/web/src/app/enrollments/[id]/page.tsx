import { notFound } from 'next/navigation';
import { getEnrollmentHistory } from '../../../modules/enrollment/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';

export const dynamic = 'force-dynamic';

export default async function EnrollmentPage({ params }: { params: { id: string } }) {
  const viewer = await getCurrentUser();
  if (!viewer) notFound();
  const history = await getEnrollmentHistory(params.id, viewer);
  if (!history) notFound();

  return <main>
    <h1>Run history</h1>
    {history.submissions.map((submission) => <section key={submission.id}>
      <h2>{submission.commitSha}</h2>
      <p>Submission status: {submission.status}</p>
      {submission.runs.length === 0 ? <p>No grading runs</p> : submission.runs.map((run) => <article key={run.id}>
        <p>Run status: {run.status}</p>
        {run.score !== null && <p>Score: {run.score}</p>}
        {run.reportUrl && <a href={run.reportUrl}>Report</a>}
        {run.buildLogUrl && <a href={run.buildLogUrl}>Build log</a>}
        {run.appLogUrl && <a href={run.appLogUrl}>App log</a>}
      </article>)}
    </section>)}
  </main>;
}

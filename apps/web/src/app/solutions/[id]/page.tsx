import { notFound } from 'next/navigation';
import { getPublishedSolution, listComments } from '../../../modules/community/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';
import { Comments } from '../../Comments.js';

export const dynamic = 'force-dynamic';

export default async function SolutionPage({ params }: { params: { id: string } }) {
  const solution = await getPublishedSolution(params.id);
  if (!solution) notFound();
  const user = await getCurrentUser();
  const target = { type: 'solution' as const, id: solution.id };
  const initialComments = await listComments(target);

  return (
    <main>
      <h1>{solution.title}</h1>
      <p>{solution.writeup}</p>
      {solution.repoUrl ? (
        <p><a href={solution.repoUrl}>Repository</a></p>
      ) : null}
      <p>Score: {solution.score}</p>
      {solution.reportUrl ? (
        <p><a href={solution.reportUrl}>Grading report</a></p>
      ) : null}
      <Comments target={target} initialComments={initialComments} isSignedIn={Boolean(user)} />
    </main>
  );
}

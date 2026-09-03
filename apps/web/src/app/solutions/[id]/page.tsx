import { notFound } from 'next/navigation';
import { getPublishedSolution } from '../../../modules/community/index.js';

export const dynamic = 'force-dynamic';

export default async function SolutionPage({ params }: { params: { id: string } }) {
  let solution;
  try {
    solution = await getPublishedSolution(params.id);
  } catch {
    solution = undefined;
  }
  if (!solution) notFound();

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
    </main>
  );
}

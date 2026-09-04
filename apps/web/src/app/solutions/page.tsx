import { notFound } from 'next/navigation';
import { listPublishedSolutions } from '../../modules/community/index.js';

export const dynamic = 'force-dynamic';

export default async function SolutionsPage() {
  let solutions;
  try {
    solutions = await listPublishedSolutions();
  } catch {
    solutions = undefined;
  }
  if (!solutions) notFound();

  return (
    <main>
      <h1>Solution gallery</h1>
      {solutions.length === 0 ? (
        <p>No published solutions yet.</p>
      ) : (
        <ul>
          {solutions.map((solution) => (
            <li key={solution.id}>
              <a href={`/solutions/${solution.id}`}>{solution.title}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

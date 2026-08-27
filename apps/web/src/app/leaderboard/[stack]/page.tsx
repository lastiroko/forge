import { getLeaderboard } from '../../../modules/scoring/index.js';

export const revalidate = 60;

interface StackLeaderboardPageProps {
  params: { stack: string };
}

export default async function StackLeaderboardPage({ params }: StackLeaderboardPageProps) {
  const entries = await getLeaderboard(params.stack);

  return (
    <main>
      <h1>Leaderboard</h1>
      <ol>
        {entries.map((entry) => (
          <li key={entry.userId}>
            <span>{entry.handle}</span>
            {' — '}
            <span>{entry.totalPoints} pts</span>
          </li>
        ))}
      </ol>
    </main>
  );
}

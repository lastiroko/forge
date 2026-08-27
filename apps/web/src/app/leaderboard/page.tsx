import { getLeaderboard, GLOBAL_SCOPE } from '../../modules/scoring/index.js';

export const revalidate = 60;

export default async function LeaderboardPage() {
  const entries = await getLeaderboard(GLOBAL_SCOPE);

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

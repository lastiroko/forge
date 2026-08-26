import { listChallenges, type Stack } from '../../modules/catalogue/index.js';

export const revalidate = 60;

interface ChallengesPageProps {
  searchParams: {
    level?: string;
    mode?: string;
    stack?: string;
    sort?: string;
  };
}

export default async function ChallengesPage({ searchParams }: ChallengesPageProps) {
  const level = searchParams.level && searchParams.level !== 'all' ? searchParams.level : undefined;
  const mode = searchParams.mode && searchParams.mode !== 'all' ? searchParams.mode : undefined;
  const stack = searchParams.stack && searchParams.stack !== 'all' ? searchParams.stack : undefined;

  const challengeSummaries = await listChallenges({
    level,
    mode: mode as 'backend' | 'fullstack' | undefined,
    stackId: stack,
    sort: searchParams.sort as 'newest' | 'most-completed' | 'points' | undefined,
  });

  const stackOptions = new Map<string, Stack>();
  for (const challenge of challengeSummaries) {
    for (const stack of challenge.enabledStacks) {
      stackOptions.set(stack.id, stack);
    }
  }

  return (
    <main>
      <h1>Challenges</h1>
      <form method="get">
        <select name="level" defaultValue={searchParams.level ?? 'all'}>
          <option value="all">All levels</option>
          <option value="junior">Junior</option>
          <option value="mid">Mid</option>
          <option value="senior">Senior</option>
        </select>
        <select name="mode" defaultValue={searchParams.mode ?? 'all'}>
          <option value="all">All modes</option>
          <option value="backend">Backend</option>
          <option value="fullstack">Fullstack</option>
        </select>
        <select name="stack" defaultValue={searchParams.stack ?? 'all'}>
          <option value="all">All stacks</option>
          {Array.from(stackOptions.values()).map((stack) => (
            <option key={stack.id} value={stack.id}>
              {stack.language} / {stack.framework}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={searchParams.sort ?? 'newest'}>
          <option value="newest">Newest</option>
          <option value="most-completed">Most completed</option>
          <option value="points">Points</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      <ul>
        {challengeSummaries.map((challenge) => (
          <li key={challenge.id}>
            <span>{challenge.title}</span>
            {' — '}
            <span>{challenge.level}</span>
            {' — '}
            <span>
              {challenge.enabledStacks.map((stack) => `${stack.language} / ${stack.framework}`).join(', ')}
            </span>
            {' — '}
            <span>{challenge.basePoints} pts</span>
            {' — '}
            <span>{challenge.completionCount} completions</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

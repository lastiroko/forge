import { notFound } from 'next/navigation';
import { getChallenge, getEnabledStacks } from '../../../modules/catalogue/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';
import { StartChallengeFlow } from './StartChallengeFlow.js';

export const revalidate = 60;

export default async function ChallengePage({ params }: { params: { id: string } }) {
  const challenge = await getChallenge(params.id);
  if (!challenge) notFound();
  const enabledStacks = await getEnabledStacks(params.id);

  let user;
  try {
    user = await getCurrentUser();
  } catch {
    // identity.getCurrentUser is an unimplemented skeleton that always throws, so treat this as signed out for now.
    user = undefined;
  }

  return (
    <main>
      <h1>{challenge.title}</h1>
      <p>{challenge.level}</p>
      {user ? (
        <StartChallengeFlow
          challengeId={challenge.id}
          userId={user.id}
          backendEnabled={challenge.backendEnabled}
          fullstackEnabled={challenge.fullstackEnabled}
          stacks={enabledStacks.map((stack) => ({
            id: stack.id,
            language: stack.language,
            framework: stack.framework,
          }))}
        />
      ) : <p>Sign in with GitHub to start this challenge.</p>}
    </main>
  );
}

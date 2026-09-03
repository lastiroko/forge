import { notFound } from 'next/navigation';
import { getChallenge, getEnabledStacks, getLatestPublishedVersion } from '../../../modules/catalogue/index.js';
import { getCurrentUser } from '../../../modules/identity/index.js';
import { StartChallengeFlow } from './StartChallengeFlow.js';

export const revalidate = 60;

interface RubricWeights {
  functional: number;
  contract: number;
  robustness: number;
  quality: number;
}

export default async function ChallengePage({ params }: { params: { id: string } }) {
  const challenge = await getChallenge(params.id);
  if (!challenge) notFound();
  const version = await getLatestPublishedVersion(params.id);
  if (!version) notFound();
  const rubric = version.rubric as RubricWeights;
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
      <pre>{version.brief}</pre>
      <h2>Rubric weights</h2>
      <dl>
        <dt>Functional</dt>
        <dd>{rubric.functional}</dd>
        <dt>Contract</dt>
        <dd>{rubric.contract}</dd>
        <dt>Robustness</dt>
        <dd>{rubric.robustness}</dd>
        <dt>Quality</dt>
        <dd>{rubric.quality}</dd>
      </dl>
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

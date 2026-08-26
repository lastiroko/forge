import { notFound } from 'next/navigation';
import { getChallenge, getLatestPublishedVersion } from '../../../modules/catalogue/index.js';

interface RubricWeights {
  functional: number;
  contract: number;
  robustness: number;
  quality: number;
}

export default async function ChallengeDetailPage({ params }: { params: { id: string } }) {
  const challenge = await getChallenge(params.id);
  if (!challenge) {
    notFound();
  }

  const version = await getLatestPublishedVersion(params.id);
  if (!version) {
    notFound();
  }

  const rubric = version.rubric as RubricWeights;

  return (
    <main>
      <h1>{challenge.title}</h1>
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
    </main>
  );
}

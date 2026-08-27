import { notFound } from 'next/navigation';
import { getPublicProfile } from '../../../modules/identity/index.js';

export const revalidate = 60;

export default async function PublicProfilePage({ params }: { params: { handle: string } }) {
  const profile = await getPublicProfile(params.handle);
  if (!profile) notFound();

  return (
    <main>
      <h1>{profile.displayName}</h1>
      <p>@{profile.handle}</p>
      <section>
        <h2>Completed challenges</h2>
        {profile.completedChallenges.length === 0 ? (
          <p>No completed challenges yet.</p>
        ) : (
          <ul>
            {profile.completedChallenges.map((challenge, index) => (
              <li key={`${challenge.title}-${challenge.language}-${challenge.framework}-${index}`}>
                <h3>{challenge.title}</h3>
                <p>Stack: {challenge.language} / {challenge.framework}</p>
                <p>Mode: {challenge.mode}</p>
                <p>Score: {challenge.score}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>Published solutions</h2>
        <p>No published solutions yet.</p>
      </section>
    </main>
  );
}

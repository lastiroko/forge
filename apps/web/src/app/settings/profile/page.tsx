import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../../modules/identity/index.js';
import { updateProfileAction } from './actions.js';

export const dynamic = 'force-dynamic';

const FIELDS = ['displayName', 'bio', 'links'] as const;

interface ProfileSettingsPageProps {
  searchParams: {
    displayName?: string;
    bio?: string;
    links?: string;
  };
}

export default async function ProfileSettingsPage({ searchParams }: ProfileSettingsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/github');

  const errors: Partial<Record<(typeof FIELDS)[number], string>> = {};
  for (const field of FIELDS) {
    const value = searchParams[field];
    if (value) errors[field] = value;
  }

  return (
    <main>
      <h1>Account settings</h1>
      <form action={updateProfileAction}>
        <label>
          Display name
          <input type="text" name="displayName" defaultValue={user.displayName} maxLength={100} required />
        </label>
        {errors.displayName ? <p>{errors.displayName}</p> : null}

        <label>
          Bio
          <textarea name="bio" defaultValue={user.bio ?? ''} maxLength={280} />
        </label>
        {errors.bio ? <p>{errors.bio}</p> : null}

        <label>
          Links (one per line, up to 5)
          <textarea name="links" defaultValue={user.links.join('\n')} />
        </label>
        {errors.links ? <p>{errors.links}</p> : null}

        <button type="submit">Save</button>
      </form>
    </main>
  );
}

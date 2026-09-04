import { redirect } from 'next/navigation';
import { getCurrentUser, PROFILE_ERROR_MESSAGES, type ProfileErrorCode } from '../../../modules/identity/index.js';
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

function isProfileErrorCode(value: string | undefined): value is ProfileErrorCode {
  return value !== undefined && Object.prototype.hasOwnProperty.call(PROFILE_ERROR_MESSAGES, value);
}

export default async function ProfileSettingsPage({ searchParams }: ProfileSettingsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/github');

  // searchParams come straight from the URL, so only render messages for
  // recognized error codes rather than echoing back whatever a visitor put there.
  const errors: Partial<Record<(typeof FIELDS)[number], string>> = {};
  for (const field of FIELDS) {
    const code = searchParams[field];
    if (isProfileErrorCode(code)) errors[field] = PROFILE_ERROR_MESSAGES[code];
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

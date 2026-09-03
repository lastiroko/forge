import { cookies } from 'next/headers';
import type { SessionCookieReader } from '../../../modules/identity/index.js';
import { requireRole } from '../../../modules/identity/index.js';
import {
  EMAIL_PREFERENCES,
  preferences,
} from '../../../modules/notifications/index.js';
import { saveNotificationPreferencesAction } from './actions.js';

export async function AccountSettingsPage(
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl?: string,
) {
  const user = await requireRole('member', cookieStore, databaseUrl);
  const persisted = await preferences(user, databaseUrl);
  const enabled = new Map(persisted.map((preference) => [preference.eventType, preference.emailEnabled]));

  return (
    <main>
      <h1>Account settings</h1>
      <form action={saveNotificationPreferencesAction}>
        {EMAIL_PREFERENCES.map((preference) => (
          <label key={preference.eventType}>
            <input
              type="checkbox"
              name={preference.eventType}
              defaultChecked={enabled.get(preference.eventType) ?? true}
            />
            {preference.label}
          </label>
        ))}
        <button type="submit">Save preferences</button>
      </form>
    </main>
  );
}

export default AccountSettingsPage;

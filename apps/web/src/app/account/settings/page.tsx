import { cookies } from 'next/headers';
import { requireRole } from '../../../modules/identity/index.js';
import {
  EMAIL_PREFERENCES,
  preferences,
} from '../../../modules/notifications/index.js';
import { saveNotificationPreferencesAction } from './actions.js';

export default async function Page() {
  const user = await requireRole('member', cookies());
  const persisted = await preferences(user);
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
      <section>
        <h2>Account data</h2>
        <p>Download a copy of your profile, enrollments, submissions, and grading reports.</p>
        <a href="/account/export" download>Download account data</a>
      </section>
    </main>
  );
}

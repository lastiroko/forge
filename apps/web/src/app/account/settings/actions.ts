'use server';

import { cookies } from 'next/headers';
import type { SessionCookieReader } from '../../../modules/identity/index.js';
import { requireRole } from '../../../modules/identity/index.js';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  setEmailPreference,
} from '../../../modules/notifications/index.js';

export async function saveNotificationPreferences(
  formData: FormData,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl?: string,
): Promise<void> {
  const user = await requireRole('member', cookieStore, databaseUrl);
  await setEmailPreference(user, GRADING_FINISHED_EVENT, formData.has(GRADING_FINISHED_EVENT), databaseUrl);
  await setEmailPreference(user, COMMENT_RECEIVED_EVENT, formData.has(COMMENT_RECEIVED_EVENT), databaseUrl);
}

export async function saveNotificationPreferencesAction(formData: FormData): Promise<void> {
  await saveNotificationPreferences(formData);
}

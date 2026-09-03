'use server';

import { cookies } from 'next/headers';
import { markNotificationsRead } from './mark-notifications-read.js';

export async function markNotificationsReadAction(notificationIds: string[]): Promise<void> {
  await markNotificationsRead(notificationIds, cookies());
}

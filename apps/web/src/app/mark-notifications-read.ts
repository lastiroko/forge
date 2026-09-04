import { requireRole, type SessionCookieReader } from '../modules/identity/index.js';
import { markRead } from '../modules/notifications/index.js';

export async function markNotificationsRead(
  notificationIds: string[],
  cookieStore: SessionCookieReader,
): Promise<void> {
  if (notificationIds.length === 0) return;
  const user = await requireRole('member', cookieStore);
  await markRead(user, notificationIds);
}

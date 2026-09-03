import { getCurrentUser } from '../modules/identity/index.js';
import { listForUser } from '../modules/notifications/index.js';
import { NotificationList } from './NotificationList.js';

export async function Header() {
  const user = await getCurrentUser();
  const notifications = user ? await listForUser(user) : undefined;

  return (
    <header>
      <a href="/">Forge</a>
      {notifications ? <NotificationList initialNotifications={notifications} /> : null}
    </header>
  );
}

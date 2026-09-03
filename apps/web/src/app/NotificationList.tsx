'use client';

import { useState, useTransition } from 'react';
import {
  COMMENT_RECEIVED_EVENT,
  GRADING_FINISHED_EVENT,
  type Notification,
} from '../modules/notifications/index.js';
import { markNotificationsReadAction } from './notifications-actions.js';

interface NotificationListProps {
  initialNotifications: Notification[];
}

function messageFor(notification: Notification): string {
  const payload = notification.payload as Record<string, unknown>;
  if (notification.eventType === GRADING_FINISHED_EVENT) {
    return `Your submission finished grading with a score of ${payload.score}.`;
  }
  if (notification.eventType === COMMENT_RECEIVED_EVENT) {
    return `New comment on your solution: "${payload.body}"`;
  }
  return notification.eventType;
}

export function NotificationList({ initialNotifications }: NotificationListProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [visibleUnreadIds] = useState(
    () => initialNotifications.filter((notification) => notification.readAt === null).map((notification) => notification.id),
  );
  const [open, setOpen] = useState(false);
  const [hasMarkedRead, setHasMarkedRead] = useState(false);
  const [, startTransition] = useTransition();

  const unreadCount = notifications.filter((notification) => notification.readAt === null).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !hasMarkedRead && visibleUnreadIds.length > 0) {
      setHasMarkedRead(true);
      const readAt = new Date();
      setNotifications((current) => current.map((notification) => (
        visibleUnreadIds.includes(notification.id) ? { ...notification, readAt } : notification
      )));
      startTransition(() => {
        markNotificationsReadAction(visibleUnreadIds);
      });
    }
  }

  return (
    <div>
      <button type="button" onClick={toggle}>
        Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
      </button>
      {open ? (
        <ul>
          {notifications.map((notification) => (
            <li key={notification.id}>{messageFor(notification)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

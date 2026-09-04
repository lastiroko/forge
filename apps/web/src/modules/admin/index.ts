import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';
import { AuthorizationError, requireRole, type SessionCookieReader } from '../identity/index.js';

const { solutions, comments, users, auditLog } = schema;

export type HideTarget =
  | { type: 'solution'; id: string }
  | { type: 'comment'; id: string };

function requiredReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('Admin module: reason is required');
  return trimmed;
}

export async function hideContent(
  target: HideTarget,
  reason: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const admin = await requireRole('admin', cookieStore, databaseUrl);
  const auditReason = requiredReason(reason);
  if (target.type !== 'solution' && target.type !== 'comment') {
    throw new Error('Admin module: unsupported content target');
  }
  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      const [updated] = target.type === 'solution'
        ? await tx.update(solutions).set({ hiddenAt: new Date() }).where(eq(solutions.id, target.id)).returning({ id: solutions.id })
        : await tx.update(comments).set({ hiddenAt: new Date() }).where(eq(comments.id, target.id)).returning({ id: comments.id });
      if (!updated) throw new Error(`Admin module: no ${target.type} found with id ${target.id}`);
      await tx.insert(auditLog).values({
        actorId: admin.id,
        action: 'content.hide',
        targetType: target.type,
        targetId: target.id,
        reason: auditReason,
      });
    });
  } finally {
    await pool.end();
  }
}

export async function warnMember(
  userId: string,
  reason: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const admin = await requireRole('admin', cookieStore, databaseUrl);
  const auditReason = requiredReason(reason);
  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new Error(`Admin module: no user found with id ${userId}`);
      await tx.insert(auditLog).values({ actorId: admin.id, action: 'member.warn', targetType: 'user', targetId: userId, reason: auditReason });
    });
  } finally {
    await pool.end();
  }
}

export async function suspendMember(
  userId: string,
  reason: string,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const admin = await requireRole('admin', cookieStore, databaseUrl);
  if (admin.id === userId) throw new AuthorizationError();
  const auditReason = requiredReason(reason);
  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, userId)).returning({ id: users.id });
      if (!updated) throw new Error(`Admin module: no user found with id ${userId}`);
      await tx.insert(auditLog).values({ actorId: admin.id, action: 'member.suspend', targetType: 'user', targetId: userId, reason: auditReason });
    });
  } finally {
    await pool.end();
  }
}

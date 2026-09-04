import { cookies } from 'next/headers';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { createDbClient, schema } from '@forge/db';
import { loadEnv } from '@forge/shared';

const { users, sessions, enrollments, challengeVersions, challenges, stacks, submissions, gradingRuns } = schema;

export type User = typeof users.$inferSelect;

export type AccountExportProfile = Pick<User,
  'id' | 'githubId' | 'handle' | 'displayName' | 'avatarUrl' | 'email' | 'role' | 'bio' | 'links' | 'createdAt'
>;

export type Session = typeof sessions.$inferSelect;

export type Role = 'member' | 'author' | 'admin';

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

// Next.js compiles Server Actions and the modules they import into a bundle
// separate from the one used to render the page, so a thrown AuthorizationError
// can arrive as an instance of a different copy of this class in production.
// Check the `name` string instead of `instanceof`, since that survives bundling.
export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof Error && error.name === 'AuthorizationError';
}

const roleRank: Record<Role, number> = {
  member: 0,
  author: 1,
  admin: 2,
};

function isRole(role: string): role is Role {
  return Object.prototype.hasOwnProperty.call(roleRank, role);
}

export const SESSION_COOKIE = 'forge_session';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionCookieReader {
  get(name: string): { value: string } | undefined;
}

export interface GitHubIdentity {
  githubId: number;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  email: string;
}

export async function getAccountExportProfile(
  userId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<AccountExportProfile | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [profile] = await db.select({
      id: users.id,
      githubId: users.githubId,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      email: users.email,
      role: users.role,
      bio: users.bio,
      links: users.links,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, userId)).limit(1);
    return profile;
  } finally {
    await pool.end();
  }
}

export async function upsertGithubUser(
  identity: GitHubIdentity,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<User> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [user] = await db
      .insert(users)
      .values({ ...identity, role: 'member' })
      .onConflictDoUpdate({
        target: users.githubId,
        set: {
          handle: identity.handle,
          avatarUrl: identity.avatarUrl,
          email: identity.email,
        },
      })
      .returning();
    return user;
  } finally {
    await pool.end();
  }
}

export interface CompletedChallenge {
  title: string;
  language: string;
  framework: string;
  mode: string;
  score: number;
}

export interface PublicProfile {
  displayName: string;
  handle: string;
  bio: string | null;
  links: string[];
  completedChallenges: CompletedChallenge[];
}

export async function getPublicProfile(
  handle: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<PublicProfile | undefined> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [user] = await db
      .select({ id: users.id, displayName: users.displayName, handle: users.handle, bio: users.bio, links: users.links })
      .from(users)
      .where(eq(users.handle, handle))
      .limit(1);
    if (!user) return undefined;

    const rows = await db
      .select({
        enrollmentId: enrollments.id,
        title: challenges.title,
        language: stacks.language,
        framework: stacks.framework,
        mode: enrollments.mode,
        score: gradingRuns.score,
      })
      .from(enrollments)
      .innerJoin(challengeVersions, eq(enrollments.challengeVersionId, challengeVersions.id))
      .innerJoin(challenges, eq(challengeVersions.challengeId, challenges.id))
      .innerJoin(stacks, eq(enrollments.stackId, stacks.id))
      .innerJoin(submissions, eq(submissions.enrollmentId, enrollments.id))
      .innerJoin(gradingRuns, eq(gradingRuns.submissionId, submissions.id))
      .where(and(
        eq(enrollments.userId, user.id),
        eq(enrollments.status, 'completed'),
        eq(gradingRuns.status, 'successful'),
        isNotNull(gradingRuns.score),
      ))
      .orderBy(asc(enrollments.createdAt), asc(enrollments.id));

    const bestByEnrollment = new Map<string, CompletedChallenge>();
    for (const row of rows) {
      // The query excludes null scores; retain the check so TypeScript and future
      // query changes preserve the successful-run invariant at this boundary.
      if (row.score === null) continue;
      const existing = bestByEnrollment.get(row.enrollmentId);
      if (!existing || row.score > existing.score) {
        bestByEnrollment.set(row.enrollmentId, {
          title: row.title,
          language: row.language,
          framework: row.framework,
          mode: row.mode,
          score: row.score,
        });
      }
    }

    return {
      displayName: user.displayName,
      handle: user.handle,
      bio: user.bio,
      links: user.links,
      completedChallenges: [...bestByEnrollment.values()],
    };
  } finally {
    await pool.end();
  }
}

export async function createSession(
  userId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<Session> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [session] = await db
      .insert(sessions)
      .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) })
      .returning();
    return session;
  } finally {
    await pool.end();
  }
}

export async function getCurrentUser(
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<User | undefined> {
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return undefined;

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [row] = await db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId));
    if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
    return row.user;
  } finally {
    await pool.end();
  }
}

export async function deleteSession(
  sessionId: string,
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<void> {
  const { db, pool } = createDbClient(databaseUrl);
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } finally {
    await pool.end();
  }
}

export interface ProfileInput {
  displayName: string;
  bio: string;
  links: string[];
}

const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_BIO_LENGTH = 280;
const MAX_LINKS = 5;

// Codes, not free-form text: the settings page round-trips these through a
// redirect URL's search params, so the rendered message must come from this
// fixed table rather than from anything an attacker could put in the URL.
export const PROFILE_ERROR_MESSAGES = {
  displayName_length: `Display name must be between 1 and ${MAX_DISPLAY_NAME_LENGTH} characters.`,
  bio_length: `Bio must be at most ${MAX_BIO_LENGTH} characters.`,
  links_count: `You can add at most ${MAX_LINKS} links.`,
  links_duplicate: 'Links must be unique.',
  links_invalid: 'Links must be absolute http:// or https:// URLs.',
} as const;

export type ProfileErrorCode = keyof typeof PROFILE_ERROR_MESSAGES;

export interface ProfileValidationErrors {
  displayName?: ProfileErrorCode;
  bio?: ProfileErrorCode;
  links?: ProfileErrorCode;
}

export type ProfileUpdateResult =
  | { ok: true; user: User }
  | { ok: false; errors: ProfileValidationErrors };

function isHttpUrl(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateProfileInput(displayName: string, bio: string, links: string[]): ProfileValidationErrors {
  const errors: ProfileValidationErrors = {};

  if (displayName.length < 1 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.displayName = 'displayName_length';
  }

  if (bio.length > MAX_BIO_LENGTH) {
    errors.bio = 'bio_length';
  }

  if (links.length > MAX_LINKS) {
    errors.links = 'links_count';
  } else if (new Set(links).size !== links.length) {
    errors.links = 'links_duplicate';
  } else if (links.some((link) => !isHttpUrl(link))) {
    errors.links = 'links_invalid';
  }

  return errors;
}

export async function updateCurrentUserProfile(
  input: ProfileInput,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<ProfileUpdateResult> {
  const currentUser = await getCurrentUser(cookieStore, databaseUrl);
  if (!currentUser) throw new AuthorizationError();

  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  const links = input.links.map((link) => link.trim()).filter((link) => link.length > 0);

  const errors = validateProfileInput(displayName, bio, links);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [user] = await db
      .update(users)
      .set({ displayName, bio: bio.length > 0 ? bio : null, links })
      .where(eq(users.id, currentUser.id))
      .returning();
    return { ok: true, user };
  } finally {
    await pool.end();
  }
}

export async function requireRole(
  role: Role,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<User> {
  const user = await getCurrentUser(cookieStore, databaseUrl);
  if (!user || user.suspendedAt || !isRole(user.role) || roleRank[user.role] < roleRank[role]) {
    throw new AuthorizationError();
  }
  return user;
}

export async function changeUserRole(
  targetUserId: string,
  role: Role,
  cookieStore: SessionCookieReader = cookies(),
  databaseUrl: string = loadEnv().DATABASE_URL,
): Promise<User | undefined> {
  const actingUser = await requireRole('admin', cookieStore, databaseUrl);
  if (actingUser.id === targetUserId) throw new AuthorizationError();

  const { db, pool } = createDbClient(databaseUrl);
  try {
    const [user] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, targetUserId))
      .returning();
    return user;
  } finally {
    await pool.end();
  }
}

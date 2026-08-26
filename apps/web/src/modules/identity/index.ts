import { schema } from '@forge/db';

const { users } = schema;

export type User = typeof users.$inferSelect;

export type Role = 'member' | 'author' | 'admin';

export async function getCurrentUser(): Promise<User | undefined> {
  throw new Error('identity.getCurrentUser is not implemented yet');
}

export async function requireRole(role: Role): Promise<User> {
  throw new Error('identity.requireRole is not implemented yet');
}

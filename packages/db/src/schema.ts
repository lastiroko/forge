import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const enrollments = pgTable('enrollments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  challengeVersionId: uuid('challenge_version_id').notNull(),
  mode: text('mode').notNull(),
  stackId: uuid('stack_id').notNull(),
  repoUrl: text('repo_url'),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

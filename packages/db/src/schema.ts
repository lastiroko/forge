import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, unique } from 'drizzle-orm/pg-core';

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

export const stacks = pgTable('stacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  language: text('language').notNull(),
  framework: text('framework').notNull(),
});

export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  level: text('level').notNull(),
  backendEnabled: boolean('backend_enabled').notNull().default(true),
  fullstackEnabled: boolean('fullstack_enabled').notNull().default(false),
});

export const challengeVersions = pgTable('challenge_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: uuid('challenge_id').notNull().references(() => challenges.id),
  version: integer('version').notNull(),
  level: text('level').notNull(),
  rubric: jsonb('rubric').notNull(),
  openapiRef: text('openapi_ref').notNull(),
  hiddenTestsRef: text('hidden_tests_ref').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => ({
  challengeVersionUnique: unique().on(table.challengeId, table.version),
}));

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  enrollmentId: uuid('enrollment_id').notNull().references(() => enrollments.id),
  commitSha: text('commit_sha').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

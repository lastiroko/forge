import { pgTable, pgSchema, uuid, text, bigint, timestamp, integer, boolean, jsonb, doublePrecision, unique } from 'drizzle-orm/pg-core';

export const appSchema = pgSchema('app');

export const users = appSchema.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: bigint('github_id', { mode: 'number' }).notNull(),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  email: text('email').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = appSchema.table('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const challengeStacks = pgTable('challenge_stacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: uuid('challenge_id').notNull().references(() => challenges.id),
  stackId: uuid('stack_id').notNull().references(() => stacks.id),
}, (table) => ({
  challengeStackUnique: unique().on(table.challengeId, table.stackId),
}));

export const challengeVersions = pgTable('challenge_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  challengeId: uuid('challenge_id').notNull().references(() => challenges.id),
  version: integer('version').notNull(),
  level: text('level').notNull(),
  brief: text('brief').notNull().default(''),
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

export const gradingRuns = pgTable('grading_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  status: text('status').notNull(),
  score: doublePrecision('score').notNull(),
  reportUrl: text('report_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const solutions = pgTable('solutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  title: text('title').notNull(),
  writeup: text('writeup').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => ({
  solutionsSubmissionUnique: unique().on(table.submissionId),
}));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  reporterId: uuid('reporter_id').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pointsLedger = pgTable('points_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  stackId: uuid('stack_id'),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  gradingRunId: uuid('grading_run_id').references(() => gradingRuns.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leaderboardSnapshots = pgTable('leaderboard_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull(),
  stackId: uuid('stack_id'),
  userId: uuid('user_id').notNull(),
  totalPoints: integer('total_points').notNull(),
  rank: integer('rank').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pointsTotalsCache = pgTable('points_totals_cache', {
  userId: uuid('user_id').primaryKey(),
  totalPoints: integer('total_points').notNull(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  eventType: text('event_type').notNull(),
  emailEnabled: boolean('email_enabled').notNull().default(true),
}, (table) => ({
  notificationPreferencesUnique: unique().on(table.userId, table.eventType),
}));

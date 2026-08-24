import type { Config } from 'drizzle-kit';

// drizzle-kit loads this file with its own esbuild-based loader, which transpiles
// syntax only and does not resolve the NodeNext '.js' extension convention used by
// @forge/shared's source files. Importing loadEnv() from @forge/shared here fails
// with "Cannot find module ./env.js", so DATABASE_URL is read directly instead.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;

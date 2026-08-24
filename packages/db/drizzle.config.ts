import type { Config } from 'drizzle-kit';
import { loadEnv } from '@forge/shared';

const env = loadEnv();

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
} satisfies Config;

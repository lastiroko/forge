import { randomBytes } from 'node:crypto';

export interface DatabaseCredentials {
  username: string;
  password: string;
  database: string;
}

export function generateDatabaseCredentials(runId: string): DatabaseCredentials {
  const suffix = runId.replace(/-/g, '').slice(0, 16);
  const password = randomBytes(24).toString('hex');
  return {
    username: `run_${suffix}`,
    password,
    database: `run_${suffix}`,
  };
}

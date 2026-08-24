import PgBoss from 'pg-boss';
import { loadEnv } from '@forge/shared';

export async function getQueue(databaseUrl: string = loadEnv().DATABASE_URL): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
  await boss.start();
  return boss;
}

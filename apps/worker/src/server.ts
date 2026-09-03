import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getQueue } from '@forge/db';
import { loadEnv, type Env } from '@forge/shared';
import { registerLeaderboardSnapshotJob } from './lib/leaderboard-snapshot.js';
import { registerGradingWorker } from './pipeline.js';

export function createServer() {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  createServer().listen(env.PORT, async () => {
    console.log(`worker listening on http://localhost:${env.PORT}`);
    const boss = await getQueue(env.DATABASE_URL);
    await registerLeaderboardSnapshotJob(boss, { databaseUrl: env.DATABASE_URL });
    // TODO(#37): pass the concrete grading stages and a real status persistence
    // callback once the merged stages (tickets #38-#48) report member-vs-platform
    // failures via PipelineStageResult and a status storage target is decided.
    await registerGradingWorker(boss, [], () => {});
  });
}

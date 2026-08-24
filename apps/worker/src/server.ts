import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadEnv, type Env } from '@forge/shared';

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
  createServer().listen(env.PORT, () => {
    console.log(`worker listening on http://localhost:${env.PORT}`);
  });
}

import { getCurrentUser, SESSION_COOKIE } from './index.js';

async function main(): Promise<void> {
  const sessionId = process.argv[2];
  if (!sessionId) throw new Error('session id argument is required');

  const cookieStore = {
    get: (name: string) => (name === SESSION_COOKIE ? { value: sessionId } : undefined),
  };

  const user = await getCurrentUser(cookieStore);
  if (!user) throw new Error('session did not resolve to a user');

  process.stdout.write(JSON.stringify({ userId: user.id }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

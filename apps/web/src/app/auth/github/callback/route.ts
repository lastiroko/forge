import { upsertGithubUser } from '../../../../modules/identity/index.js';
import { createGithubCallbackHandler } from './handler.js';

export const runtime = 'nodejs';

export const GET = createGithubCallbackHandler({
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  fetch: globalThis.fetch,
  upsertUser: upsertGithubUser,
});

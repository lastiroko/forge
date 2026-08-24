import { loadEnv } from '@forge/shared';

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

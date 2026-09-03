import { z } from 'zod';

// PORT defaults to 3000; DATABASE_URL has no default and is required.
// S3_* fields default to this repo's docker-compose MinIO service.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  S3_ENDPOINT: z.string().url().default('http://minio:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().default('forge'),
  S3_SECRET_ACCESS_KEY: z.string().default('forgeforge'),
  S3_BUCKET: z.string().default('forge-reports'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error('Invalid environment configuration - ' + message);
  }
  return result.data;
}

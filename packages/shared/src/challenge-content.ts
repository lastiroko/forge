import { z } from 'zod';

export const challengeContentSchema = z.object({
  slug: z.string().min(1),
  level: z.enum(['junior', 'mid', 'senior']),
  briefRef: z.string().min(1),
  openapiRef: z.string().min(1),
  hiddenTestsRef: z.string().min(1),
  rubric: z.object({
    functional: z.number(),
    contract: z.number(),
    robustness: z.number(),
    quality: z.number(),
  }),
  enabledModes: z.array(z.enum(['backend', 'fullstack'])).min(1),
  enabledStacks: z.array(z.string().min(1)).min(1),
});

export type ChallengeContent = z.infer<typeof challengeContentSchema>;

export function validateChallengeContent(input: unknown): ChallengeContent {
  const result = challengeContentSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error('Invalid challenge content - ' + message);
  }
  return result.data;
}

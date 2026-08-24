import { z } from 'zod';

export const challengeSchema = z.object({
  slug: z.string().min(1),
  level: z.enum(['junior', 'mid', 'senior']),
  rubric: z.object({
    functional: z.number(),
    contract: z.number(),
    robustness: z.number(),
    quality: z.number(),
  }),
  services: z.array(z.string()).default([]),
});

export type Challenge = z.infer<typeof challengeSchema>;

# Forge

A platform where developers build real backend apps in any language and get graded automatically.

## Stack
- TypeScript everywhere. Next.js for the web app, Node for the grader worker.
- Postgres with Drizzle. pg-boss for the job queue. S3-compatible storage.
- Modular monolith: modules live in src/modules/<name> and only talk through each module's index.ts.

## Rules
- No provider-specific cloud features. Everything must run under docker compose.
- Every change needs tests.
- Never edit files under .github/.

## Layout
- apps/web      the Next.js app
- apps/worker   the grader
- packages/db   Drizzle schema shared by both
- docs/         requirements and architecture

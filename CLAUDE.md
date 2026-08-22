# Forge

A platform where developers build real backend apps in any language and get graded automatically.

## Stack
- TypeScript everywhere. Next.js for the web app, Node for the grader worker.
- Postgres with Drizzle. pg-boss for the job queue. S3-compatible storage.
- Modular monolith in apps/web. The worker is a pipeline, not modules. See Layout rules below for where code goes.

## Rules
- No provider-specific cloud features. Everything must run under docker compose.
- Every change needs tests.
- Never edit files under .github/.

## Layout rules
- apps/web: modular monolith. Modules live in apps/web/src/modules/<name>
  and only talk through each module's index.ts. Never import across module internals.
- apps/worker: a pipeline, not modules. Stages live in apps/worker/src/stages/,
  shared helpers in apps/worker/src/lib/, entry point apps/worker/src/server.ts.
- packages/db, packages/shared: imported by both. No app-specific logic.

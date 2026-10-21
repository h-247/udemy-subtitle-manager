# Udemy Subtitle Manager on ChatGPT Sites

One React and TypeScript application runs locally and on ChatGPT Sites. It tracks Udemy courses, lectures, subtitles, and optional Google Drive uploads.

## Stack

- React, TypeScript, Tailwind CSS, and the official ChatGPT Sites Vinext starter
- TypeScript API routes on Cloudflare Workers
- Drizzle ORM with D1; Sites managed R2 stores subtitle files
- Zod request validation, Vitest unit tests, and Playwright browser tests
- Node.js 22.13 or later, npm, Wrangler, and Miniflare for local development

ChatGPT Sites access, hosting, and storage depend on the user's plan and current usage limits. Local development tools and dependencies are free and open source. Local D1 and R2 state stays under `.wrangler/state`, separate from production; deployment does not copy local records.

## Local development on Windows

From the repository root in PowerShell:

```powershell
npm.cmd run install:ci
npm.cmd run db:migrate:local
npm.cmd run dev
```

Open [http://localhost:5173](http://localhost:5173). The official Sites plugin simulates ChatGPT sign-in in development. Wrangler/Miniflare persists D1 and R2 state across restarts.

Optional Google Drive support needs OAuth values in `.dev.vars`; copy `.dev.vars.example` and fill in local credentials. The dev command creates a local `SECRET_KEY` if missing. Keep secrets out of source control and browser code.

`db/schema.ts` defines the schema, while committed SQL files in `drizzle/` are the migration source for local and hosted databases. Generate migrations with `npm.cmd run db:generate`, review the SQL, and apply them locally with `npm.cmd run db:migrate:local`.

## Verify and preview

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

`npm.cmd run test:e2e` runs Chromium checks for dashboard/course/back navigation, subtitle download, import progress, retry, and cancellation against the built Worker. `npm.cmd run test:runtime` runs dispatch recovery against workerd with persistent local D1/R2. CI retains browser screenshots, reports, and failure traces.

## Hosting configuration

`.openai/hosting.json` declares the `DB` D1 and `BUCKET` R2 bindings. Set `SECRET_KEY` and optional Google OAuth credentials as Site runtime secrets. The local database is never uploaded when deploying.


### Reconnection, durable deletion and Drive secrets

Subtitle batches enter `WAITING_SESSION` when Udemy needs reconnection. The job retains its lecture cursor and counters; saving cookies resumes the same checkpoint. The job card opens the existing connections panel.

Deletion returns HTTP 202 and queues a `CLEANUP` job. The worker shares the per-user processing lease, cancels affected queued work, and atomically saves a file manifest before removing database records. Cleanup retries indefinitely with backoff, including after restart; Drive 404 is successful cleanup. Reconnect Drive if its authorization was removed. Cleanup jobs cannot be cancelled and are visible in the jobs list. Existing scheduled dispatcher calls continue cleanup without the browser.

Drive OAuth credentials use the same AES-GCM `v1` envelope and `SECRET_KEY` as Udemy cookies. Legacy JSON migrates on authenticated access or in bounded batches of 25 during internal dispatcher calls. OAuth callbacks and refreshes always save encrypted credentials. Keep `SECRET_KEY` stable; no database schema migration is needed for these changes.

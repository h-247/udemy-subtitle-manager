# Udemy Subtitle Manager

Udemy Subtitle Manager manages Udemy courses, lecture progress, subtitles, and optional Google Drive uploads. One React and TypeScript application runs locally and on ChatGPT Sites.

## Technology

- React, TypeScript, Tailwind CSS, and the official ChatGPT Sites Vinext starter
- TypeScript API routes on the Cloudflare Workers runtime
- Drizzle ORM with Cloudflare D1 for records and optional Sites managed R2 for subtitle files
- Zod request validation, Vitest unit tests, and Playwright browser tests
- Node.js 22.13 or later, npm, Wrangler, and Miniflare for local development

ChatGPT Sites access, hosting, and storage depend on the user's ChatGPT plan and current usage limits. The local development tools and dependencies are free and open source. Local D1/R2 data lives under `chatgpt-sites/udemy-subtitle-manager/.wrangler/state`; it is separate from production and is never uploaded by deployment.

## Run locally on Windows

Open PowerShell in the repository root. Install Node.js 22.13 or later and Git, then run:

```powershell
npm.cmd run install:ci
npm.cmd run db:migrate:local
npm.cmd run dev
```

Open [http://localhost:5173](http://localhost:5173). The Sites plugin simulates ChatGPT sign-in during local development. Wrangler/Miniflare keeps the local D1 database and R2 bucket between restarts.

Optional Google Drive support needs OAuth credentials in `chatgpt-sites/udemy-subtitle-manager/.dev.vars`. Start from `.dev.vars.example`; the dev command creates and persists a local `SECRET_KEY` if one is missing. Never commit `.dev.vars` or production secrets.

The same SQL files in `chatgpt-sites/udemy-subtitle-manager/drizzle/` are used by local D1 and Sites deployment. Generate a schema migration after changing `db/schema.ts`, inspect the generated SQL, and apply it locally with `npm.cmd run db:migrate:local`. Local and hosted databases remain separate.

## Check and preview a production build

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

The preview serves the built Worker locally with Wrangler. Run `npm.cmd run test:e2e` for Chromium navigation, subtitle download, import progress, retry, and cancellation checks. Run `npm.cmd --prefix chatgpt-sites/udemy-subtitle-manager run test:runtime` for workerd integration coverage with persistent local D1/R2. Release CI saves Playwright reports, screenshots, and failure traces.

## Main project files

- Application source: [`chatgpt-sites/udemy-subtitle-manager`](chatgpt-sites/udemy-subtitle-manager)
- D1 schema and migrations: `chatgpt-sites/udemy-subtitle-manager/db/` and `drizzle/`
- Site bindings: `chatgpt-sites/udemy-subtitle-manager/.openai/hosting.json`
- Windows launchers: `start-dev.ps1`, `start_app.bat`, and `stop_app.bat`
- Release and deployment evidence: [`RELEASE.md`](RELEASE.md)

## Deployment

Deploy with the ChatGPT Sites plugin workflow. The Sites manifest declares the D1 `DB` and R2 `BUCKET` bindings. A deployment applies the committed migrations to the hosted database; it does not copy local records. Keep secrets in the Sites runtime settings. Record the deployed URL, source commit, and verification results in `RELEASE.md`.

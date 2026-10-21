## 2026-10-21 ChatGPT Sites release

Pending verification for the next release: the release snapshot regression now
requires hosting configuration from the selected Git commit, isolates working-tree
configuration drift, and rejects missing, invalid, or tampered configuration.
The CI matrix runs installation, local migrations, typecheck, build, unit,
production Worker and Chromium suites on Windows and Linux. Recovery suites now
include API curriculum import, automatic subtitle transition, expired session,
cookie reconnection and a persisted Worker restart; the browser scenario closes
the importing page and reopens the dashboard. Udemy and Drive HTTP responses in
these suites are fixtures. Passing these checks does not constitute a live hosted
recovery check. Record that separately before declaring the next release verified.

- Site version: 21
- Sites source commit: `ae34174408fa5e44edab4088ff2473610b1f9e73`
- Deployment ID: `appgdep_6ad84bd869448191b9648159604d69a8`
- URL: https://udemy-subtitle-manager.h-247.chatgpt.site
- Deployment status: `succeeded`; existing owner-only access preserved.
- Verified: local D1 migrations 0000–0002, TypeScript typecheck, Vitest and repository regression scripts, production Vinext build. The built API worker contains the exact Sites source commit above.
- Browser E2E: blocked by the local Vite server bind failure (`EACCES` on `127.0.0.1:5173`). Release checks now run browser flows against the built Worker under workerd and retain Playwright traces on failure; this release predates that requirement.

The authoritative application source for local and hosted use is `chatgpt-sites/udemy-subtitle-manager`. `sites/udemy-subtitle-manager` is an ignored Sites Git checkout used only to publish a tested snapshot. Do not develop independently in that checkout. The old Python backend and `frontend` directories are retained legacy code; launchers and current documentation use the shared Vinext Worker application.

1. Commit intended changes, including Drizzle migrations and regression tests. Push to GitHub and wait for **Release checks** for that exact commit. CI runs legacy backend compatibility tests, Sites regression tests, TypeScript checks, the production build, Chromium dashboard/course/back/import-progress/retry/cancel/subtitle-download flows, and production-bundle Worker recovery tests with disk-backed local D1/R2. Failed browser runs retain screenshots, HTML reports, and Playwright trace ZIPs. Use Node 24.
2. Open the existing Sites project with the Sites source helper to reconcile the remote. Then run `node scripts/prepare-sites-release.mjs` from a clean root checkout. It requires successful push checks for the exact commit and materializes Git blobs into a new `output/sites-releases/<commit>-*` directory, including the tracked `.openai/hosting.json` after validating its `DB` and `BUCKET` bindings. The SHA-256 manifest rejects missing, changed, or unexpected source files; it cannot inherit obsolete files from a previous deployment checkout.
3. Run the Sites source helper against that fresh snapshot with the existing project ID, fresh source credential on stdin, the production build command, and an archive path. The helper pushes the snapshot and packages its build. Save and deploy that returned commit/archive while preserving owner-only access. Deploy applies the committed Drizzle migrations.
4. Run `node scripts/verify-release-health.mjs <site-url> <tested-commit>` (set `SITE_SERVICE_TOKEN` when the private Site gate requires it). The command requires `/api/health` to report both `status: ok` and the exact tested commit. Invoke the protected dispatcher and read back job/subtitle state on the hosted app. Record root commit, Sites source commit, version, deployment ID, URL, and verification results in a GitHub release. Deployment success alone does not prove browser-close/restart recovery against Udemy and Drive.

`Hosted job dispatcher` runs every five minutes and can also be dispatched manually. GitHub scheduling may be delayed; it is not a latency guarantee. Store `SITE_SERVICE_TOKEN` (the existing Site service access token) and `JOB_RUNNER_SECRET` in GitHub Actions secrets, with the same runner secret in Sites production environment. The service token passes the private Site access gate; the independent runner secret authorizes only job advancement. Never put tokens into tracked source, command arguments, release records, or logs.

The dispatcher makes bounded requests until idle or four minutes have elapsed. Requests and dashboard closure do not own progress. D1 stores a per-user exclusive ten-minute lease, resumable import payload/batch cursor, retry count and next retry time. A process restart releases nothing prematurely: a crashed lease expires, then another invocation resumes. Network calls have twelve-second deadlines. Failures retry with exponential backoff up to eight consecutive attempts, then retain their checkpoint for explicit **Retry job**. Cancellation stops subsequent steps; an in-flight item may finish. The release integration suite runs this Worker bundle through workerd with persisted local D1 and R2 across runtime restarts; it checks overlapping dispatch, caption reuse, Drive-only retry, upload confirmation loss, and ownership isolation using fixture Udemy/Google endpoints.

Caption selection uses the requested base language (`en`); `caption_language` retains the actual locale (`en_US`). Migration 0002 keeps the best durable row for each lecture/base language and removes superseded bookkeeping failures without deleting R2 or Drive files. Regional variants intentionally share the existing base-language selection semantics. Download `status` and `drive_status` are separate. A Drive retry reads the stored R2 caption and uses a reserved Drive ID persisted before upload, so remote success followed by a lost database write can be reconciled without a duplicate file.

New imports accept optional tags in the URL form. After curriculum import, one D1 transaction saves those tags and transitions the same durable job to a video-only subtitle batch. A restart cannot enqueue a duplicate batch. Existing-course tag editing is removed; tags remain visible and filterable. Curriculum re-sync preserves existing tags and does not start a separate download batch.

Subtitle execution starts immediately after authenticated enqueue/retry/resume POSTs via the Worker execution context (`waitUntil`), with a bounded drain and the same D1 lease/checkpoints. Dashboard job reads send a separate resume POST for pending work; GET endpoints remain read-only. GitHub dispatch remains the unattended recovery path. Caption 401/403/404 refreshes metadata once using the remote Udemy course ID before retrying the signed URL; CDN fetches never include Udemy session credentials.

Saving Udemy cookies uses one atomic three-statement D1 batch for encrypted session persistence and owner-scoped course/lecture domain updates. Verification has bounded four-second per-host requests; a network timeout is VERIFICATION_FAILED, not evidence of malformed cookies. The save response explicitly reports saved=true even when Udemy returns ACCESS_DENIED.

# Udemy Subtitle Manager on ChatGPT Sites

This Site edition keeps the repository's course, lecture, Udemy cookie, subtitle, processing-job, and Google Drive API flows in a Cloudflare Worker. D1 stores per-account records and R2 stores subtitle files. ChatGPT Sites sign-in supplies the account identity; no app password or JWT is stored in the browser.

## Runtime configuration

The Site uses the D1 binding `DB` and R2 binding `BUCKET`, declared in `.openai/hosting.json`.

Set `SECRET_KEY` as a Site runtime secret to a random value of at least 32 characters. It encrypts Udemy cookies before D1 storage. Keep it stable; changing it makes existing encrypted cookies unreadable.

Google Drive is optional. To enable it, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the Site runtime. Add the exact callback URL `https://udemy-subtitle-manager.h-247.chatgpt.site/api/drive/callback` to the OAuth client's authorized redirect URIs in Google Cloud Console. The app requests the `drive.file` scope.

## Worker constraints

Course imports and subtitle batches are persisted as D1 jobs. Each dashboard poll advances one job step, so progress survives page refreshes without relying on a long-lived Python thread. Caption retrieval uses Udemy's caption URLs directly; manual WebVTT/SubRip upload remains available. The Site does not run the repository's FastAPI process or local SQLite database.

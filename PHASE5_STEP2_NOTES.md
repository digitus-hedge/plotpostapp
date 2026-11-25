# Phase 5, Step 2: going live on Railway and Atlas

**The step-by-step setup is in `DEPLOY_GUIDE.md`.** It covers the Atlas production database, Cloudinary, email, Firebase, Railway, your domain, the first checks, making yourself admin, alert emails and backups.

This file lists what changed in the code to make the server ready for that.

## Start-up and shutdown (`server.js`, `config/startupReport.js`)

- **Clear stop on bad settings.**
  - The server checks its settings before it starts. Missing `MONGODB_URI` or `JWT_SECRET`, or a `JWT_SECRET` shorter than 32 characters in production, stops it with a clear message.
  - The check existed before but was never called.
- **A settings summary at start.** The log shows which features are on, and never shows passwords:
  ```
  PlotPost settings:
    Mode: production on Railway (production)
    Database: plotpost on plotpost.xxxxx.mongodb.net
    Email: on (brevo)
    Google sign-in: on
    Phone alerts (Firebase): on
    Photos (Cloudinary): on
    Error alert emails: on (1 address(es))
    Rate limits: on
  ```
  It also prints ⚠️ warnings for:
  - running on Railway without `NODE_ENV=production`
  - a database address with no database name (everything would go into `test`)
  - a database address that points at your own PC
  - Cloudinary, email or Google not set up
- **The Windows DNS fix only runs on your PC.**
  - Before, the server always switched to public DNS servers plus `192.168.1.1`, even on Railway.
  - Now it uses the `DNS_SERVERS` setting, which is empty in production.
- **It keeps trying to reach the database.**
  - Before, a failed first connection left the server running with no database until someone restarted it.
  - Now it tries again after 5 s, 10 s, 20 s, then every 30 s.
  - Until it connects, `/api/health` answers 503, so Railway won't switch to a broken deploy.
- **Redeploys don't cut requests off.**
  - When Railway replaces the server, the old copy finishes the requests in progress, closes the database, then exits.
  - `railway.json` now gives it 15 seconds (`drainingSeconds`); Railway's default is 0.
  - It also starts with `node server.js` instead of `npm start`, so the stop signal reaches the server.
- **Crashes:**
  - A crash is logged and emailed, and the server exits; Railway starts it again.
  - A background task that fails is logged and emailed, and the server keeps running.

## Error alert emails (`services/errorAlerts.js`)

- **Who gets them:** the addresses in `ERROR_ALERT_EMAILS`. If that's empty, it uses `REPORT_ALERT_EMAILS`.
- **What triggers one:**
  - any server error (500)
  - a failed hourly job (listing expiry or the 12-month clean-up)
  - the database still unreachable after 3 tries
  - a crash
- **How often:** at most one email every 15 minutes; anything in between goes into the next one. A crash is sent straight away.
- **What's in it:** only the route pattern (`GET /api/posts/:id`, never real ids or search words) and the first line of the error. The full details are in Railway's logs.

I'd planned to use Sentry for this. These built-in emails need no new account, no new package and no change to the privacy policy. Sentry can be added later if you want error graphs and history.

## Indexes

- **Reports:**
  - `status + updatedAt`: the admin queue, oldest first.
  - `status + resolvedAt`: the 12-month clean-up.
- **Users:**
  - `createdAt`: the admin People list, newest first.
  - `bannedAt`: the Banned count.

The server builds them by itself when it starts.

## Backups (`npm run backup`, `npm run restore`)

- `utils/dbBackup.js` with `scripts/backupDb.js` and `scripts/restoreDb.js`. They work without installing any MongoDB tools.
- **Backup:**
  - It writes one compressed file per collection into `backups\<date_time>\`. Ids, dates and numbers come back exactly.
  - It only reads from the database.
  - It deletes backups older than 30 days, as the privacy policy promises.
- **Restore:**
  - The target database has to be given with `--uri` every time; it's never taken from `.env`.
  - It refuses to write into collections that already have data, unless you add `--replace`.
  - It asks you to type the database name before it changes anything.
- **`backups/` is in `.gitignore` and the new `.railwayignore`.** Backups hold people's personal data, so they never go to GitHub or Railway.

## Other changes

- `package.json`:
  - Node 24 is pinned for Railway. On your PC, npm may print an `EBADENGINE` warning if you use another version. It's only a warning.
  - New `backup` and `restore` commands.
  - nodemon now ignores `backups/`, `tests/` and `public/`.
- `.env.example`:
  - Every setting now has `=`.
  - New settings: `NODE_ENV`, `ADMIN_PANEL_URL`, `REPORT_ALERT_EMAILS`, `ERROR_ALERT_EMAILS` and `BACKUP_MONGODB_URI`.
- `.railwayignore` (new): keeps `.env`, `backups/` and `node_modules/` out of `railway up` uploads.

## Files

New:
- `config/startupReport.js`
- `services/errorAlerts.js`
- `utils/dbBackup.js`
- `scripts/backupDb.js`, `scripts/restoreDb.js`
- `tests/reliability.test.js`: 12 tests, no database needed
- `.railwayignore`
- `DEPLOY_GUIDE.md`

Changed:
- `server.js`, `railway.json`
- `middleware/errorHandler.js`
- `services/expiryService.js`
- `models/Report.js`, `models/User.js`
- `package.json`, `package-lock.json`
- `.gitignore`, `.env.example`

## Install and check

1. Extract `plotpost_phase5_step2_backend.zip` into `backend` and overwrite.
2. Run `npm install` (no new packages; this just picks up the changed `package.json`).
3. Run `npm test`.
4. Run `npm run dev`. The **PlotPost settings** summary appears at the top of the log.
5. Optional: run `npm run backup` against your **test** database, and look at the `backups` folder.
6. Then follow `DEPLOY_GUIDE.md`.

The app didn't change in this step.

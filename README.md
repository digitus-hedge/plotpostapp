# PlotPost Backend

Node.js + Express 5 + MongoDB (Mongoose) API for the PlotPost Flutter app.

## Run it locally

```bash
npm install
cp .env.example .env      # then fill in MONGODB_URI, JWT_SECRET, Cloudinary, SMTP
npm run dev               # http://localhost:5000
```

Check it's alive: `GET http://localhost:5000/api/health` → `{"success":true,"database":"connected"}`.

Make someone an admin (they must have registered first):

```bash
npm run make-admin -- someone@example.com
npm run make-admin -- someone@example.com --remove
```

## Tests

```bash
npm test
```

Tests never touch your real database. By default they start a temporary in-memory MongoDB
(`mongodb-memory-server` downloads MongoDB, about 100 MB, the first time; needs internet once).
To use another test database instead: `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test`.

## Folder layout

| Folder | What's in it |
|---|---|
| `app.js` | Builds the Express app (security, routes, error handling). Tests load this directly. |
| `server.js` | Checks settings, connects to MongoDB, starts the server, shuts down cleanly. |
| `config/` | `env.js` (all settings), `db.js` (MongoDB connection), `cloudinary.js` |
| `models/` | Mongoose schemas |
| `controllers/` | Request handlers |
| `routes/` | URL → middleware → controller |
| `middleware/` | Login check, admin check, validation, rate limits, sanitizing, errors, uploads |
| `services/` | Tokens, one-time codes, email, Google sign-in, Cloudinary images |
| `validators/` | Input rules (zod) |
| `utils/` | `AppError`, user serializers |
| `scripts/` | One-off admin scripts |
| `tests/` | Jest + supertest |

## Responses and errors

Every response is JSON with `success`. Errors look like:

```json
{ "success": false, "message": "Please enter a valid email address.", "errors": [{ "field": "email", "message": "..." }] }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input (message says what) |
| 401 | Not logged in, or the access token expired → the app refreshes and retries once |
| 403 | Logged in but not allowed |
| 404 | Not found |
| 409 | Already exists (e.g. email taken) |
| 413 | Request too large |
| 429 | Too many requests or code requests; wait and retry |
| 503 | A needed service (email, Google, Cloudinary) isn't configured on the server |

## Login sessions

- **Access token**: a JWT valid for 15 minutes. Send it as `Authorization: Bearer <token>`.
- **Refresh token**: random, valid 30 days, stored on the server only as a SHA-256 hash.
  `POST /api/auth/refresh` swaps it for a new pair; each refresh token works **once**.
  Presenting an already-used one ends every session for that user (theft protection).
- Login/register/refresh responses contain `token` (same as `accessToken`, kept for older
  app builds), `accessToken`, `refreshToken`, `expiresIn` (seconds) and `user`.
- Changing or resetting the password ends all other sessions immediately.

## API endpoints

Base URL: `https://<your-app>.up.railway.app/api` (locally `http://localhost:5000/api`).
🔒 = needs `Authorization: Bearer <accessToken>`. 🔓 = login optional.

### Auth (`/api/auth`): stricter rate limit (20 requests / 15 min per IP) on sensitive routes

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `name`, `email`, `password` | Password: 8–72 chars, a letter and a number. Returns tokens + user; emails a 6-digit verification code (`verificationEmailSent`). |
| POST | `/login` | `email`, `password` | Same error for wrong email or wrong password. |
| POST | `/google` | `idToken` | Google ID token from the app. Creates the account on first use (`isNewUser`), links to an existing account if Google verified the same email. |
| POST | `/refresh` | `refreshToken` | New token pair. |
| POST | `/logout` | `refreshToken` (optional) | Ends this device's session. Always 200. |
| POST | `/logout-all` 🔒 | none | Ends every session on every device. |
| POST | `/verify-email` 🔒 | `code` | 6-digit code from the email. 5 wrong tries lock the code. |
| POST | `/resend-verification` 🔒 | none | New code; once per 60 seconds. |
| POST | `/forgot-password` | `email` | Always the same answer, whether or not the account exists. Code valid 15 minutes. |
| POST | `/reset-password` | `email`, `code`, `newPassword` | Sets the password, verifies the email, ends other sessions, returns tokens. |
| POST | `/change-password` 🔒 | `currentPassword`, `newPassword` | `currentPassword` not needed for Google accounts that never set one. Returns new tokens. |

### Users (`/api/users`)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/profile` 🔒 | none | Your account (`user`). |
| PUT | `/profile` 🔒 | any of `name`, `phone`, `bio`, `agency`, `designation`, `location` | Role, email and verification can't be changed here. |
| POST | `/profile/photo` 🔒 | multipart field `image` (JPG/PNG/WEBP, ≤ 8 MB) | Uploads to Cloudinary (400×400), replaces and deletes the old photo. |
| DELETE | `/profile/photo` 🔒 | none | Removes the photo. |
| PATCH | `/settings` 🔒 | any of `pushNotifications`, `emailInquiries`, `showPhoneNumber` (booleans) | |
| DELETE | `/account` 🔒 | `password`, or `confirm: "DELETE"` for Google-only accounts | Permanently deletes the account, its posts and photos, enquiries sent and received on its posts, its likes and comments, and sessions. |
| POST | `/saved/:postId` 🔒 | none | Toggle bookmark (unchanged; moves to its own collection in Stage 4). |
| GET | `/saved` 🔒 | none | Saved posts (unchanged). |
| GET | `/:id` | none | Public profile: name, photo, bio, agency, designation, location, phone (unless hidden), `postsCount`. Never email. |

### Posts, uploads, enquiries (unchanged in Stages 0–1; rebuilt in Stages 2–5)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/posts?page=&limit=` | Feed, newest first. |
| GET | `/api/posts/my` 🔒 | Your posts. |
| POST | `/api/posts` 🔒 | Create. |
| PUT | `/api/posts/:id` 🔒 | Edit (owner only). |
| DELETE | `/api/posts/:id` 🔒 | Delete (owner only). |
| POST | `/api/posts/:id/like` 🔒 | Toggle like. |
| POST | `/api/posts/:id/comment` 🔒 | Add comment `{ text }`. |
| POST | `/api/upload` 🔒 | Multipart `image` → Cloudinary URL. |
| POST | `/api/enquiries` 🔓 | Send an enquiry. |
| GET | `/api/enquiries/my` 🔒 | Enquiries you sent. |
| DELETE | `/api/enquiries/:id` 🔒 | Delete one you sent. |

### Other

| Method | Path | Notes |
|---|---|---|
| GET | `/` | "PlotPost Backend is running!" |
| GET | `/api/health` | 200 when the database is connected, otherwise 503. Railway uses this. |

## Database schema (changes in Stages 0–1)

### `users`

| Field | Type | Notes |
|---|---|---|
| `name` | String, required, ≤ 80 | |
| `email` | String, required, unique, lowercase | Login. |
| `password` | String (bcrypt hash), hidden by default | Not required for Google-only accounts. |
| `role` | `"user"` \| `"admin"` | **New.** Default `user`. Set with `npm run make-admin`. |
| `googleId` | String, unique when present | **New.** Never sent to the app. |
| `isEmailVerified`, `emailVerifiedAt` | Boolean, Date | **New.** |
| `passwordChangedAt` | Date, hidden | **New.** Tokens issued before it are rejected. |
| `lastLoginAt` | Date | **New.** |
| `phone`, `bio`, `profileImage` | String | Existing. |
| `profileImagePublicId` | String, hidden | **New.** Cloudinary ID, used to delete the old photo. |
| `agency`, `designation`, `location` | String | **New.** From the Edit Profile screen. |
| `settings.pushNotifications`, `settings.emailInquiries`, `settings.showPhoneNumber` | Boolean, default `true` | **New.** |
| `emailVerification`, `passwordReset` | `{ codeHash, expiresAt, attempts, sentAt }`, hidden | **New.** Only an HMAC of each code is stored. |
| `savedPosts` | [ObjectId → Post] | Existing (moves to a Bookmark collection in Stage 4). |
| `createdAt`, `updatedAt` | Date | Existing. |

Existing users keep working: new fields have defaults, and old 6-character passwords still log in
(the 8-character rule applies only to new passwords).

### `refreshtokens` (new)

| Field | Type | Notes |
|---|---|---|
| `user` | ObjectId → User, indexed | |
| `tokenHash` | String, unique | SHA-256 of the token the app holds. |
| `expiresAt` | Date | TTL index: MongoDB deletes expired rows automatically. |
| `revokedAt` | Date \| null | Set on logout, rotation, password change. |
| `replacedByHash` | String \| null | Set when rotated; used to detect reuse. |
| `userAgent`, `ip` | String | For future "your devices" screens. |

## Security in place

Helmet headers · CORS allow-list for browsers (`CORS_ORIGINS`) · rate limits (300 requests /
15 min per IP overall, 20 on login, register and reset) · request bodies capped at 200 KB
(12 MB on `/api/posts` until Stage 2) · MongoDB operator injection stripped · zod input
validation · bcrypt (cost 12) · constant-time login checks · short-lived access tokens with
rotating refresh tokens · 6-digit codes hashed, 15-minute expiry, 5 attempts, 60 s resend
cooldown · internal errors logged but never sent to the app · settings checked at startup
(production refuses a JWT secret under 32 characters) · request logging (morgan) · graceful
shutdown on Railway redeploys.

## Deploy to Railway

1. Put this folder in a GitHub repo (`.gitignore` already keeps `.env` and `node_modules` out).
   Check with `git status` that `.env` is **not** listed before your first commit.
2. Railway → **New Project** → **Deploy from GitHub repo** → pick the repo. If the backend is in
   a subfolder, set **Settings → Root Directory** to that folder.
3. **Variables**: add everything from `.env.example` with real values, plus `NODE_ENV=production`.
   Don't set `PORT` (Railway provides it) or `DNS_SERVERS`.
4. **MongoDB Atlas → Network Access**: allow Railway to connect. Railway's outgoing IPs aren't
   fixed on most plans, so this usually means `0.0.0.0/0`, which is safe only with a strong
   database password.
5. **Settings → Networking → Generate Domain**. Open `https://<domain>/api/health`; you should
   see `"database":"connected"`.
6. Railway reads `railway.json`: start command `npm start`, health check `/api/health`, restart
   on failure.
7. In the Flutter app, build with
   `--dart-define=API_BASE_URL=https://<domain>/api` (or set `productionBaseUrl` in
   `lib/services/api_client.dart`).
"# plotpostapp" 

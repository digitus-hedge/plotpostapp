# PlotPost: Stage 0 and Stage 1 report

**Stage 0:** foundation and security. **Stage 1:** login, sessions and profile.
Date: 19 Nov 2026

## 1. How to install

**Backend** (`plotpost_backend_stage0-1.zip`)

1. Back up your current `plotpost_backend` folder.
2. Copy the zip's contents over it. Your `.env` is **not** in the zip and is not touched.
3. In `.env`, delete the first, shorter `JWT_SECRET=` line (you have two; the long one is the
   one in use) and add the new settings from `.env.example` you want (SMTP, Google).
4. `npm install`, then `npm test`, then `npm run dev`.

**Flutter** (`plotpost_flutter_stage0-1_changes.zip`)

1. Commit or back up your project first.
2. Copy the zip's `lib/` folder and `pubspec.yaml` over your `plotpost` project (same paths).
3. Run `flutter pub get`, then `flutter analyze`, then send me anything it reports.
4. Run on your phone. Pass the server address:
   `flutter run --dart-define=API_BASE_URL=http://<your-PC-IP>:5000/api`
   (after the Railway deploy: `--dart-define=API_BASE_URL=https://<domain>/api`).
   Google sign-in also needs `--dart-define=GOOGLE_SERVER_CLIENT_ID=<web client id>`.

## 2. What changed

### Backend

| File | Change |
|---|---|
| `app.js` (new) | The Express app, split from `server.js` so tests can load it. Helmet, CORS allow-list, request logging, body size limits, injection filter, rate limit, JSON 404/500 handling. |
| `server.js` | Checks settings → connects to MongoDB → starts. Exits if MongoDB is unreachable (Railway restarts it). Clean shutdown on redeploy. |
| `config/env.js` (new) | Every setting in one place; refuses to start with a missing or weak `JWT_SECRET`. |
| `config/db.js` | Now the only database connection (there were two). The Windows DNS fix runs only locally. |
| `config/cloudinary.js` | Reads from `env.js`. |
| `middleware/errorHandler.js`, `rateLimiter.js`, `sanitize.js`, `validate.js` (new) | Error handling, rate limits, MongoDB injection filter, input validation. |
| `middleware/authMiddleware.js` | Short-lived access tokens; rejects tokens from before a password change; `optionalAuth` and admin-only `authorize("admin")`. |
| `middleware/uploadMiddleware.js` | Wrong file type now returns 400 instead of 500. |
| `models/User.js` | New fields: role, Google ID, email verification, agency, designation, location, settings, photo ID, code fields. Password hidden by default and optional for Google accounts. |
| `models/RefreshToken.js` (new) | One row per logged-in device; only hashes stored; expired rows auto-deleted. |
| `controllers/authController.js` | Register, login, Google, refresh, logout, logout-all, verify email, resend, forgot, reset, change password. |
| `controllers/userController.js` | Profile with new fields, settings, profile photo upload/delete, public profile, delete account. Saved-posts code unchanged. |
| `routes/authRoutes.js`, `routes/userRoutes.js` | New endpoints (see README). |
| `routes/enquiryRoutes.js` | Uses the shared `optionalAuth` (same behavior). |
| `services/` (new) | `tokenService`, `codeService`, `emailService`, `googleAuthService`, `imageService`. |
| `validators/` (new) | Input rules for auth and profile. |
| `utils/` (new) | `AppError`, user serializers (password, codes and Google ID are never sent). |
| `scripts/make-admin.js` (new) | `npm run make-admin -- email@example.com`. |
| `tests/` (new) | 69 automated tests. |
| `.env.example`, `.gitignore`, `railway.json`, `README.md` (new) | Settings template; keeps `.env` and `node_modules` out of git; Railway start and health check; docs. |
| `package.json` | New packages: helmet, express-rate-limit, morgan, nodemailer, google-auth-library, zod; dev: jest, supertest, mongodb-memory-server-core. `npm test` works. |

Not changed: post, enquiry and upload controllers, the Post and Enquiry models, and every
existing URL and response field the app uses. A dedicated test file checks those still work.

### Flutter

| File | Change |
|---|---|
| `lib/services/api_client.dart` (new) | One place for server URL, timeouts, tokens and readable error messages. On a 401 it refreshes the session once (never two refreshes at the same time) and retries; if the session is over, the app returns to the Welcome screen. |
| `lib/services/api_service.dart` | Same methods as before, now through `ApiClient`, plus: Google sign-in, forgot/reset password, verify email, change password, profile photo, settings, delete account. Logout now ends the session on the server too. |
| `lib/services/google_auth_service.dart` (new) | Wraps `google_sign_in` 7.x. |
| `lib/main.dart` | Sends the user to Welcome with a message when the session ends. |
| `lib/screens/verify_code_screen.dart` (new) | Enter the 6-digit code: verify email (with "Skip for now") or reset password. |
| `lib/screens/auth_form_screen.dart` | Real password reset by code; "Forgot password?" link on Log In; signup password rule matches the server (8+ chars, a letter and a number); after signup → verify-email screen. |
| `lib/screens/welcome_screen.dart` | "Continue with Google" works. |
| `lib/screens/account_settings_screen.dart` | Shows your real name, email and photo; the three switches save to the server; Change Password opens a form (it used to open the reset screen); new **Verify Email Address** row (only when unverified) and **Delete Account** row. |
| `lib/screens/edit_profile_screen.dart` | Starts from your real details; agency, designation and location now save; the photo uploads to Cloudinary (it used to send the phone's file path); **Remove Photo**; email is read-only; on an error you stay on the screen instead of it closing as if saved. |
| `lib/screens/profile_screen.dart` | Shows your real details and photo instead of made-up defaults (fake bio, "Calicut Prime Properties"); verified tick only when the email is verified; empty fields say "Not added yet". |
| `lib/widgets/auth_field.dart` | Shared new-password rule. |
| `pubspec.yaml` | Adds `google_sign_in: ^7.2.0` and `http_parser: ^4.1.0`. |

## 3. Test report

**Backend: 69 of 69 passed** (4 files, run three times in a row, no flaky results). Full list in
`TEST_RESULTS.txt`.

- `security.test.js` (14): health, 404s, broken JSON, Helmet headers, CORS allow/deny,
  oversized bodies, injection attempt on login, rate limit returns 429, no internal error
  details leak, admin-only guard.
- `auth.test.js` (33): register (validation, duplicates in any letter case, can't make itself
  admin), login (same error for wrong email or wrong password, old 6-character passwords still
  work), expired/forged/old-style tokens, refresh rotation and theft detection, refresh tokens
  stored only as hashes, logout and logout-all, email verification (lockout after 5 tries,
  resend cooldown), forgot/reset (no account enumeration, old sessions and old tokens killed,
  code single-use), change password, Google sign-in (create, link, refuse unverified link,
  Google-only account sets a password, rejected token).
- `profile.test.js` (16): profile fields, can't change role/email/verification, phone and
  photo-link validation, settings, photo upload/replace/delete (Cloudinary mocked), bad files,
  public profile hides email and optionally the phone, delete account removes exactly the
  user's data and nothing of other users'.
- `existing-endpoints.test.js` (6): posts create/list/edit/delete, ownership checks,
  save/unsave, guest and logged-in enquiries, likes and comments, all still working.

**Where they ran:** FerretDB 1.24, a MongoDB-compatible database, because MongoDB itself can't be
installed in my workspace. On your PC, `npm test` uses a real (temporary) MongoDB. Please run it
once and send me the result.

**What testing caught and fixed:**
- **Two removal steps in "delete account"** used MongoDB features FerretDB doesn't support
  (conditional `$pull` on comments, `$pull` with `$in`). They were rewritten in a way that works
  on both, and the test now checks exactly what's removed.
- **Image cleanup** was called with extra arguments and an empty ID. Fixed.
- **Auto-expiring indexes** aren't supported by FerretDB. They stay on for Atlas and are switched
  off only for tests (`DB_TTL_INDEXES=false`). Expired tokens are rejected by the query anyway.
- **Checking the tests themselves:** I broke the code-lockout rule on purpose and confirmed a test
  fails, so the tests can catch real breakage.

**Not verified here:**
- **Flutter.** The Flutter SDK can't be downloaded in my workspace, so the Dart code hasn't been
  compiled. I checked every changed file for matching brackets and that every `ApiService` call
  exists. `flutter analyze` on your machine is the real check.
- **Real email, Google and Cloudinary.** Tests replace these with fakes, so they need a manual
  check after you add the credentials.
- **The existing Flutter test.** `test/widget_test.dart` is Flutter's default counter test and
  was already failing before these changes (the app has no counter). I left it alone.

## 4. What you need to set up

**Email (verification and reset codes)**
- Google Workspace / Gmail: Google Account → Security → 2-Step Verification on → **App passwords**
  → create one.
- In `.env` and on Railway, set: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
  `SMTP_USER=<full address>`, `SMTP_PASS=<app password>`,
  `EMAIL_FROM=PlotPost <that address>`.
- Until then, register still works but sends no code, and forgot-password says reset emails
  aren't set up. To test locally without SMTP, set `EMAIL_DEV_LOG_CODES=true` and codes print
  in the terminal (never on Railway).

**Google sign-in.** Use the Google Cloud project behind your Firebase project, or a new one.
1. Google Cloud Console → **Google Auth Platform** → Branding: app name "PlotPost" and support
   email. Audience: External. While in Testing, add your Gmail as a test user.
2. Clients → **Create client** → *Web application* → name "PlotPost server". Copy the
   **Client ID**:
   - backend `.env` and Railway: `GOOGLE_CLIENT_IDS=<web client id>`
   - Flutter: `--dart-define=GOOGLE_SERVER_CLIENT_ID=<web client id>`
3. Clients → **Create client** → *Android*:
   - package name `digitus.com.plotpost`
   - SHA-1 from `cd android && ./gradlew signingReport` (the "debug" variant for now; add the
     release / Play Store SHA-1 later)

   This client's ID isn't used in code, but Google needs it to exist.
4. Google sign-in works in the Android app, not in the web build (the web build shows a message
   saying so).

**Railway.** Steps are in the backend `README.md` ("Deploy to Railway"). In short:
1. Push the backend to GitHub and deploy it on Railway.
2. Add the Variables, with `NODE_ENV=production`.
3. Allow Railway in Atlas Network Access.
4. Generate a domain and check `/api/health`.

If you use the Flutter web build on Firebase Hosting, add its address to `CORS_ORIGINS`.

## 5. Status

**Done in Stages 0–1**
- Security basics
- Registration and login
- Short-lived access tokens with refresh tokens
- Logout and logout-all
- Forgot, reset and change password
- Email verification
- Google sign-in
- Admin role and admin-only guard
- Account deletion
- Profile: view, update, new fields, photo upload/delete, public profile
- Account settings
- Tests and docs

**Known gaps left on purpose for later stages**
- **Publishing a post can still look successful when it failed** (`savePost` quietly returns the
  local copy), and photos are still stored as base64 in MongoDB. → Stage 2 (I raised its timeout
  from 12 s to 60 s to make false successes rarer until then).
- **Sample posts** still appear in the feed, in "Manage My Postings" and in the profile when you
  have none. → Stage 2.
- **The profile's "4.9 Rating"** is made up; there is no rating feature in the plan. Tell me
  whether to remove it or plan ratings.
- **Changing your email** isn't supported (the field is read-only).
- **Login tokens are kept in `shared_preferences`.** Moving them to `flutter_secure_storage`
  would be safer; worth doing before launch.
- **Stages 2–10** are not started.

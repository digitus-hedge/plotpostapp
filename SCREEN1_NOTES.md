# Screen 1: Welcome, Log In, Sign Up, Forgot Password

## Install

**Backend** (`screen1_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones (same paths). Your `.env` is not touched. Then run:

```
npm install
npm test
npm run dev
```

The first `npm test` downloads a temporary MongoDB (about 100 MB). It never uses your real
database.

**Flutter** (`screen1_flutter.zip`): copy the files into your `plotpost` folder (same paths).
Then run:

```
flutter pub get
flutter analyze
```

Send me anything `flutter analyze` reports.

## What changed

- **Backend, changed:** `controllers/authController.js`, `routes/authRoutes.js`, `models/User.js`,
  `server.js`, `package.json`, `package-lock.json`
- **Backend, new:** `services/` (email, codes, Google), `validators/authValidators.js`,
  `middleware/validate.js`, `rateLimiter.js`, `errorHandler.js`, `.env.example`,
  `tests/auth.test.js`
- **Flutter, changed:** `screens/auth_form_screen.dart`, `screens/welcome_screen.dart`,
  `services/api_service.dart`, `pubspec.yaml`
- **Flutter, new:** `screens/reset_password_screen.dart`, `services/google_auth_service.dart`

Sign Up and Log In return exactly the same fields as before, so the rest of the app is unaffected.

## New endpoints

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/auth/forgot-password` | `email` | Always "If an account exists… we've sent a 6-digit code". The code lasts 15 minutes, and you can ask for a new one once a minute. |
| `POST /api/auth/reset-password` | `email`, `code`, `newPassword` | Sets the password and logs in (`token` + `user`). 5 wrong codes lock it. |
| `POST /api/auth/google` | `idToken` | Logs in or creates the account (`token`, `user`, `isNewUser`). |

`/register` and `/login` now check input and allow 20 attempts per 15 minutes per IP address.

## Set up

**1. Email, for Forgot Password**

- In your Google account: Security → turn on 2-Step Verification → **App passwords** → create one.
- Add these to `.env`:
  ```
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=465
  SMTP_USER=<full email address>
  SMTP_PASS=<the 16-character app password>
  EMAIL_FROM=PlotPost <same address>
  ```
- To test before setting this up, put `EMAIL_DEV_LOG_CODES=true` in `.env`. The code then
  appears in your server terminal instead of an email. Use this on your PC only.

**2. Continue with Google**

1. Open [Google Cloud Console](https://console.cloud.google.com) and pick your Firebase project
   (or create a project).
2. **Google Auth Platform → Branding:** app name PlotPost and your support email.
   **Audience:** External, then add your Gmail as a test user.
3. **Clients → Create client → Web application.** Copy its Client ID:
   - In `.env`: `GOOGLE_CLIENT_IDS=<that ID>`
   - When running Flutter: `--dart-define=GOOGLE_SERVER_CLIENT_ID=<that ID>`
4. **Clients → Create client → Android:**
   - Package name: `digitus.com.plotpost`
   - SHA-1: run `cd android && ./gradlew signingReport` and take the SHA-1 from the "debug"
     section.

## Test on your phone

```
flutter run --dart-define=API_BASE_URL=http://<your PC's IP>:5000/api --dart-define=GOOGLE_SERVER_CLIENT_ID=<web client id>
```

1. **Sign Up:** try a 6-character password and check you get the new rule message. Then use 8+
   characters with a number.
2. **Log In:** log in with that account. A wrong password should say "Invalid email or password".
3. **Forgot password?** (the new link under the password box): enter your email, check your inbox
   (or the server terminal), enter the code and a new password. You should land in the app,
   logged in.
4. **Continue with Google:** pick your Google account and you should land in the app. Log out and
   try again; it should log in to the same account.

## Test results

**29 of 29 passed**, run 3 times in a row (details in `SCREEN1_TEST_RESULTS.txt`):

- **Sign Up (7):** account created, duplicate emails refused, each bad input explained
- **Log In (6):** right and wrong passwords, old 6-character passwords still work, injection blocked,
  rate limit kicks in
- **Forgot Password (8):** no account enumeration, code stored only as a hash, cooldown, reset
  works and the code is single-use, 5-try lockout, expiry, password rule, clear message when email
  isn't set up
- **Google (6):** new account, linking, refusing an unverified link, Google-only account sets a
  password, rejected token, clear message when not set up
- **Other screens (2):** the login token still opens the profile; JSON 404s

I also broke the code on purpose twice (allowed 50 wrong codes; skipped the password check) to
confirm the tests catch it. Both were caught.

These ran on FerretDB, a MongoDB-compatible database, because MongoDB can't be installed in my
workspace. Your `npm test` uses real MongoDB.

**Not checked by me:**
- **The Flutter code hasn't been compiled.** No Flutter SDK here, so I checked brackets and that
  every `ApiService` call exists. `flutter analyze` on your PC is the real check.
- **Real emails and real Google sign-in** need your keys above.

## Known limits

- **Resetting your password doesn't log out other phones** that were already logged in. Logins
  still last 30 days, as before. Ending other sessions can come with the Account Settings screen.
- **Google sign-in works in the Android app only.** The web build shows a message saying so.
- **The backend has no `.gitignore`.** Add one with `node_modules/` and `.env` before you push to
  GitHub or Railway, or your passwords would be uploaded.

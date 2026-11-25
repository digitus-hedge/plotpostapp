# Phase 4, Step 2: email verification and a real email service

## A bug fixed first: Forgot Password didn't work

The auth controller called `issueResetCode` and `checkResetCode`, but `services/codeService.js` didn't have them, so:
- no reset email was ever sent (the app still said "we've sent a code")
- resetting always failed with a server error

Both now work. The rules are unchanged: a 6-digit code, valid for 15 minutes, 5 tries, 60 seconds between codes. A successful reset also confirms the email.

## What's new

**Email sending** (`services/emailService.js`)
- Railway's Hobby plan blocks SMTP, so emails now go through an email service's HTTPS API:
  - **Brevo**: `BREVO_API_KEY`. The free plan allows 300 emails a day; free-plan emails carry a small "Sent with Brevo" footer.
  - **Resend**: `RESEND_API_KEY`. The free plan allows 100 a day and 3,000 a month.
  - **SMTP**, as before. It works on your PC, or on Railway Pro.
- The first one that's set up is used. `EMAIL_PROVIDER=brevo|resend|smtp` picks one when several are set.
- Everything uses it: verification codes, reset codes, inquiry copies and report alerts.

**Email verification**
- **Sign-up** emails a 6-digit code. The app already opens the code screen after sign-up, and the login works straight away.
- **New routes:**
  - `POST /api/auth/verify-email` `{ code }` (logged in)
  - `POST /api/auth/resend-verification` (logged in): 60 seconds between codes, 5 an hour
  - The same limits as reset codes: 15 minutes, 5 tries
- **Not needed for:** browsing, saving and liking.
- **Needed before:** posting a listing, sending interest, starting or sending chat messages, and commenting. Without it the server answers 403 `{ emailNotVerified: true }`. In the app, a "Confirm your email first" box appears; it sends a code and opens the code screen, then the action goes ahead.
- Accounts that count as confirmed:
  - **Existing accounts**: the server marks them as verified on its first start ("N existing account(s) marked as verified"). Nobody is locked out.
  - **Google accounts**: Google has already confirmed the email.
- **Safety switch:** while no email service is set up, verification isn't required, because nobody could get a code. The server prints a warning at start. `EMAIL_VERIFICATION_REQUIRED=false` switches it off on purpose.
- The login and profile responses include `isEmailVerified`. Settings already shows "Verify Email Address" until it's done.

## Set up Brevo (about 15 minutes)

1. Sign up at **brevo.com** (free).
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain.** Use your domain, then add the DNS records it shows (for SPF, DKIM and DMARC) at your domain provider, for example Hostinger → DNS Zone. Wait until Brevo shows them as verified.
   - If you don't have a domain yet: under **Senders**, add and confirm a single email address. That works for testing, but more emails go to spam.
3. **SMTP & API → API Keys → Generate a new API key.** Copy it once.
4. In `backend\.env` (and Railway → Variables):
   ```
   BREVO_API_KEY=xkeysib-...
   EMAIL_FROM=PlotPost <no-reply@your-domain.com>
   ```
   The address must be on the domain, or be the sender, you verified in step 2.
5. Restart the backend. The warning "Email is not set up" should be gone.

Never share or commit the API key.

## Files

Backend:
- `services/codeService.js`: the missing reset functions, plus verification codes
- `services/emailService.js`: Brevo / Resend / SMTP, and the verification email
- `controllers/authController.js`: code at sign-up, verify, resend, Google counts as verified
- `routes/authRoutes.js`, `validators/authValidators.js`: the two new routes
- `middleware/emailVerified.js` (new): the check
- `routes/postRoutes.js`, `routes/enquiryRoutes.js`, `routes/chatRoutes.js`: the check applied
- `models/User.js`: `emailVerifiedAt` and the code, plus the upgrade for existing accounts
- `controllers/userController.js`: `isEmailVerified` in the profile
- `server.js`: runs the upgrade, and warns when email isn't set up
- `.env.example`: the new settings

Tests:
- `tests/auth.test.js` (**rewritten**). The old one tested refresh tokens and email fields this backend doesn't have, so it couldn't pass. The new one has 16 tests covering sign-up, login, verification, forgot/reset, change password and Google.
- `tests/existing-endpoints.test.js` (rewritten for the current API)
- `tests/security.test.js`: uses `adminOnly`, which exists, instead of `authorize`, which doesn't
- `tests/helpers/auth.js`: reads `token`
- `tests/setupEnv.js`: other tests skip verification

App:
- `lib/widgets/email_verification.dart` (new): the "Confirm your email" box
- `lib/services/api_service.dart`: `saveCachedUser`
- These now ask for a confirmed email first:
  - `lib/screens/create_post_screen.dart` (Publish)
  - `lib/screens/show_interest_screen.dart` (Show interest)
  - `lib/widgets/comments_modal_sheet.dart` (Post comment)
  - `lib/screens/chat_screen.dart` (Send)
  - `lib/screens/seller_profile_screen.dart` (Message)

## Install

1. Backend: extract `plotpost_phase4_step2_backend.zip` into `backend` and overwrite. Set up Brevo (above), then run `npm test` and `npm run dev`.
2. App: extract `plotpost_phase4_step2_flutter.zip` into `frontend` and overwrite. Run `flutter analyze`, then `flutter run`.

Both zips are cumulative. There are no new packages.

## How to check it

1. **Forgot Password** with your email: the code arrives, and resetting works.
2. **Sign up** with a new email: the code arrives and the code screen opens. Tap "Skip for now".
3. Try to publish a post, comment, send interest or message someone. "Confirm your email first" appears; send the code, enter it, and the action works.
4. An **existing account** can do everything without being asked.
5. **Continue with Google** is never asked.

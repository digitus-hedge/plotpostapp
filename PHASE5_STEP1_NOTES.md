# Phase 5, Step 1: public pages and deleting an account from the web

Google Play needs three links from you: a privacy policy, the terms, and a page where people can delete their account without the app. Your backend now serves all three, on the same address as the admin panel:

| Page | Address | What it is |
|---|---|---|
| Privacy Policy | `https://<your server>/privacy` | Rewritten to match what PlotPost really does |
| Terms of Service | `https://<your server>/terms` | Same words as the app's Terms tab |
| Delete account | `https://<your server>/delete-account` | Email, then 6-digit code, then deleted |

On your PC: `http://localhost:5000/privacy` and so on.

## The privacy policy

The old in-app policy was wrong in places:
- It was dated January 2025.
- It said PlotPost uses your phone's location. It doesn't.
- It said saved items stay on the phone. They're on the server now.
- It didn't mention chats, phone alerts, Google sign-in or the email service.

The new one covers:
- what's collected, and how it's used
- who can see what (for example, phone numbers only for logged-in users)
- the companies that help run PlotPost (MongoDB Atlas, Railway, Cloudinary, Firebase, Google Sign-In, the email service)
- how long things are kept
- how to delete your account
- your choices, security, children (18+), changes and contact

**The same text is in the app** (Privacy & Terms → Privacy Policy). If you change one, change the other.

Before you publish, please check:
- **Your name or business name.** The policy just says "the PlotPost team". If PlotPost is run by a company or a named person, add that name. Play Console asks for it anyway.
- **An email address for privacy questions.** Right now the only contact is WhatsApp/phone +91 62356 49489. An email address (for example privacy@your-domain) is better, and Play Console needs one too.
- **Is it right?** I wrote it from the code, in plain language, but I'm not a lawyer. If you can, have someone check it against India's data protection rules (the DPDP Act).

## Deleting an account from the website

1. The person enters their email and gets a 6-digit code. It works the same way as the Forgot Password code: 15 minutes, 5 tries, 60 seconds between codes, 5 an hour. It also works for accounts made with Google.
2. They enter the code, tick "I understand", and the account is deleted straight away.

**The same deletion as the app.** The app's Delete Account button and the website now use one shared piece of code (`services/accountDeletion.js`), so both delete exactly the same things:
- the account and profile photo
- listings and their photos
- inquiries sent and received
- chats and messages
- comments, likes, follows and saved items
- notifications and phone alerts

**One gap fixed:** the record of which listings the person had opened in the last 2 days is now deleted too. Before, those records were left to expire on their own.

**It never reveals who has an account.** The page answers the same whether or not an email has an account.

**If no email service is set up:** the page says to message support on WhatsApp instead. Once Brevo is set up (Phase 4 Step 2), it works on its own.

## What's kept after deleting, and for how long

Both the policy and the delete page say this:

| What | How long |
|---|---|
| Reports made by the person or about them | 12 months after an admin closes them, then deleted automatically |
| Admin log rows | 12 months after the action, then deleted automatically |
| Server logs and backups | Up to 30 days |

The 12-month clean-up runs with the hourly listing-expiry check. Open reports stay until an admin closes them.

**Two things to keep true:**
- **The admin log is no longer kept forever.** It now goes after 12 months.
- **The backup script** (still to come) must keep copies for **30 days or less**, so the policy stays true. The same goes for server logs.

## Files

New:
- `public/privacy.html`, `public/terms.html`, `public/delete-account.html`
- `public/site/site.css`, `public/site/delete-account.js`, `public/site/icon.svg`
- `services/accountDeletion.js`: the shared deletion
- `controllers/accountDeletionController.js`: the two website steps
- `services/retentionService.js`: the 12-month clean-up
- `tests/webPages.test.js`: 9 tests, no database needed
- `tests/accountDeletion.test.js`: 9 tests, needs the test database

Changed:
- `server.js`: serves the pages, with strict page rules: only PlotPost's own files may load, and no other site can frame them
- `routes/authRoutes.js`, `validators/authValidators.js`: `POST /api/auth/delete-account/request-code` and `/confirm`
- `models/User.js`: holds the deletion code, stored only as a hash
- `services/codeService.js`, `services/emailService.js`: the deletion code and its email
- `controllers/userController.js`: Delete Account uses the shared deletion
- `services/expiryService.js`: runs the 12-month clean-up
- `models/AdminAction.js`: the comment now says log rows are deleted after 12 months

App:
- `lib/screens/terms_privacy_screen.dart`: the new privacy policy text

## Install

1. Backend: extract `plotpost_phase5_step1_backend.zip` into `backend` and overwrite.
2. Run `npm test` and `npm run dev`, then open `http://localhost:5000/privacy`, `/terms` and `/delete-account`.
3. App: extract `plotpost_phase5_step1_flutter.zip` into `frontend` and overwrite. Run `flutter analyze`.

Both zips are cumulative. There are no new packages or settings.

## How to check

1. Open the three pages on your PC and on your phone (same Wi-Fi: `http://<your PC's IP>:5000/privacy`).
2. Make a test account and post a listing.
3. On `/delete-account`, enter its email.
   - With Brevo set up, the code arrives by email.
   - Without it, the page tells you to contact support. That's expected.
4. Enter the code, tick the box and delete. The listing and the account are gone, and logging in no longer works.
5. In the app: Profile → Settings → Privacy Policy & Terms shows the new policy, dated 24 November 2026.

I couldn't run the database tests here, so please run `npm test` and send me anything that fails.

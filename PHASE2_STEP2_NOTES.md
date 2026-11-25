# PlotPost Phase 2, Step 2: admin panel, removing listings, banning users

Date: 23 Nov 2026. Covers item 12: an admin panel to view reports, remove listings and ban users, and to act on reports within 24 hours.
Step 3 (RERA agent verification) comes next.

**These zips include Step 1 as well.** If you haven't copied the Step 1 zips yet, just use these.

## 1. How to install

**Backend** (`plotpost_phase2_step2_backend.zip`)
1. Stop the backend (Ctrl + C) and back up your `backend` folder.
2. Right-click the zip → **Extract All…** → **Browse** to your backend folder (the one with `server.js`) → **Extract** → **Replace the files**.
3. Run `npm test` and send me the result.
4. Start it with `npm run dev`.

**Flutter** (`plotpost_phase2_step2_flutter.zip`)
1. Extract the zip into `plotpost\frontend` (the folder with `pubspec.yaml`) and **Replace the files**.
2. Run `flutter pub get`, then `flutter analyze`, and send me the output.

## 2. Make yourself an admin and open the panel

1. In the app, sign up (or use your existing account). It needs a password: Google-only accounts set one with "Forgot password".
2. In the backend folder, run:
   ```
   node scripts/make-admin.js your@email.com
   ```
   - It should print `your@email.com is now: admin`.
   - `node scripts/make-admin.js --list` shows every admin.
   - `... --remove` takes the admin role away.
3. Open the panel in a browser:
   - **On your PC:** http://localhost:5000/admin
   - **After the Railway deploy:** https://your-domain/admin
4. Log in with that email and password.

## 3. What the panel does

| Screen | What you can do |
|---|---|
| **Dashboard** | Open reports, reports **waiting over 24 hours** (red), the oldest open report, and counts of listings, accounts, removed listings and banned accounts. Overdue reports are listed underneath. |
| **Reports** | Open / Done, and All / Listings / Comments / Accounts. Each card shows the item, who wrote it, every report (reason, details, reporter, time) and how long it has waited. Actions: **Remove listing**, **Remove comment**, **Ban seller / author / account**, **Dismiss (no action)**, and **Restore** on a removed listing. |
| **Listings** | Search by title, location, or seller name or email. Filter to removed listings. Remove or restore. |
| **People** | Search by name, email or phone. Filter Banned or Admins. Click a name to see their details, listings, reports about them and past admin actions, and to Ban or Unban them. |
| **Audit log** | Every action taken in the panel: who did it, when, what, why, and how many reports it closed. |

Remove and Ban ask for a **reason**, with quick picks. The person is shown that reason.

## 4. What happens in the app

- **Removed listing:**
  - It disappears from the feed, search, Saved and the details page for everyone. A link shows "This listing was removed by PlotPost."
  - It can't be liked, commented on or enquired about.
  - The seller still sees it in My Listings as **"Removed by PlotPost"**, with the reason.
  - The seller also gets a notification and a phone alert.
  - **Restore** puts it back.
- **Removed comment:** it's deleted, and the author gets a notification with the reason.
- **Banned account:**
  - **Every login ends straight away.** The app logs them out with "This account has been suspended… Contact PlotPost support on WhatsApp +91 62356 49489".
  - New logins (password, Google or password reset) are refused.
  - Their listings and comments are hidden from everyone.
  - Their phone alerts stop.
  - All open reports about them are closed.
  - **Unban** brings their listings and comments back. They have to log in again.
- Admins can't ban themselves or other admins.

## 5. Report emails (helps with the 24 hours)

Every new report emails all admins, with the reason and what was reported. This needs the SMTP settings in `.env` (the same ones as the inquiry emails). Optional `.env` lines:
```
ADMIN_PANEL_URL=https://your-domain/admin
REPORT_ALERT_EMAILS=someone@example.com,other@example.com
```
`ADMIN_PANEL_URL` is the link written in the email. `REPORT_ALERT_EMAILS` adds extra people besides the admins.

## 6. What changed

### Backend

| File | Change |
|---|---|
| `admin/index.html`, `admin/app.js`, `admin/style.css` (new) | The panel. Plain HTML/JS/CSS with no build step, served at `/admin` with strict browser security headers. |
| `controllers/adminController.js`, `routes/adminRoutes.js`, `validators/adminValidators.js` (new) | The admin API (`/api/admin/...`). Admins only. |
| `models/AdminAction.js` (new) | The audit log. |
| `models/User.js` | `role` (user / admin), plus `bannedAt`, `banReason` and `bannedBy`. |
| `models/Post.js` | `removedAt`, `removedReason`, `removedBy`, and `sellerBanned`. |
| `models/Report.js` | `resolvedAt`, `resolvedBy`, `resolution`. |
| `models/Notification.js`, `services/notificationService.js`, `controllers/notificationController.js` | A new "moderation" notice: PlotPost removed your listing or comment. |
| `middleware/authMiddleware.js` | Banned accounts are logged out (401 with `banned: true`). New `adminOnly` check. |
| `controllers/authController.js` | Banned accounts can't log in (403). |
| `controllers/postController.js`, `userController.js`, `enquiryController.js`, `followController.js` | Removed listings and banned sellers are hidden everywhere except from the owner. Banned people's comments are hidden. |
| `services/reportService.js`, `services/emailService.js` | The email to admins on each new report. Reporting again reopens a closed report. |
| `scripts/make-admin.js` | Fixed. Before, it set a field the account didn't have, so it did nothing. It also gains `--list`. |
| `server.js` | Mounts `/api/admin` and the `/admin` page. |
| `tests/admin.test.js` (new) | 9 tests. |

### Flutter

| File | Change |
|---|---|
| `models/property_post.dart` | `isRemoved`, `removedReason`. |
| `screens/my_listings_screen.dart` | A red "Removed by PlotPost" label and the reason. |
| `screens/notifications_screen.dart` | "PlotPost removed your listing / comment. Reason: …" |
| `services/api_client.dart`, `main.dart` | A suspended account is logged out and told why. |

## 7. Test it (admin, seller A, buyer B)

1. **Make an admin:** run `make-admin.js` for your account and log in at `/admin`. The Dashboard should show zeros.
2. **Report a listing:** as B in the app, report A's listing. It shows up in the panel under Reports (press Refresh). If SMTP is set, an email arrives.
3. **Remove it:** click **Remove listing** and pick a reason.
   - In the app, B no longer sees the listing.
   - A sees "Removed by PlotPost" and the reason in My Listings, plus a notification.
4. **Restore it:** Listings → filter Removed → **Restore**. It's back for everyone.
5. **Remove a comment:** B reports a comment by A. In the panel, click **Remove comment**. A gets a notification.
6. **Ban the author:** in the panel, click **Ban author** for A.
   - A's app logs out with the suspended message.
   - Logging in again is refused.
   - A's listings vanish for B.
7. **Unban:** People → Banned → **Unban**. A can log in again.
8. **Audit log:** every action above is listed.

## 8. What I could check here

- The panel was clicked through in a real browser against a stand-in API: login, the wrong-password message, Dashboard, Reports, the reason box, Remove listing, Listings, People with the details drawer, and the Audit log. **Text from users is shown safely**: HTML or script typed into a report shows as plain text.
- Every backend file passes Node's syntax check, the server loads with all routes, and the word-filter tests pass.
- There's no MongoDB here, so `tests/admin.test.js` (9 tests) and the rest need `npm test` on your PC.
- There's no Flutter here either: I checked brackets, and `flutter analyze` is the real check.

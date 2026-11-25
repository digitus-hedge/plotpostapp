# PlotPost Phase 2, Step 1: reports, blocking, word filter, terms, support contact

Date: 23 Nov 2026. Covers items 10, 11 and 14, plus the two store items (terms and support contact).
Steps 2 (admin panel, remove listings, ban users) and 3 (RERA verification) come next.

## 1. How to install

**Backend** (`plotpost_phase2_step1_backend.zip`)
1. Back up your `backend` folder.
2. Copy the zip's contents over it (same paths). Your `.env` isn't in the zip and isn't touched.
3. Run `npm test`. Send me the output. It includes the new `tests/moderation.test.js` and `tests/contentFilter.test.js`.
4. Start it with `npm run dev`. On the first start it upgrades your old reports automatically (see section 3).

**Flutter** (`plotpost_phase2_step1_flutter.zip`)
1. Commit or back up your project.
2. Copy the zip's `lib/` and `pubspec.yaml` over `plotpost/frontend`. The zip also has **all the Phase 1 files**, so it works whether or not you already copied Phase 1.
3. Run `flutter pub get`, then `flutter analyze`. Send me everything it reports.

## 2. Bug fixed: request checks were not running

`middleware/validate.js` expected `validate({ body: schema })`, but every route calls `validate(schema)`. So no request was checked: empty comments, wrong phone numbers, bad report reasons and over-long text all got through. The fix accepts both forms, so all checks run again. The app's requests already match them.

## 3. What changed

### Backend

| File | Change |
|---|---|
| `middleware/validate.js` | The fix above. |
| `models/Report.js` | Reports now have a `kind`: post, comment or user. It stores who wrote the reported thing (`reportedUser`) and a copy of a reported comment's text. Comments and people have their own 6 reasons. `upgradeOldReports()` marks old reports as posts and drops the old one-report-per-post index. |
| `services/reportService.js` (new) | Saves or updates a report, one per person per item. |
| `controllers/postController.js` | `reportComment` (new). Blocked people's posts are hidden in the feed, search, the Following tab and `by-ids`, and their comments are hidden too. The details page tells the app `seller.blockedByMe`. |
| `controllers/userController.js` | `reportUser`, `getBlockedUsers`, `acceptTerms` (new). Saved posts from blocked sellers are hidden. The profile includes `termsAcceptedAt`. |
| `controllers/chatController.js` | Chats with blocked people leave the Messages list and the unread count. |
| `controllers/followController.js` | Blocked people are left out of Following and the suggested sellers. |
| `controllers/enquiryController.js` | Inquiries from blocked buyers are hidden. New ones are refused with "You can't contact this seller." |
| `controllers/authController.js` | Sign-up saves `termsAcceptedAt` when `acceptTerms` is true. Logins return it. |
| `utils/contentFilter.js`, `config/blockedWords.js`, `middleware/contentFilter.js` (new) | The offensive word filter (section 4). |
| `routes/*.js` | New routes (section 5). The filter is on posts, comments, chat messages, inquiries, profile and sign-up. |
| `models/User.js` | `termsAcceptedAt`. |
| `validators/postValidators.js`, `validators/authValidators.js` | The comment and person report reasons, and `acceptTerms`. |
| `server.js` | Runs the report upgrade after connecting to MongoDB. |
| `scripts/listReports.js` | Also lists comment and account reports. `--done-report <id>` marks one done. |
| `tests/moderation.test.js`, `tests/contentFilter.test.js` (new) | Tests for everything above. |

### Flutter

| File | Change |
|---|---|
| `widgets/safety_actions.dart` (new) | The Block confirmation, Unblock, and the Report sheets for a person or a comment, with their 6 reasons. |
| `widgets/terms_gate.dart` (new) | The "Terms of Use: Agree and continue / Log out" screen. It's shown to Google sign-ups and older accounts, and it can't be skipped. |
| `screens/blocked_users_screen.dart` (new) | Settings → Blocked People, with Unblock. |
| `screens/chat_screen.dart` | ⋮ menu: Report, and Block / Unblock. After blocking, sending is turned off. |
| `screens/property_details_screen.dart` | Seller card ⋮ menu: Report seller and Block seller (not shown on your own listing). |
| `widgets/property_post_card.dart` | The card's menu gets "Block this seller". |
| `widgets/comments_modal_sheet.dart` | Each comment by someone else gets a ⋯ button: Report comment, or Block the author. |
| `screens/browse_screen.dart` | Reloads after you block someone. Runs the terms check on start. |
| `screens/auth_form_screen.dart` | Sign-up needs "I agree to the Terms of Use". |
| `screens/terms_privacy_screen.dart` | New sections: zero tolerance for objectionable content; reporting, blocking and 24-hour review; contact. |
| `screens/help_center_screen.dart` | "Contact Support" opens WhatsApp or a call to +91 62356 49489. The fake support chat is gone. |
| `screens/account_settings_screen.dart` | A new "Blocked People" row. |
| `services/api_service.dart` | `reportComment`, `reportUser`, `setUserBlocked`, `getBlockedUsers`, `acceptTerms`, and `register(acceptTerms)`. |
| `widgets/login_prompt.dart` | Runs the terms check after logging in from a prompt. |

## 4. The word filter

- **Refused fields:**
  - posts: title, description, seller name, location
  - comments
  - chat messages
  - inquiries: name, message
  - profile: name, bio, agency, role, location
  - the name at sign-up

  The app shows: *Please remove offensive language from the description ("…").*
- **How it matches:** whole words only, so "assess" and "Kunnamangalam" pass. It ignores letter case and undoes common tricks: sh1t, $hit, f\*ck, f.u.c.k, shiiit.
- **The word list:** `config/blockedWords.js` has English and common Hindi words, plus a **short Malayalam/Manglish starter list. Please check it and add your own words** (the file explains how). Restart the server after editing.
- **Photos aren't checked.** Reports cover those.

## 5. New routes

| Route | Body | Answer |
|---|---|---|
| POST `/api/posts/:id/comments/:commentId/report` 🔒 | `{ reason, details }` | 201 new / 200 updated |
| POST `/api/users/:id/report` 🔒 | `{ reason, details }` | 201 new / 200 updated |
| GET `/api/users/blocked` 🔒 | – | `users: [{ _id, name, profileImage }]` |
| POST `/api/users/accept-terms` 🔒 | – | `termsAcceptedAt` |

**Comment and person reasons:**
- Spam or scam
- Harassment or bullying
- Hate speech or offensive language
- Sexual or inappropriate content
- Pretending to be someone else
- Other reason

## 6. Test with two accounts (A and B)

1. **Sign up:** sign up as B without ticking the box and you should be refused. Tick it and you should get in.
2. **Google or older account:** log in with Google, or with an account made earlier. The Terms screen appears. "Log out" logs you out. "Agree and continue" lets you in.
3. **Blocking from a comment:** A comments on a post. B taps ⋯ on that comment and chooses Report comment, and should see "Thanks, we'll review this comment". Then B chooses Block A from the same ⋯ menu.
   - A's posts and comments disappear for B.
   - A's chat leaves B's Messages.
   - A can't message B anymore.
4. **Unblocking:** B opens Settings → Blocked People, where A should be listed. B taps Unblock, and everything comes back.
5. **Reporting a person:** B opens a chat with A, taps ⋮ → Report, and should see "Thanks, we'll review this account". The seller card ⋮ on A's listing works the same way.
6. **Word filter:** B posts a comment with "sh1t" and should be refused with the message. A normal comment works.
7. **Help Center:** Help Center → Contact Support → WhatsApp should open a chat with +91 62356 49489.
8. **Reports on the backend:** on the PC, `node scripts/listReports.js` shows the post, comment and account reports. Step 2's admin panel will replace this.

## 7. What I could check here

- The 6 word-filter tests run here and pass.
- Every backend file passes Node's syntax check, and the server loads with all routes.
- There's no MongoDB here, so `tests/moderation.test.js` (13 tests) and your existing tests need `npm test` on your PC.
- Flutter isn't installed here either. I checked brackets and that every method called exists, and `flutter analyze` is the real check.

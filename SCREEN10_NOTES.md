# Screen 10: Profile, Edit Profile and Account Settings

Install **after Screens 1–9**.

## Install

**Backend** (`screen10_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages and no database step. Then:

```
npm test
npm run dev
```

People who are already logged in stay logged in. Their logins simply have no session number yet,
which counts as the first one.

**Flutter** (`screen10_flutter.zip`): copy the files into your `plotpost` folder, then run
`flutter analyze` and send me anything it reports. There are no new packages.

## What changed

- **Backend changed:**
  - models: `models/User.js`
  - controllers: `controllers/userController.js`, `controllers/authController.js`,
    `controllers/uploadController.js`, `controllers/postController.js` (only shares its Cloudinary
    photo helpers)
  - routes: `routes/userRoutes.js`, `routes/authRoutes.js`, `routes/uploadRoutes.js`
  - other: `middleware/authMiddleware.js`, `validators/authValidators.js`
- **Backend new:** `validators/userValidators.js`, `tests/profile.test.js`
- **Flutter changed:** `screens/profile_screen.dart`, `screens/edit_profile_screen.dart`,
  `screens/account_settings_screen.dart`, `screens/property_details_screen.dart`,
  `services/api_service.dart`
- **Flutter new:** `screens/change_password_screen.dart`

## Bugs fixed

- **Fake details on every profile.** Everyone's Profile and Settings started with "PlotPost
  User", "+91 98950 00000", a made-up broker bio, "Calicut Prime Properties" and a "Verified Real
  Estate Agent" label with a verified tick. Only your real details show now, with prompts like
  "Add a short bio" where something's missing. No verified tick or label is shown.
- **Settings could overwrite your profile.** Account Settings → Edit Profile Details opened with
  those fake details, so Save would have replaced your real profile. Edit Profile now loads your
  details from the server itself.
- **Fake listings and rating.** With no posts, Profile showed 2 sample posts as yours, and "Rating
  4.9" was fake. It now shows a "No listings yet" message and a real **Followers** count. A post
  you just published no longer appears twice.
- **Profile photos never reached anyone else.** The app saved the photo's file location on your
  phone. Photos now upload to Cloudinary, and the server only accepts your own uploaded photos.
  The photo picker also works in the web version now (it no longer uses phone-only file access).
- **Agency, role and location were never saved.** They are now. A failed save no longer closes the
  screen as if it had saved: you stay there and see why.
- **Change Password opened Forgot Password.** It's now a real form (see below).
- **Settings switches reset every time.** Push Notifications and Email Inquiries are now saved to
  your account. "Show Phone Number" is removed, because each post has its own phone field.
- **"Auto-Reply Settings" just opened Buyer Inquiries.** It's now called Buyer Inquiries.
- **Your own posts showed Save and Report buttons** that did nothing. Both are hidden on your own
  posts now.
- **The backend accepted any profile values** and sent the Google ID with the profile. Every field
  is checked now, and only safe fields are sent.

## Profile and Edit Profile

- **The header** shows your photo (or initial), name, role and location.
- **The numbers** are Listed, Inquiries (leads received) and Followers.
- **Edit Profile** saves name, role, agency, phone, location and bio, with lengths checked.
  - The photo is cropped square around the face, 400 px, in Cloudinary's `plotpost/avatars`
    folder. "Remove" takes it off.
  - A replaced or removed photo is deleted from Cloudinary (only your own photos are ever
    deleted).
  - Email is shown read-only. Changing a login email needs a verification step, which can come
    later.

## Passwords and logins

- **Change Password:** your current password, then the new one twice (8+ characters, with a letter
  and a number).
  - Other phones are logged out; this phone stays logged in.
  - Accounts that only use Google have no password, so they get "Email me a code" (Forgot
    Password) instead.
- **Log Out of All Devices** (in Settings) ends your login everywhere except this phone.
- **Forgot Password** now also logs out your other phones. This is the gap left open in Screen 1.
- **A phone that's been logged out** this way shows "You've been logged out" with a Log in button,
  instead of failing quietly.

## Delete account

In **Settings → Delete Account**. Password accounts confirm with their password; Google-only
accounts type DELETE.

- **Deleted:**
  - the account and profile photo
  - your posts, with their photos, view records, the buyer inquiries on them and other people's
    saves of them
  - your comments and likes on other posts
  - your follows, both ways
  - the enquiries you sent
- **Kept:** reports you made, shown as "(account deleted)" in `listReports.js`.
- **Other people's data is never touched.** If anything fails half-way, it's safe to try again.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/users/profile` | Safe fields, plus agency, profession (the Role field), location, settings, hasPassword, googleLinked and `stats: { listings, followers, following }`. No password, Google ID or session number. |
| `PUT /api/users/profile` | Any of name, phone, bio, agency, profession, location, `profileImage` (an upload link, or "" to remove), `settings: { pushNotifications, emailInquiries }`. Email can't be changed. |
| `POST /api/upload/avatar` | Profile photo upload (field `image`). Returns `imageUrl`. |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }`. Returns a fresh `token` for this phone. |
| `POST /api/auth/logout-all` | Returns a fresh `token` for this phone. |
| `DELETE /api/users/me` | `{ password }` or `{ confirm: "DELETE" }`. |

A login that's been ended gets a 401 with `sessionEnded: true`. The app then forgets it.

## Test on your phone

1. **Profile:** open it. Only your real details show, and there's no "Verified" label anywhere.
2. **Edit:** Edit Profile → add a photo, role and agency → Save. They show on Profile, and on a
   second phone your photo appears in your comments and on the seller card.
3. **Settings:** Settings → Edit Profile Details opens with your details (not "PlotPost User").
   Turn Push Notifications off, leave Settings and come back. It's still off.
4. **Two phones:** log in on two phones. On one, Settings → Change Password. The other phone shows
   "You've been logged out" next time it loads your profile. Try Log Out of All Devices the same
   way.
5. **Delete:** with a test account, Settings → Delete Account → enter the password. You're back on
   the Welcome screen, and that account's posts are gone from the feed.

## Test results

**174 passed and 1 skipped, of 175** (14 new, plus 161 from Screens 1–9), 6 runs in a row. The
skipped one is the Screen 8 test that needs real MongoDB; it runs with `npm test` on your PC.
Details are in `SCREEN10_TEST_RESULTS.txt`.

- **Profile (2):**
  - real details and numbers, with nothing secret
  - old phone-path photos aren't sent
- **Edit Profile (5):**
  - partial saves, trimmed, and email unchangeable
  - bad values refused, including phone paths, other sites' photos and post photos as a profile
    photo
  - photo replace and remove delete the old one in Cloudinary
  - notification switches saved
  - avatar upload settings
- **Change Password (3):**
  - other phones logged out, new login works, old password stops working
  - wrong, same and weak passwords refused
  - Google-only accounts sent to Forgot Password
- **Log out of all devices (2):**
  - old logins end, and on guest pages they count as guests
  - Forgot Password reset also logs out other phones
- **Delete account (2):**
  - needs your password (or DELETE)
  - removes exactly your posts, comments, likes, follows and enquiries, and nobody else's

I also broke the code on purpose five times, and the tests caught each one:
- old logins never ending
- reset not logging out other phones
- delete removing other people's comments
- any photo link accepted
- a wrong current password accepted

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **Real Cloudinary photo upload and delete.** Run test 2 above to confirm.

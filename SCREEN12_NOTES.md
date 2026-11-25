# Screen 12: Notifications and phone alerts

Install **after Screens 1–11**.

## Install

**Backend** (`screen12_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages and no database step: the two new collections
(`notifications`, `pushdevices`) are created by themselves. Then:

```
npm test
npm run dev
```

**Flutter** (`screen12_flutter.zip`): copy the files into your `plotpost` folder, then:

```
flutter pub get
flutter analyze
```

Send me anything `flutter analyze` reports. Two new packages are added: `firebase_core` and
`firebase_messaging`.

**The Notifications list and the number on the bell work straight away.** Phone alerts stay off
until you do the Firebase setup below. The app works normally without it.

## Turn on phone alerts (Firebase, free)

1. **Create the project.** Go to <https://console.firebase.google.com> and click **Add project**,
   e.g. "PlotPost". Google Analytics isn't needed.
2. **Add the Android app.** Click **Add app** → Android. The package name is
   `digitus.com.plotpost`. Download `google-services.json` and put it in `android/app/`.
3. **Add two Gradle lines:**
   - In `android/settings.gradle.kts`, inside `plugins { }`:
     `id("com.google.gms.google-services") version "4.6.0" apply false`
   - In `android/app/build.gradle.kts`, inside `plugins { }`:
     `id("com.google.gms.google-services")`

   Instead of steps 2 and 3, you can run `flutterfire configure`. It also creates
   `lib/firebase_options.dart`, which this app doesn't use; that's fine.
4. **Server key.** In Firebase, go to Project settings → Service accounts → **Generate new private
   key**. Keep the downloaded file **outside** your project folders and never commit it. Turn it
   into one line:

   ```
   node -e "console.log(require('fs').readFileSync('C:/keys/plotpost-firebase.json').toString('base64'))"
   ```

   Put the output in `.env` (and later in Railway Variables) as `FIREBASE_SERVICE_ACCOUNT_JSON=...`,
   then restart the server.
5. **Run on a real Android phone,** or an emulator with Google Play. Tap **Allow** when it asks
   about notifications.

**If the build fails:**
- If it says minSdk is too low, set `minSdk = 23` in `android/app/build.gradle.kts`.
- If the server log says "Firebase answered 403", turn on "Firebase Cloud Messaging API" for the
  project in Google Cloud Console.

## What changed

- **Backend new:**
  - `models/Notification.js`
  - `models/PushDevice.js` (see the note below)
  - `services/notificationService.js`
  - `services/pushService.js`
  - `controllers/notificationController.js`
  - `routes/notificationRoutes.js`
  - `validators/notificationValidators.js`
  - `tests/notifications.test.js`
- **Backend changed:**
  - `server.js`: adds `/api/notifications`
  - `models/User.js`: when you last opened Notifications
  - `controllers/postController.js`: likes, comments and deleting a post
  - `controllers/followController.js`: follows
  - `controllers/enquiryController.js`: inquiries
  - `controllers/chatController.js`: message alerts
  - `controllers/userController.js`: blocking, and Delete account cleans up notifications and
    phones
  - `controllers/authController.js`: a password change or reset, or "Log out of all devices",
    stops alerts to every phone
  - `services/emailService.js`: the inquiry email copy
  - `.env.example`: the new setting names (no values)
- **Flutter new:** `lib/models/app_notification.dart`, `lib/services/push_service.dart`
- **Flutter changed:**
  - `lib/screens/notifications_screen.dart` (rewritten)
  - `lib/screens/browse_screen.dart`
  - `lib/screens/account_settings_screen.dart`
  - `lib/services/api_service.dart`
  - `pubspec.yaml`

**Differences from the plan:**
- **One extra file, `models/PushDevice.js`.** Phones are kept in their own small collection instead
  of inside each user record. That makes moving a phone between accounts reliable, also on the test
  database.
- **`main.dart` and `AndroidManifest.xml` didn't need changing.** The notification permission comes
  with the package.

## Bugs fixed

- **The Notifications screen was all made up.** It had 7 sample items ("Ravi Kumar", "Green Acre
  Realty"…), and its buttons faked "connected" messages. It now shows only real events.
- **The red dot on the bell was always on.** It's now a real number, and it hides at zero.
- **Opening a post from a notification showed broken Save and Show Interest buttons.** These are
  your own posts, so those buttons are hidden now, and the latest copy loads.
- **The Push Notifications and Email Inquiries switches did nothing.** They now control the phone
  alerts and the inquiry emails.

## How it works

| Event | In Notifications | Phone alert |
|---|---|---|
| Buyer inquiry on your post | ✅ with **Reply** (opens Buyer Inquiries) | ✅, plus an email copy if Email Inquiries is on and SMTP is set |
| Chat message | ❌ (Messages has its own list) | ✅ one per chat in the tray, replaced by the newest |
| Comment on your post | ✅ "Anu and 2 others commented…" with the latest comment | ✅ |
| Like on your post | ✅ "Anu and 3 others liked…" | ❌ |
| New follower | ✅ with **Follow back** | ❌ |

- **The list:**
  - It's grouped under Today, Yesterday, This week and Earlier, newest first, 20 at a time.
  - Pull down to refresh.
  - Tapping a like or comment opens the post.
- **The bell** shows how many are new since you last opened Notifications, checked every 15
  seconds like the Messages number. Opening the screen sets it to zero. The rows that were new stay
  highlighted until you leave.
- **Rules:**
  - Nothing about your own actions, and nothing from people you've blocked.
  - Unliking, unfollowing, deleting a comment, an inquiry or a post takes the matching notification
    away again.
- **Push Notifications off:** no phone alerts, but the list still fills.
- **Email Inquiries off:** no inquiry emails.
- **Alerts and logging out:**
  - Logging out stops alerts to that phone.
  - Changing or resetting your password, or "Log out of all devices", stops alerts to every phone
    until each one logs in again.
  - Logging in with another account on the same phone moves the alerts to that account.
  - Up to 10 phones per account.
- **With the app open,** Android doesn't show the alert. Instead, the numbers update, and
  inquiries and comments show a short note with **View**.
- **Tapping an alert** opens the chat, Buyer Inquiries or the post.
- **Delete account** also deletes that person's notifications and phones, and removes their name
  from other people's like and comment rows.
- **Old notifications** are deleted 90 days after their last activity (on MongoDB Atlas).

## Endpoints (all need login)

| Endpoint | Notes |
|---|---|
| `GET /api/notifications?page=1` | 20 a page, newest first. Also returns `unread`, `hasMore` and `serverTime`. |
| `GET /api/notifications/unread` | `{ count }` for the bell. |
| `POST /api/notifications/seen` | Body `{ upTo }` (the `serverTime` from the list). Never moves back, and never past now. |
| `POST /api/notifications/devices` | Body `{ token, platform }`. This phone gets alerts. Returns `alertsReady`: whether the server has the Firebase key. |
| `DELETE /api/notifications/devices` | Body `{ token }`. This phone logged out. |

## Test on your phone

**Works now, without Firebase.** You need two accounts, A and B.

1. As B, like A's post, comment on it, follow A and send Show Interest.
2. As A, within about 15 seconds the bell shows **4**. Open Notifications:
   - **Reply** opens Buyer Inquiries.
   - **Follow back** works.
   - Tapping the like or comment row opens the post.
3. Go back: the bell is at zero.
4. As B, unlike the post. As A, pull to refresh: the like row is gone.

**After the Firebase setup:**

5. Close the app on A's phone. As B, send a chat message, a comment and an inquiry. Three alerts
   appear. Each opens the right screen when tapped.
6. With A's app open, a new inquiry shows a note at the bottom with **View**.
7. Turn off Push Notifications in Settings: no more alerts. Log out: no alerts on that phone.

## Test results

**209 passed and 1 skipped, of 210** (24 new, plus 186 from Screens 1–11), 6 runs in a row, including a fresh install of your
original backend with all 12 screens. The
skipped one is the Screen 8 test that needs real MongoDB. Details are in
`SCREEN12_TEST_RESULTS.txt`.

- **The list (12):**
  - empty to start
  - likes and comments grouped, newest people first
  - your own likes, comments and repeat taps don't count
  - unlike, unfollow and deleted comments are taken out again
  - follows with Follow back
  - inquiries, also from guests, with alert, email, and update on repeat
  - messages alert only
  - Push Notifications off
  - pages of 20
  - a deleted post takes its notifications with it
  - a database problem never breaks the like or comment itself
- **The bell (2):**
  - counts only what's new
  - Seen only moves forward and never past now; bad times are refused
- **Blocking and Delete account (2)**
- **Phones (4):**
  - register and move between accounts
  - log out, and tokens are never shown
  - checks on the token and phone type
  - up to 10 phones
  - password change or reset and "log out of all devices" remove every phone
- **Sending to Firebase, against a fake Firebase (3):**
  - the exact message format
  - dead phones removed, other failures kept
  - the dead-token check
- **Setup (1):** the 90-day clean-up index

I also broke the code on purpose nine times, and the tests caught each one:
- blocked people still counted
- Seen moving into the future
- deleted posts leaving notifications
- dead phones never removed
- password changes keeping phones
- alerts sent with Push Notifications off
- unlikes counted as new
- paging broken
- deleted inquiries left behind

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **Real alerts reaching a phone.** I have no Firebase project here, so sending was tested against
  a fake Firebase. Run steps 5–7 after the setup.
- **Real inquiry emails.** They start once SMTP is in `.env`.

## Good to know

- **Notifications start from now.** Likes and comments made before this update don't appear.
- **Android only for now.**
  - iPhone alerts need a paid Apple Developer account ($99 a year) and a small addition in the
    app.
  - The web version has the list and the bell, but no alerts.
- **The message text shows on the lock screen,** as you chose.
- **The small icon in the alert** is your app icon. Some phones show it as a plain white shape; a
  proper notification icon can be added later.
- **Building for Windows desktop** now also downloads Firebase's Windows files the first time.
  Android and web aren't affected.
- **Not included (later if you want):**
  - notifications about new posts from sellers you follow
  - photos in chat
  - instant delivery (Socket.IO)

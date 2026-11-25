# Phase 3, Step 3: phone alerts (item 16)

## What it does

**Backend**
- It already saved each phone's alert token and sent alerts for buyer inquiries, chat messages and comments. Step 2 added listing expiry alerts.
- **New:** a **new follower** also gets a phone alert ("New follower: Anu started following you").
  - One alert per new follower; tapping Follow again doesn't send another.
  - Nothing is sent to yourself, from people you blocked, or when Push Notifications is off in Settings.
- Test added in `tests/notifications.test.js`.

**App** (Android)
- `lib/services/push_service.dart` (new):
  - Starts Firebase when the app opens. Without `google-services.json` it stays off and the app works as before.
  - After login, asks once for permission ("Allow PlotPost to send notifications?") and sends this phone's token to the server.
  - Logging out removes the phone from the account. If the login ends by itself, the phone stops getting alerts too.
  - **Tapping an alert** opens:
    - a chat message → that chat
    - a buyer inquiry → Buyer Inquiries
    - a new follower → their profile
    - a comment, listing expiry or removal → the post
  - **While the app is open**, alerts show as a bar at the bottom with **View**. Chat messages stay quiet, because the chat screens refresh by themselves.
- `pubspec.yaml`: adds `firebase_core` and `firebase_messaging`.
- `main.dart`: starts Firebase.
- `browse_screen.dart`: turns alerts on when the home screen opens.
- `api_service.dart`: phone register/remove, and logout removes the phone first.

## Set up (one time)

You've added the Android app in Firebase. Now:

### 1. The `google-services.json` file
- It must be at `frontend\android\app\google-services.json`.
- Open it and find `"package_name"`. It must be exactly the same as `applicationId` in `frontend\android\app\build.gradle` (or `.kts`). If they differ, the build fails with "No matching client found for package name".

### 2. Two Gradle lines
Open `frontend\android\settings.gradle` **or** `settings.gradle.kts`. In the `plugins { ... }` block, add the last line shown:

`settings.gradle.kts` (Kotlin):
```kotlin
plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "..." apply false
    id("org.jetbrains.kotlin.android") version "..." apply false
    id("com.google.gms.google-services") version "4.4.4" apply false
}
```
`settings.gradle` (Groovy):
```groovy
plugins {
    id "dev.flutter.flutter-plugin-loader" version "1.0.0"
    id "com.android.application" version "..." apply false
    id "org.jetbrains.kotlin.android" version "..." apply false
    id "com.google.gms.google-services" version "4.4.4" apply false
}
```
Leave the existing lines as they are and only add the `google-services` line.

Open `frontend\android\app\build.gradle` **or** `build.gradle.kts`. In its `plugins { ... }` block, add the last line shown:

Kotlin:
```kotlin
plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}
```
Groovy:
```groovy
plugins {
    id "com.android.application"
    id "kotlin-android"
    id "dev.flutter.flutter-gradle-plugin"
    id "com.google.gms.google-services"
}
```
If your files don't have a `plugins { }` block (older projects use `buildscript { dependencies { classpath ... } }`), send me the two files and I'll give you the exact edit.

### 3. The backend key
This is step D from before:
- `FIREBASE_SERVICE_ACCOUNT_JSON=` plus the base64 of the service-account key, as one line in `backend\.env`.
- Restart the backend. If the line is wrong, it prints "Phone alerts are off: …".

### 4. Build
```
cd frontend
flutter clean
flutter pub get
flutter analyze
flutter run
```

## How to check it (two accounts, a real Android phone)

Emulators need a "Google Play" system image to get alerts.

1. Log in on the phone. Allow notifications when asked.
2. From a second account, do each of these. Each should give an alert on the phone; tap it and the right screen should open:
   - follow the first account → their profile
   - comment on one of its posts → the post
   - send interest → Buyer Inquiries
   - send a chat message → the chat
3. With the app open, the same actions show a bar at the bottom with **View**, except chat messages.
4. Log out on the phone. The second account's actions no longer reach it.
5. Settings → turn off Push Notifications. No alerts arrive, but the Notifications list still fills.

## If something goes wrong

- **`flutter pub get` fails with a Flutter/Dart version message:** send me `flutter --version`. The Firebase packages need a recent Flutter.
- **The build says `minSdk`:** in `android\app\build.gradle(.kts)`, set `minSdk = 23` (Groovy: `minSdkVersion 23`).
- **"File google-services.json is missing":** the file isn't in `android\app\`.
- **Logged in, but no alerts:**
  - Check that the backend printed no "Phone alerts are off" line.
  - Check the phone's Settings → Apps → PlotPost → Notifications is on.
  - Check that Firebase → Project settings → Cloud Messaging shows "Firebase Cloud Messaging API (V1): Enabled".

## Not included

- iPhone alerts. They need an Apple Developer account ($99/year) and an APNs key.
- A custom notification icon. Android uses the app icon; some phones show it as a white square. A proper single-colour icon can be added later.

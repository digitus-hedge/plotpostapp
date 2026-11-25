# Phase 3, Step 2: Sold / Rented, and listings that expire after 90 days (item 17)

## What it does

**Expiry (backend)**
- Each listing shows for **90 days** after it's posted or last renewed. After that it leaves the feed, Search, the Following tab and the seller profile. It still appears in My Listings and still opens from a direct link, marked **Expired**.
- **Existing posts** get their first 90 days from the day you start the new server. Nothing disappears on day one; the server prints how many posts got a date.
- `POST /api/posts/:id/renew` (seller only): shows the listing for 90 days from today. Sold, rented and removed listings can't be renewed.
- **Mark as active** on a sold or rented listing (or an expired one) starts a new 90 days.
- Every post sent to the app now has `expiresAt` and `isExpired`.
- Buyers can't send interest on an expired listing ("This listing has expired."), the same as for sold ones.
- **Reminders:** a check inside the server runs every hour, starting a minute after the server starts. Nothing needs setting up.
  - **3 days before:** a notification and phone alert: "Your listing expires soon. Expires in 3 days. Renew it in My Listings…"
  - **When it expires:** "Your listing has expired…"
  - Each is sent once per 90 days. Renew clears them.
  - There's no phone alert if the seller turned phone notifications off, but the in-app notification still shows.
  - `EXPIRY_CHECKS=false` in `.env` turns the check off.
- **Admin panel:** a new **Expired** tab on Posts, an Expired label, and the expiry date in the report drawer. "Active posts" on the Dashboard no longer counts expired posts.

**App**
- **My Listings:**
  - Every listing has a label: **Live · 62 days left**, **Expires in 2 days** (orange), **Expired**, **Sold**, **Rented**, or **Removed by PlotPost**.
  - Filters: All, Live, Expired, Sold / rented, For sale, For rent.
  - The ⋮ menu has **Mark as sold**, **Mark as rented**, **Mark as active** and **Renew**.
  - A **Renew** button appears when a listing has expired or has 7 days or less left.
  - The list loads from the server, and pull-to-refresh reloads it. Opening it from Settings → Manage My Postings no longer shows an empty list.
  - Delete is now done by My Listings itself.
- **Post photos** get a **Sold**, **Rented** or **Expired** label everywhere: feed, Saved, and the seller profile.
- **Details page:**
  - Shows the Sold / Rented / Expired tag.
  - On sold, rented and expired listings, **Show interest** becomes "No longer available".
  - On **your own** expired or sold listing, a box offers **Renew** or **Mark active**.
- **Notifications:** expiry reminders come from "PlotPost" with a **Renew** button that renews straight away.

## Files

Backend:
- `models/Post.js`: `expiresAt`, the reminder fields, and the upgrade for older posts
- `services/expiryService.js` (new): the hourly check
- `server.js`: runs the upgrade and starts the check after connecting
- `controllers/postController.js`: feed rule, `isExpired`, Renew, status rules
- `routes/postRoutes.js`: the Renew route
- `controllers/userController.js`: profile Live tab
- `controllers/enquiryController.js`: no interest on expired listings
- `models/Notification.js`, `services/notificationService.js`, `controllers/notificationController.js`: the "listing" notices
- `controllers/adminController.js`, `admin/app.js`: Expired tab and label
- `tests/expiry.test.js` (new, 10 tests); `tests/admin.test.js` (count updated)

App:
- `models/property_post.dart`: `expiresAt`, `isExpired`, `isLive`, `daysLeft`
- `services/api_service.dart`: `setPostStatus`, `renewPost`
- `screens/my_listings_screen.dart`
- `screens/profile_screen.dart`: refreshes after My Listings
- `screens/property_details_screen.dart`
- `widgets/property_post_card.dart`: the photo label
- `screens/notifications_screen.dart`
- `screens/seller_profile_screen.dart`: uses the photo label

There are no new packages.

## Install

1. Backend: extract `plotpost_phase3_step2_backend.zip` into `backend` and overwrite. Run `npm test`, then `npm run dev`. On the first start you'll see "Listing expiry: N older post(s) get 90 days from today."
2. App: extract `plotpost_phase3_step2_flutter.zip` into `frontend` and overwrite. Run `flutter analyze`, then `flutter run`.

Both zips are cumulative.

## How to check it

1. Open My Listings. Each listing says "Live · 90 days left".
2. Mark one as **sold** from the ⋮ menu. It leaves the feed and shows a red **Sold** label. Mark it **active** and it comes back with 90 days.
3. To check expiry without waiting 90 days, use a test post. In MongoDB Compass, set its `expiresAt` to tomorrow and restart the server. Within a minute you get "Your listing expires soon" in Notifications, and as a phone alert once phone alerts are set up.
4. Set `expiresAt` to yesterday and restart. The post leaves the feed, shows **Expired** in My Listings, and you get "Your listing has expired".
5. Tap **Renew** (in My Listings or on the notification). It's back in the feed with 90 days.
6. In the admin panel, Posts → **Expired** lists it.

## Notes

- Renew doesn't move a listing to the top of the feed. The feed is still newest-posted first.
- Settings → Manage My Postings → **Edit** still doesn't save, as before this step: that screen is opened without a save function. Edit from the Profile tab's listings works. I can fix this separately if you want.

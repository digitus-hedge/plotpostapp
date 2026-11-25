# Phase 3, Step 1: seller profile and hiding phone numbers (items 15 and 18)

## What it does

**Seller profile (15)**
- `GET /api/users/:id`: anyone can open it, logged in or not. It shows:
  - name, photo, bio, agency, role and location
  - "Member since"
  - the numbers: live listings, sold / rented, followers, following
  - for the viewer: `isFollowing`, `isYou`, `blockedByMe`
- **It never includes the email or phone.** Banned and deleted accounts return 404.
- `GET /api/users/:id/posts?tab=live|sold&page=1`: the seller's listings, newest first, 20 at a time, in the same format as the feed.
  - **Live**: what the feed shows.
  - **Sold / Rented**: their closed listings.
  - Removed listings and a banned seller's listings never show.
  - If you blocked the person, the list comes back empty with `blockedByMe: true`.
- In the app, a new **Seller Profile** screen with a header, the numbers, **Follow** and **Message**, Report / Block in the ⋮ menu, and the **Live** and **Sold / Rented** tabs (with a Sold or Rented label). You open it from:
  - the seller's name or photo on any post card, or "View seller profile" in its ⋯ menu
  - "View profile" on the details page seller card
  - a seller in the Following row. Tapping the photo opens the profile; the small + / ✓ badge still follows or unfollows.
  - a "started following you" notification

**Phone hidden from logged-out visitors (18)**
- For people who aren't logged in, the server sends `sellerPhone: ""`, `hasPhone: true` and `phoneHidden: true` instead of the number. This applies to the feed, post details, a guest's Saved list and the seller profile listings.
- Phone numbers written in the **title, caption, description and seller name** are replaced with "[number hidden · log in to see it]" for them. The same goes for **comments** and the **profile bio**.
  - Hidden: Indian mobiles (with or without +91, 0, spaces, dots or dashes) and landlines like 0495 2721234.
  - Left alone: prices like ₹1,20,00,000, areas, PIN codes and dates.
- In the app, the details page shows "Phone number hidden · **Log in to see**", and **Call** asks the guest to log in first.
  - After logging in, the page reloads and the call starts.
  - The feed reloads too, so captions show in full.
- Logged-in users see everything as before.

## Files

Backend:
- `utils/phoneMask.js` (new): finds and hides phone numbers
- `controllers/postController.js`: guest version of every post, comments
- `controllers/userController.js`: the two profile endpoints
- `routes/userRoutes.js`: the routes, placed after the existing `/users/...` routes
- `tests/phoneMask.test.js` (new, 22 tests, no database needed)
- `tests/publicProfile.test.js` (new, 7 tests, needs MongoDB like the others)

App:
- `lib/screens/seller_profile_screen.dart` (new)
- `lib/models/property_post.dart`: adds `hasPhone`, `phoneHidden`, `status`
- `lib/services/api_service.dart`: adds `getPublicProfile`, `getUserPosts`, and the `loggedInChanged` signal
- `lib/widgets/login_prompt.dart`: tells the app someone logged in
- `lib/screens/property_details_screen.dart`: log in to see the number, View profile
- `lib/widgets/property_post_card.dart`: the seller name opens the profile
- `lib/screens/browse_screen.dart`: Following row opens profiles, and the feed reloads after login
- `lib/screens/notifications_screen.dart`: follow notifications open the profile

There are no new packages.

## Install

1. Backend: extract `plotpost_phase3_step1_backend.zip` into `backend` and overwrite. Run `npm test`, then `npm run dev`.
2. App: extract `plotpost_phase3_step1_flutter.zip` into `frontend` and overwrite. Run `flutter analyze`, then `flutter run`.

Both zips are cumulative: they include all the earlier phases.

## How to check it

1. Log out. Open a post whose seller has a phone number. The number is hidden, and the caption shows "[number hidden · log in to see it]" where it had a number.
2. Tap **Call**. It asks you to log in; after you log in, the number shows and the phone app opens.
3. Tap the seller's name on a card. The profile opens with Live and Sold / Rented. Mark one of your own posts Sold from another account and it moves to the second tab.
4. Follow from the profile. The follower count goes up, and the other account gets "started following you". Tapping that notification opens the profile.
5. Block from the profile. The listings are hidden and an Unblock button shows.
6. In a browser, open `http://localhost:5000/api/users/<id>`. There is no email or phone in it.

## Notes

- The details page has a Call button but no WhatsApp button. Only Call needed changing.
- Someone who searches the feed for a phone number while logged out can still find the post, but they won't see the number.
- Numbers written as words ("nine eight nine...") or as pictures can't be detected.

# Screen 7: Saved posts

Install **after Screens 1–6**.

## Install

**Backend** (`screen7_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages and no database changes to run. Then:

```
npm test
npm run dev
```

**Flutter** (`screen7_flutter.zip`): copy the files into your `plotpost` folder, then run
`flutter analyze` and send me anything it reports. There are no new packages.

## What changed

- **Backend changed:** `controllers/userController.js`, `routes/userRoutes.js`,
  `controllers/postController.js`, `routes/postRoutes.js`
- **Backend new:** `tests/saved.test.js`
- **Flutter changed:** `screens/browse_screen.dart`, `screens/saved_screen.dart`,
  `widgets/property_post_card.dart`, `services/api_service.dart`

## Bugs fixed

- **Saves lived only on the phone.** Reinstalling or switching phones lost them. They're now on
  your account.
- **The Saved tab showed only saved posts that were in the loaded feed.** Posts further down,
  posts hidden by a search or filter, and sold posts were missing, and the count was wrong. It now
  shows your whole list.
- **Pull to refresh on Saved was fake** (it just waited 0.7 s). It now reloads the list.
- **Saving was a toggle on the server,** so a double tap or a retry could unsave by mistake. The
  app now says exactly "save" or "unsave".
- **The server's saved list sent each seller's email address** and every post's full like and
  comment lists. It now uses the same format as the feed: counts only, no emails.
- **The profile endpoint sent every saved post in full,** and the app stored all of it on the
  phone each time. It now sends only the saved post IDs.
- **On the details page, the bookmark icon didn't change back** when a save failed. It does now.

## How it works now

- **Logged in:** saves go on your account and show on any phone you log in on.
  - The Saved tab lists them newest first, and reloads each time you open it.
  - The bookmark icons are correct everywhere.
- **Guests:** saves stay on this phone, as before, but the Saved tab now shows all of them.
  - When a guest logs in, their saves move to the account.
  - Saves of posts that have since been deleted are tidied away.
- **Existing users don't lose anything.** Posts someone saved on their phone before this update
  are moved to their account the first time they open the app logged in. If that fails (for
  example, no internet), the app keeps them on the phone and tries again next time.
- **Sold and rented posts stay in Saved** with a red **Sold** or orange **Rented** badge on the
  photo. The badge also shows on your own sold posts on your Profile.
- **500 saved posts at most per account.** Trying to save more shows "You can save up to 500
  posts. Remove some saved posts to save more."
- **If the list can't load** (no internet, say), the Saved tab says so and you can pull down to
  try again. Offline, the bookmark icons still show what this phone knows is saved.

## Endpoints

| Endpoint | Notes |
|---|---|
| `POST /api/users/saved/:postId` | Body `{ "saved": true }` saves, `{ "saved": false }` removes; both are safe to repeat. With no body it toggles, as before. Removing works even if the post was deleted. |
| `GET /api/users/saved` | Your saved posts, newest first, in the feed format, including sold and rented ones. Also returns `postIds`. Deleted posts are left out. |
| `POST /api/users/saved/import` | Body `{ "postIds": [...] }`, up to 500. Moves saves from a phone to the account and skips anything already saved, missing or past the limit. Safe to repeat. |
| `GET /api/posts/by-ids?ids=a,b,c` | Up to 100 posts in the order asked, for a guest's Saved tab. Guests allowed. |
| `GET /api/users/profile` | `savedPosts` is now a list of IDs, not whole posts. |

## Test on your phone

1. **Save and reinstall:** log in → save 3 posts → uninstall and reinstall the app → log in. The
   3 posts are still in Saved.
2. **Two phones** (or phone and web): save on one, open the Saved tab on the other. It's there.
3. **Further down:** scroll far down the feed, save a post, go back to the top and open Saved.
   It's at the top of Saved.
4. **Filters:** turn on a filter that hides a saved post. Saved still shows it.
5. **Sold:** save someone's post, have the seller mark it Sold in My Listings, then pull to
   refresh Saved. It shows the red Sold badge.
6. **Guest:** log out → continue as guest → save 2 posts → open Saved: both show → log in. They're
   now on your account.
7. **Offline:** turn on airplane mode and open Saved. You see the "Couldn't load saved posts"
   message; pull down after turning it off.

## Test results

**135 of 135 passed** (12 new, plus 123 from Screens 1–6), 6 runs in a row. Details are in
`SCREEN7_TEST_RESULTS.txt`.

- **Save and unsave (5):**
  - saving twice keeps one save, and removing twice is fine
  - the old toggle still works with no body
  - each account has its own saves, and guests must log in
  - bad IDs and values are refused
  - a missing post can't be saved but can be removed
  - 500 at most, and removing one makes room
- **Saved list (2):**
  - newest first
  - feed format: counts, isLiked, no like lists, no emails, no seller-only stats
  - sold and rented stay with their status, and deleted posts drop out
- **Moving phone saves (2):**
  - adds only posts that exist, keeps the phone's order, skips duplicates and bad IDs
  - safe to repeat
  - stops at 500 and says so
  - bad requests and guests are refused
- **Posts by ID (2):**
  - in the order asked, sold included, missing and bad IDs left out
  - more than 100 refused
- **Profile (1):** saved post IDs only

I also broke the code on purpose four times, and the tests caught each one:
- saving that ignores `{ saved: true }`
- the list in the wrong order
- seller emails in the list
- moving saves past the 500 limit

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.

## Good to know

- **Bookmarks on Profile still do nothing.** The details page opened from your own Profile still
  has a bookmark that does nothing. That's left for Screen 10 (Profile).
- **Save order across phones:** if a guest saved posts on the phone and the account already had
  saves, the phone's saves are added after the account's, so they appear at the top of Saved.

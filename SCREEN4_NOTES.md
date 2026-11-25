# Screen 4: Property Details

Install **after Screens 1–3**; these files build on them.

## Install

**Backend** (`screen4_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages. Then run:

```
npm test
npm run dev
```

**Flutter** (`screen4_flutter.zip`): copy the files into your `plotpost` folder. Then run:

```
flutter analyze
```

There are no new packages, so no `flutter pub get` is needed. Send me anything it reports.

## What changed

- **Backend, changed:** `controllers/postController.js`, `routes/postRoutes.js`, `models/Post.js`
- **Backend, new:** `models/PostView.js`, `tests/postDetails.test.js`
- **Flutter, changed:** `screens/property_details_screen.dart`, `services/api_service.dart`,
  `models/property_post.dart`

## What the page does now

- **Latest copy on open:** when you open a post, the page loads its current version from the server.
  If the seller changed the price or details, you see the change. If the post was deleted, you get
  "This post is no longer available." and go back.
- **Views:**
  - The page shows the count, e.g. "Shared via Instagram · 2h · 120 views".
  - Each person counts once per day, and the day resets at midnight India time.
  - Logged-in users are counted by account and guests by internet address. The address is stored
    only as a scrambled code, never as-is.
  - The seller's own opens don't count.
- **Call / Open on Instagram taps:** counted the same way, once per person per day, excluding the
  seller. Only the seller sees these numbers; buyers never do. They'll appear in My Listings
  (Screen 5).
- **Seller card:**
  - shows the seller's profile photo, plus "3 listings · 12 followers"
  - has a **Follow / Following** button, which isn't shown on your own posts
  - guests who tap Follow see "Log in to follow sellers."
- **Sample posts:** posts opened from Inquiries, Chat or Notifications are still sample data until
  those screens are built. They show as before, without contacting the server.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/posts/:id` | Guests allowed. Returns `post` (with `views`, `likesCount`, `isLiked`, `commentsCount`; `stats` only for the seller) and `seller` (`name`, `profileImage`, `postsCount`, `followersCount`, `memberSince`, `isFollowing`, `isYou`). Never shows the seller's email. Deleted posts get 404 with a message. |
| `POST /api/posts/:id/view` | Counts a view. Returns `counted` and `views`. |
| `POST /api/posts/:id/contact` | Body `{ "action": "call" }` or `{ "action": "link" }`. Returns `counted`. |

View records are kept for two days only, then MongoDB deletes them automatically. Deleting a post
also deletes its view records. The feed now includes `views` on each post, and `stats` only for
your own posts.

## Test on your phone

1. Open any real post: you see "· 1 view" (or more), the seller's photo if they have one, and
   their listings and followers.
2. Close and reopen the same post: the count doesn't go up, because it's the same person on the
   same day.
3. Log in as a second account and open it: the count goes up by one. Your own posts never count
   your views.
4. Tap **Follow** on the seller card, then open the Following tab: their posts are there. Tap
   **Following** to unfollow.
5. On a second phone or account, change a post's price, then open it on the first phone: the new
   price shows.

## Test results

**94 of 94 passed** (18 new, plus 76 from Screens 1–3), 5 runs in a row. Details are in
`SCREEN4_TEST_RESULTS.txt`.

- **Post details (6):**
  - shows the latest copy after an edit
  - seller card: listings, followers, photo, member since, no email
  - knows whether you follow the seller, and marks your own posts
  - deleted post gets 404, bad ID gets 400
  - guests and broken logins can open it
  - `/my` still reaches My Listings
- **Views (7):**
  - once per person per day
  - the seller's own opens don't count
  - a new day counts again
  - guests count once per address, stored only as a scrambled code
  - 4 opens at the same moment count once
  - views show in the feed
  - deleted and bad posts are refused
- **Taps (4):**
  - once per person per day, separately for Call and Link
  - the seller's own taps don't count
  - only the seller sees the counts, in details and feed
  - unknown actions refused (including a sneaky `__proto__` one)
- **Clean-up (1):** deleting a post removes its view records

I broke the code on purpose twice: counting the seller's own views, and showing tap counts to
everyone. The tests caught both.

**Not checked by me:**
- **The Flutter code isn't compiled** (no Flutter SDK here). `flutter analyze` is the real check.
- **Auto-deletion of view records** works on Atlas and on your PC's test database. My workspace's
  stand-in database can't do it, so I ran my tests with it switched off (`DB_TTL_INDEXES=false`).
  You don't need that setting.

## Good to know

- **Showing view counts:** buyers see them. If you'd rather only sellers see them, it's a
  one-line change.
- **Guests on shared Wi-Fi:** two guests on the same network count as one person. Logged-in users
  are always counted separately.

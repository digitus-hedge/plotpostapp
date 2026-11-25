# Screen 2: Browse (home feed)

Install **after Screen 1** (these files build on it).

## Install

**Backend** (`screen2_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages. Then run:

```
npm test
npm run dev
```

**Flutter** (`screen2_flutter.zip`): copy the files into your `plotpost` folder. Then run:

```
flutter analyze
```

Send me anything it reports. There are no new packages, so no `flutter pub get` is needed.

## What changed

- **Backend, changed:** `controllers/postController.js`, `routes/postRoutes.js`,
  `routes/userRoutes.js`, `models/Post.js`, `middleware/authMiddleware.js`
- **Backend, new:** `models/Follow.js`, `controllers/followController.js`, `tests/browse.test.js`
- **Flutter, changed:** `screens/browse_screen.dart`, `widgets/property_post_card.dart`,
  `models/property_post.dart`, `services/api_service.dart`

## What the screen does now

- **Feed:** only real posts, newest first. The 6 built-in sample posts are gone. 10 posts load at a
  time, and more load as you scroll, so the feed is no longer stuck at the 10 newest.
  Pull down to refresh.
- **Platform tabs (All, Instagram, Facebook, YouTube):** filter on the server.
- **Location chips:** none selected at first, so you see all posts. Tap a chip to see only that
  area; tap it again to see everything. "More" and the Filter screen's area choice work the same
  way.
- **Likes:** real counts, and whether you liked each post. A tap toggles your like and double-tap
  only likes. You see the change right away, and it's undone if saving fails. A post can't be
  liked twice. Guests see "Log in to like posts."
- **Following tab:**
  - The tray shows sellers you follow first, then real sellers with the most posts. Your own
    account isn't suggested.
  - Tapping a seller follows or unfollows them, and that's saved to your account.
  - The tab shows posts from sellers you follow plus your own.
  - Guests see the tray but need to log in to follow.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/posts?page=&limit=&platform=&locality=&feed=following` | Guests allowed. Each post has `likesCount`, `commentsCount`, `isLiked` and `user {_id, name, profileImage}`; the response has `hasMore`. `feed=following` needs login. |
| `POST /api/posts/:id/like` | Body `{ "like": true }` or `{ "like": false }` sets it; an empty body toggles it. Returns `isLiked` and `likesCount`. |
| `POST /api/users/:id/follow` | Follow a seller. Doing it twice is harmless; you can't follow yourself. |
| `DELETE /api/users/:id/follow` | Unfollow a seller. |
| `GET /api/users/following` | The sellers you follow, with their post counts. |
| `GET /api/users/suggested-sellers?limit=` | Sellers with the most posts. Guests allowed. |

The feed no longer sends each post's full list of likers and comments, only the counts. Nothing
in the app used those lists.

## Test on your phone

1. Open the app. You should see only real posts, with no "Ravi Kumar" or "Prime Plots Kerala"
   sample posts. If you have more than 10 posts, scroll down and more should load.
2. Tap **YouTube**: only YouTube posts. Tap **All** to see everything again.
3. Tap the **Chevayur** chip: only posts whose location contains Chevayur. Tap it again to see all
   posts.
4. Like a post and pull down to refresh: the like stays. Log in as a second account; it should
   see the same count, without your like marked as its own.
5. Open **Following**: the tray shows real sellers. Follow one, and their posts appear below. Tap
   them again to unfollow.

## Test results

**49 of 49 passed** (20 new for this screen, plus Screen 1's 29), including 8 runs in a row.
Details are in `SCREEN2_TEST_RESULTS.txt`.

- **Feed (7 tests):**
  - paging, with no post shown twice or skipped
  - newest first
  - counts, but no seller email or like lists
  - platform filter, location filter (any letter case)
  - special characters in the location search don't break it
  - filters combined with paging
  - guests, and a broken login token, still get the feed
- **Likes (5 tests):**
  - toggling
  - "liked by me" shows only for you
  - double-tap never unlikes
  - 5 taps at the same moment count once
  - likes from different people add up
  - guests are refused, and bad or unknown posts are rejected
- **Following (6 tests):**
  - follow and unfollow with counts
  - two follows at the same moment are stored once
  - you can't follow yourself, unknown users or bad IDs
  - the following list
  - suggested sellers are ordered by post count and leave you out
  - the following feed shows only followed sellers and you
- **Other screens (2 tests):** creating a post, My Listings, profile and saved still work.

I broke the code on purpose twice: likes allowing duplicates, and the Following feed ignoring
follows. The tests caught both.

**Fixed along the way:**
- **Likes:** the test database (FerretDB) doesn't support one MongoDB option I used for likes
  (Atlas does). I rewrote that step so it works on both.
- **One flaky test:** caused by my test setup, which emptied the database after Mongoose had
  already built its indexes. The tests now rebuild the indexes, and the app itself was never
  affected.

**Not checked by me:** the Flutter code hasn't been compiled (no Flutter SDK here). I checked
brackets, and that every method and field the new code uses exists. `flutter analyze` is the real
check.

## Good to know

- **Saved tab:** sample posts you'd saved no longer appear there. Saved gets its own backend in
  Screen 7.
- **The search tab** still searches only the posts already loaded. Server-side search comes in
  Screen 6.
- **The feed can still be slow with photos,** because they're stored as text inside each post.
  Screen 3 (Create Post) moves them to Cloudinary.
- **Location matching:** the chips match the text of each post's location. "Mavoor Road" won't
  match a post that says "Mavoor Rd".

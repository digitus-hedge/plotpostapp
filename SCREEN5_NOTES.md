# Screen 5: My Listings and Edit Post

Install **after Screens 1–4** (these files build on them).

## Install

**Backend** (`screen5_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. No new packages. Then:

```
npm test
npm run dev
```

**Flutter** (`screen5_flutter.zip`): copy the files into your `plotpost` folder, then run
`flutter analyze` and send me anything it reports. No new packages, so no `flutter pub get` is
needed.

## What changed

- **Backend changed:** `controllers/postController.js`, `routes/postRoutes.js`, `models/Post.js`
- **Backend new:** `tests/myListings.test.js`
- **Flutter changed:** `screens/my_listings_screen.dart`, `screens/edit_post_screen.dart`,
  `screens/account_settings_screen.dart`, `screens/property_details_screen.dart`,
  `services/api_service.dart`, `models/property_post.dart`

## Bugs fixed

- **Editing created a duplicate post.** The edit screen left out the post's ID, so every save
  published a new copy and the original never changed. Edits now update the original.
- **"Updated successfully" appeared before anything was saved.** Now you stay on the edit screen
  with a spinner until the save finishes. If it fails, you see the reason and your changes are
  still there.
- **Photos added while editing were silently dropped.** They now upload to Cloudinary and are
  added to the existing photos.
- **Delete only hid the post on your phone**, so it came back after a refresh. It's now deleted on
  the server.
- **Manage My Postings (Account Settings) showed the 6 sample posts,** and edit and delete there did
  nothing. It now opens your real listings.

## What My Listings does now

- **Loads your posts from the server,** whichever screen you open it from (Profile or Account
  Settings). Pull down to refresh.
- **Every listing shows its numbers**, for example "120 views · 14 likes · 8 calls · 15 link
  opens". Only you see them.
- **Status menu:** mark a listing **Sold**, **Rented**, or **Active** again. The badge changes to
  match, and the "Active" filter now shows only active listings.
  - Sold and rented posts leave the home feed and the Following tab.
  - They stay in My Listings, and anyone who opens one (from a saved list or a link) sees a
    **Sold** or **Rented** label.
- **Delete** removes the post permanently. It also removes its photos from Cloudinary and takes
  the post off other people's saved lists. The confirmation message now says this.
- **Edit:** if you remove a photo, it's deleted from Cloudinary when you save.

Only photos in your own Cloudinary account's `plotpost/` folder are ever deleted. YouTube
thumbnails, the old base64 photos and links from other accounts are never touched. If Cloudinary
is down, the post is still deleted; the photo just stays behind.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/posts/my` | All your posts (active, sold, rented), newest first. Each has `status`, `views`, `likesCount`, `commentsCount` and `stats: { calls, linkOpens }`. The full like and comment lists are no longer sent. |
| `PATCH /api/posts/:id/status` | Body `{ "status": "active" \| "sold" \| "rented" }`. Only the seller can do this. |
| `PUT /api/posts/:id` | Same as before. Photos you remove are now deleted from Cloudinary. |
| `DELETE /api/posts/:id` | Same as before. Now also cleans up the post's photos, saved-list entries and view records. |
| `GET /api/posts` | The home feed now leaves out sold and rented posts. Older posts that have no status yet count as active. |

## Test on your phone

1. **Edit:** Profile → My Listings → Edit a post → change the price → Save. You stay on the screen
   until it's saved. Back in the list, the price has changed, and there's still only **one** copy
   of the post in the feed.
2. **Add photos:** Edit → add 2 photos → Save. The old and the new photos are all there.
3. **Status:** Status → Mark as sold. The badge turns red "Sold", and the post disappears from the
   home feed. Open it from My Listings and the details page shows a Sold label. Mark it active
   again and it's back in the feed.
4. **Delete:** Delete → confirm. Pull to refresh: it stays gone. In Cloudinary's Media Library,
   its photos are gone too.
5. **Account Settings:** Account Settings → Manage My Postings shows your real posts, not the
   samples.

## Test results

**108 of 108 passed** (14 new, plus 94 from Screens 1–4), 6 runs in a row. Details are in
`SCREEN5_TEST_RESULTS.txt`.

- **My Listings (2):**
  - only your posts, newest first, with views, likes, comments and call/link counts
  - includes sold and rented posts
  - guests are refused
- **Status (4):**
  - sold and rented posts leave the home feed and the Following tab, and come back when active
  - a sold post still opens on its own page, with its label
  - older posts with no status count as active
  - only the seller can change it, and bad values or IDs are refused
- **Edit (5):**
  - updates the same post and never creates a copy
  - keeping photos and adding new ones keeps them all
  - removed photos are deleted from Cloudinary
  - photos that aren't yours are never deleted
  - a failed edit deletes nothing
- **Delete (3):**
  - removes the post, its photos, its view records and its saved-list entries
  - still works when Cloudinary is down
  - other people can't delete your post

Cloudinary was faked in these tests, so nothing was really deleted. I also broke the code on
purpose twice to make sure the tests notice: once letting sold posts show in the feed, and once
deleting photos from any Cloudinary account. The tests caught both.

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **Real deletes in your Cloudinary account.** Run test 4 above to confirm.

## Good to know

- **The duplicate-post bug may have left copies in your database** if you edited posts before
  this fix. You can delete the extra copies from My Listings.
- **Changing a post's link** (Instagram or YouTube URL) still isn't possible in Edit, as before. To
  change it, delete the post and post it again.

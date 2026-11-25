# Screen 3: Create Post

Install **after Screens 1 and 2**; these files build on them.

## Install

**Backend** (`screen3_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages. Then run:

```
npm test
npm run dev
```

**Flutter** (`screen3_flutter.zip`): copy the files into your `plotpost` folder. Then run:

```
flutter pub get
flutter analyze
```

`pubspec.yaml` gains `http_parser`, which you already have through `http`, so nothing new
downloads. Send me anything `flutter analyze` reports.

## What changed

- **Backend, changed:** `controllers/postController.js`, `controllers/uploadController.js`,
  `middleware/uploadMiddleware.js`, `models/Post.js`, `routes/postRoutes.js`,
  `tests/browse.test.js`
- **Backend, new:** `validators/postValidators.js`, `tests/createPost.test.js`
- **Flutter, changed:** `services/api_service.dart`, `models/property_post.dart`, `pubspec.yaml`

In `tests/browse.test.js` (Screen 2), the one test that created a post without a photo now
includes a photo link. Photo posts need at least one photo now.

## What happens when you tap Publish now

1. **Each photo uploads to Cloudinary** (`POST /api/upload`). It's shrunk to at most 1600 × 1600 px,
   compressed and saved as JPG in the `plotpost/posts` folder. iPhone HEIC photos work too.
2. **The post is saved with the photo links only**, not the photos themselves. Feeds get much
   lighter.
3. **If anything fails, you stay on the form with a message.** That covers no internet, a server
   error, Cloudinary not set up, or being logged out. Before, the post looked published and then
   vanished. Guests see "Please log in to publish a post."

The "Seller / Agent name" you type is now saved and shown on the post. Leaving it as "You" shows
your account name. Reels and YouTube links now keep their video tag.

## What the server checks now

| Field | Rule |
|---|---|
| Title | Required, up to 120 characters |
| Location | Required, up to 120 characters |
| Type | Plot, House, Villa, Flat or Commercial |
| Deal | For sale or For rent |
| Platform | Instagram, Facebook, YouTube, Other, or PlotPost (a photo post) |
| Post link | Required for link posts; must start with http:// or https:// |
| Photos | Photo posts need 1 to 8. They must be uploaded links: new base64 photos are refused. |
| Phone | Digits, spaces, + ( ) and - only |
| Description | Up to 3000 characters; other fields have sensible limits |

Fields the app shouldn't set (owner, likes, comments) are ignored.

**Your existing posts** keep their current photos, including the old base64 ones, and can still be
edited without re-uploading them. Only *new* photos must be uploaded links.

## Test on your phone

1. **Photo post:** New Post → add 2–3 photos → fill in the form → Publish. It should appear in the
   feed. Open the Cloudinary Media Library: the photos are in `plotpost/posts`.
2. **Seller name:** type "Calicut Prime Properties" as the seller name. The post shows that name.
3. **YouTube link post:** paste a YouTube link → Publish. It shows the video thumbnail and the video
   tag stays after you refresh.
4. **Failure:** turn on airplane mode and publish. You stay on the form with a clear message, and no
   fake post appears in the feed.
5. **Guest:** while logged out, try to publish. You get the message to log in.

## Test results

**76 of 76 passed** (27 new, plus 49 from Screens 1–2), on 5 runs in a row. Details are in
`SCREEN3_TEST_RESULTS.txt`.

- **Photo upload (5 tests):**
  - correct Cloudinary settings (1600 px, JPG, folder)
  - HEIC accepted
  - PDFs, missing files and guests refused
  - photos over 8 MB refused
  - clear messages when Cloudinary fails or isn't set up
- **Create post (17 tests):**
  - all fields saved, including seller name and video tag
  - the feed shows them
  - base64 refused
  - 1–8 photos
  - link posts need a real link, so `javascript:` and `ftp:` links are refused
  - 9 kinds of bad input, each explained
  - owner, likes and comments can't be faked
  - guests refused
- **Edit post (5 tests):**
  - old base64 posts can still be edited
  - new base64 refused
  - photos can be replaced with uploaded ones
  - a photo post can't end up with no photos
  - edits are checked, and only the owner can edit

Cloudinary was faked in these tests, so no real files were uploaded. I broke the code on purpose
twice: accepting base64 again, and uploads not converting to JPG. The tests caught both.

**Not checked by me:**
- **Flutter isn't compiled** (no Flutter SDK here). `flutter analyze` is the real check.
- **A real upload to your Cloudinary account** needs your keys; do test 1 above to confirm.

## Good to know

- **Leftover photos:** if publishing fails after the photos have uploaded, those photos stay unused
  in Cloudinary. It's harmless, and a cleanup can come later.
- **Adding photos while editing a post** still replaces all of its photos, as before. That gets
  fixed in Screen 5 (My Listings / Edit Post).
- **Old posts:** I can write a one-off script that moves the old base64 photos into Cloudinary. It
  changes existing posts, so I'd back up first, and only do it if you want it.
- **Request size limit:** the server still accepts large requests (12 MB) so old base64 posts can
  be edited. Once old photos are moved, that limit can come down.

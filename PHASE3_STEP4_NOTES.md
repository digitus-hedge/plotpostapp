# Phase 3, Step 4: photo clean-up (item 19)

## Already in place from earlier screens

Photos are removed from Cloudinary straight away when:
- a post is deleted (all its photos)
- photos are removed in Edit post
- a profile photo is changed or removed
- an account is deleted (its posts' photos and its profile photo)

Only photos in your own Cloudinary `plotpost/` folders are ever deleted. A Cloudinary error never stops the delete or the edit.

## New: `scripts/cleanupPhotos.js`

This finds photos that nothing uses any more, mainly photos uploaded for a post that was never published (the app closed, or publishing failed). It looks only in `plotpost/posts` and `plotpost/avatars`.

```
node scripts/cleanupPhotos.js                    report only, changes nothing
node scripts/cleanupPhotos.js --apply            delete what the report lists
node scripts/cleanupPhotos.js --days 7           only photos older than 7 days (default 2)
node scripts/cleanupPhotos.js --folder posts     only post photos (or: avatars)
```

How it decides:
- A photo is kept if **any** post (including posts removed by PlotPost, so they can be restored) or **any** profile uses it.
- Photos uploaded in the last 2 days are always kept, because they may belong to a post someone is still writing.
- **Safety stop:** if the database uses no photos at all but Cloudinary has some, `--apply` refuses to delete. That usually means `.env` points to the wrong database.
- It deletes 100 at a time and reports how many were deleted and how many failed.
- **Deleted photos can't be brought back.** Run the report first and look at the list.

It uses `MONGODB_URI` and `CLOUDINARY_*` from `.env`. I haven't run it against your database or Cloudinary.

## Files

- `scripts/cleanupPhotos.js` (new)
- `services/photoCleanup.js` (new): the listing, matching and deleting
- `tests/photoCleanup.test.js` (new, 4 tests, no database needed, passing)

## Install

Extract `plotpost_phase3_step4_backend.zip` into `backend` and overwrite. It's cumulative and includes all of Phase 2 and Phase 3. There's no app change in this step.

## Suggested use

1. Back up first if you like: in Cloudinary → Media Library you can download the folder.
2. `node scripts/cleanupPhotos.js`: read the counts, then the list.
3. If it looks right: `node scripts/cleanupPhotos.js --apply`.
4. After that, once a month is plenty.

Cloudinary's free plan allows about 500 listing calls an hour. One run uses one call per 500 photos, so this isn't a concern.

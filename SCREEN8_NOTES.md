# Screen 8: Comments, Report and Share

Install **after Screens 1–7**.

## Install

**Backend** (`screen8_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages and no database step. Then:

```
npm test
npm run dev
```

**Flutter** (`screen8_flutter.zip`): copy the files into your `plotpost` folder. This screen adds
one package (`share_plus`), so run:

```
flutter pub get
flutter analyze
```

Send me anything `flutter analyze` reports.

## What changed

- **Backend changed:** `controllers/postController.js`, `routes/postRoutes.js`, `models/Post.js`,
  `models/PostView.js`, `validators/postValidators.js`, `middleware/rateLimiter.js`,
  `tests/postDetails.test.js`
- **Backend new:** `models/Report.js`, `scripts/listReports.js`, `tests/social.test.js`
- **Flutter changed:** `widgets/comments_modal_sheet.dart`, `widgets/report_post_modal.dart`,
  `widgets/share_post_modal_sheet.dart`, `widgets/property_post_card.dart`,
  `services/api_service.dart`, `models/property_post.dart`, `screens/my_listings_screen.dart`,
  `pubspec.yaml`

Two files changed that weren't on my list:
- `models/PostView.js`: shares are counted once per person per day, like calls.
- `tests/postDetails.test.js`: the seller's tap counts now include `shares`.

## Bugs fixed

- **Every post showed the same 3 made-up comments,** and every card said "View all 3 comments". A
  comment you posted vanished when you closed the sheet. Comments are now real and saved.
- **Report did nothing.** It waited a second and said "submitted". Reports are now stored.
- **The Share sheet had a fake contact list** ("Listing sent to Ravi Kumar"), and "Share Listing"
  only copied text. The fake contacts are gone, and Share opens the phone's real share menu.

## Comments

- **Anyone can read comments,** newest first, 20 at a time. "Show older comments" loads more.
- **Posting needs login.** Guests see "Log in to comment."
  - Comments can be up to 1,000 characters.
  - Each account can post at most 20 comments every 10 minutes. Past that, it says "You're
    commenting very fast...".
- **Deleting:** a bin icon appears on your own comments and, if you're the seller, on every
  comment on your post. It asks before deleting.
- **The seller's comments show a "Seller" label.**
- **Hearts are removed,** as agreed.
- **The card's comment line is real:** "Add a comment", "View 1 comment", "View all 12 comments".
  It updates as soon as you post or delete.

## Reports

- **Reporting needs login.** It sends the reason you picked and any details (up to 500
  characters).
  - Each person has one report per post. Reporting the same post again updates that report.
  - You can't report your own post.
  - Each account can send at most 10 reports an hour.
- **Nothing is hidden automatically,** as agreed. Review reports from your `plotpost_backend`
  folder:
  ```
  node scripts/listReports.js                 open reports, most-reported post first
  node scripts/listReports.js --all           including ones marked done
  node scripts/listReports.js --done <postId> mark that post's reports done
  ```
  It shows the post, the seller's name, email and phone, and each report's reason, details,
  reporter and date. Only `--done` changes anything. To take a post down, use the seller's
  details from the list to contact them (an admin screen can come later).

## Share

- **"Share Listing" opens the phone's share menu** (WhatsApp, Messages, email and so on).
- **"Copy" copies the same text,** which is shown in the sheet first:
  ```
  Villa in Nadakkavu
  Price: ₹1.2 crore
  Villa · For sale
  Location: Nadakkavu, Kozhikode
  https://www.instagram.com/p/...   (the original post, if there is one)

  Shared from PlotPost
  ```
- **Shares and copies are counted for the seller,** once per person per day and never their own.
  My Listings now shows "… · 3 shares" next to calls and link opens.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /api/posts/:id/comments?page=1` | 20 a time, newest first. Each comment has `user.name`, `user.profileImage` (no email), `isSeller` and `canDelete`. Also returns `total` and `hasMore`. Guests allowed. |
| `POST /api/posts/:id/comment` | Body `{ "text": "..." }`, 1–1,000 characters. Returns the new `comment` and `commentsCount`. Same address as before, but it now returns the one new comment instead of the whole list. |
| `DELETE /api/posts/:id/comments/:commentId` | Your own comment, or any comment on your post. Returns `commentsCount`. |
| `POST /api/posts/:id/report` | Body `{ "reason": "...", "details": "..." }`. Returns 201 when new, 200 when it updates your earlier report. |
| `POST /api/posts/:id/contact` | Now also takes `{ "action": "share" }`. |

## Test on your phone

1. **Comment:** open any post's comments. The sample comments are gone. Post one, close the sheet
   and open it again: it's still there, and the card now says "View 1 comment".
2. **Seller:** as the seller, reply to it. Your reply shows the "Seller" label. Delete the
   buyer's comment with the bin icon.
3. **Guest:** log out and open comments. You can read them, and the box says "Log in to comment."
4. **Report:** as a buyer, report someone else's post. Then, on your computer, run
   `node scripts/listReports.js` and the report is listed.
5. **Share:** tap Share → Share Listing → pick WhatsApp. The text arrives with the Instagram or
   YouTube link. As the seller, My Listings shows "1 share".

## Test results

**147 passed and 1 skipped, of 148** (13 new, plus 135 from Screens 1–7), 6 runs in a row.
Details are in `SCREEN8_TEST_RESULTS.txt`.

- **Reading comments (3):**
  - guests can read
  - newest first
  - names and photos but no emails
  - the Seller label
  - who may delete
  - 20 at a time with `hasMore`
- **Posting comments (4):**
  - returns the new comment and the count, and the feed count goes up
  - the post's own date doesn't change
  - needs login, and empty or over 1,000 characters are refused
  - the 20-per-10-minutes limit, and other people aren't affected
  - comments posted at the same moment are all kept (skipped here, see below)
- **Deleting (1):** your own, the seller's power, others refused, already deleted
- **Reports (4):**
  - stored with reason and details, and reporting again updates the same report
  - needs login, and bad reasons, long details and your own post are refused
  - 10 an hour
  - the review script groups and marks reports done
- **Shares (1):**
  - once per person per day, never the seller's own
  - shown only to the seller

**Skipped here:** "people commenting at the same moment all keep their comments". The code adds
each comment in one step, which real MongoDB (Atlas) always keeps. The test database I use here
(FerretDB) can lose writes that arrive at the same moment, so that test skips itself only when
`TEST_DB_IS_FERRETDB=true`. Plain `npm test` on your PC uses real MongoDB, so it runs there.
Please check it passes.

I also broke the code on purpose four times, and the tests caught each one:
- anyone deleting any comment
- comments in the wrong order
- sellers reporting their own post
- one shared comment limit for everybody

I also ran `listReports.js` from the command line on a test database: list, `--done`, then
`--all`.

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **The share menu on a real phone.**

## Good to know

- **Old comments:** any comments already in your database (from the backend's old
  `/comment` endpoint) now show up properly.
- **Rate-limit settings:** you can change the limits in `.env` with `RATE_LIMIT_COMMENT_MAX` and
  `RATE_LIMIT_REPORT_MAX`.
- **Left for later:** a web page for each post, so shared links open without the app and show a
  photo preview in WhatsApp. This fits better once the backend is on Railway with a domain.

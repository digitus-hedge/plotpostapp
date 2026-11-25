# Screen 6: Search and Filter

Install **after Screens 1–5**.

## Install

**Backend** (`screen6_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. Two new folders come with it: `utils/` and `scripts/`. There are no new
packages. Then run:

```
npm test
npm run dev
```

**Flutter** (`screen6_flutter.zip`): copy the files into your `plotpost` folder, then run
`flutter analyze` and send me anything it reports. There are no new packages.

## Your existing posts (one-off)

Posts made before this update don't have the price and bedroom numbers yet, so they're left
out while a price or bedrooms filter is set. They still show everywhere else. To add the
numbers:

1. **Back up your database first**, for example with `mongodump`.
2. Run this in `plotpost_backend` to see what would change. It changes nothing:
   ```
   node scripts/backfillPostNumbers.js
   ```
   It shows how many posts need the numbers and lists up to 20 prices it couldn't read.
3. If that looks right, run it again to write the numbers:
   ```
   node scripts/backfillPostNumbers.js --apply
   ```

The script only adds `priceValue` and `bedroomsCount`. No other field changes, post dates stay
as they are, and nothing is deleted. Running it a second time does nothing. New and edited
posts get the numbers automatically.

## What changed

- **Backend changed:** `controllers/postController.js`, `models/Post.js`,
  `validators/postValidators.js`
- **Backend new:** `utils/priceParser.js`, `scripts/backfillPostNumbers.js`, `tests/search.test.js`
- **Flutter changed:** `screens/browse_screen.dart`, `screens/filter_screen.dart`,
  `services/api_service.dart`

`routes/postRoutes.js` didn't need changing after all, because the filter checks run inside the
feed endpoint.

## Bugs fixed

- **Search only looked at the ~10 posts already loaded.** It now searches every post on the
  server. The Search tab also loads more posts as you scroll.
- **Type and Sale/Rent filters could show "No matching posts" when matches existed** further
  down the feed. The server now does all the filtering.
- **The price slider and "Video Tours Only" did nothing.** Both work now. The slider also used to
  start at ₹10–200 lakh, so tapping Apply hid rentals and anything over ₹2 crore. It now starts
  at "Any price".
- **"Explore (n)" counted only the loaded posts.** It now shows all matches.
- **"Clear search and filters" left the type and Sale/Rent filters on.** It now clears everything.
- **The location bar said ", Kozhikode" when no area was picked.** It now says "All Kozhikode".

## How it works now

- **Search** looks in the title, description, location, property type, Sale/Rent, the seller
  name on the post and the seller's account name.
  - Every word must match, so "villa nadakkavu" finds villas in Nadakkavu.
  - Letter case doesn't matter.
  - The app waits until you pause typing (0.4 s), or searches straight away when you press the
    keyboard's search button.
  - The platform name isn't searched. Otherwise "plot" would match every post on the PlotPost
    platform. The platform tabs cover that.
- **The price slider depends on Listing Type:**
  - **For sale:** ₹5 lakh to ₹3 crore+, in steps of ₹5 lakh.
  - **For rent:** ₹0 to ₹1 lakh+ a month, in steps of ₹2,000.
  - **Any:** no slider. A note says to pick For sale or For rent.
  - A handle left at either end means "no limit" on that side.
- **Bedrooms:** Any / 1+ / 2+ / 3+ / 4+. The row is hidden when only Plot is picked.
- **The Filters button shows a number** for how many filters are on.
- **The Search tab always searches every post**, even when Home is on Following. The Following
  tab itself still shows everything from the sellers you follow.
- **Sold and rented posts stay hidden**, as in Screen 5.

## How prices are read

The price text isn't changed. A number is worked out from it each time a post is saved:

| Seller types | Number used |
|---|---|
| ₹1.45 crore, 1.2 Cr onwards | 1,45,00,000 / 1,20,00,000 |
| ₹38 lakh, 38L, 85 lac | 38,00,000 / 38,00,000 / 85,00,000 |
| ₹50,00,000 | 50,00,000 |
| ₹18,000 / month, 18k per month | 18,000 (rent per month) |
| 40-50 lakh | 40,00,000 (the lower end) |
| Price on request, ₹38 | no number: left out only while a price filter is set |

A bare small number like "₹38" gets no number, because it could mean 38 lakh or 38 thousand.
Encourage sellers to write "38 lakh".

## Endpoint

`GET /api/posts` takes these new values. Everything from before (`page`, `limit`, `platform`,
`locality`, `feed=following`) works as it did.

| Value | Example | Notes |
|---|---|---|
| `q` | `villa nadakkavu` | Up to 80 characters; every word must match |
| `types` | `Villa,House` | Plot, House, Villa, Flat, Commercial |
| `deal` | `For sale` | Any, For sale, For rent |
| `minPrice`, `maxPrice` | `2000000` | Whole rupees (per month for rent) |
| `video` | `true` | Video tours only |
| `minBedrooms` | `3` | 0 to 20 |

Bad values get a 400 with a clear message, for example "The minimum price can't be more than the
maximum." `total` is the number of matches, and `hasMore` says whether there are more pages.

## Test on your phone

1. **Search:** Search tab → type "villa". It should find villas that aren't in the first 10
   posts, and the Explore count should show all of them. Scroll down to load more.
2. **Two words:** "villa nadakkavu" shows only villas in Nadakkavu.
3. **Price:** Filters → For sale → drag the slider to about ₹20 lakh – ₹1 crore → Apply. Only
   posts in that range appear, and the Filters button shows a number.
4. **Rent:** Filters → For rent. The slider is now per month.
5. **Bedrooms:** choose 3+. Then pick only Plot and the bedrooms row disappears.
6. **Video:** turn on Video Tours Only, and only reels and videos show.
7. **Clear:** search something with no results → "Clear search and filters" clears everything.
8. **Following:** Home → Following → Search tab. Search finds posts from everyone.

## Test results

**123 of 123 passed** (15 new, plus 108 from Screens 1–5), 6 runs in a row. Details are in
`SCREEN6_TEST_RESULTS.txt`.

- **Price numbers (3):**
  - common formats read correctly
  - unclear prices get no number
  - numbers are set on create and updated on every edit
- **Search (3):**
  - every word must match, in any field and any case
  - finds posts by the seller name on the post or the account name
  - symbols are searched as plain text
  - searches over 80 characters are refused
- **Filters (8):**
  - one or several types
  - Sale/Rent
  - sale and rent price ranges, including "no limit" ends and posts without a price
  - bad prices refused
  - video only
  - bedrooms
  - everything together with paging and the right total, sold posts still hidden
  - the Following tab
- **Script (1):**
  - the report run changes nothing
  - `--apply` adds only the two numbers and leaves post dates unchanged
  - a second run changes nothing

I also broke the code on purpose three times, and the tests caught each one:
- search matching any word instead of every word
- the numbers not updating when a post is edited
- the script changing post dates

I also ran the script from the command line on a test database (report, `--apply`, then again).

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **The script hasn't been run on your real database.** That's yours to run, after a backup.

## Good to know

- **The Saved tab still lists only saved posts that are in the loaded feed**, so a search or
  filter can hide some of them there. Screen 7 moves Saved to the server and fixes this.
- **Search speed:** it's fast for thousands of posts. If PlotPost grows to hundreds of thousands,
  we can switch to MongoDB Atlas Search later.

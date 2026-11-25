# Design step 5: Edit Post, size filter, live result count

Two zips this time: the app (all design changes since you sent your lib
folder, steps 1 to 5) and the backend (everything since Phase 5 Step 1, plus
the size filter). Extract each over its folder as before. The backend zip
has no `.env`.

## 1. Edit Post uses the New Post form

**What you see.** Tapping Edit on a listing opens the same form as New
post, titled "Edit post", already filled in. The button says "Save
changes", and the hint says what's missing ("Add the area to save").

**How the old details are filled in:**

- **Photos.** The ones already online stay in the grid. You can remove them,
  add new ones (up to 8 in all) and the first one is still the cover. New
  photos are uploaded where they sit, so the order you see is the order
  saved.
- **Price.** "₹38 L" fills 38 with Lakh, "₹1.2 Cr" fills 1.2 with Crore, and
  a rent fills the monthly amount. A price the fields can't show exactly (a
  range like "40-50 lakh", or words) is kept as written. A line under the
  field says so ("Now "40-50 lakh". Type a new price to replace it.") and has
  a Remove price button.
- **Size.** "10 cents", "1,850 sq ft" and "1 acre" fill the amount and unit.
  Anything else is kept as written, with a Remove size button, the same as
  the price.
- **Place.** "Chevayur, Kozhikode" picks Kozhikode and Chevayur. "Kakkanad,
  Kochi" still finds Kakkanad under Ernakulam. A place that isn't in the
  list goes in "Other area", in the district the post names, or Kozhikode
  if it names none. You can see and change it before saving.
- **Link posts** open on "Share a link". If you don't change the link, the
  post keeps its picture.
- Name, phone, description, type, sale or rent, bedrooms and bathrooms are
  filled in as they are.

**Bugs in the old Edit screen that this fixes:**

1. **Edit made a second copy of the post.** The old screen dropped the
   post's ID, so saving went to "create" instead of "update".
2. **New photos were thrown away.** Photos added while editing were never
   uploaded.
3. **"Updated successfully" showed before saving.** The message came after
   a fake 0.6-second wait, whether or not the save worked.

Now the form waits for the server. If the save fails, the error shows and
you stay on the form with your changes. When it works, My Listings says
"Changes saved." and reloads.

Saving an edit also no longer sends you to the Home tab; only a new post
does.

**Files:**

- `screens/create_post_screen.dart`: has an `existing` post option.
- `screens/edit_post_screen.dart`: now a small wrapper around that form.
  The old 554-line screen is gone.
- `screens/my_listings_screen.dart`
- `services/api_service.dart` (`savePost` keeps the photo order)
- `screens/browse_screen.dart`

## 2. Size filter (cents or sq ft)

**What you see.** Filters has a new Size section after Price:

- a Cents | Sq ft switch
- Min and Max boxes, and a line saying "1 cent = 435.6 sq ft"

Switching the unit converts what you typed, so 10 cents becomes 4356 sq ft.
If Max is smaller than Min, it says so and the button is off until you fix
it. A chip like "10 – 20 cents" appears in Explore and can be removed like
the others. Reset clears the size.

**How it works on the server.** Sellers type sizes as text, so the server
now works out a number from it, the same way it already does for price and
bedrooms:

- **`utils/priceParser.js`** has a new `parseArea`, which returns square
  feet:
  - "10 cents" → 4356
  - "1850 sq ft" → 1850
  - "2 acres" → 87120
  - "1 acre 20 cents" → 52272
  - "120 sq m" → 1292
  - "10-12 cents" → 4356 (the lower end)
  - "10" (no unit) → nothing, so the post is left out of size filters only
    while a size is set
- **`models/Post.js`** has a new `areaValue` field, set on every save
  (create and edit), with an index.
- **`validators/postValidators.js`** accepts `minArea` and `maxArea` on
  `GET /api/posts`. They are whole square feet; bad values and min above
  max get a 400 with the reason.
- **`controllers/postController.js`** applies the range.

The app sends square feet. The bottom of a range rounds down and the top
rounds up, so a post right on the edge is included.

**One thing to know:** a listing has a single Size, which may be the land
(plots, in cents) or the floor area (flats, in sq ft). Filtering "at least
10 cents" (4356 sq ft) can also show a 4500 sq ft flat. The help line nudges
people toward the right unit; a separate land size and built-up area would
fix this fully later.

**Posts that already exist.** New and edited posts get the number
automatically. Older posts need the existing backfill script, which now
fills in the size too:

```
node scripts/backfillPostNumbers.js           (report only, changes nothing)
node scripts/backfillPostNumbers.js --apply   (after a backup)
```

The report lists sizes it couldn't read. If production starts with a fresh
database, you don't need it. I haven't run it; it's for you to run against
your database.

## 3. "Show 24 properties"

The button on Filters now counts the matches as you change things:

- "Show 24 properties"
- "Show 1 property"
- "No properties match"

It checks 0.4 seconds after your last change, so dragging the price slider
sends one request, not dozens. An older answer that arrives late is ignored.
If the server can't be reached, it just says "Show properties". The count
uses the same query as the feed, including your search words, so it matches
what you get. Screen readers announce the new count.

No server change was needed: the feed already returns `total`, so the app
asks for one post and reads the total.

**Files:**

- `screens/filter_screen.dart`
- `screens/browse_screen.dart`: one function now turns filter choices into
  the server query, for both the feed and the count.
- `services/api_service.dart` (`FeedFilters.minArea` / `maxArea`)
- `utils/listing_format.dart` (`toSquareFeet`, `plainNumber`)

## Checks

- **Backend:**
  - 71 tests that need no database pass, including 5 new ones in
    `tests/areaFilter.test.js` (the size parser and the query rules).
  - New database tests are in `tests/search.test.js`: the size range, an
    edit updating the size, and the backfill filling in the size. Those need
    MongoDB, so please run `npm test` on your machine.
- **App:** I can't run Flutter here; brackets check out on every changed
  file. Please run `flutter analyze` and send me anything it reports.

**To try:**

1. Edit a listing: change the cover photo and add a new photo, then save.
   It should still be one post, with your photos in that order.
2. Edit a post whose price is a range; the range should be kept.
3. In Filters, type a size and watch the count change; switch Cents to Sq
   ft.

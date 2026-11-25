# Screen 9: Show Interest and Buyer Inquiries

Install **after Screens 1–8**.

## Install

**Backend** (`screen9_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages and no database step: enquiries already in
your database show up for their seller automatically. Then:

```
npm test
npm run dev
```

**Flutter** (`screen9_flutter.zip`): copy the files into your `plotpost` folder, then run
`flutter analyze` and send me anything it reports. There are no new packages.

## What changed

- **Backend changed:** `models/Enquiry.js`, `controllers/enquiryController.js`,
  `routes/enquiryRoutes.js`, `middleware/rateLimiter.js`
- **Backend new:** `validators/enquiryValidators.js`, `tests/enquiries.test.js`,
  `tests/enquiryLimits.test.js`
- **Flutter changed:** `screens/show_interest_screen.dart`, `screens/inquiries_screen.dart`,
  `models/enquiry.dart`, `services/api_service.dart`, `screens/browse_screen.dart`,
  `screens/profile_screen.dart`

## Bugs fixed

- **Show Interest never reached the seller.** It waited 0.9 s and kept the enquiry on the phone
  ("Frontend preview"). It now goes to the server and to the post's seller.
- **Buyer Inquiries showed 4 made-up buyers** (Ravi Kumar and others) on sample posts. It now shows
  real enquiries on your posts.
- **The server couldn't tell which seller an enquiry was for.** It only stored a typed name. Each
  enquiry is now linked to the seller's account. Older enquiries are matched through their post.
- **The server accepted anything.** It now checks every field, ignores any post title or seller
  name the phone sends (it uses the post's own), limits how many can be sent, and no longer sends
  back internal error text.
- **The "my enquiries" list returned whole posts,** with likes, comments and the seller's email. It
  now returns a short post summary.
- **Profile "Inquiries" counted enquiries you sent,** but opened the leads you received. It now
  counts leads received.

## Show Interest

- **Logged in:** your name, phone and email are filled in from your account. You can still change
  them.
- **Checks:**
  - a name
  - a phone number of 10–13 digits
  - a valid email if one is given; it's required if you pick "Email"
  - a message of 10–1,000 characters
- **Problems show on the form,** for example "This property is no longer available." or "You
  can't send interest on your own post."
- **Asking again about the same post** (same account, or for guests the same phone number)
  updates your earlier enquiry. It gets the new message, moves to the top of the seller's list and
  is unread again.
- **Sold and rented posts** don't accept new interest.
- **Guests can send,** up to 5 enquiries an hour per internet connection. Accounts can send 10 an
  hour. You can change these in `.env` with `RATE_LIMIT_ENQUIRY_GUEST_MAX` and
  `RATE_LIMIT_ENQUIRY_MAX`.

## Buyer Inquiries

- **Your leads, newest first,** 30 at a time with "Show more". Pull down to refresh.
- **The top line shows your totals,** for example "12 buyer leads received · 3 unread".
- **Filters:** All, Unread, Phone call, WhatsApp, Email. These run on the server.
- **Each lead shows:**
  - the buyer's name, a NEW badge and a Pending / Contacted / Closed label
  - "Wants a visit" if they ticked it
  - their message, and when it was sent
  - the property, which opens it; Sold, Rented and "Post deleted" are labelled
- **Reply uses the buyer's preferred method:**
  - Call opens the phone.
  - WhatsApp opens a chat with a short greeting. 10-digit numbers get +91.
  - Email opens your mail app with a subject and greeting.
  - A second button offers WhatsApp or Call. You can also copy the number.
- **Opening a lead or tapping any of these marks it read.**
- **The ⋮ menu:** Mark as contacted, Close lead, Mark as pending, Mark as unread.

## Endpoints

| Endpoint | Notes |
|---|---|
| `POST /api/enquiries` | Show Interest. Body `{ postId, name, phone, email, message, contactMethod, wantsVisit }`. Guests allowed. Returns 201 when new, 200 when it updated your earlier enquiry. `postTitle` and `seller` are filled in by the server. |
| `GET /api/enquiries/received` | Leads on your posts. Query: `page`, `limit` (max 50), `unread=true`, `method=WhatsApp`. Returns `total`, `unread`, `count` (matching the filter) and `hasMore`. |
| `PATCH /api/enquiries/:id` | Seller only. Body `{ "read": true \| false }` and/or `{ "status": "Pending" \| "Contacted" \| "Closed" }`. |
| `GET /api/enquiries/my` | Enquiries you sent, newest first, with a short post summary. |
| `DELETE /api/enquiries/:id` | Delete one you sent (as before). |

## Test on your phone

1. **Guest:** log out → open someone's post → Show Interest → fill the form → Send. You see
   "Interest sent to …".
2. **Seller:** log in as that post's seller → Profile → Inquiries. The lead is there with a NEW
   badge, and the Profile count includes it.
3. **Reply:** tap WhatsApp (or Call or Email). It opens with the buyer's details, and the NEW badge
   goes.
4. **Status:** ⋮ → Mark as contacted. The label changes. Try the Unread and WhatsApp filters.
5. **Repeat:** as the same buyer, send interest on the same post again. The seller sees one lead,
   moved to the top with the new message.
6. **Sold:** mark a post Sold in My Listings, then try Show Interest on it. It says "This property
   is no longer available."

## Test results

**160 passed and 1 skipped, of 161** (13 new, plus 148 from Screens 1–8), 6 runs in a row. The
skipped one is the Screen 8 test that needs real MongoDB; it runs with `npm test` on your PC.
Details are in `SCREEN9_TEST_RESULTS.txt`.

- **Show Interest (7):**
  - a guest's interest reaches the seller, with title and seller from the post (faked values are
    ignored)
  - account name used when the post has no seller name
  - repeat updates instead of copying, and goes back to unread and Pending
  - guests matched by phone
  - bad details refused, with the reason
  - own, sold, rented and missing posts refused
  - a broken login counts as a guest
- **Buyer Inquiries (3):**
  - only your posts' leads, newest first, with filters, paging and totals
  - older enquiries show
  - leads stay after their post is deleted
- **Read and status (1):** seller only; read, unread and status; bad values refused
- **Sent list (1):** newest first with a short summary; delete your own only
- **Limits (1):** guests 5 an hour per connection, accounts 10 an hour

I also broke the code on purpose five times, and the tests caught each one:
- repeat enquiries making copies
- every seller seeing every lead
- anyone changing a lead's status
- sold posts accepting interest
- enquiries not linked to the seller

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **Opening WhatsApp, email and the phone app on a real phone.**

## Good to know

- **Sellers aren't notified yet.** There's no alert for a new lead until Screen 12
  (Notifications), and email alerts need the SMTP password. Until then they check Buyer Inquiries.
- **Reply doesn't use in-app chat yet.** It uses the phone's own apps. In-app chat comes with
  Screen 11 (Messages).
- **There's no screen for enquiries you sent as a buyer** (the backend list exists). Say if you
  want one.

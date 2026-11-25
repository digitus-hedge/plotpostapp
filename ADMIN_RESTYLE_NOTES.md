# Admin panel restyle (Phase 2, Step 2 follow-up)

The /admin page now uses the look and layout of `PlotPost_Admin_Panel_Refined.html`:
the rounded frame, round-icon side menu, white panel, grey cards with white rows,
the crimson accent, pill buttons, the side drawer, the reason box and the light/dark switch.
It works with real data from the backend. There is no sample data.

## What you'll see

| Page | What's on it |
|---|---|
| Dashboard | **Active posts / 3,000**, "+N this week" and "% of target"; New today, Sellers who posted, Accounts, Post views, Contact taps, Oldest open report; Instagram / Facebook / YouTube mix; **Needs attention** (overdue, reported posts, comments, accounts); open reports; **New posts per day** for 14 days (India time) |
| Reports | Open / Resolved tabs with counts, a type filter (posts, comments, accounts). Click a row to open the drawer: **Keep**, **Remove post** or **Remove comment**, **Ban** |
| Posts | Search, platform filter, tabs (All, Live, Removed, Sold / rented, Seller banned) with counts, Remove / Restore, Load more. The platform chip opens the original post |
| People | Search, tabs (All, Active, Banned, Admins) with counts. The drawer shows the profile, activity, posts, reports and admin actions, with Ban / Unban |
| Audit log | Search and a "who" filter |

The top search box searches posts. The moon button switches light/dark, and the panel remembers your choice.
On a phone, the menu scrolls sideways and the sign-out button sits at the top.

**Active posts** means posts that are not removed, not sold or rented, and whose seller isn't banned.
**Contact taps** means calls plus link opens.

## Files changed since Step 2

- `admin/index.html`, `admin/style.css`, `admin/app.js`: rebuilt in the new style
- `admin/theme.js` (new): applies the saved light/dark choice before the page draws
- `controllers/adminController.js`: read-only additions:
  - more dashboard numbers in `/api/admin/summary`
  - tab counts for posts, people and reports
  - a platform filter for posts
  - search and a "who" filter for the audit log
  - "decided by" on resolved reports
- `server.js`: the /admin security policy now allows the Google fonts (`fonts.googleapis.com`, `fonts.gstatic.com`). Inline scripts and inline styles are still blocked.
- `tests/admin.test.js`: 2 new tests (dashboard numbers, tab counts and filters) and a stronger header check

The zip is cumulative and includes everything from Step 1 and Step 2.

## Install

1. Stop the server.
2. Extract `plotpost_phase2_step2_admin_style_backend.zip` into your `backend` folder and allow overwrite.
3. You don't need `npm install`, because there are no new packages.
4. Run `npm test`, then `npm run dev`. Open http://localhost:5000/admin and sign in with your admin account.

## How to check it

1. On the Dashboard, the numbers should match your data, and the chart should show 14 bars, with today hatched.
2. Hover a bar to see the exact count.
3. Report a post from the app with a second account. The Reports badge goes up.
4. Open the report and click **Remove post**. Clicking the button without a reason shows an error; pick a preset reason and confirm.
5. The post disappears from the app feed, and the audit log shows the removal.
6. On People, open the seller and ban them. The drawer then shows **Unban**.
7. Click the moon button and reload the page. It should stay dark.

## Not included yet

- Suspend (7/30 days) and Warn seller. These wait until after Step 3.
- Locations, Agent verification (Step 3) and District analytics are shown under "Coming later".
- The `plot-post.com` link from the design isn't included, because the site address isn't set yet.
- The fonts load from Google. Without internet, the panel falls back to the system font and still works.

# Phase 4, Step 1: request protection

## What changed

The old `app.js` already had several protections, but the real server (`server.js`, which `npm run dev` and Railway run) never used them. They're now in `server.js`, and `app.js` simply loads `server.js`, so the older tests check the real server.

| Protection | Now |
|---|---|
| **Security headers (helmet)** | On for every response: nosniff, HSTS, frame protection; "Express" is no longer advertised. The admin panel keeps its own stricter rules. |
| **CORS** | Only the websites listed in `CORS_ORIGINS` can call the API from a browser. The Android app sends no Origin, so it always works. `/admin` is on the same address, so it always works. With `CORS_ORIGINS` empty: any site on your PC, none in production. |
| **Injection guard** | Switched on. Keys starting with `$` or containing `.` are removed from every request body, which blocks `{ "email": { "$ne": null } }` tricks. |
| **Body size** | 200 KB for everything (was 12 MB). Only **editing a post** keeps 12 MB, because older posts still carry base64 photos. |
| **Photo uploads** | The file's **real content** is checked, not just the type the phone claims. Real JPG, PNG, WEBP and HEIC pass; a renamed text file, script or PDF is refused. Still 8 MB at most, and now one photo per request. |
| **Request log** | One line per request in the server console (morgan); on Railway it's in the Deploy logs. |

**New rate limits** (all can be changed in `.env`):

| What | Limit | Counted per |
|---|---|---|
| Forgot-password codes (and verification codes in Step 2) | 5 an hour | **email address**, so no one can flood one person's inbox from many networks |
| Wrong passwords | 10 in 15 minutes, then 15 minutes' wait | account (email); correct logins don't count |
| Photo uploads | 60 an hour | account |
| New listings | 30 a day | account |
| Likes, follows, unfollows, saves | 300 an hour | account |

These come on top of what was already there:
- 20 login / sign-up / reset requests per 15 minutes per network
- comments 20 per 10 minutes
- inquiries 10 an hour (guests 5)
- messages 30 a minute
- reports 10 an hour
- new chats 20 a day

**Input checks:** the routes without a schema already check their own input in the controller (IDs, `saved`, `postIds`, `status`, contact action), and a bad ID always gets a 400. I left those as they are, so the messages the app shows stay the same.

## Settings (`.env` and Railway Variables)

```
CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com   # when you have a website
TRUST_PROXY=1            # Railway: leave unset (1 is the default in production)
```
The new limit names are in `.env.example`. You don't need to set them; the defaults above apply.

## Files

- `server.js`: helmet, CORS list, request log, body limits, injection guard
- `app.js`: now just loads `server.js`
- `middleware/uploadMiddleware.js`: content check, one file per request, a shared `oneImage`
- `middleware/rateLimiter.js`: the five new limits
- `routes/authRoutes.js`, `routes/postRoutes.js`, `routes/userRoutes.js`, `routes/uploadRoutes.js`: limits applied
- `tests/hardening.test.js` (new, 13 tests, no database needed, passing)
- `tests/security.test.js`: the large-body test now uses Edit post
- `.env.example`: the new settings

## Install

Extract `plotpost_phase4_step1_backend.zip` into `backend` and overwrite. Then run `npm test` and `npm run dev`. There are no new packages and no app change.

## How to check it

1. The app works as before: log in, post with photos, edit, like, follow, chat.
2. Try uploading a renamed file (for example a .txt renamed to .jpg). You get "This file isn't a photo PlotPost can use".
3. Enter a wrong password 11 times for one account. The 11th says "Too many wrong passwords for this account…".
4. In a browser on your PC, open `http://localhost:5000/`. Its response headers include `strict-transport-security` and `x-content-type-options`.

# Putting the PlotPost backend on Hostinger (MySQL)

The app talks to **https://plotpost.hedge-group.com/api**. These steps replace
the old MongoDB backend on Hostinger with this MySQL one.

You need from your PC:
- `plotpost-backend-hostinger.zip` (on the Desktop): the server code, without
  `node_modules` and without secrets.
- `backend/.env.production`: the production settings. It holds passwords:
  upload it, don't email or share it.

---

## 1. Keep a copy of the old backend

In hPanel → **Files → File Manager**, open the folder of the old (MongoDB)
backend and **rename** it, e.g. `backend-mongo-old`. Don't delete it until the
new one works.

Note: data in the old MongoDB database (users, posts) is **not** copied to
MySQL. The new backend starts empty.

## 2. Create the MySQL database

hPanel → **Databases → MySQL Databases**:

1. Create a database (e.g. `plotpost`) and a user with a **strong password**.
   Hostinger adds a prefix: you get names like `u123456789_plotpost`.
2. Write down: database name, user name, password. The host is `localhost`.

The tables are created automatically the first time the server starts.
(`schema.sql` in the zip does the same by hand, via phpMyAdmin → Import, if
you prefer.)

## 3. Gmail for the codes

Users must confirm their email with a 6-digit code before they can post, so
email has to work.

1. Use a Gmail account for PlotPost. Turn on **2-Step Verification**
   (Google Account → Security).
2. Google Account → Security → **App passwords** → create one named "PlotPost".
   Copy the 16 letters (no spaces).
3. In `.env.production` fill in `SMTP_USER`, `SMTP_PASS` (the 16 letters) and
   both `FILL_ME` parts of `EMAIL_FROM`.

Gmail sends up to about 500 emails a day; enough to start.

## 4. Fill in `.env.production`

Open `backend/.env.production` and replace every `FILL_ME`:
- `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` from step 2.
- The Gmail lines from step 3.
- `GOOGLE_CLIENT_IDS` after step 8 (leave empty for now).

`JWT_SECRET` and the Cloudinary keys are already filled in.

## 5. Upload the new backend

hPanel → **File Manager**:

1. Upload `plotpost-backend-hostinger.zip` to where the old backend was, and
   **Extract** it into a folder (e.g. `backend`).
2. Upload `.env.production` into that folder and **rename it to `.env`**
   (next to `server.js`).

## 6. Start it (hPanel → Node.js)

hPanel → **Websites → Manage → Node.js** (or **Advanced → Node.js**), for
`plotpost.hedge-group.com`:

| Setting | Value |
|---|---|
| Node.js version | 20 or newer (22 recommended) |
| Application root | the folder from step 5 |
| Startup file | `server.js` |

Then **Install dependencies** (runs `npm install`) and **Start / Restart**.
If hPanel has an **Environment variables** section you may enter the `.env`
lines there instead of uploading the file.

The log should show:

```
PlotPost settings:
  Mode: production
  Database: MySQL u123456789_plotpost on localhost:3306
  Email: on (smtp)
  ...
✅ MySQL connected to localhost/u123456789_plotpost
```

Check in a browser: **https://plotpost.hedge-group.com/api/posts** should
show `{"success":true,...}`. The admin panel is at
**https://plotpost.hedge-group.com/admin/**.

> On a Hostinger **VPS** instead of hosting: install Node 22 and MySQL, put
> the files in a folder, `npm install --omit=dev`, start with
> `pm2 start server.js --name plotpost`, and point the domain at port 5000
> through Nginx with HTTPS (Let's Encrypt).

## 7. Make an admin

In the app, register your admin account (and confirm its email). Then, in
hPanel → **Databases → phpMyAdmin** → your database → SQL:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

(Or, with SSH: `node scripts/make-admin.js you@example.com`.)
Use a strong password for admin accounts.

## 8. Google sign-in

In **Google Cloud Console** (console.cloud.google.com), one project:

1. **APIs & Services → OAuth consent screen**: External, app name PlotPost,
   your support email. Publish it.
2. **Credentials → Create credentials → OAuth client ID → Web application**,
   name "PlotPost server". Copy its **Client ID**
   (`…apps.googleusercontent.com`).
   - Put it in `GOOGLE_CLIENT_IDS` in `.env` on Hostinger and restart.
   - The app is built with it too (see below).
3. **Credentials → Create credentials → OAuth client ID → Android**:
   - Package name: `digitus.com.plotpost`
   - SHA-1: `50:E4:F2:48:7A:4B:40:7E:4E:7E:DD:63:5C:9D:9E:1D:DE:F5:82:29`
     (the release key in `frontend/android/app/upload-keystore.jks`).
   - If you already have an Android client for `digitus.com.plotpost`, just
     add this SHA-1 to it.

Then build the app with the Web client ID:

```
cd frontend
flutter build apk --release --dart-define=GOOGLE_SERVER_CLIENT_ID=<web client id>
```

## 9. Updating later

- **Server:** upload the changed files (or a new zip), keep `.env`, then
  **Install dependencies** if `package.json` changed, and **Restart**.
- **App:** raise `version:` in `frontend/pubspec.yaml` (e.g. `1.0.1+2`; the
  number after `+` must go up), build again and share the new APK. Phones
  only accept it if it's signed with the **same key**, so keep
  `upload-keystore.jks` and `key.properties` backed up somewhere safe
  (not only on this PC).

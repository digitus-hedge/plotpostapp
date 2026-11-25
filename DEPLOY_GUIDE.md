# Putting the PlotPost backend online: Atlas + Railway

Once you've finished, the app talks to your server like this:

```
Phone app ──HTTPS──▶ https://api.<your-domain>/api   (Railway, Singapore)
                         │  ├─ /privacy  /terms  /delete-account  /admin
                         ▼
                    MongoDB Atlas (Singapore)   + Cloudinary (photos), Brevo (email), Firebase (phone alerts)
```

The whole thing takes about 1–2 hours. Do the parts in order.

**What it costs:**
- **Railway Hobby:** $5 a month. That includes $5 of usage, which a small API like this usually stays within. Railway's Free plan puts services to sleep when nobody is using them, so it isn't suitable for the live server.
- **Atlas:**
  - **Free:** $0. It has 512 MB of space and **no automatic backups**, so you run `npm run backup` yourself (part 7).
  - **Flex:** about $8–30 a month. It makes an automatic backup every day. You can switch from Free to Flex later in one click.

---

## 1. Atlas: a separate production database

Keep production apart from the database you test with on your PC. Then a test or a script on your PC can never change real people's data.

1. **Make the project and cluster.**
   1. In Atlas, open the project menu (top left) and choose **New Project**. Name it `PlotPost Production`.
   2. Click **Create cluster**.
   3. Pick **Free** (or Flex) and provider **AWS**.
   4. For the region, pick **Singapore (ap-southeast-1)**. Choose the same region as Railway (part 3) so the server and database are close together.
   5. Name the cluster `plotpost`.
2. **Database users** (under Security → Database Access):
   - `plotpost_app`, with the role **Read and write to any database**. This one is for the server.
   - `plotpost_backup`, with the role **Only read any database**. This one is for backups from your PC.

   For each one, click **Autogenerate Secure Password**, copy it into your password manager, and use letters and digits only. Symbols like `@ : / ?` break the address.
3. **Network Access → Add IP Address → Allow access from anywhere** (`0.0.0.0/0`).

   Railway's Hobby plan has no fixed address you could list instead. That's why the strong passwords above matter.
4. **Connect → Drivers.** Copy the address and add the database name `plotpost` after `.net/`:
   ```
   mongodb+srv://plotpost_app:<password>@plotpost.xxxxx.mongodb.net/plotpost?retryWrites=true&w=majority&appName=plotpost
   ```
   That's `MONGODB_URI` for Railway. Make a second one with `plotpost_backup` for part 7.

The new database starts empty. The server creates the collections and indexes the first time it starts.

> **Bringing your test data across instead?** Run a backup on your PC (part 7, using your current address), then restore it into production with `npm run restore`. Most apps go live with an empty database.

---

## 2. Cloudinary, email, Google and Firebase

- **Cloudinary: make a second, free Cloudinary account for production.** Don't share one with your PC.
  - Why: the photo clean-up script (`node scripts/cleanupPhotos.js --apply`) deletes photos that **its** database doesn't use. If test and production shared one Cloudinary account, a clean-up run on your PC would delete live listings' photos.
- **Email:** set up Brevo as in `PHASE4_STEP2_NOTES.md`. That covers verifying your domain or sender, getting `BREVO_API_KEY`, and setting `EMAIL_FROM`.
- **Google Sign-In:** use the same Web client ID as on your PC (`GOOGLE_CLIENT_IDS`). The release fingerprints get added in Step 3.
- **Firebase:** use the same Firebase project. On your PC, turn the key file into one line of text:
  ```
  node -e "console.log(require('fs').readFileSync('key.json').toString('base64'))"
  ```
  Paste that line as `FIREBASE_SERVICE_ACCOUNT_JSON`. Never send the key file to anyone, and delete `key.json` from Downloads afterwards.

---

## 3. Railway

1. **Sign up** at railway.com and choose the **Hobby** plan.
2. **Get the code there.** Choose one:
   - **A. GitHub (recommended).** Every change you push deploys by itself.
     1. Put the `backend` folder in a **private** GitHub repository, with `package.json` at the top level. `.gitignore` already keeps out `.env`, `node_modules` and `backups/`.
     2. In Railway: **New Project → Deploy from GitHub repo**, and pick the repository.
     3. If `package.json` is in a subfolder, set **Settings → Root Directory** to that folder.
   - **B. Railway CLI.** No GitHub needed.
     1. Install it: `npm i -g @railway/cli`.
     2. From the backend folder, run `railway login`, then `railway init`, then `railway up`.
     3. To deploy again after a change, run `railway up` again. `.railwayignore` and `.gitignore` keep `.env` and `backups/` from being uploaded.
3. **Settings → Region:** Southeast Asia (Singapore), the same as Atlas.
4. **Variables:** open the **Raw Editor** and paste this, with your values filled in:
   ```
   NODE_ENV=production
   MONGODB_URI=mongodb+srv://plotpost_app:...@plotpost.xxxxx.mongodb.net/plotpost?retryWrites=true&w=majority
   JWT_SECRET=<new 96-character secret, see below>
   CLOUDINARY_CLOUD_NAME=<production account>
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   BREVO_API_KEY=...
   EMAIL_FROM=PlotPost <no-reply@your-domain.com>
   GOOGLE_CLIENT_IDS=<web client id>.apps.googleusercontent.com
   FIREBASE_SERVICE_ACCOUNT_JSON=<the base64 line>
   ADMIN_PANEL_URL=https://api.your-domain.com/admin
   ERROR_ALERT_EMAILS=you@example.com
   ```
   - **`JWT_SECRET`:** make a new one just for production. Don't reuse the one on your PC. Generate it with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - **Optional:**
     - `REPORT_ALERT_EMAILS`: more people who get report emails. Admins always do.
     - `CORS_ORIGINS`: only once you have a website that calls the API from a browser.
   - **Don't set these on Railway:**
     - `PORT`: Railway sets it.
     - `SMTP_*`: Railway blocks it.
     - `EMAIL_DEV_LOG_CODES`, `BACKUP_MONGODB_URI`, `DNS_SERVERS`, `TRUST_PROXY`: the defaults are right.
5. **Deploy.** Open **Deployments → View logs**. A good start looks like this:
   ```
   PlotPost settings:
     Mode: production on Railway (production)
     Database: plotpost on plotpost.xxxxx.mongodb.net
     Email: on (brevo)
     Google sign-in: on
     Phone alerts (Firebase): on
     Photos (Cloudinary): on
     Error alert emails: on (1 address(es))
   🚀 Server running on port 8080
   ✅ MongoDB connected successfully
   ```
   - Any line starting with ⚠️ names a setting to fix.
   - The build log also shows the Node version. It should be 24, as set in `package.json`. If it isn't, add the variable `RAILPACK_NODE_VERSION=24`.
6. **Networking → Generate Domain.** You get an address like `plotpost-production.up.railway.app`. Try it (part 4).

### Your own domain (recommended before you build the release app)

The server address is built into the app. Moving to a new address later means releasing an app update, so set up the final address now.

1. In Railway, go to **Networking → Custom Domain** and enter **`api.your-domain.com`**.
   - Use a subdomain, not the bare `your-domain.com`.
   - Railway needs a special kind of DNS record for a bare domain. Many providers (Hostinger included, as far as I know) don't support it.
   - A subdomain also leaves `your-domain.com` free for a website later.
2. Railway shows **two DNS records**: a CNAME (`api` → `xxxx.up.railway.app`) and a TXT record for verification. Add both in your domain's DNS. In Hostinger, that's **Domains → DNS / Nameservers → Manage DNS records**.
3. Wait for Railway's green tick. It can take from a few minutes up to a few hours. The HTTPS certificate is set up automatically.

---

## 4. Check it

Open these in a browser:

| Address | Expected |
|---|---|
| `https://api.your-domain.com/api/health` | `{"success":true,"database":"connected"}` |
| `https://api.your-domain.com/privacy` | The Privacy Policy |
| `https://api.your-domain.com/delete-account` | The Delete account page |
| `https://api.your-domain.com/admin` | The admin login |

Then run the app on your phone against the live server, the same way as Step 3 but in debug:

```
flutter run --dart-define=API_BASE_URL=https://api.your-domain.com/api --dart-define=GOOGLE_SERVER_CLIENT_ID=<web client id>.apps.googleusercontent.com
```

Now try each feature:
1. Sign up, confirm the email code, and post a listing with a photo.
2. Open it from a second account, send interest, chat and comment.
3. Check phone alerts arrive.
4. Try Forgot Password.
5. Delete a test account on `/delete-account`.

---

## 5. Make yourself an admin

1. Sign up in the app (part 4) with the email you want to use for the admin panel.
2. Then do one of these:
   - **Atlas:** go to **Browse Collections → plotpost → users**, find your account, and change `"role": "user"` to `"admin"`.
   - **Railway CLI:** from the backend folder, run `railway run npm run make-admin -- you@example.com`. This uses Railway's settings, so it changes the live database.
3. Log in at `https://api.your-domain.com/admin`.

---

## 6. Error alert emails

With `ERROR_ALERT_EMAILS` set (and Brevo working), the server emails you when:
- a request fails with a server error (500)
- an hourly job fails
- the database can't be reached after 3 tries
- the server crashes (Railway then starts it again by itself)

To keep your inbox quiet, it sends at most one email every 15 minutes. Problems in between are listed together in the next email. The emails name the route (for example `GET /api/posts/:id`) and the first line of the error. The full details are in Railway's logs, which the Hobby plan keeps for 7 days.

---

## 7. Backups

**On Atlas Flex:** Atlas makes one backup a day automatically. Restore from **Cluster → Backup**. Running the script below now and then is still a good extra copy.

**On Atlas Free:** there are no automatic backups, so use the script on your PC.

1. **Add the backup address.** In your PC's `backend\.env`, add a line with the **read-only** user from part 1. This can read production but can't change it:
   ```
   BACKUP_MONGODB_URI=mongodb+srv://plotpost_backup:...@plotpost.xxxxx.mongodb.net/plotpost?retryWrites=true&w=majority
   ```
2. **Make a backup:** run `npm run backup`.
   - It writes `backups\2026-11-24_2130\`: one compressed file per collection, plus `backup.json`.
   - It **deletes backups older than 30 days**, because the privacy policy promises that.
   - It only reads from the database.
3. **Run it every day** (the PC must be on). Make a file `backup-plotpost.bat` next to the backend folder:
   ```bat
   cd /d C:\path\to\backend
   call npm run backup >> backups\backup-log.txt 2>&1
   ```
   Then in **Task Scheduler**:
   1. Choose **Create Basic Task**, name it `PlotPost backup`, and set it to **Daily** at a time the PC is usually on.
   2. Choose **Start a program** and pick `backup-plotpost.bat`.
   3. Afterwards, open the task's **Properties**, go to **Settings**, and tick **Run task as soon as possible after a scheduled start is missed**.
4. **Keep the backups private.** They contain people's names, emails, phone numbers and chats. Don't put the folder in a shared Google Drive, and never upload it anywhere.
5. **Practise a restore once**, so you know it works before you need it. Restore into a **new, empty** database name:
   ```
   npm run restore -- backups\2026-11-24_2130 --uri "mongodb+srv://plotpost_app:...@plotpost.xxxxx.mongodb.net/plotpost_restore?retryWrites=true&w=majority"
   ```
   - It shows what it will do and asks you to type the database name before changing anything.
   - It refuses if those collections already have data. `--replace` overrides that, so use it only in a real emergency.
   - Afterwards, look at `plotpost_restore` in Atlas, then delete it.

---

## 8. Changing things later

- **Code:** push to GitHub (or run `railway up`).
  - Railway builds the new version and waits until `/api/health` says the database is connected.
  - Only then does it switch over.
  - The old copy gets up to 15 seconds to finish requests that are still running (`drainingSeconds` in `railway.json`).
- **A setting:** change it in **Variables**. Railway redeploys by itself.
- **The app's server address:** leave it as it is once the app is in the store. That's why the custom domain comes first.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Health check fails; the log shows `MongoDB connection error` | Atlas → Network Access must include `0.0.0.0/0`. Check the password in `MONGODB_URI` (letters and digits only) and the database name after `.net/`. |
| Log shows `Server configuration error` and stops | The message names the setting. Usually `JWT_SECRET` is missing or shorter than 32 characters. |
| "Application failed to respond" | Remove any `PORT` variable you added; Railway sets it. |
| Codes don't arrive | Check the log for `Email: off`. Check `EMAIL_FROM` is on the domain or sender you verified in Brevo, and look in Brevo → Transactional → Logs. |
| Google sign-in says the server can't check the token | `GOOGLE_CLIENT_IDS` must be the **Web** client ID, the same one used in the app's `GOOGLE_SERVER_CLIENT_ID`. |
| No phone alerts | The log says `Phone alerts (Firebase): off`. Paste `FIREBASE_SERVICE_ACCOUNT_JSON` again as the base64 line. |
| Custom domain stuck on "waiting for DNS" | Check both records (CNAME and TXT) are exactly as Railway shows them, and wait a few hours. |

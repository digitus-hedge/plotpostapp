// Tests set their own values and must never read your real .env.
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ quiet: true });
}

const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const dns = require('dns');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { config } = require('./config/env');
const { sanitizeRequest } = require('./middleware/sanitize');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
// On Railway (and most hosts) requests arrive through one proxy; this lets
// the rate limits see each phone's real IP address (TRUST_PROXY, default 1
// in production).
app.set('trust proxy', config.trustProxy);

// Security headers on every response (the admin panel sets its own,
// stricter rules below).
app.use(helmet());

// Which websites may call the API from a browser. The Android app sends no
// Origin header, so it is always allowed; CORS only matters for browsers.
// List your sites in CORS_ORIGINS (comma-separated), e.g.
//   CORS_ORIGINS=https://plot-post.com,https://www.plot-post.com
// Empty: on your PC any site may call it; in production none may (the admin
// panel at /admin is on the same address, so it always works).
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      if (!config.isProduction && config.corsOrigins.length === 0) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
  })
);

// One line per request in the server log (not in tests).
if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

// Request bodies: 200 KB is plenty for everything the app sends. Editing a
// post is the one exception: older posts still carry photos as base64 text.
const smallJson = express.json({ limit: '200kb' });
const editPostJson = express.json({ limit: '12mb' });
app.use((req, res, next) =>
  (req.method === 'PUT' && /^\/api\/posts\/[^/]+\/?$/.test(req.path) ? editPostJson : smallJson)(req, res, next)
);
// Blocks MongoDB operator injection ({ "email": { "$ne": null } } and friends).
app.use(sanitizeRequest);

// Route handlers
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/posts", require("./routes/postRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/enquiries", require("./routes/enquiryRoutes"));
app.use("/api/chats", require("./routes/chatRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

// The admin panel (a web page for PlotPost staff): https://<your server>/admin
// Admins log in with their PlotPost email and password.
app.use(
  "/admin",
  (req, res, next) => {
    res.set({
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  },
  express.static(path.join(__dirname, "admin"), { index: "index.html" })
);

// Public pages (the Play Store asks for these links):
//   https://<your server>/privacy         Privacy Policy
//   https://<your server>/terms           Terms of Service
//   https://<your server>/delete-account  delete an account without the app
// Their styles and script are in public/site. Only files from this server
// may load, and no other site may show these pages in a frame.
const sitePageRules = (req, res, next) => {
  res.set({
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  });
  next();
};
const sitePages = { privacy: "privacy.html", terms: "terms.html", "delete-account": "delete-account.html" };
app.use("/site", sitePageRules, express.static(path.join(__dirname, "public", "site"), { index: false, maxAge: "1h" }));
for (const [name, file] of Object.entries(sitePages)) {
  app.get([`/${name}`, `/${name}.html`], sitePageRules, (req, res) => {
    res.sendFile(path.join(__dirname, "public", file));
  });
}

app.get('/api/health', (req, res) => {
  const isDatabaseConnected = mongoose.connection.readyState === 1;
  res.status(isDatabaseConnected ? 200 : 503).json({
    success: isDatabaseConnected,
    database: isDatabaseConnected ? 'connected' : 'disconnected',
  });
});

// Test route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 PlotPost Backend is running!'
  });
});

// Unknown URLs and errors: always JSON with a readable message.
app.use(notFound);
app.use(errorHandler);

// Jobs that need the database, run once after the first connection.
const afterFirstConnect = async () => {
  // One-time upgrade for reports made before comments and people could be
  // reported (safe to run on every start).
  try {
    await require('./models/Report').upgradeOldReports();
  } catch (error) {
    console.error('Report upgrade failed:', error.message);
  }

  // Listings expire after 90 days. Posts made before that get their first
  // 90 days from today (safe to run on every start).
  try {
    const upgraded = await require('./models/Post').upgradeOldPosts();
    if (upgraded) console.log(`Listing expiry: ${upgraded} older post(s) get 90 days from today.`);
  } catch (error) {
    console.error('Post expiry upgrade failed:', error.message);
  }
  // Accounts made before email verification existed count as verified.
  try {
    const verified = await require('./models/User').upgradeOldUsers();
    if (verified) console.log(`Email verification: ${verified} existing account(s) marked as verified.`);
  } catch (error) {
    console.error('Account upgrade failed:', error.message);
  }
  if (!require('./services/emailService').canSend()) {
    console.warn('Email is not set up (BREVO_API_KEY, RESEND_API_KEY or SMTP_*): no verification or reset codes can be sent, so email verification is not required.');
  }
  // "Expires in 3 days" / "has expired" notices and the 12-month clean-up, every hour.
  require('./services/expiryService').startExpiryChecks();
};

// MongoDB connection. If Atlas can't be reached (network, wrong password,
// IP not allowed) it keeps trying: after 5 s, 10 s, 20 s, then every 30 s.
// Until then /api/health answers 503, so Railway won't switch to a broken deploy.
let stopping = false;
const connectDB = async (attempt = 1) => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('✅ MongoDB connected successfully');
    await afterFirstConnect();
  } catch (error) {
    if (stopping) return;
    const wait = Math.min(5000 * 2 ** (attempt - 1), 30000);
    console.error(`❌ MongoDB connection error (try ${attempt}): ${error.message}`);
    console.error(`   Trying again in ${wait / 1000} s. Check MONGODB_URI, the database password and Atlas → Network Access.`);
    if (attempt === 3) require('./services/errorAlerts').report(error, { where: 'database connection' });
    setTimeout(() => connectDB(attempt + 1), wait);
  }
};

// Start the server only when run with `node server.js` / `npm start`.
// Tests load the app without starting it or touching your real database.
if (require.main === module) {
  const { validateConfig } = require('./config/env');
  const { printStartupReport } = require('./config/startupReport');
  const errorAlerts = require('./services/errorAlerts');

  // Stop straight away with a clear message if a required setting is missing.
  try {
    validateConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
  printStartupReport();

  // Windows on some PCs can't look up Atlas's "mongodb+srv" address
  // (querySrv ECONNREFUSED). Only on your PC; Railway's own DNS is used there.
  if (config.dnsServers.length) {
    try {
      dns.setServers(config.dnsServers);
    } catch (err) {
      // Ignore if custom DNS fallback fails
    }
  }

  const PORT = process.env.PORT || 5000;

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  // Connect to MongoDB
  connectDB();

  // Railway stops the old copy with SIGTERM when a new deploy is ready, and
  // waits 15 s before forcing it (drainingSeconds in railway.json): finish the
  // requests in progress, close the database, then exit.
  const shutDown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing current requests, then stopping.`);
    const forceExit = setTimeout(() => process.exit(0), 10000);
    forceExit.unref();
    server.close(async () => {
      try {
        await mongoose.disconnect();
      } catch (error) {
        // Already closed.
      }
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutDown('SIGTERM'));
  process.on('SIGINT', () => shutDown('SIGINT'));

  // Something failed with nobody waiting for it: log it and email the
  // alert list, but keep serving.
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    errorAlerts.report(reason, { where: 'background task' });
  });
  // A real crash: the server may be in a broken state, so log it, email
  // the alert list (wait up to 5 s), and exit. Railway starts it again.
  process.on('uncaughtException', async (error) => {
    console.error('💥 Crash:', error);
    try {
      await errorAlerts.reportNow(error, { where: 'crash' });
    } finally {
      process.exit(1);
    }
  });
}

module.exports = app;

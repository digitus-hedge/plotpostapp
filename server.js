if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ quiet: true });
}

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { config } = require('./config/env');
const { connectDB, disconnectDB, sequelize } = require('./config/db');
const { sanitizeRequest } = require('./middleware/sanitize');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(helmet());

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

if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

const smallJson = express.json({ limit: '200kb' });
const editPostJson = express.json({ limit: '12mb' });
app.use((req, res, next) =>
  (req.method === 'PUT' && /^\/api\/posts\/[^/]+\/?$/.test(req.path) ? editPostJson : smallJson)(req, res, next)
);
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

// The admin panel
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

// Public pages
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

// The PlotPost app for computers (Flutter web build in ./webapp), at /app/.
// Built with: flutter build web --release --base-href /app/ --no-web-resources-cdn
// Flutter's engine runs as WebAssembly and draws photos, videos and the
// YouTube / Facebook ... players from other sites, so this page gets its own,
// wider security policy than the rest of the site.
const webAppDir = path.join(__dirname, "webapp");
const webAppRules = (req, res, next) => {
  res.set({
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https:",
      "frame-src https:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  });
  next();
};
// (express.static sends /app to /app/ by itself.)
app.use(
  "/app",
  webAppRules,
  express.static(webAppDir, {
    index: "index.html",
    // The start files must always be fresh so a new version shows at once.
    setHeaders(res, file) {
      if (/(index\.html|flutter_bootstrap\.js|flutter_service_worker\.js|version\.json)$/.test(file)) {
        res.set("Cache-Control", "no-cache");
      } else {
        res.set("Cache-Control", "public, max-age=3600");
      }
    },
  })
);
// Unknown paths inside the app (e.g. a refreshed page) load the app itself.
app.get(/^\/app\/(?!assets\/|canvaskit\/).*$/, webAppRules, (req, res, next) => {
  const index = path.join(webAppDir, "index.html");
  res.sendFile(index, (error) => {
    if (error) next();
  });
});

app.get('/api/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({
      success: true,
      database: 'connected',
      type: 'MySQL',
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      database: 'disconnected',
      type: 'MySQL',
      error: error.message,
    });
  }
});

// Test route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 PlotPost Backend is running (MySQL)!'
  });
});

app.use(notFound);
app.use(errorHandler);

const afterFirstConnect = async () => {
  try {
    await require('./models/Report').upgradeOldReports();
  } catch (error) {
    console.error('Report upgrade failed:', error.message);
  }

  try {
    const upgraded = await require('./models/Post').upgradeOldPosts();
    if (upgraded) console.log(`Listing expiry: ${upgraded} older post(s) get 90 days from today.`);
  } catch (error) {
    console.error('Post expiry upgrade failed:', error.message);
  }

  try {
    const verified = await require('./models/User').upgradeOldUsers();
    if (verified) console.log(`Email verification: ${verified} existing account(s) marked as verified.`);
  } catch (error) {
    console.error('Account upgrade failed:', error.message);
  }

  if (!require('./services/emailService').canSend()) {
    console.warn('Email is not set up (BREVO_API_KEY, RESEND_API_KEY or SMTP_*): no verification or reset codes can be sent.');
  }

  require('./services/expiryService').startExpiryChecks();
};

let stopping = false;
const startDatabase = async (attempt = 1) => {
  try {
    await connectDB();
    await afterFirstConnect();
  } catch (error) {
    if (stopping) return;
    const wait = Math.min(5000 * 2 ** (attempt - 1), 30000);
    console.error(`❌ MySQL connection error (try ${attempt}): ${error.message}`);
    console.error(`   Check MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE in Hostinger .env.`);
    if (attempt === 3) require('./services/errorAlerts').report(error, { where: 'database connection' });
    setTimeout(() => startDatabase(attempt + 1), wait);
  }
};

if (require.main === module) {
  const { validateConfig } = require('./config/env');
  const { printStartupReport } = require('./config/startupReport');
  const errorAlerts = require('./services/errorAlerts');

  try {
    validateConfig();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
  printStartupReport();

  const PORT = process.env.PORT || 5000;

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  startDatabase();

  const shutDown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing current requests, then stopping.`);
    const forceExit = setTimeout(() => process.exit(0), 10000);
    forceExit.unref();
    server.close(async () => {
      try {
        await disconnectDB();
      } catch (error) {
        // Already closed.
      }
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutDown('SIGTERM'));
  process.on('SIGINT', () => shutDown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    errorAlerts.report(reason, { where: 'background task' });
  });

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

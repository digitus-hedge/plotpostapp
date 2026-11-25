// Loads and checks every setting the server needs, in one place.
// The rest of the code reads settings from here instead of process.env.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

const list = (value) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  nodeEnv,
  isProduction,
  isTest,
  port: int(process.env.PORT, 5000),

  mongoUri: process.env.MONGODB_URI,
  // Atlas supports auto-expiring (TTL) indexes; some test databases do not.
  dbTtlIndexes: bool(process.env.DB_TTL_INDEXES, true),

  jwtSecret: process.env.JWT_SECRET,
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenDays: int(process.env.REFRESH_TOKEN_DAYS, 30),
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),

  // Browser origins allowed to call the API (the mobile app sends no origin).
  corsOrigins: list(process.env.CORS_ORIGINS),
  // Railway (and most hosts) sit behind one proxy hop.
  trustProxy: int(process.env.TRUST_PROXY, isProduction ? 1 : 0),

  rateLimit: {
    enabled: bool(process.env.RATE_LIMIT_ENABLED, !isTest),
    windowMinutes: int(process.env.RATE_LIMIT_WINDOW_MINUTES, 15),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 20),
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
  },
  // Local testing without SMTP: print codes to the console. Never enable on Railway.
  emailDevLogCodes: bool(process.env.EMAIL_DEV_LOG_CODES, false) && !isProduction,

  google: {
    // OAuth client IDs whose ID tokens we accept (the Web client ID at minimum).
    clientIds: list(process.env.GOOGLE_CLIENT_IDS),
  },

  // Windows DNS workaround for mongodb+srv lookups; off in production.
  dnsServers: list(
    process.env.DNS_SERVERS ?? (isProduction ? "" : "1.1.1.1,8.8.8.8,192.168.1.1")
  ),
};

config.smtp.configured = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
config.cloudinary.configured = Boolean(
  config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret
);
config.google.configured = config.google.clientIds.length > 0;

const validateConfig = () => {
  const problems = [];
  if (!config.mongoUri && !isTest) problems.push("MONGODB_URI is missing.");
  if (!config.jwtSecret) problems.push("JWT_SECRET is missing.");
  if (isProduction && config.jwtSecret && config.jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters in production.");
  }
  if (problems.length) {
    throw new Error(`Server configuration error:\n - ${problems.join("\n - ")}`);
  }
  return config;
};

module.exports = { config, validateConfig };

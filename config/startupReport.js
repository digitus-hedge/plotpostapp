// What the server prints when it starts: which features are switched on,
// and warnings for settings that are missing or wrong. Never prints
// passwords, keys or secrets.
const { config } = require("./env");

// "mongodb+srv://user:pass@cluster0.ab.mongodb.net/plotpost?x=y"
//   -> { host: "cluster0.ab.mongodb.net", database: "plotpost" }
const describeMongoUri = (uri) => {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(String(uri || ""));
  if (!match) return { host: "", database: "" };
  return { host: match[1], database: decodeURIComponent(match[2] || "") };
};

// Which MySQL server and database the app uses (never the password).
const describeMysql = (mysql = config.mysql) => ({
  host: `${mysql.host || "?"}:${mysql.port || 3306}`,
  database: mysql.database || "",
});

const onOff =(on, detail = "") => (on ? `on${detail ? ` (${detail})` : ""}` : "off");

const startupReport = (env = process.env) => {
  const emailService = require("../services/emailService");
  const pushService = require("../services/pushService");
  const { recipients } = require("../services/errorAlerts");

  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID);
  const db = describeMysql();
  const emailProvider = emailService.provider();
  const alertTo = recipients();

  const lines = [
    `Mode: ${config.nodeEnv}${onRailway ? ` on Railway (${env.RAILWAY_ENVIRONMENT_NAME || "?"})` : ""}`,
    `Database: MySQL ${db.database || "(no name)"} on ${db.host}`,
    `Email: ${onOff(Boolean(emailProvider), emailProvider)}`,
    `Google sign-in: ${onOff(config.google.configured)}`,
    `Phone alerts (Firebase): ${onOff(pushService.canSend())}`,
    `Photos (Cloudinary): ${onOff(config.cloudinary.configured)}`,
    `Error alert emails: ${onOff(alertTo.length > 0 && Boolean(emailProvider), `${alertTo.length} address(es)`)}`,
    `Rate limits: ${onOff(config.rateLimit.enabled)}`,
  ];

  const warnings = [];
  if (onRailway && !config.isProduction) {
    warnings.push("Running on Railway but NODE_ENV isn't \"production\". Add NODE_ENV=production in Variables.");
  }
  if (env.MONGODB_URI) {
    warnings.push("MONGODB_URI is set but unused: PlotPost now uses MySQL (MYSQL_HOST, MYSQL_DATABASE, ...). You can remove it.");
  }
  if (config.isProduction) {
    if (!config.cloudinary.configured) warnings.push("Cloudinary isn't set up: photo uploads will fail.");
    if (!emailProvider) warnings.push("No email service: no verification, reset or delete-account codes can be sent.");
    if (!config.google.configured) warnings.push("GOOGLE_CLIENT_IDS is empty: Continue with Google won't work.");
    if (env.EMAIL_DEV_LOG_CODES === "true") warnings.push("EMAIL_DEV_LOG_CODES is ignored in production; remove it.");
  }
  return { lines, warnings };
};

const printStartupReport = () => {
  const { lines, warnings } = startupReport();
  console.log(`PlotPost settings:\n  ${lines.join("\n  ")}`);
  for (const warning of warnings) console.warn(`⚠️  ${warning}`);
};

module.exports = { startupReport, printStartupReport, describeMysql, describeMongoUri };

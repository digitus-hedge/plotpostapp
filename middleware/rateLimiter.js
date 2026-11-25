const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// Limits login, sign-up, Google and password-reset requests per IP address,
// to slow down password guessing and code guessing. Defaults: 20 requests per
// 15 minutes. Turned off in tests unless RATE_LIMIT_ENABLED=true.
const enabled = () =>
  process.env.RATE_LIMIT_ENABLED === "true" ||
  (process.env.RATE_LIMIT_ENABLED !== "false" && process.env.NODE_ENV !== "test");

const authLimiter = enabled()
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "20", 10),
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "Too many attempts. Please wait a few minutes and try again.",
      },
    })
  : (req, res, next) => next();

// Comments and reports: limited per account (these routes need login).
// Turned off in tests unless RATE_LIMIT_ENABLED=true or RATE_LIMIT_SOCIAL_ENABLED=true.
const socialEnabled = () => process.env.RATE_LIMIT_SOCIAL_ENABLED === "true" || enabled();

const perAccount = ({ windowMs, limit, message }) =>
  socialEnabled()
    ? rateLimit({
        windowMs,
        limit,
        keyGenerator: (req) => `user:${req.user?._id ?? "none"}`,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: { success: false, message },
      })
    : (req, res, next) => next();

// Defaults: 20 comments per 10 minutes, 10 reports per hour.
const commentLimiter = perAccount({
  windowMs: 10 * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_COMMENT_MAX || "20", 10),
  message: "You're commenting very fast. Please wait a few minutes and try again.",
});

const reportLimiter = perAccount({
  windowMs: 60 * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_REPORT_MAX || "10", 10),
  message: "Too many reports in a short time. Please try again later.",
});

// Show Interest: guests are allowed, so they're limited per internet
// connection (IP address) and accounts per account. Defaults: 5 an hour for
// guests, 10 an hour for accounts.
const enquiryLimiter = socialEnabled()
  ? rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: (req) =>
        req.user
          ? parseInt(process.env.RATE_LIMIT_ENQUIRY_MAX || "10", 10)
          : parseInt(process.env.RATE_LIMIT_ENQUIRY_GUEST_MAX || "5", 10),
      keyGenerator: (req) => (req.user ? `user:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`),
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "You've sent a lot of enquiries in a short time. Please try again later.",
      },
    })
  : (req, res, next) => next();

// Chat messages: 30 a minute per account.
const messageLimiter = perAccount({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_MESSAGE_MAX || "30", 10),
  message: "You're sending messages very fast. Please wait a moment.",
});

// --------------------------------------------------- added in Phase 4

const minutes = (n) => n * 60 * 1000;
const num = (name, fallback) => parseInt(process.env[name] || String(fallback), 10);
const emailKey = (req) => `email:${String(req.body?.email || "").trim().toLowerCase()}`;

// Codes sent by email (password reset, and email verification), per email
// address: stops someone flooding one person's inbox from many phones or
// networks. Default 5 an hour. Logged-in requests (resend verification)
// count per account.
const emailCodeLimiter = enabled()
  ? rateLimit({
      windowMs: minutes(60),
      limit: num("RATE_LIMIT_EMAIL_CODE_MAX", 5),
      keyGenerator: (req) => (req.user ? `user:${req.user._id}` : emailKey(req)),
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "Too many codes requested. Please wait an hour and try again.",
      },
    })
  : (req, res, next) => next();

// Wrong passwords per email address: 10 in 15 minutes, then that account's
// login waits (on top of the per-IP limit above). Successful logins don't count.
const loginFailLimiter = enabled()
  ? rateLimit({
      windowMs: minutes(15),
      limit: num("RATE_LIMIT_LOGIN_FAIL_MAX", 10),
      keyGenerator: emailKey,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "Too many wrong passwords for this account. Please wait 15 minutes or use Forgot Password.",
      },
    })
  : (req, res, next) => next();

// Per account. Defaults: 60 photo uploads an hour, 30 new posts a day,
// 300 likes / follows / saves an hour.
const uploadLimiter = perAccount({
  windowMs: minutes(60),
  limit: num("RATE_LIMIT_UPLOAD_MAX", 60),
  message: "You've uploaded a lot of photos in a short time. Please try again later.",
});

const newPostLimiter = perAccount({
  windowMs: minutes(24 * 60),
  limit: num("RATE_LIMIT_POST_MAX", 30),
  message: "You've posted a lot of listings today. Please try again tomorrow.",
});

const actionLimiter = perAccount({
  windowMs: minutes(60),
  limit: num("RATE_LIMIT_ACTION_MAX", 300),
  message: "You're doing that very fast. Please wait a few minutes.",
});

module.exports = {
  authLimiter,
  commentLimiter,
  reportLimiter,
  enquiryLimiter,
  messageLimiter,
  emailCodeLimiter,
  loginFailLimiter,
  uploadLimiter,
  newPostLimiter,
  actionLimiter,
};

// Runs before every test file. Tests never use your real .env database:
// they use TEST_MONGODB_URI if set, otherwise an in-memory MongoDB that
// mongodb-memory-server downloads the first time (needs internet once).
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hs256-signing";
process.env.BCRYPT_ROUNDS = "4";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.DNS_SERVERS = "";
process.env.CORS_ORIGINS = "https://plotpost.web.app";
// Make sure tests never touch real email, Google or Cloudinary accounts.
process.env.SMTP_HOST = "";
process.env.GOOGLE_CLIENT_IDS = "test-google-client-id";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";
// Most tests skip email verification; tests/auth.test.js turns it on.
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.BREVO_API_KEY = "";
process.env.RESEND_API_KEY = "";

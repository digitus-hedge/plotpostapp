// 6-digit one-time codes for email verification, password reset and
// deleting an account from the website.
const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { config } = require("../config/env");

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// Keyed hash: a leaked database alone can't be used to look up codes.
const hashCode = (userId, purpose, code) =>
  crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${purpose}:${userId}:${code}`)
    .digest("hex");

const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

// Creates a new code on user[field] and returns the plain code for the email.
const issueCode = (user, field) => {
  const existing = user[field];
  if (existing?.sentAt && Date.now() - existing.sentAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    throw new AppError(429, "Please wait a minute before asking for another code.");
  }
  const code = generateCode();
  user[field] = {
    codeHash: hashCode(user._id, field, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    attempts: 0,
    sentAt: new Date(),
  };
  return code;
};

// Checks a submitted code. Wrong guesses are counted and saved; after
// MAX_ATTEMPTS the code stops working and a new one must be requested.
const INVALID_CODE = "That code is wrong or has expired. Please request a new one.";

const verifyCode = async (user, field, code) => {
  const entry = user[field];
  const invalid = AppError.badRequest(INVALID_CODE);
  if (!entry?.codeHash) throw invalid;
  if (entry.expiresAt.getTime() < Date.now() || entry.attempts >= MAX_ATTEMPTS) throw invalid;

  const expected = Buffer.from(entry.codeHash, "hex");
  const actual = Buffer.from(hashCode(user._id, field, String(code)), "hex");
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    entry.attempts += 1;
    user.markModified(field);
    await user.save();
    throw invalid;
  }
  user[field] = undefined;
};

// Forgot Password (user.passwordReset) and email verification
// (user.emailVerification). Load the user with "+passwordReset" /
// "+emailVerification" first; save the user after issuing or checking.
const issueResetCode = (user) => issueCode(user, "passwordReset");
const checkResetCode = (user, code) => verifyCode(user, "passwordReset", code);
const issueVerifyCode = (user) => issueCode(user, "emailVerification");
const checkVerifyCode = (user, code) => verifyCode(user, "emailVerification", code);
// Website account deletion (user.accountDeletion; load with "+accountDeletion").
const issueDeletionCode = (user) => issueCode(user, "accountDeletion");
const checkDeletionCode = (user, code) => verifyCode(user, "accountDeletion", code);

module.exports = {
  issueCode,
  verifyCode,
  issueResetCode,
  checkResetCode,
  issueVerifyCode,
  checkVerifyCode,
  issueDeletionCode,
  checkDeletionCode,
  // Errors these throw (wrong code, cooldown) are AppErrors.
  CodeError: AppError,
  INVALID_CODE,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
};

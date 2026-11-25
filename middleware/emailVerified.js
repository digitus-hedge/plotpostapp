// Accounts must confirm their email before they post a listing, send
// interest, start or send chat messages, or comment. Browsing, saving and
// liking work without it.
//
// Switched off (everyone passes) when:
//   - EMAIL_VERIFICATION_REQUIRED=false, or
//   - no email service is set up yet, so nobody can get a code and get stuck.
// Accounts made before verification existed count as verified (see
// User.upgradeOldUsers), and Google accounts are verified by Google.
const emailService = require("../services/emailService");

const verificationRequired = () => process.env.EMAIL_VERIFICATION_REQUIRED !== "false";

const requireVerifiedEmail = (req, res, next) => {
  if (!req.user || req.user.emailVerifiedAt || !verificationRequired() || !emailService.canSend()) {
    return next();
  }
  return res.status(403).json({
    success: false,
    emailNotVerified: true,
    email: req.user.email,
    message: "Please confirm your email first. We can send a 6-digit code to " + req.user.email + ".",
  });
};

module.exports = { requireVerifiedEmail, verificationRequired };

const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  googleSignIn,
  forgotPassword,
  resetPassword,
  changePassword,
  logoutAllDevices,
  verifyEmail,
  resendVerification,
} = require("../controllers/authController");
const { requestDeletionCode, confirmDeletion } = require("../controllers/accountDeletionController");
const { protect } = require("../middleware/authMiddleware");
const { authLimiter, loginFailLimiter, emailCodeLimiter } = require("../middleware/rateLimiter");
const validate = require("../middleware/validate");
const { noOffensiveWords } = require("../middleware/contentFilter");
const {
  registerSchema,
  loginSchema,
  googleSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  deletionCodeSchema,
  confirmDeletionSchema,
} = require("../validators/authValidators");

// Register a new user
router.post(
  "/register",
  authLimiter,
  validate(registerSchema),
  noOffensiveWords({ name: "name" }),
  registerUser
);

// Login user
router.post("/login", authLimiter, validate(loginSchema), loginFailLimiter, loginUser);

// Continue with Google (body: { idToken })
router.post("/google", authLimiter, validate(googleSchema), googleSignIn);

// Forgot password: email a 6-digit code (body: { email })
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), emailCodeLimiter, forgotPassword);

// Reset password with the code (body: { email, code, newPassword })
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);

// The website's Delete account page (no login): email a 6-digit code
// (body: { email }), then delete with it (body: { email, code }).
router.post(
  "/delete-account/request-code",
  authLimiter,
  validate(deletionCodeSchema),
  emailCodeLimiter,
  requestDeletionCode
);
router.post("/delete-account/confirm", authLimiter, validate(confirmDeletionSchema), confirmDeletion);

// Logged in: change password (body: { currentPassword, newPassword }).
router.post("/change-password", protect, authLimiter, validate(changePasswordSchema), changePassword);

// Logged in: confirm the email with the 6-digit code (body: { code }).
router.post("/verify-email", protect, authLimiter, validate(verifyEmailSchema), verifyEmail);

// Logged in: email a new verification code (60 s between codes, 5 an hour).
router.post("/resend-verification", protect, emailCodeLimiter, resendVerification);

// Logged in: end every other login.
router.post("/logout-all", protect, logoutAllDevices);

module.exports = router;

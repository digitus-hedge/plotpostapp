const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const codeService = require("../services/codeService");
const emailService = require("../services/emailService");
const googleAuthService = require("../services/googleAuthService");
const { SUSPENDED_MESSAGE } = require("../middleware/authMiddleware");
const notifications = require("../services/notificationService");

// Generate JWT token. "v" is the account's tokenVersion: raising it (password
// change or reset, "log out of all devices") ends every older login.
const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    { id: user._id, v: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

// The user details the app receives after login, sign-up, Google or reset.
const userResponse = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  profileImage: user.profileImage || "",
  bio: user.bio || "",
  termsAcceptedAt: user.termsAcceptedAt || null,
  isEmailVerified: Boolean(user.emailVerifiedAt),
});

// Suspended accounts never get a login (password, Google or reset).
const loggedIn = (res, status, message, user, extra = {}) => {
  if (user.bannedAt) {
    return res.status(403).json({ success: false, banned: true, message: SUSPENDED_MESSAGE });
  }
  return res.status(status).json({
    success: true,
    message,
    token: generateToken(user),
    user: userResponse(user),
    ...extra,
  });
};

// Compared against when the email is unknown, so a wrong email takes as long
// as a wrong password and can't be used to find out which emails exist.
const DUMMY_HASH = bcrypt.hashSync("plotpost-timing-guard", 10);

// Request bodies are already checked and cleaned by validators/authValidators.js.

// ================= REGISTER =================
const registerUser = async (req, res) => {
  const { name, email, password, acceptTerms } = req.body;

  // Check if user already exists
  const userExists = await User.findOne({ email });
  if (userExists) {
    return res.status(400).json({
      success: false,
      message: "User already exists with this email",
    });
  }

  // Encrypt password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    termsAcceptedAt: acceptTerms === true ? new Date() : null,
  });

  // A 6-digit code to confirm the email. If it can't be sent now, the
  // account still works and "Send a new code" tries again.
  const verificationEmailSent = await sendVerification(user);

  return loggedIn(res, 201, "User registered successfully", user, { verificationEmailSent });
};

// Issues and emails a verification code. True when it was sent.
const sendVerification = async (user) => {
  if (!emailService.canSend()) return false;
  try {
    const withCode = await User.findById(user._id).select("+emailVerification");
    const code = codeService.issueVerifyCode(withCode);
    await withCode.save();
    await emailService.sendVerificationCode(withCode, code);
    return true;
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.warn("Verification email failed:", error.message);
    return false;
  }
};

// ================= LOGIN =================
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  // Google-only accounts have no password: same answer as a wrong password.
  const isPasswordCorrect = await bcrypt.compare(password, user?.password || DUMMY_HASH);
  if (!user || !user.password || !isPasswordCorrect) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  return loggedIn(res, 200, "Login successful", user);
};

// ================= CONTINUE WITH GOOGLE =================
// The app signs in with Google and sends the ID token. We check it with
// Google, then log in the matching account or create a new one.
const googleSignIn = async (req, res) => {
  const google = await googleAuthService.verifyGoogleIdToken(req.body.idToken);

  let user = await User.findOne({ googleId: google.googleId });
  let isNewUser = false;

  if (!user) {
    const sameEmail = await User.findOne({ email: google.email });
    if (sameEmail) {
      // Only link when Google has confirmed this person owns the email.
      if (!google.emailVerified) {
        return res.status(409).json({
          success: false,
          message: "An account with this email already exists. Please log in with your password.",
        });
      }
      user = sameEmail;
      user.googleId = google.googleId;
      if (!user.profileImage && google.picture) user.profileImage = google.picture;
      // Google has confirmed the email.
      if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
      await user.save();
    } else {
      isNewUser = true;
      user = await User.create({
        name: google.name.slice(0, 80),
        email: google.email,
        googleId: google.googleId,
        profileImage: google.picture,
        emailVerifiedAt: google.emailVerified ? new Date() : null,
      });
    }
  } else if (!user.emailVerifiedAt && google.emailVerified) {
    user.emailVerifiedAt = new Date();
    await user.save();
  }

  return loggedIn(res, isNewUser ? 201 : 200, "Login successful", user, { isNewUser });
};

// ================= FORGOT PASSWORD =================
// Emails a 6-digit code. The answer is the same whether or not the email has
// an account, so this can't be used to find out who is registered.
const RESET_SENT_MESSAGE = "If an account exists for that email, we've sent a 6-digit code to it.";

const forgotPassword = async (req, res) => {
  if (!emailService.canSend()) {
    return res.status(503).json({
      success: false,
      message: "Password reset emails aren't set up yet. Please contact PlotPost support.",
    });
  }

  const user = await User.findOne({ email: req.body.email }).select("+passwordReset");
  if (user) {
    try {
      const code = codeService.issueResetCode(user);
      await user.save();
      await emailService.sendPasswordResetCode(user, code);
    } catch (error) {
      // A cooldown or a mail failure must not reveal that the account exists.
      if (!(error instanceof codeService.CodeError) && process.env.NODE_ENV !== "test") {
        console.warn("Password reset email failed:", error.message);
      }
    }
  }

  return res.status(200).json({ success: true, message: RESET_SENT_MESSAGE });
};

// ================= RESET PASSWORD =================
// Checks the emailed code, sets the new password and logs the user in.
const resetPassword = async (req, res) => {
  const { email, code, newPassword } = req.body;

  const user = await User.findOne({ email }).select("+passwordReset");
  if (!user) {
    return res.status(400).json({ success: false, message: codeService.INVALID_CODE });
  }

  await codeService.checkResetCode(user, code);
  user.password = await bcrypt.hash(newPassword, 10);
  // The code reached their inbox, so the email is confirmed too.
  if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  // Log out every other phone; this one gets a fresh login below.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  // Phones stop getting alerts until they log in again.
  await notifications.sessionsEnded(user._id);

  return loggedIn(res, 200, "Your password has been reset.", user);
};

// ================= CHANGE PASSWORD =================
// Logged in: current password + new password. Other phones are logged out;
// this one gets a fresh login. Google-only accounts set a password with
// Forgot Password instead (that proves they own the email).
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);

  if (!user.password) {
    return res.status(400).json({
      success: false,
      noPassword: true,
      message: "Your account signs in with Google and has no password yet. Use Forgot Password to set one.",
    });
  }
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(400).json({ success: false, message: "Your current password is incorrect." });
  }
  if (await bcrypt.compare(newPassword, user.password)) {
    return res.status(400).json({ success: false, message: "Please choose a password different from your current one." });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  // Every phone stops getting alerts; this one signs up again with its new login.
  await notifications.sessionsEnded(user._id);

  return loggedIn(res, 200, "Password changed. You've been logged out on other devices.", user);
};

// ================= VERIFY EMAIL =================
// Logged in: the 6-digit code from the sign-up email (or a resent one).
// 5 wrong tries end the code; it expires after 15 minutes.
const verifyEmail = async (req, res) => {
  const user = await User.findById(req.user._id).select("+emailVerification");
  if (user.emailVerifiedAt) {
    return res.status(200).json({ success: true, message: "Your email is already verified.", user: userResponse(user) });
  }
  await codeService.checkVerifyCode(user, req.body.code);
  user.emailVerifiedAt = new Date();
  await user.save();
  return res.status(200).json({ success: true, message: "Email verified. Thank you!", user: userResponse(user) });
};

// Logged in: email a new verification code (60 seconds between codes).
const resendVerification = async (req, res) => {
  const user = await User.findById(req.user._id).select("+emailVerification");
  if (user.emailVerifiedAt) {
    return res.status(400).json({ success: false, message: "Your email is already verified." });
  }
  if (!emailService.canSend()) {
    return res.status(503).json({
      success: false,
      message: "Verification emails aren't set up yet. Please try again later.",
    });
  }
  const code = codeService.issueVerifyCode(user); // 429 within 60 seconds of the last one
  await user.save();
  try {
    await emailService.sendVerificationCode(user, code);
  } catch (error) {
    console.warn("Verification email failed:", error.message);
    return res.status(502).json({ success: false, message: "We couldn't send the email. Please try again in a few minutes." });
  }
  return res.status(200).json({ success: true, message: `We've sent a new 6-digit code to ${user.email}.` });
};

// ================= LOG OUT OF ALL DEVICES =================
// Ends every login, then gives this phone a fresh one.
const logoutAllDevices = async (req, res) => {
  const user = await User.findById(req.user._id);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await notifications.sessionsEnded(user._id);

  return loggedIn(res, 200, "You've been logged out on all other devices.", user);
};

module.exports = {
  registerUser,
  loginUser,
  googleSignIn,
  forgotPassword,
  resetPassword,
  changePassword,
  logoutAllDevices,
  verifyEmail,
  resendVerification,
  // Shared with the profile endpoints.
  generateToken,
};

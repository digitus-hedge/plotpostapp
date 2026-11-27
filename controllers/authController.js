const { User } = require("../models");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const codeService = require("../services/codeService");
const emailService = require("../services/emailService");
const googleAuthService = require("../services/googleAuthService");
const { SUSPENDED_MESSAGE } = require("../middleware/authMiddleware");
const notifications = require("../services/notificationService");

const generateToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    { id: user.id, v: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
};

const userResponse = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone || "",
  profileImage: user.profileImage || "",
  bio: user.bio || "",
  termsAcceptedAt: user.termsAcceptedAt || null,
  isEmailVerified: Boolean(user.emailVerifiedAt),
});

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

const DUMMY_HASH = bcrypt.hashSync("plotpost-timing-guard", 10);

const registerUser = async (req, res) => {
  const { name, email, password, acceptTerms } = req.body;

  const userExists = await User.findOne({ where: { email } });
  if (userExists) {
    return res.status(400).json({
      success: false,
      message: "User already exists with this email",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    termsAcceptedAt: acceptTerms === true ? new Date() : null,
  });

  const verificationEmailSent = await sendVerification(user);

  return loggedIn(res, 201, "User registered successfully", user, { verificationEmailSent });
};

const sendVerification = async (user) => {
  if (!emailService.canSend()) return false;
  try {
    const withCode = await User.findByPk(user.id);
    const code = codeService.issueVerifyCode(withCode);
    await withCode.save();
    await emailService.sendVerificationCode(withCode, code);
    return true;
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.warn("Verification email failed:", error.message);
    return false;
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ where: { email } });

  const isPasswordCorrect = await bcrypt.compare(password, user?.password || DUMMY_HASH);
  if (!user || !user.password || !isPasswordCorrect) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  return loggedIn(res, 200, "Login successful", user);
};

const googleSignIn = async (req, res) => {
  const google = await googleAuthService.verifyGoogleIdToken(req.body.idToken);

  let user = await User.findOne({ where: { googleId: google.googleId } });
  let isNewUser = false;

  if (!user) {
    const sameEmail = await User.findOne({ where: { email: google.email } });
    if (sameEmail) {
      if (!google.emailVerified) {
        return res.status(409).json({
          success: false,
          message: "An account with this email already exists. Please log in with your password.",
        });
      }
      user = sameEmail;
      user.googleId = google.googleId;
      if (!user.profileImage && google.picture) user.profileImage = google.picture;
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

const RESET_SENT_MESSAGE = "If an account exists for that email, we've sent a 6-digit code to it.";

const forgotPassword = async (req, res) => {
  if (!emailService.canSend()) {
    return res.status(503).json({
      success: false,
      message: "Password reset emails aren't set up yet. Please contact PlotPost support.",
    });
  }

  const user = await User.findOne({ where: { email: req.body.email } });
  if (user) {
    try {
      const code = codeService.issueResetCode(user);
      await user.save();
      await emailService.sendPasswordResetCode(user, code);
    } catch (error) {
      if (!(error instanceof codeService.CodeError) && process.env.NODE_ENV !== "test") {
        console.warn("Password reset email failed:", error.message);
      }
    }
  }

  return res.status(200).json({ success: true, message: RESET_SENT_MESSAGE });
};

const resetPassword = async (req, res) => {
  const { email, code, newPassword } = req.body;

  const user = await User.findOne({ where: { email } });
  if (!user) {
    return res.status(400).json({ success: false, message: codeService.INVALID_CODE });
  }

  await codeService.checkResetCode(user, code);
  user.password = await bcrypt.hash(newPassword, 10);
  if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await notifications.sessionsEnded(user.id);

  return loggedIn(res, 200, "Your password has been reset.", user);
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findByPk(req.user.id);

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
  await notifications.sessionsEnded(user.id);

  return loggedIn(res, 200, "Password changed. You've been logged out on other devices.", user);
};

const verifyEmail = async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (user.emailVerifiedAt) {
    return res.status(200).json({ success: true, message: "Your email is already verified.", user: userResponse(user) });
  }
  await codeService.checkVerifyCode(user, req.body.code);
  user.emailVerifiedAt = new Date();
  await user.save();
  return res.status(200).json({ success: true, message: "Email verified. Thank you!", user: userResponse(user) });
};

const resendVerification = async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (user.emailVerifiedAt) {
    return res.status(400).json({ success: false, message: "Your email is already verified." });
  }
  if (!emailService.canSend()) {
    return res.status(503).json({
      success: false,
      message: "Verification emails aren't set up yet. Please try again later.",
    });
  }
  const code = codeService.issueVerifyCode(user);
  await user.save();
  try {
    await emailService.sendVerificationCode(user, code);
  } catch (error) {
    console.warn("Verification email failed:", error.message);
    return res.status(502).json({ success: false, message: "We couldn't send the email. Please try again in a few minutes." });
  }
  return res.status(200).json({ success: true, message: `We've sent a new 6-digit code to ${user.email}.` });
};

const logoutAllDevices = async (req, res) => {
  const user = await User.findByPk(req.user.id);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await notifications.sessionsEnded(user.id);

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
  generateToken,
};

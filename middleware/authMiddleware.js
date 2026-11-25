
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Logins from before the last password change / "log out of all devices"
// carry an older number. (Logins made before this check have none: 0.)
const sessionStillValid = (decoded, user) => (decoded.v || 0) === (user.tokenVersion || 0);

// What a suspended account is told (logging in, or any request).
const SUSPENDED_MESSAGE =
  "This account has been suspended for breaking the PlotPost rules. Contact PlotPost support on WhatsApp +91 62356 49489.";

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. Token missing.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");

    // sessionEnded tells the app to forget this login (account deleted, or
    // logged out by a password change / "log out of all devices").
    if (!user) {
      return res.status(401).json({
        success: false,
        sessionEnded: true,
        message: "User not found.",
      });
    }

    // Banned by an admin: the app logs out and shows why.
    if (user.bannedAt) {
      return res.status(401).json({
        success: false,
        sessionEnded: true,
        banned: true,
        message: SUSPENDED_MESSAGE,
      });
    }

    // Logged out by a password change or "Log out of all devices".
    if (!sessionStillValid(decoded, user)) {
      return res.status(401).json({
        success: false,
        sessionEnded: true,
        message: "You've been logged out. Please log in again.",
      });
    }

    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

// For pages guests can see too (the home feed). A valid token sets req.user
// so the answer can be personal ("liked by me"); a missing, expired or broken
// token just means "guest", so the feed never fails because of an old login.
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");
      if (user && !user.bannedAt && sessionStillValid(decoded, user)) req.user = user;
    } catch (error) {
      // Treated as a guest.
    }
  }
  next();
};

// Admin panel routes: use after protect.
const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admins only." });
  }
  next();
};

module.exports = { protect, optionalAuth, adminOnly, SUSPENDED_MESSAGE };

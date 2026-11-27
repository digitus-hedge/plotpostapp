const jwt = require("jsonwebtoken");
const { User } = require("../models");

const sessionStillValid = (decoded, user) => (decoded.v || 0) === (user.tokenVersion || 0);

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

    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        sessionEnded: true,
        message: "User not found.",
      });
    }

    if (user.bannedAt) {
      return res.status(401).json({
        success: false,
        sessionEnded: true,
        banned: true,
        message: SUSPENDED_MESSAGE,
      });
    }

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

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id, {
        attributes: { exclude: ["password"] },
      });
      if (user && !user.bannedAt && sessionStillValid(decoded, user)) req.user = user;
    } catch (error) {
      // Treated as a guest.
    }
  }
  next();
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admins only." });
  }
  next();
};

module.exports = { protect, optionalAuth, adminOnly, SUSPENDED_MESSAGE };

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const AppError = require("../utils/AppError");
const { config } = require("../config/env");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Two parallel refresh calls from one phone can both present the same token.
// Within this window the second one just fails, without logging out every device.
const REUSE_GRACE_MS = 10 * 1000;

const signAccessToken = (user) =>
  jwt.sign({ id: String(user._id), role: user.role || "user", type: "access" }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
    algorithm: "HS256",
  });

const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  // Tokens from before Stage 1 have no type; treat them as access tokens.
  if (decoded.type && decoded.type !== "access") {
    throw AppError.unauthorized("Invalid token.");
  }
  return decoded;
};

let cachedTtlSeconds;
const accessTokenSeconds = () => {
  if (cachedTtlSeconds === undefined) {
    const decoded = jwt.decode(signAccessToken({ _id: "x" }));
    cachedTtlSeconds = decoded.exp - decoded.iat;
  }
  return cachedTtlSeconds;
};

const createRefreshToken = async (user, req) => {
  const raw = crypto.randomBytes(48).toString("base64url");
  await RefreshToken.create({
    user: user._id,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000),
    userAgent: String(req?.get?.("user-agent") || "").slice(0, 200),
    ip: req?.ip || "",
  });
  return raw;
};

// The token pair sent to the app after login, register, refresh etc.
// `token` duplicates accessToken so the current app version keeps working.
const issueAuthTokens = async (user, req) => {
  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user, req);
  return {
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: accessTokenSeconds(),
  };
};

const revokeAllForUser = (userId) =>
  RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

// Exchanges a refresh token for a new pair. Each refresh token works once.
// Presenting an already-used token means it was probably stolen, so every
// session for that user is ended.
const rotateRefreshToken = async (rawToken, req) => {
  if (!rawToken || typeof rawToken !== "string") {
    throw AppError.unauthorized("Your session has expired. Please log in again.");
  }
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const current = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
    { returnDocument: "after" }
  );

  if (!current) {
    const existing = await RefreshToken.findOne({ tokenHash });
    if (existing?.revokedAt && now - existing.revokedAt > REUSE_GRACE_MS && existing.replacedByHash) {
      await revokeAllForUser(existing.user);
    }
    throw AppError.unauthorized("Your session has expired. Please log in again.");
  }

  const User = require("../models/User");
  const user = await User.findById(current.user);
  if (!user) throw AppError.unauthorized("Your session has expired. Please log in again.");

  const tokens = await issueAuthTokens(user, req);
  current.replacedByHash = sha256(tokens.refreshToken);
  await current.save();
  return { user, tokens };
};

const revokeRefreshToken = async (rawToken) => {
  if (!rawToken || typeof rawToken !== "string") return;
  await RefreshToken.updateOne(
    { tokenHash: sha256(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};

module.exports = {
  sha256,
  signAccessToken,
  verifyAccessToken,
  issueAuthTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};

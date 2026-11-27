const { OAuth2Client } = require("google-auth-library");
const AppError = require("../utils/AppError");
const { config } = require("../config/env");

const client = new OAuth2Client();

// Checks a Google ID token from the app with Google and returns the
// verified account details. Tests replace this function with a fake.
const verifyGoogleIdToken = async (idToken) => {
  if (!config.google.configured) {
    throw AppError.unavailable("Google sign-in is not set up on the server yet.");
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.google.clientIds });
    payload = ticket.getPayload();
  } catch (error) {
    throw AppError.unauthorized("Google sign-in failed. Please try again.");
  }
  if (!payload?.sub || !payload.email) {
    throw AppError.unauthorized("Google sign-in failed. Please try again.");
  }
  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture || "",
  };
};

module.exports = { verifyGoogleIdToken };

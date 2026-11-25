// Phone alerts through Firebase Cloud Messaging (free). Uses Google's
// official sending service (FCM HTTP v1) with the Google login library the
// server already has, so no extra package.
//
// Switched on by one setting: FIREBASE_SERVICE_ACCOUNT_JSON, the service
// account key from the Firebase console (the JSON itself, or the same text
// base64-encoded). Without it alerts are simply off and everything else
// works. The key is never logged or sent anywhere except to Google.
const { JWT } = require("google-auth-library");
const PushDevice = require("../models/PushDevice");

const isTest = () => process.env.NODE_ENV === "test";

// In tests, alerts are collected here instead of being sent.
const outbox = [];

const MAX_DEVICES_PER_ACCOUNT = 10;
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let credentials; // read once: { email, key, projectId } or null
const readCredentials = () => {
  if (credentials !== undefined) return credentials;
  credentials = null;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text);
    const projectId = process.env.FIREBASE_PROJECT_ID || parsed.project_id;
    if (parsed.client_email && parsed.private_key && projectId) {
      credentials = { email: parsed.client_email, key: parsed.private_key, projectId };
    } else {
      console.error("Phone alerts are off: FIREBASE_SERVICE_ACCOUNT_JSON has no client_email, private_key or project_id.");
    }
  } catch (error) {
    console.error("Phone alerts are off: FIREBASE_SERVICE_ACCOUNT_JSON could not be read (paste the whole key file, or its base64).");
  }
  return credentials;
};

// True when alerts can actually reach phones.
const canSend = () => isTest() || Boolean(readCredentials());

let jwtClient;
const accessToken = async () => {
  const { email, key } = readCredentials();
  if (!jwtClient) jwtClient = new JWT({ email, key, scopes: [SCOPE] });
  // The library keeps the token and renews it shortly before it expires.
  const { token } = await jwtClient.getAccessToken();
  return token;
};

// FCM data values must all be text.
const textValues = (data = {}) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );

// One alert for one phone. "tag" makes a newer alert replace the older one
// in the phone's notification tray (one alert per chat, not one per message).
const buildMessage = (token, alert) => ({
  message: {
    token,
    notification: { title: alert.title, body: alert.body },
    data: textValues(alert.data),
    android: {
      priority: "HIGH",
      ...(alert.tag ? { notification: { tag: alert.tag } } : {}),
    },
  },
});

// Firebase answers like this when the app was removed from the phone, or the
// token was replaced or belongs to another Firebase project.
const isDeadToken = (status, body) => {
  const error = body?.error || {};
  const codes = (error.details || []).map((detail) => detail?.errorCode).filter(Boolean);
  if (status === 404 || codes.includes("UNREGISTERED") || codes.includes("SENDER_ID_MISMATCH")) return true;
  return status === 400 && /registration token/i.test(String(error.message || ""));
};

// Sends one alert to each token. Dead tokens are removed. Never throws.
const deliver = async (tokens, alert, options = {}) => {
  let projectId = options.projectId;
  let bearer = options.bearer;
  const fetchImpl = options.fetchImpl || fetch;
  try {
    if (!projectId) projectId = readCredentials().projectId;
    if (!bearer) bearer = await accessToken();
  } catch (error) {
    console.error("Phone alerts: could not get permission from Google to send.");
    return { sent: 0, removed: 0, failed: tokens.length };
  }

  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const result = { sent: 0, removed: 0, failed: 0 };
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildMessage(token, alert)),
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          result.sent += 1;
          return;
        }
        const body = await response.json().catch(() => ({}));
        if (isDeadToken(response.status, body)) {
          await PushDevice.deleteOne({ token });
          result.removed += 1;
          return;
        }
        result.failed += 1;
        console.error(`Phone alert not delivered (Firebase answered ${response.status}).`);
      } catch (error) {
        result.failed += 1;
        console.error("Phone alert not delivered (could not reach Firebase).");
      }
    })
  );
  return result;
};

// Sends an alert to every phone of an account. Returns how many phones it
// went to. The actual sending happens in the background, so the request
// that caused it isn't kept waiting.
const sendToUser = async (userId, alert) => {
  if (!canSend()) return 0;
  const devices = await PushDevice.find({ user: userId }).select("token").lean();
  if (!devices.length) return 0;
  if (isTest()) {
    for (const device of devices) outbox.push({ user: String(userId), token: device.token, ...alert });
    return devices.length;
  }
  deliver(
    devices.map((device) => device.token),
    alert
  ).catch(() => {});
  return devices.length;
};

// This phone now gets alerts for this account (and stops getting them for
// any other account it was logged in with). Up to 10 phones per account;
// the ones not opened for longest are dropped.
const registerDevice = async (userId, token, platform) => {
  const filter = { token };
  const update = { $set: { user: userId, platform, lastSeenAt: new Date() } };
  try {
    await PushDevice.updateOne(filter, update, { upsert: true });
  } catch (error) {
    // Two registrations at the same moment: the other one created it.
    if (error?.code !== 11000) throw error;
    await PushDevice.updateOne(filter, update);
  }
  const extra = await PushDevice.find({ user: userId })
    .sort({ lastSeenAt: -1, _id: -1 })
    .skip(MAX_DEVICES_PER_ACCOUNT)
    .select("_id")
    .lean();
  if (extra.length) await PushDevice.deleteMany({ _id: { $in: extra.map((device) => device._id) } });
};

// Logging out on this phone.
const removeDevice = (userId, token) => PushDevice.deleteOne({ token, user: userId });

// Password change or reset, "Log out of all devices", account deleted.
const removeAllDevices = (userId) => PushDevice.deleteMany({ user: userId });

module.exports = {
  canSend,
  sendToUser,
  registerDevice,
  removeDevice,
  removeAllDevices,
  deliver,
  buildMessage,
  isDeadToken,
  outbox,
  MAX_DEVICES_PER_ACCOUNT,
};

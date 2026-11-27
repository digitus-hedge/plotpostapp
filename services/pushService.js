const { JWT } = require("google-auth-library");
const { PushDevice } = require("../models");

const isTest = () => process.env.NODE_ENV === "test";
const outbox = [];
const MAX_DEVICES_PER_ACCOUNT = 10;
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let credentials;
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
    }
  } catch (error) {
    console.error("Phone alerts off: FIREBASE_SERVICE_ACCOUNT_JSON could not be read.");
  }
  return credentials;
};

const canSend = () => isTest() || Boolean(readCredentials());

let jwtClient;
const accessToken = async () => {
  const { email, key } = readCredentials();
  if (!jwtClient) jwtClient = new JWT({ email, key, scopes: [SCOPE] });
  const { token } = await jwtClient.getAccessToken();
  return token;
};

const textValues = (data = {}) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );

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

const isDeadToken = (status, body) => {
  const error = body?.error || {};
  const codes = (error.details || []).map((detail) => detail?.errorCode).filter(Boolean);
  if (status === 404 || codes.includes("UNREGISTERED") || codes.includes("SENDER_ID_MISMATCH")) return true;
  return status === 400 && /registration token/i.test(String(error.message || ""));
};

const deliver = async (tokens, alert, options = {}) => {
  let projectId = options.projectId;
  let bearer = options.bearer;
  const fetchImpl = options.fetchImpl || fetch;
  try {
    if (!projectId) projectId = readCredentials().projectId;
    if (!bearer) bearer = await accessToken();
  } catch (error) {
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
          await PushDevice.destroy({ where: { token } });
          result.removed += 1;
          return;
        }
        result.failed += 1;
      } catch (error) {
        result.failed += 1;
      }
    })
  );
  return result;
};

const sendToUser = async (userId, alert) => {
  if (!canSend()) return 0;
  const devices = await PushDevice.findAll({ where: { userId }, attributes: ["token"] });
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

const registerDevice = async (userId, token, platform) => {
  const [device, created] = await PushDevice.findOrCreate({
    where: { token },
    defaults: { userId, platform, lastSeenAt: new Date() },
  });
  if (!created) {
    device.userId = userId;
    device.platform = platform;
    device.lastSeenAt = new Date();
    await device.save();
  }
};

const removeDevice = (userId, token) => PushDevice.destroy({ where: { token, userId } });
const removeAllDevices = (userId) => PushDevice.destroy({ where: { userId } });

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

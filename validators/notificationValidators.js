const { z } = require("zod");
const { PUSH_PLATFORMS } = require("../models/PushDevice");

const pushToken = z
  .string({ error: "Missing phone alert token." })
  .trim()
  .min(20, "Invalid phone alert token.")
  .max(4096, "Invalid phone alert token.");

// POST /api/notifications/seen — you've seen the list up to this moment
// (the serverTime the list came with). Without it: now.
const markSeenSchema = z.object({
  upTo: z.iso.datetime({ offset: true, error: "Invalid time." }).optional(),
});

// POST /api/notifications/devices — this phone wants alerts.
const registerDeviceSchema = z.object({
  token: pushToken,
  platform: z.enum(PUSH_PLATFORMS, { error: "Unknown phone type." }).default("android"),
});

// DELETE /api/notifications/devices — this phone logged out.
const removeDeviceSchema = z.object({
  token: pushToken,
});

module.exports = { markSeenSchema, registerDeviceSchema, removeDeviceSchema };

const { z } = require("zod");

// Removing a listing or comment, or banning someone, needs a reason. The
// seller or commenter is shown it; it is also kept in the audit log.
const reason = z
  .string({ error: "Please give a reason." })
  .trim()
  .min(3, "Please give a reason (at least 3 characters).")
  .max(500, "The reason can be up to 500 characters.");

const reasonSchema = z.object({ reason });

// Restore / unban: a note is optional.
const optionalReasonSchema = z.object({
  reason: z.string().trim().max(500, "The note can be up to 500 characters.").optional(),
});

const id = z.string().trim().regex(/^[a-f0-9]{24}$/i, "Invalid ID.").optional();

// POST /api/admin/reports/dismiss
const dismissSchema = z.object({
  kind: z.enum(["post", "comment", "user"], { error: "Say whether it's a post, comment or account." }),
  post: id,
  comment: id,
  user: id,
  reason: z.string().trim().max(500).optional(),
});

module.exports = { reasonSchema, optionalReasonSchema, dismissSchema };

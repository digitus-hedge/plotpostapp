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

// Posts and accounts have MySQL ids (whole numbers, sent as text or numbers).
const id = z
  .preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().trim().regex(/^[1-9]\d{0,9}$/, "Invalid ID.")
  )
  .optional();
// Comments live inside a post with a UUID (older ones: a 24-character id).
const commentId = z
  .string()
  .trim()
  .regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-f0-9]{24})$/i, "Invalid ID.")
  .optional();

// POST /api/admin/reports/dismiss
const dismissSchema = z.object({
  kind: z.enum(["post", "comment", "user"], { error: "Say whether it's a post, comment or account." }),
  post: id,
  comment: commentId,
  user: id,
  reason: z.string().trim().max(500).optional(),
});

module.exports = { reasonSchema, optionalReasonSchema, dismissSchema };

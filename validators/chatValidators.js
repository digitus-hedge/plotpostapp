const { z } = require("zod");

// MySQL ids are positive whole numbers; the app may send them as text or numbers.
const id = (label) =>
  z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string({ error: `Please choose a ${label}.` }).trim().regex(/^[1-9]\d{0,9}$/, `Please choose a ${label}.`)
  );

// POST /api/chats — open (or start) your chat with someone, optionally about
// one of their posts.
const startChatSchema = z.object({
  userId: id("person to message"),
  postId: id("property").optional(),
});

// POST /api/chats/:id/messages
const sendMessageSchema = z.object({
  text: z
    .string({ error: "Please write a message." })
    .trim()
    .min(1, "Please write a message.")
    .max(2000, "Messages can be up to 2,000 characters."),
  postId: id("property").optional(),
});

module.exports = { startChatSchema, sendMessageSchema };

const { z } = require("zod");

const id = (label) =>
  z.string({ error: `Please choose a ${label}.` }).trim().regex(/^[a-f0-9]{24}$/i, `Please choose a ${label}.`);

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

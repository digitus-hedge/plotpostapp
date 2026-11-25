# Screen 11: Messages and Chat

Install **after Screens 1–10**.

## Install

**Backend** (`screen11_backend.zip`): copy the files into your `plotpost_backend` folder,
replacing the old ones. There are no new packages and no database step: the two new collections
(`conversations`, `messages`) are created by themselves. Then:

```
npm test
npm run dev
```

**Flutter** (`screen11_flutter.zip`): copy the files into your `plotpost` folder, then run
`flutter analyze` and send me anything it reports. There are no new packages.

## What changed

- **Backend new:** `models/Conversation.js`, `models/Message.js`, `controllers/chatController.js`,
  `routes/chatRoutes.js`, `validators/chatValidators.js`, `tests/chat.test.js`
- **Backend changed:**
  - `server.js`: adds `/api/chats`
  - `middleware/rateLimiter.js`: the message limit
  - `models/User.js`: blocked people
  - `routes/userRoutes.js` and `controllers/userController.js`: block and unblock, and Delete
    account now also deletes chats
  - `controllers/enquiryController.js`: tells the seller whether the buyer has an account
- **Flutter new:** `models/chat.dart`
- **Flutter changed:** `screens/messages_screen.dart`, `screens/chat_screen.dart`,
  `screens/property_details_screen.dart`, `screens/browse_screen.dart`,
  `screens/inquiries_screen.dart`, `screens/help_center_screen.dart`, `services/api_service.dart`,
  `models/enquiry.dart`

## Bugs fixed

- **Messages showed 6 made-up conversations,** plus fake "notes" with online dots and a Requests
  tab. It now shows your real chats.
- **Chat saved nothing.** Messages stayed on the phone and vanished. "Active now / Active 2h ago"
  was invented, and the preview was shown as a message received at "10:30 AM". Messages are now
  saved on the server, and nothing is made up.
- **"New message" listed only the fake people,** and there was no way to message a seller. Chats
  now start from **Message** on a property, or **Chat in PlotPost** on a Buyer Inquiry.
- **Help Center's "Contact Support" opened a chat nobody read.** It's hidden until you send me a
  real support email or WhatsApp number.

## How it works

- **One chat per pair of people,** like WhatsApp. Messaging the same seller about two posts keeps
  one chat, and each post shows as a small card you can tap.
- **Starting from a post:** the chat opens with "About: …" above the box, and that post's card goes
  with your first message. Tap × if you don't want it attached.
- **Messages** are up to 2,000 characters.
  - The latest 30 load first; scroll up for older ones.
  - While a chat is open, new messages are checked every 3 seconds.
  - **Seen** appears under your last message once they've opened the chat.
- **Messages list:** newest chat first, with search, unread counts in bold and "You: …" for your
  own last message.
  - It refreshes every 15 seconds and when you come back from a chat.
  - A chat only appears once someone has written in it.
- **Home:** the Messages icon shows a red badge with your unread count, updated every 15 seconds.
- **Delete chat** (hold a chat in the list, or ⋮ in the chat) deletes it for you only, along with
  its history for you. The other person keeps theirs. If they write again, it comes back with just
  the new messages.
- **Block** (⋮ in the chat): they can't message you or start a new chat with you, and you can't
  message them until you tap **Unblock**. They only see "You can't message this person."; they
  aren't told they're blocked.
- **Limits per account:** 30 messages a minute and 20 new chats a day. Opening an existing chat
  doesn't count. You can change these in `.env` with `RATE_LIMIT_MESSAGE_MAX` and
  `CHAT_NEW_PER_DAY_MAX`.
- **Login and privacy:**
  - You need to be logged in. Guests tapping Message see "Log in to send messages."
  - Nobody else can open a chat they're not in.
  - Emails are never shown.
- **Your own posts:** the details page no longer shows the Call / Show interest bar.
- **Delete account** (Screen 10) now also deletes that person's chats and messages, and removes
  them from other people's block lists.

## Endpoints (all need login)

| Endpoint | Notes |
|---|---|
| `POST /api/chats` | Body `{ userId, postId? }`. Opens your chat with that person or starts it. 201 when new, 200 when it existed. |
| `GET /api/chats` | Your chats with messages, newest first, and the total `unread`. |
| `GET /api/chats/unread` | `{ unread, chats }` for the badge. |
| `GET /api/chats/:id/messages` | The latest 30 in time order, `?before=<id>` for older ones, `?after=<id>` for new ones. Also returns `otherReadAt`, `canMessage`, `blockedByMe` and `hasMore`. |
| `POST /api/chats/:id/messages` | Body `{ text, postId? }`, 1–2,000 characters. |
| `POST /api/chats/:id/read` | Marks the chat read. |
| `DELETE /api/chats/:id` | Deletes the chat for you only. |
| `POST /api/users/:id/block` / `DELETE /api/users/:id/block` | Block / unblock. |

## Test on your phone

You'll need two phones (or a phone and the web version) with two accounts.

1. **Message a seller:** as the buyer, open the seller's post → **Message** → write "Is it still
   available?". The message shows the post's card.
2. **Seller:** within about 15 seconds, the Messages icon on Home shows a badge. Open Messages: the
   chat is bold with 1 unread. Open it and reply.
3. **Live:** keep the chat open on both phones. New messages appear within about 3 seconds, and
   "Seen" shows under the buyer's message.
4. **Inquiries:** as a logged-in buyer, send Show Interest. As the seller, go to Buyer Inquiries → ⋮
   → **Chat in PlotPost**.
5. **Block:** ⋮ → Block. The other phone gets "You can't message this person." Unblock and it
   works again.
6. **Delete chat:** hold the chat in the list → Delete. It's gone for you only. Send a message
   from the other phone and it comes back.

## Test results

**185 passed and 1 skipped, of 186** (11 new, plus 175 from Screens 1–10), 6 runs in a row. The
skipped one is the Screen 8 test that needs real MongoDB; it runs with `npm test` on your PC.
Details are in `SCREEN11_TEST_RESULTS.txt`.

- **Starting chats (3):**
  - one per pair, whoever starts it, and about a post
  - not with yourself, unknown people, missing posts or without login
  - 20 new a day, and reopening doesn't count
- **Sending and reading (4):**
  - unread counts, the badge, Seen and the order
  - 30 at a time, older by scrolling up, new since the last message
  - empty, too-long, strangers and bad IDs refused
  - 30 a minute, and the other person isn't affected
- **Delete for me (1):**
  - your list and history cleared, theirs kept
  - a new message brings it back
- **Blocking (1):**
  - both directions stopped, with no hint that they're blocked
  - unblocking restores it
  - you can't block yourself
- **Other screens (2):**
  - Inquiries say whether the buyer has an account
  - Delete account removes chats, messages and blocks, and nobody else's

I also broke the code on purpose five times, and the tests caught each one:
- strangers opening any chat
- blocked people still messaging
- deleted chat history still showing
- unread never counting up
- no daily limit on new chats

**Not checked by me:**
- **The Flutter code hasn't been compiled.** There's no Flutter SDK here, so `flutter analyze` is
  the real check.
- **Two real phones chatting.** Run the steps above.

## Good to know

- **Not instant:** new messages take up to 3 seconds in an open chat, and up to 15 seconds for the
  list and badge. If you later want instant delivery, Socket.IO can replace this without changing
  the screens much.
- **No alert when the app is closed.** Notifications for new messages come with Screen 12.
- **Text only for now.** Photos in chat and a list of the people you've blocked (you unblock from
  the chat) can come later if you want them.
- **"Contact Support" in Help Center is hidden.** Send me a support email or WhatsApp number and I'll
  connect it.

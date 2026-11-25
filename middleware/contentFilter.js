const { findOffensiveWords } = require("../utils/contentFilter");

// Refuses a request whose text fields contain offensive words (400, with the
// words found so people can fix them). Use after validate(...), e.g.
//   noOffensiveWords({ title: "title", description: "description" })
// Keys are body fields; values are how the field is named in the message.
const noOffensiveWords = (fields) => (req, res, next) => {
  for (const [field, label] of Object.entries(fields)) {
    const value = req.body?.[field];
    if (typeof value !== "string") continue;
    const words = findOffensiveWords(value);
    if (words.length) {
      const list = words.map((word) => `"${word}"`).join(", ");
      return res.status(400).json({
        success: false,
        offensive: true,
        field,
        message: `Please remove offensive language from the ${label} (${list}).`,
      });
    }
  }
  next();
};

module.exports = { noOffensiveWords };

// Words refused in posts, comments, chat messages, inquiries and profiles
// (see utils/contentFilter.js for how they are matched).
//
// How to write an entry (always lower case):
//   "word"     the whole word only: "ass" would NOT match "assess" or "class"
//   "word*"    any word starting with it: "fuck*" also matches "fucking", "fucker"
//   "two words" a phrase, matched as whole words
//
// Matching ignores letter case, common tricks (sh1t, $hit, f*ck, f.u.c.k)
// and stretched letters (shiiit). Only use "*" for words that can't be the
// start of an innocent word: e.g. never "kunna*", because of "Kunnamangalam".
//
// After editing, restart the server. Run the tests (npm test) to check that
// place names and normal words still pass.

const english = [
  "fuck*",
  "motherfuck*",
  "fck",
  "fuk",
  "fucc",
  "wtf",
  "shit",
  "shitty",
  "shithead",
  "bullshit",
  "bitch*",
  "bastard",
  "bastards",
  "asshole*",
  "arsehole*",
  "dickhead*",
  "cunt*",
  "whore*",
  "slut*",
  "wanker*",
  "twat",
  "porn*",
  "nude pics",
  "send nudes",
  "nigger*",
  "nigga*",
  "faggot*",
  "retard",
  "retarded",
  "kill yourself",
  "kys",
];

// Hindi and Hinglish abuse that is common across India.
const hindi = [
  "chutiya*",
  "chutia*",
  "madarchod*",
  "maderchod*",
  "bhenchod*",
  "behenchod*",
  "bhosdi*",
  "bhosdike",
  "gandu",
  "randi",
  "randwa",
  "lavda",
  "lauda",
  "harami",
];

// Malayalam (in Malayalam script and in Manglish). A short starter list:
// please check it and add the words you want blocked.
const malayalam = [
  "myre",
  "myru",
  "myran",
  "mairu",
  "thayoli",
  "thaayoli",
  "poorimon",
  "poorimone",
  "poorimol",
  "kunne",
  "മൈര്",
  "മൈരേ",
  "മൈരൻ",
  "തായോളി",
  "പൂറി",
  "പൂറിമോനേ",
  "കുണ്ണ",
];

module.exports = [...english, ...hindi, ...malayalam];

// Finds offensive words in text people post (see config/blockedWords.js).
//
// Whole words only, so "assess", "Scunthorpe" and "Kunnamangalam" pass.
// Before comparing, the text is lower-cased and common tricks are undone:
//   sh1t, $hit, @ss     look-alike digits and symbols become letters
//   f.u.c.k, f-u-c-k    dots, dashes and underscores between letters are dropped
//   f*ck, sh*t          each * stands for one hidden letter
//   shiiiit, fuuuck     stretched letters count once (for words of 4+ letters)

const BLOCKED = require("../config/blockedWords");

const LOOKALIKES = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };

// Letters and marks of any script (Malayalam vowel signs are marks).
const LETTER = "\\p{L}\\p{M}";
const INVISIBLE = /[​-‍⁠﻿­]/g;

// "shiiit" → "shit"; Malayalam marks are left alone.
const squeeze = (word) => word.replace(/(\p{L})\1+/gu, "$1");

// Prepared once: whole words, word prefixes ("fuck*") and phrases.
const exact = new Map(); // word → entry
const squeezed = new Map(); // squeezed word (4+ letters) → entry
const prefixes = []; // [prefix, entry]
const phrases = []; // [" two words ", entry]
for (const raw of BLOCKED) {
  const entry = String(raw).trim().toLowerCase().normalize("NFKC");
  if (!entry) continue;
  if (entry.includes(" ")) {
    phrases.push([` ${entry.split(/\s+/).join(" ")} `, entry]);
  } else if (entry.endsWith("*")) {
    prefixes.push([entry.slice(0, -1), entry.slice(0, -1)]);
  } else {
    exact.set(entry, entry);
    const short = squeeze(entry);
    if (short.length >= 4) squeezed.set(short, entry);
  }
}
const exactWords = [...exact.keys()];

// Look-alikes only count inside words that also have real letters, so prices
// and phone numbers ("3 BHK", "98950 00000") are left alone.
const normaliseWord = (word) =>
  /\p{L}/u.test(word) ? [...word].map((ch) => LOOKALIKES[ch] ?? ch).join("") : word;

const tokensOf = (text) => {
  const cleaned = String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    // f.u.c.k / f-u-c-k / f_u_c_k → fuck
    .replace(new RegExp(`(?<=[${LETTER}])[._-](?=[${LETTER}])`, "gu"), "");
  // A word is letters plus look-alikes and *, e.g. "sh*t", "$hit", "a$$hole".
  return cleaned.match(new RegExp(`[${LETTER}0-9@$!*]+`, "gu")) || [];
};

const matchWord = (token) => {
  // "shit!" / "!!idiot": exclamation marks at the ends are punctuation.
  const word = normaliseWord(token.replace(/^!+|!+$/g, ""));
  if (!word || !/\p{L}/u.test(word)) return null;

  // f*ck, sh*t: each * is one hidden letter.
  if (word.includes("*")) {
    const pattern = new RegExp(`^${word.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".")}$`, "u");
    const prefixHit = prefixes.find(([prefix]) => pattern.test(prefix));
    if (prefixHit) return prefixHit[1];
    return exactWords.find((candidate) => pattern.test(candidate)) ?? null;
  }

  if (exact.has(word)) return exact.get(word);
  const short = squeeze(word);
  if (squeezed.has(short)) return squeezed.get(short);
  for (const [prefix, entry] of prefixes) {
    if (word.startsWith(prefix) || short.startsWith(squeeze(prefix))) return entry;
  }
  return null;
};

// The offensive words found in `text`, each once, in the order found.
const findOffensiveWords = (text) => {
  if (typeof text !== "string" || !text.trim()) return [];
  const tokens = tokensOf(text);
  const found = new Set();
  for (const token of tokens) {
    const hit = matchWord(token);
    if (hit) found.add(hit);
  }
  if (phrases.length) {
    const joined = ` ${tokens.map(normaliseWord).join(" ")} `;
    for (const [phrase, entry] of phrases) {
      if (joined.includes(phrase)) found.add(entry);
    }
  }
  return [...found];
};

const containsOffensiveWords = (text) => findOffensiveWords(text).length > 0;

module.exports = { findOffensiveWords, containsOffensiveWords };

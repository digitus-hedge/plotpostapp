// Turns the price and bedrooms text sellers type into numbers, so the feed
// can filter by price and bedrooms. The text itself is never changed.
//
//   "₹1.45 crore"      -> 14500000
//   "₹38 lakh", "38L"  -> 3800000
//   "₹50,00,000"       -> 5000000
//   "₹18,000 / month"  -> 18000   (rent: the amount per month)
//   "40-50 lakh"       -> 4000000 (a range counts as its lower end)
//   "Price on request" -> null    (no number: left out of price filters)
//
// A bare small number ("₹38") is ambiguous (38 lakh? 38 thousand?), so it
// gives null instead of a guess. Bare numbers of 1,000 or more are rupees.

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
// Longer words first, so "lakhs" isn't read as "l".
const UNIT = String.raw`(crores?|cr|lakhs?|lacs?|lakh|lac|l|thousands?|k)\b`;
const PRICE_PATTERN = new RegExp(
  `${NUMBER}(?:\\s*(?:-|–|to)\\s*${NUMBER})?\\s*(?:${UNIT})?`,
  "gi"
);

const MULTIPLIER = { cr: 1e7, crore: 1e7, l: 1e5, lakh: 1e5, lac: 1e5, k: 1e3, thousand: 1e3 };
const MAX_PRICE = 1e11; // ₹10,000 crore; anything bigger is a typo

const toNumber = (digits) => Number(String(digits).replace(/,/g, ""));

// "Crores" -> crore, "lacs" -> lac, "L" -> l, ...
const multiplierFor = (unit) => MULTIPLIER[unit.toLowerCase().replace(/s$/, "")];

// Rupees as a whole number, or null when there's no clear price.
const parsePrice = (text) => {
  if (typeof text !== "string" || text.trim() === "") return null;

  let bare = null;
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const [, first, , unit] = match;
    const amount = toNumber(first);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (unit) {
      const value = Math.round(amount * multiplierFor(unit));
      return value > 0 && value <= MAX_PRICE ? value : null;
    }
    // No unit: remember the first big enough number, but keep looking in
    // case a later one has a unit ("2 BHK for 35 lakh").
    if (bare === null && amount >= 1000) bare = Math.round(amount);
  }
  return bare !== null && bare <= MAX_PRICE ? bare : null;
};

// "3", "3 BHK", "3+" -> 3. Empty or no number -> null.
const parseBedrooms = (text) => {
  if (typeof text !== "string") return null;
  const match = text.match(/\d+/);
  if (!match) return null;
  const count = Number(match[0]);
  return count >= 0 && count <= 50 ? count : null;
};

// The size text sellers type, in square feet, for the size filter:
//
//   "10 cents", "10 cent plot"   -> 4356   (1 cent = 435.6 sq ft)
//   "1850 sq ft", "1,850 sqft"   -> 1850
//   "2 acres"                    -> 87120  (1 acre = 43,560 sq ft)
//   "1 acre 20 cents"            -> 52272
//   "120 sq m"                   -> 1292
//   "10-12 cents"                -> 4356   (a range counts as its lower end)
//   "10", "big plot", ""         -> null   (no unit: left out of size filters)
//
// When the text has more than one size ("1850 sq ft house on 10 cents"),
// the first one counts.
const SQFT_PER = { acre: 43560, cent: 435.6, sqft: 1, sqm: 10.7639 };
const MAX_AREA = 1e8; // about 2,300 acres; anything bigger is a typo
const AREA_UNIT = String.raw`(acres?|cents?|sq\.?\s?(?:ft|feet)\.?|sqft|sft|square\s?(?:feet|foot|ft)|sq\.?\s?m(?:tr|trs)?\.?|sq\.?\s?met(?:er|re)s?|sqm|square\s?met(?:er|re)s?)(?![a-z])`;
const AREA_PATTERN = new RegExp(
  `${NUMBER}(?:\\s*(?:-|–|to)\\s*${NUMBER})?\\s*${AREA_UNIT}`,
  "gi"
);
const ACRES_AND_CENTS = new RegExp(
  `${NUMBER}\\s*acres?\\s*(?:and|&|,|\\+)?\\s*${NUMBER}\\s*cents?(?![a-z])`,
  "i"
);

// "Sq. ft" -> sqft, "cents" -> cent, "square metres" -> sqm, ...
const areaUnitKey = (unit) => {
  const letters = unit.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.startsWith("acre")) return "acre";
  if (letters.startsWith("cent")) return "cent";
  if (letters.endsWith("ft") || letters.endsWith("feet") || letters.endsWith("foot")) return "sqft";
  return "sqm";
};

const inRange = (sqft) => {
  const value = Math.round(sqft);
  return value > 0 && value <= MAX_AREA ? value : null;
};

// Square feet as a whole number, or null when there's no clear size.
const parseArea = (text) => {
  if (typeof text !== "string" || text.trim() === "") return null;

  const both = text.match(ACRES_AND_CENTS);
  if (both) {
    const acres = toNumber(both[1]);
    const cents = toNumber(both[2]);
    if (Number.isFinite(acres) && Number.isFinite(cents)) {
      return inRange(acres * SQFT_PER.acre + cents * SQFT_PER.cent);
    }
  }

  for (const match of text.matchAll(AREA_PATTERN)) {
    const [, first, , unit] = match;
    const amount = toNumber(first);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return inRange(amount * SQFT_PER[areaUnitKey(unit)]);
  }
  return null;
};

module.exports = { parsePrice, parseBedrooms, parseArea, SQFT_PER };

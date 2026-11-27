// Hides phone numbers written inside post text (title, caption, description)
// from people who aren't logged in. Instagram and Facebook captions often
// include "Call 98950 12345", which would undo hiding the seller's phone field.
//
// What counts as a phone number here:
//   - Indian mobiles: 10 digits starting 6-9, optionally with +91 / 91 / 0
//     in front, with spaces, dots or dashes anywhere between the digits
//     ("98950 12345", "+91-98950-12345", "098950 12345").
//   - Landlines: 0 + area code + number, 10-11 digits in all
//     ("0495 2721234", "0484-2345678").
// Prices ("₹1,20,00,000", "45 lakhs"), areas ("2400 sqft"), pin codes
// (673001) and dates are left alone: they are too short or use commas.

const HIDDEN = "[number hidden · log in to see it]";

// Digits may be split by one space, dot or dash at a time.
const SEP = "[\\s.\\-]?";
const MOBILE = `(?:(?:\\+|00)?91${SEP}|0${SEP})?[6-9](?:${SEP}\\d){9}`;
const LANDLINE = `0[1-9]\\d{1,3}${SEP}\\d(?:${SEP}\\d){5,7}`;
// Not part of a longer number or a price ("85,00,000"), and not inside a
// link path ("/p/9895...").
const PATTERN = new RegExp(`(?<![\\d/+,])(?:${MOBILE}|${LANDLINE})(?![\\d])`, "g");

const digitCount = (text) => (text.match(/\d/g) || []).length;

const maskPhoneNumbers = (text) => {
  if (typeof text !== "string" || !text) return text;
  return text.replace(PATTERN, (match) => {
    const digits = digitCount(match);
    // A landline must be 10-11 digits; a mobile 10 (+ country code or 0).
    if (digits < 10 || digits > 13) return match;
    return HIDDEN;
  });
};

const hasPhoneNumber = (text) => typeof text === "string" && maskPhoneNumbers(text) !== text;

module.exports = { maskPhoneNumbers, hasPhoneNumber, HIDDEN };
